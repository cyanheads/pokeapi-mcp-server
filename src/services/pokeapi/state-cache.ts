/**
 * @fileoverview Response cache over `ctx.state` that saves requests and never fails a call: a
 * storage-provider failure reads as a miss or leaves the value unstored.
 * @module services/pokeapi/state-cache
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';

/**
 * Codes `ctx.state` and the framework's `StorageService` raise for the server's own key, TTL, or
 * tenant before any provider runs. They name a defect in the call, so they propagate.
 */
const READ_DEFECTS: ReadonlySet<JsonRpcErrorCode> = new Set([
  JsonRpcErrorCode.ValidationError,
  JsonRpcErrorCode.InvalidParams,
  JsonRpcErrorCode.InvalidRequest,
]);

/**
 * A write also propagates `SerializationError`: every provider encodes the value before storing
 * it, so on a write that code means the server's own value has no JSON form. On a read it means a
 * stored value the provider cannot decode, which is a storage failure.
 */
const WRITE_DEFECTS: ReadonlySet<JsonRpcErrorCode> = new Set([
  ...READ_DEFECTS,
  JsonRpcErrorCode.SerializationError,
]);

/** Key prefixes (`pokeapi/{resource}`) whose skipped write has been logged by this process. */
const warnedResources = new Set<string>();

/** Reads `key`. A storage-provider failure reads as a miss. */
export async function readCache<T>(ctx: Context, key: string): Promise<T | null> {
  try {
    return await ctx.state.get<T>(key);
  } catch (err) {
    rethrowUnlessStorageFailure(err, READ_DEFECTS, ctx);
    return null;
  }
}

/**
 * Stores `value` under `key` for `ttlSeconds`. A storage-provider failure, such as the in-memory
 * provider's capacity limit, leaves the value unstored; the first for each key prefix is logged
 * at warning, naming the prefix but never the key's identifier or the value.
 */
export async function writeCache(
  ctx: Context,
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  try {
    await ctx.state.set(key, value, { ttl: ttlSeconds });
  } catch (err) {
    rethrowUnlessStorageFailure(err, WRITE_DEFECTS, ctx);
    const resource = key.split('/', 2).join('/');
    if (warnedResources.has(resource)) return;
    warnedResources.add(resource);
    ctx.log.warning(
      'The storage provider rejected a PokéAPI cache write; the call continues uncached. Later rejections for this resource are not logged.',
      { resource, code: err.code, detail: err.message },
    );
  }
}

/**
 * Rethrows caller cancellation (read from the call's signal, never the error), any non-`McpError`
 * (the framework's providers reject only with `McpError`, remote ones through `ErrorHandler`), and
 * a code in `defects`. What remains came from the storage provider.
 */
function rethrowUnlessStorageFailure(
  err: unknown,
  defects: ReadonlySet<JsonRpcErrorCode>,
  ctx: Context,
): asserts err is McpError {
  ctx.signal.throwIfAborted();
  if (!(err instanceof McpError) || defects.has(err.code)) throw err;
}
