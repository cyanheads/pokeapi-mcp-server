/**
 * @fileoverview The PokéAPI request failures a best-effort read degrades on instead of failing
 * its call.
 * @module services/pokeapi/upstream-failure
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';

/**
 * True when a PokéAPI request ended without a usable answer: a non-2xx status
 * (`fetchWithTimeout` marks it `FetchHttpError`), an unreachable host or unusable body
 * (`ServiceUnavailable`), or a request or retry deadline that ran out (`Timeout`). Callers check
 * their own cancellation first; a programmer error is never matched.
 */
export function isUpstreamUnavailable(err: unknown): err is McpError {
  return (
    err instanceof McpError &&
    (err.data?.errorSource === 'FetchHttpError' ||
      err.code === JsonRpcErrorCode.ServiceUnavailable ||
      err.code === JsonRpcErrorCode.Timeout)
  );
}
