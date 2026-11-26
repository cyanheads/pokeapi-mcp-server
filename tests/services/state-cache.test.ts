/**
 * @fileoverview The response cache's storage-failure rule: which `ctx.state` rejections read as a
 * miss or skip a write, which propagate, cancellation, and the one warning per resource a skipped
 * write logs.
 * @module tests/services/state-cache.test
 */

import {
  databaseError,
  internalError,
  JsonRpcErrorCode,
  type McpError,
  notFound,
  rateLimited,
  serializationError,
  serviceUnavailable,
  timeout,
} from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCache, writeCache } from '@/services/pokeapi/state-cache.js';
import { capacityError } from '../fixtures/storage-failures.js';

const KEY = 'pokeapi/move/1';

/** Provider failures as remote providers surface them through the framework's `ErrorHandler`. */
const PROVIDER_FAILURES: Array<[string, () => McpError | Promise<McpError>]> = [
  ['a database failure', () => databaseError('Store offline')],
  ['an unreachable remote store', () => serviceUnavailable('Storage unreachable')],
  ['a remote store timeout', () => timeout('Storage timed out')],
  ['a remote store rate limit', () => rateLimited('Storage throttled')],
  ['a remote failure classified as not found', () => notFound('No such table')],
  ['an internal provider fault', () => internalError('Storage fault')],
];

/** A context whose `ctx.state` reads and writes `storage`. */
function contextOver(storage: StorageService) {
  const ctx = createMockContext();
  const state: typeof ctx.state = {
    ...ctx.state,
    get: <T>(key: string) => storage.get<T>(key, ctx),
    set: (key, value, options) => storage.set(key, value, ctx, options),
  };
  return { ...ctx, state };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('readCache', () => {
  it('returns a stored value, and null for a key never stored', async () => {
    const ctx = createMockContext();
    await writeCache(ctx, KEY, { name: 'pound' }, 60);
    expect(await readCache(ctx, KEY)).toEqual({ name: 'pound' });
    expect(await readCache(ctx, 'pokeapi/move/2')).toBeNull();
  });

  it.each<[string, () => McpError | Promise<McpError>]>([
    ...PROVIDER_FAILURES,
    ['a stored value the provider cannot decode', () => serializationError('Bad entry')],
  ])('reads %s as a miss without logging', async (_label, failure) => {
    const ctx = createMockContext();
    vi.spyOn(ctx.state, 'get').mockRejectedValue(await failure());
    const warning = vi.spyOn(ctx.log, 'warning');
    expect(await readCache(ctx, KEY)).toBeNull();
    expect(warning).not.toHaveBeenCalled();
  });

  it.each([
    [
      'an invalid key',
      () => readCache(createMockContext(), 'pokeapi/move/bad key'),
      JsonRpcErrorCode.ValidationError,
    ],
    [
      'a missing tenant',
      () => readCache(createMockContext({ tenantId: '' }), KEY),
      JsonRpcErrorCode.InvalidRequest,
    ],
    [
      'an invalid tenant',
      () => readCache(createMockContext({ tenantId: 'bad tenant' }), KEY),
      JsonRpcErrorCode.InvalidParams,
    ],
  ] as const)('propagates %s', async (_label, read, code) => {
    await expect(read()).rejects.toMatchObject({ code });
  });

  it('propagates a programmer error', async () => {
    const ctx = createMockContext();
    const bug = new TypeError('cache bug');
    vi.spyOn(ctx.state, 'get').mockRejectedValue(bug);
    await expect(readCache(ctx, KEY)).rejects.toBe(bug);
  });
});

describe('writeCache', () => {
  it('stores the value for the TTL it is given', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const ctx = createMockContext();
    await writeCache(ctx, KEY, 'pound', 60);
    vi.setSystemTime(Date.now() + 60_000);
    expect(await readCache(ctx, KEY)).toBe('pound');
    vi.setSystemTime(Date.now() + 1);
    expect(await readCache(ctx, KEY)).toBeNull();
  });

  it.each<[string, () => McpError | Promise<McpError>]>([
    ['the in-memory capacity limit', capacityError],
    ...PROVIDER_FAILURES,
  ])('skips a write the store rejects with %s', async (_label, failure) => {
    const ctx = createMockContext();
    vi.spyOn(ctx.state, 'set').mockRejectedValue(await failure());
    await expect(writeCache(ctx, KEY, 'pound', 60)).resolves.toBeUndefined();
  });

  it.each([
    [
      'an invalid key',
      () => writeCache(createMockContext(), 'pokeapi/move/bad key', 1, 60),
      JsonRpcErrorCode.ValidationError,
    ],
    [
      'a negative TTL',
      () => writeCache(createMockContext(), KEY, 1, -1),
      JsonRpcErrorCode.ValidationError,
    ],
    [
      'a value with no JSON form',
      () => writeCache(createMockContext(), KEY, 1n, 60),
      JsonRpcErrorCode.SerializationError,
    ],
    [
      'a missing tenant',
      () => writeCache(createMockContext({ tenantId: '' }), KEY, 1, 60),
      JsonRpcErrorCode.InvalidRequest,
    ],
  ] as const)('propagates %s', async (_label, write, code) => {
    await expect(write()).rejects.toMatchObject({ code });
  });

  it('propagates a programmer error', async () => {
    const ctx = createMockContext();
    const bug = new TypeError('cache bug');
    vi.spyOn(ctx.state, 'set').mockRejectedValue(bug);
    await expect(writeCache(ctx, KEY, 1, 60)).rejects.toBe(bug);
  });

  it('logs the first skipped write per resource at warning, without the identifier or value', async () => {
    const capacity = await capacityError();
    const ctx = createMockContext();
    vi.spyOn(ctx.state, 'set').mockRejectedValue(capacity);
    const warning = vi.spyOn(ctx.log, 'warning');
    for (const key of [
      'pokeapi/log-probe-a/1',
      'pokeapi/log-probe-a/2',
      'pokeapi/log-probe-b/list',
    ]) {
      await writeCache(ctx, key, { flavor: 'VALUE-MARKER' }, 60);
    }
    await writeCache(ctx, 'pokeapi/log-probe-b/list', 'VALUE-MARKER', 60);
    expect(warning.mock.calls.map(([, data]) => data)).toEqual([
      { resource: 'pokeapi/log-probe-a', code: capacity.code, detail: capacity.message },
      { resource: 'pokeapi/log-probe-b', code: capacity.code, detail: capacity.message },
    ]);
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain('VALUE-MARKER');
    expect(logged).not.toMatch(/log-probe-a\/1|log-probe-b\/list/);
  });

  it('skips writes past a real in-memory store’s capacity and keeps what it holds', async () => {
    const ctx = contextOver(createInMemoryStorage({ maxEntries: 1 }));
    await writeCache(ctx, 'pokeapi/move/1', 'pound', 60);
    await writeCache(ctx, 'pokeapi/move/2', 'karate-chop', 60);
    expect(await readCache(ctx, 'pokeapi/move/1')).toBe('pound');
    expect(await readCache(ctx, 'pokeapi/move/2')).toBeNull();
  });
});

describe('cancellation', () => {
  it('surfaces a call cancelled before the store is touched', async () => {
    const controller = new AbortController();
    controller.abort(new DOMException('Caller cancelled', 'AbortError'));
    const ctx = createMockContext({ signal: controller.signal });
    await expect(readCache(ctx, KEY)).rejects.toBe(controller.signal.reason);
    await expect(writeCache(ctx, KEY, 1, 60)).rejects.toBe(controller.signal.reason);
  });

  it.each(['get', 'set'] as const)(
    'surfaces cancellation that arrives while the store fails a %s',
    async (operation) => {
      const controller = new AbortController();
      const reason = new DOMException('Caller cancelled', 'AbortError');
      const ctx = createMockContext({ signal: controller.signal });
      vi.spyOn(ctx.state, operation).mockImplementation(() => {
        controller.abort(reason);
        return Promise.reject(databaseError('Store offline'));
      });
      const warning = vi.spyOn(ctx.log, 'warning');
      const call = operation === 'get' ? readCache(ctx, KEY) : writeCache(ctx, KEY, 1, 60);
      await expect(call).rejects.toBe(reason);
      expect(warning).not.toHaveBeenCalled();
    },
  );
});
