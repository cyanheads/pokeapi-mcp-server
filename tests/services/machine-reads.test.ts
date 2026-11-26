/**
 * @fileoverview Machine-record reads: row order, base-URL routing, caching, per-row degradation,
 * the shared time budget, and cancellation.
 * @module tests/services/machine-reads.test
 */

import {
  databaseError,
  JsonRpcErrorCode,
  McpError,
  serviceUnavailable,
} from '@cyanheads/mcp-ts-core/errors';
import { createFetchMock, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MACHINE_READ_BUDGET_MS,
  MachineReadPause,
  type MachineReadSettings,
  readMachineRows,
} from '@/services/pokeapi/machine-reads.js';
import type { RawMachineRef } from '@/services/pokeapi/types.js';
import { capacityError } from '../fixtures/storage-failures.js';

const BASE = 'https://pokeapi.co/api/v2';
/** The per-request timeout sits well above the budget, so only the budget can end a stalled read. */
const SETTINGS: MachineReadSettings = {
  baseUrl: BASE,
  cacheTtlSeconds: 60,
  pause: new MachineReadPause(),
  requestTimeoutMs: 10 * MACHINE_READ_BUDGET_MS,
};
const ITEM = { owner: 'tm01', report: 'move' } as const;

const named = (name: string, kind: string) => ({ name, url: `${BASE}/${kind}/1/` });
const ref = (id: number, url = `${BASE}/machine/${id}/`): RawMachineRef => ({
  machine: { url },
  version_group: named(`group-${id}`, 'version-group'),
});
const record = (id: number) => ({
  id,
  item: named('tm01', 'item'),
  move: named(`move-${id}`, 'move'),
  version_group: named(`group-${id}`, 'version-group'),
});
const refs = (count: number) => Array.from({ length: count }, (_, index) => ref(index + 1));
const machineId = (request: Request) => Number(new URL(request.url).pathname.split('/').at(-1));

/** Serves `machine/{id}` from `respond`, defaulting to the matching record. */
function machineHttp(
  respond: (id: number, request: Request) => Response | Promise<Response> = (id) =>
    Response.json(record(id)),
) {
  return createFetchMock([
    {
      match: (request) => request.url.startsWith(`${BASE}/machine/`),
      respond: (request) => respond(machineId(request), request),
    },
  ]);
}

/** Rejects with the request signal's reason once it aborts; never settles otherwise. */
function untilAborted(request: Request) {
  return new Promise<never>((_, reject) => {
    const abort = () => reject(request.signal.reason);
    if (request.signal.aborted) abort();
    else request.signal.addEventListener('abort', abort, { once: true });
  });
}

/** A response whose headers never arrive. */
const stall = (request: Request): Promise<Response> => untilAborted(request);

const machineUrls = (http: ReturnType<typeof machineHttp>) =>
  http.calls.map(({ request }) => request.url);

afterEach(() => {
  vi.useRealTimers();
});

describe('readMachineRows', () => {
  it('reports each row in upstream order and caches records for the configured TTL', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const http = machineHttp();
    http.install();
    try {
      const ctx = createMockContext();
      const rows = [ref(3), ref(1), ref(2)];
      const first = await readMachineRows(rows, ITEM, SETTINGS, ctx);
      expect(first).toEqual({
        rows: [
          { versionGroup: 'group-3', name: 'move-3' },
          { versionGroup: 'group-1', name: 'move-1' },
          { versionGroup: 'group-2', name: 'move-2' },
        ],
        notices: [],
      });
      expect(await readMachineRows(rows, ITEM, SETTINGS, ctx)).toEqual(first);
      expect(http.calls).toHaveLength(3);
      vi.setSystemTime(Date.now() + SETTINGS.cacheTtlSeconds * 1_000 + 1);
      await readMachineRows(rows, ITEM, SETTINGS, ctx);
      expect(http.calls).toHaveLength(6);
    } finally {
      http.restore();
    }
  });

  it('reports the item side of a record for a move', async () => {
    const http = machineHttp();
    http.install();
    try {
      const result = await readMachineRows(
        [ref(7)],
        { owner: 'move-7', report: 'item' },
        SETTINGS,
        createMockContext(),
      );
      expect(result).toEqual({ rows: [{ versionGroup: 'group-7', name: 'tm01' }], notices: [] });
    } finally {
      http.restore();
    }
  });

  it('reads each record by ID from the configured base URL, never the URL as given', async () => {
    const http = machineHttp();
    http.install();
    try {
      const result = await readMachineRows(
        [
          ref(530, 'https://elsewhere.test/api/v2/machine/530/'),
          ref(531, 'https://elsewhere.test/api/v2/machine/531'),
          ref(532, `${BASE}/machine/latest/`),
        ],
        ITEM,
        SETTINGS,
        createMockContext(),
      );
      expect(machineUrls(http)).toEqual([`${BASE}/machine/530`, `${BASE}/machine/531`]);
      expect(result.rows.map((row) => row.name)).toEqual(['move-530', 'move-531', null]);
      expect(result.notices).toEqual([
        'Machine records could not be read for: group-532. Their move is null.',
      ]);
    } finally {
      http.restore();
    }
  });

  it('makes no request for an empty row list', async () => {
    const http = machineHttp();
    http.install();
    try {
      expect(await readMachineRows([], ITEM, SETTINGS, createMockContext())).toEqual({
        rows: [],
        notices: [],
      });
      expect(http.calls).toHaveLength(0);
    } finally {
      http.restore();
    }
  });

  it.each<[string, (id: number) => Response | Promise<Response>]>([
    ['HTTP 503', () => new Response('Unavailable', { status: 503 })],
    ['HTTP 404', () => new Response('Not Found', { status: 404 })],
    // A 504 maps to Timeout like a spent budget, but it answered: the row failed, not ran late.
    ['HTTP 504', () => new Response('Gateway Timeout', { status: 504 })],
    ['an HTML body', () => new Response('<html>Gateway response</html>')],
    ['a record without a move', (id) => Response.json({ ...record(id), move: null })],
    [
      'a dropped connection',
      () => {
        throw new TypeError('Connection closed');
      },
    ],
  ])('nulls only the row whose record fails with %s, and rereads it', async (_label, failure) => {
    const http = machineHttp((id) => (id === 2 ? failure(id) : Response.json(record(id))));
    http.install();
    try {
      const ctx = createMockContext();
      const result = await readMachineRows(refs(3), ITEM, SETTINGS, ctx);
      expect(result).toEqual({
        rows: [
          { versionGroup: 'group-1', name: 'move-1' },
          { versionGroup: 'group-2', name: null },
          { versionGroup: 'group-3', name: 'move-3' },
        ],
        notices: ['Machine records could not be read for: group-2. Their move is null.'],
      });
      await readMachineRows(refs(3), ITEM, SETTINGS, ctx);
      expect(machineUrls(http).slice(3)).toEqual([`${BASE}/machine/2`]);
    } finally {
      http.restore();
    }
  });

  it.each([
    ['another item', { item: named('tm99', 'item') }],
    ['another version group', { version_group: named('other', 'version-group') }],
  ])('nulls a row whose record belongs to %s', async (_label, mismatch) => {
    const http = machineHttp((id) => Response.json({ ...record(id), ...mismatch }));
    http.install();
    try {
      expect(await readMachineRows(refs(1), ITEM, SETTINGS, createMockContext())).toEqual({
        rows: [{ versionGroup: 'group-1', name: null }],
        notices: ['Machine records could not be read for: group-1. Their move is null.'],
      });
    } finally {
      http.restore();
    }
  });

  it('stops at the budget and sends nothing once it is spent', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const http = machineHttp((_id, request) => stall(request));
    http.install();
    try {
      let settled = false;
      const pending = readMachineRows(refs(26), ITEM, SETTINGS, createMockContext()).finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(MACHINE_READ_BUDGET_MS - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      const result = await pending;
      expect(result.rows.every((row) => row.name === null)).toBe(true);
      expect(result.notices).toEqual([
        `Machine records were not read within the 3-second budget for: ${result.rows.map((row) => row.versionGroup).join(', ')}. Their move is null; call again to read them.`,
      ]);
      // Eight reads were in flight when the budget ran out; the other eighteen never started.
      expect(http.calls).toHaveLength(8);
    } finally {
      http.restore();
    }
  });

  it.each([
    [MACHINE_READ_BUDGET_MS - 2, 9],
    [MACHINE_READ_BUDGET_MS - 1, 8],
  ])('reads that finish at %i ms leave the ninth row %i requests', async (delayMs, requests) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const http = machineHttp((id, request) =>
      id === 9
        ? stall(request)
        : new Promise((resolve) => setTimeout(() => resolve(Response.json(record(id))), delayMs)),
    );
    http.install();
    try {
      const pending = readMachineRows(refs(9), ITEM, SETTINGS, createMockContext());
      await vi.advanceTimersByTimeAsync(MACHINE_READ_BUDGET_MS);
      const result = await pending;
      expect(result.rows.map((row) => row.name)).toEqual([
        ...Array.from({ length: 8 }, (_, index) => `move-${index + 1}`),
        null,
      ]);
      expect(result.notices).toEqual([
        'Machine records were not read within the 3-second budget for: group-9. Their move is null; call again to read them.',
      ]);
      // With 1 ms left, the ninth read is spent before it starts.
      expect(http.calls).toHaveLength(requests);
    } finally {
      http.restore();
    }
  });

  it('bounds a response body that stalls after its headers', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    let pulls = 0;
    const http = machineHttp(
      (_id, request) =>
        new Response(
          new ReadableStream(
            {
              pull: () => {
                pulls++;
                return untilAborted(request);
              },
            },
            { highWaterMark: 0 },
          ),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    );
    http.install();
    try {
      let settled = false;
      const pending = readMachineRows(refs(1), ITEM, SETTINGS, createMockContext()).finally(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(MACHINE_READ_BUDGET_MS - 1);
      expect(pulls).toBeGreaterThan(0);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toEqual({
        rows: [{ versionGroup: 'group-1', name: null }],
        notices: [
          'Machine records were not read within the 3-second budget for: group-1. Their move is null; call again to read them.',
        ],
      });
    } finally {
      http.restore();
    }
  });

  it('names late and failed rows in separate notices', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const http = machineHttp((id, request) =>
      id === 1 ? stall(request) : new Response('Unavailable', { status: 503 }),
    );
    http.install();
    try {
      const pending = readMachineRows(refs(2), ITEM, SETTINGS, createMockContext());
      await vi.advanceTimersByTimeAsync(MACHINE_READ_BUDGET_MS);
      expect((await pending).notices).toEqual([
        'Machine records were not read within the 3-second budget for: group-1. Their move is null; call again to read them.',
        'Machine records could not be read for: group-2. Their move is null.',
      ]);
    } finally {
      http.restore();
    }
  });

  it('propagates caller cancellation instead of reporting late rows', async () => {
    const controller = new AbortController();
    const reason = new DOMException('Caller cancelled', 'AbortError');
    const http = machineHttp((_id, request) => {
      controller.abort(reason);
      return stall(request);
    });
    http.install();
    try {
      await expect(
        readMachineRows(refs(9), ITEM, SETTINGS, createMockContext({ signal: controller.signal })),
      ).rejects.toBe(reason);
      // Eight reads can be in flight when the caller cancels; the ninth row never starts.
      expect(machineUrls(http)).not.toContain(`${BASE}/machine/9`);
    } finally {
      http.restore();
    }
  });

  it('sends nothing for a call cancelled before its reads start', async () => {
    const controller = new AbortController();
    controller.abort();
    const http = machineHttp();
    http.install();
    try {
      await expect(
        readMachineRows(refs(3), ITEM, SETTINGS, createMockContext({ signal: controller.signal })),
      ).rejects.toBe(controller.signal.reason);
      expect(http.calls).toHaveLength(0);
    } finally {
      http.restore();
    }
  });

  it('reads past a failing cache and returns a record the cache cannot store', async () => {
    const http = machineHttp();
    http.install();
    try {
      const ctx = createMockContext();
      const get = vi
        .spyOn(ctx.state, 'get')
        .mockRejectedValueOnce(new McpError(JsonRpcErrorCode.SerializationError, 'Bad entry'));
      const set = vi.spyOn(ctx.state, 'set').mockRejectedValueOnce(databaseError('Read-only'));
      expect((await readMachineRows(refs(1), ITEM, SETTINGS, ctx)).rows).toEqual([
        { versionGroup: 'group-1', name: 'move-1' },
      ]);
      expect([get.mock.calls.length, set.mock.calls.length]).toEqual([1, 1]);
      // The unstored record is read again; the next write succeeds and serves the third call.
      await readMachineRows(refs(1), ITEM, SETTINGS, ctx);
      await readMachineRows(refs(1), ITEM, SETTINGS, ctx);
      expect(http.calls).toHaveLength(2);
    } finally {
      http.restore();
    }
  });

  it('resolves every row when the full store rejects each record write', async () => {
    const http = machineHttp();
    http.install();
    try {
      const ctx = createMockContext();
      vi.spyOn(ctx.state, 'set').mockRejectedValue(await capacityError());
      expect(await readMachineRows(refs(9), ITEM, SETTINGS, ctx)).toEqual({
        rows: Array.from({ length: 9 }, (_, index) => ({
          versionGroup: `group-${index + 1}`,
          name: `move-${index + 1}`,
        })),
        notices: [],
      });
      expect(http.calls).toHaveLength(9);
    } finally {
      http.restore();
    }
  });

  it('resolves a row past a cache read the storage provider cannot answer', async () => {
    const http = machineHttp();
    http.install();
    try {
      const ctx = createMockContext();
      vi.spyOn(ctx.state, 'get').mockRejectedValue(serviceUnavailable('Storage unreachable'));
      expect(await readMachineRows(refs(1), ITEM, SETTINGS, ctx)).toEqual({
        rows: [{ versionGroup: 'group-1', name: 'move-1' }],
        notices: [],
      });
    } finally {
      http.restore();
    }
  });

  it('propagates caller cancellation from a record write the store also fails', async () => {
    const capacity = await capacityError();
    const controller = new AbortController();
    const reason = new DOMException('Caller cancelled', 'AbortError');
    const http = machineHttp();
    http.install();
    try {
      const ctx = createMockContext({ signal: controller.signal });
      vi.spyOn(ctx.state, 'set').mockImplementation(() => {
        controller.abort(reason);
        return Promise.reject(capacity);
      });
      await expect(readMachineRows(refs(1), ITEM, SETTINGS, ctx)).rejects.toBe(reason);
    } finally {
      http.restore();
    }
  });

  it('propagates a programmer error instead of degrading the row', async () => {
    const http = machineHttp();
    http.install();
    try {
      const ctx = createMockContext();
      const bug = new TypeError('cache bug');
      vi.spyOn(ctx.state, 'get').mockRejectedValue(bug);
      await expect(readMachineRows(refs(3), ITEM, SETTINGS, ctx)).rejects.toBe(bug);
      expect(http.calls).toHaveLength(0);
    } finally {
      http.restore();
    }
  });
});

describe('readMachineRows under a PokéAPI rate limit', () => {
  const rateLimited = (retryAfter?: string) =>
    new Response('Too Many Requests', {
      status: 429,
      headers: retryAfter === undefined ? {} : { 'Retry-After': retryAfter },
    });
  const limitedNotice = (groups: string) =>
    `Machine records were not read for: ${groups} because PokéAPI is rate-limiting requests. Their move is null; call again later to read them.`;
  const pausedSettings = () => ({ ...SETTINGS, pause: new MachineReadPause() });

  it('stops the call’s remaining reads and pauses later calls until Retry-After passes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    let release = () => {};
    const inFlight = new Promise<void>((resolve) => {
      release = resolve;
    });
    let seen = 0;
    let limited = true;
    const http = machineHttp(async (id) => {
      // Every response waits until eight reads are in flight, so the first 429 lands mid-call.
      if (++seen === 8) release();
      await inFlight;
      return limited ? rateLimited('8') : Response.json(record(id));
    });
    http.install();
    try {
      const settings = pausedSettings();
      const ctx = createMockContext();
      const first = await readMachineRows(refs(10), ITEM, settings, ctx);
      expect(first.rows.map((row) => row.name)).toEqual(Array(10).fill(null));
      expect(first.notices).toEqual([
        limitedNotice(first.rows.map((row) => row.versionGroup).join(', ')),
      ]);
      // Eight reads were in flight when the first 429 arrived; the last two never started.
      expect(http.calls).toHaveLength(8);

      limited = false;
      vi.setSystemTime(Date.now() + 7_999);
      expect((await readMachineRows(refs(1), ITEM, settings, ctx)).notices).toEqual([
        limitedNotice('group-1'),
      ]);
      expect(http.calls).toHaveLength(8);
      vi.setSystemTime(Date.now() + 1);
      expect(await readMachineRows(refs(1), ITEM, settings, ctx)).toEqual({
        rows: [{ versionGroup: 'group-1', name: 'move-1' }],
        notices: [],
      });
      expect(http.calls).toHaveLength(9);
    } finally {
      http.restore();
    }
  });

  it.each([
    ['no Retry-After', undefined, 5_000],
    ['a Retry-After under the 5-second floor', '1', 5_000],
    ['a Retry-After past the 60-second cap', '120', 60_000],
    ['an HTTP-date Retry-After', 'Thu, 01 Jan 2026 00:00:08 GMT', 8_000],
  ])('pauses for %s', async (_label, retryAfter, pauseMs) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    let limited = true;
    const http = machineHttp((id) =>
      limited ? rateLimited(retryAfter) : Response.json(record(id)),
    );
    http.install();
    try {
      const settings = pausedSettings();
      const ctx = createMockContext();
      await readMachineRows(refs(1), ITEM, settings, ctx);
      limited = false;
      vi.setSystemTime(Date.now() + pauseMs - 1);
      await readMachineRows(refs(1), ITEM, settings, ctx);
      expect(http.calls).toHaveLength(1);
      vi.setSystemTime(Date.now() + 1);
      await readMachineRows(refs(1), ITEM, settings, ctx);
      expect(http.calls).toHaveLength(2);
    } finally {
      http.restore();
    }
  });

  it('serves cached rows while reads are paused', async () => {
    const http = machineHttp((id) => (id === 2 ? rateLimited('60') : Response.json(record(id))));
    http.install();
    try {
      const settings = pausedSettings();
      const ctx = createMockContext();
      await readMachineRows([ref(1)], ITEM, settings, ctx);
      await readMachineRows([ref(2)], ITEM, settings, ctx);
      expect(await readMachineRows(refs(2), ITEM, settings, ctx)).toEqual({
        rows: [
          { versionGroup: 'group-1', name: 'move-1' },
          { versionGroup: 'group-2', name: null },
        ],
        notices: [limitedNotice('group-2')],
      });
      expect(http.calls).toHaveLength(2);
    } finally {
      http.restore();
    }
  });
});
