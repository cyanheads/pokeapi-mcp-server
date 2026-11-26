/**
 * @fileoverview Best-effort reads of PokéAPI machine records — the TM, TR, or HM an item is, or that
 * teaches a move, in each version group — under one time budget per call.
 * @module services/pokeapi/machine-reads
 */

import { type Context, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, type McpError, serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import { fetchWithTimeout, withRetry } from '@cyanheads/mcp-ts-core/utils';
import { readCache, writeCache } from './state-cache.js';
import type { RawMachineRef } from './types.js';
import { isUpstreamUnavailable } from './upstream-failure.js';

/** One budget covers every machine request and response body of a call. */
export const MACHINE_READ_BUDGET_MS = 3_000;
const MACHINE_READ_CONCURRENCY = 8;

/** Only the record ID is taken from an upstream machine URL; requests go to the configured base URL. */
const MACHINE_URL = /\/machine\/(\d+)\/?$/;

/**
 * Shortest pause after a rate-limited machine read, and the pause when it carries no usable
 * `Retry-After`. A pause no longer than the upstream's limit window lets each resumed burst of
 * machine reads refill that window and crowd out the main reads.
 */
const RATE_LIMIT_PAUSE_MS = 5_000;
/** Longest `Retry-After` a machine read honors. */
const MAX_RATE_LIMIT_PAUSE_MS = 60_000;

/**
 * Machine-record reads are a side lookup beside each call's main read. Once PokéAPI rate-limits
 * one, every call skips them for at least 5 s, or until the `Retry-After` passes when that is
 * later (at most 60 s), leaving the request budget to the main reads. The service holds one
 * instance for the process.
 */
export class MachineReadPause {
  #untilMs = 0;

  get active(): boolean {
    return Date.now() < this.#untilMs;
  }

  /** Extends the pause to the 429's `Retry-After` (delta-seconds or HTTP-date), 5 s to 60 s. */
  extend(rateLimited: McpError): void {
    const header = rateLimited.data?.retryAfter;
    const raw = typeof header === 'string' ? header.trim() : '';
    const hintMs = /^\d+$/.test(raw) ? Number(raw) * 1_000 : Date.parse(raw) - Date.now();
    const pauseMs = Number.isNaN(hintMs)
      ? RATE_LIMIT_PAUSE_MS
      : Math.min(Math.max(hintMs, RATE_LIMIT_PAUSE_MS), MAX_RATE_LIMIT_PAUSE_MS);
    this.#untilMs = Math.max(this.#untilMs, Date.now() + pauseMs);
  }
}

const machineRecordSchema = z.object({
  item: z.object({ name: z.string() }),
  move: z.object({ name: z.string() }),
  version_group: z.object({ name: z.string() }),
});

/** A machine record reduced to the names the tools report, cached under `pokeapi/machine/{id}`. */
interface MachineRecord {
  item: string;
  move: string;
  versionGroup: string;
}

type MachineRead =
  | { status: 'read'; record: MachineRecord }
  | { status: 'late' | 'limited' | 'failed' };

export interface MachineReadSettings {
  baseUrl: string;
  cacheTtlSeconds: number;
  pause: MachineReadPause;
  requestTimeoutMs: number;
}

export interface MachineRowsTarget {
  /** Item or move whose machine rows these are. */
  owner: string;
  /** Machine-record field each row reports: `move` for an item, `item` for a move. */
  report: 'item' | 'move';
}

export interface MachineRow {
  /** Reported item or move. Null when the record could not be read or did not match the row. */
  name: string | null;
  versionGroup: string;
}

/**
 * Resolves machine rows in input order. Reads run at concurrency 8 under one 3 s budget covering
 * every request and response body; successful records are cached for `cacheTtlSeconds`. A row
 * whose record fails, arrives late, is skipped under a rate-limit pause, or names another owner
 * or version group reports null and is named in a notice. Throws only for caller cancellation
 * and programmer errors.
 */
export async function readMachineRows(
  refs: RawMachineRef[],
  target: MachineRowsTarget,
  settings: MachineReadSettings,
  ctx: Context,
): Promise<{ notices: string[]; rows: MachineRow[] }> {
  const deadlineAt = Date.now() + MACHINE_READ_BUDGET_MS;
  const reads: Array<{ ref: RawMachineRef; read: MachineRead }> = [];
  const queue = refs.entries();
  let fatal: { error: unknown } | undefined;
  // Workers share one queue and never reject, so none is left running unobserved; the first fatal
  // error stops new reads.
  const worker = async () => {
    for (const [index, ref] of queue) {
      if (fatal !== undefined) return;
      try {
        reads[index] = { ref, read: await readMachine(ref, deadlineAt, settings, ctx) };
      } catch (error) {
        fatal ??= { error };
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(MACHINE_READ_CONCURRENCY, refs.length) }, worker),
  );
  ctx.signal.throwIfAborted();
  if (fatal) throw fatal.error;

  const owns = target.report === 'move' ? 'item' : 'move';
  const unread: Record<'late' | 'limited' | 'failed', string[]> = {
    late: [],
    limited: [],
    failed: [],
  };
  // With no fatal error, every queued ref was read, so `reads` holds each in input order.
  const rows = reads.map(({ ref, read }): MachineRow => {
    const versionGroup = ref.version_group.name;
    if (
      read.status === 'read' &&
      read.record.versionGroup === versionGroup &&
      read.record[owns] === target.owner
    ) {
      return { versionGroup, name: read.record[target.report] };
    }
    // A record that was read but names another owner or version group counts as failed.
    unread[read.status === 'read' ? 'failed' : read.status].push(versionGroup);
    return { versionGroup, name: null };
  });
  const { late, limited, failed } = unread;
  const notices: string[] = [];
  if (late.length > 0) {
    notices.push(
      `Machine records were not read within the ${MACHINE_READ_BUDGET_MS / 1000}-second budget for: ${late.join(', ')}. Their ${target.report} is null; call again to read them.`,
    );
  }
  if (limited.length > 0) {
    notices.push(
      `Machine records were not read for: ${limited.join(', ')} because PokéAPI is rate-limiting requests. Their ${target.report} is null; call again later to read them.`,
    );
  }
  if (failed.length > 0) {
    notices.push(
      `Machine records could not be read for: ${failed.join(', ')}. Their ${target.report} is null.`,
    );
  }
  return { rows, notices };
}

async function readMachine(
  ref: RawMachineRef,
  deadlineAt: number,
  settings: MachineReadSettings,
  ctx: Context,
): Promise<MachineRead> {
  const id = MACHINE_URL.exec(ref.machine.url)?.[1];
  if (id === undefined) return { status: 'failed' };
  const key = `pokeapi/machine/${id}`;
  ctx.signal.throwIfAborted();
  const cached = await readCache<MachineRecord>(ctx, key);
  if (cached !== null) return { status: 'read', record: cached };

  // A request dispatched with 1 ms or less left would only be aborted on arrival.
  const remainingMs = deadlineAt - Date.now();
  ctx.signal.throwIfAborted();
  if (remainingMs <= 1) return { status: 'late' };
  if (settings.pause.active) return { status: 'limited' };
  let record: MachineRecord;
  try {
    record = await withRetry(
      async (attempt) => {
        const response = await fetchWithTimeout(
          `${settings.baseUrl}/machine/${id}`,
          Math.min(settings.requestTimeoutMs, attempt.remainingMs),
          ctx,
          { signal: attempt.signal, headers: { Accept: 'application/json' } },
        );
        // Malformed JSON fails the schema below; an aborted or failed body keeps its own error.
        const body: unknown = await response.json().catch((err: unknown) => {
          if (err instanceof SyntaxError) return;
          throw err;
        });
        const parsed = machineRecordSchema.safeParse(body);
        if (!parsed.success)
          throw serviceUnavailable('PokéAPI returned an invalid machine record.');
        return {
          item: parsed.data.item.name,
          move: parsed.data.move.name,
          versionGroup: parsed.data.version_group.name,
        };
      },
      {
        operation: 'PokéAPI machine request',
        context: ctx,
        signal: ctx.signal,
        deadlineMs: remainingMs,
        maxRetries: 0,
      },
    );
  } catch (err) {
    ctx.signal.throwIfAborted();
    if (!isUpstreamUnavailable(err)) throw err;
    if (err.code === JsonRpcErrorCode.RateLimited) {
      settings.pause.extend(err);
      return { status: 'limited' };
    }
    // An HTTP 504 also maps to Timeout, but PokéAPI answered it: only a request cut short runs late.
    const cutShort = err.code === JsonRpcErrorCode.Timeout && err.data?.status === undefined;
    return { status: cutShort ? 'late' : 'failed' };
  }
  await writeCache(ctx, key, record, settings.cacheTtlSeconds);
  return { status: 'read', record };
}
