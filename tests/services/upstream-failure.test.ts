/**
 * @fileoverview The upstream-failure predicate shared by move chronology and machine reads.
 * @module tests/services/upstream-failure.test
 */

import {
  internalError,
  notFound,
  requestCancelled,
  serviceUnavailable,
  timeout,
} from '@cyanheads/mcp-ts-core/errors';
import { createFetchMock, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { fetchWithTimeout } from '@cyanheads/mcp-ts-core/utils';
import { describe, expect, it } from 'vitest';
import { isUpstreamUnavailable } from '@/services/pokeapi/upstream-failure.js';

/** The rejection `fetchWithTimeout` gives a response with `status`. */
async function httpFailure(status: number): Promise<unknown> {
  const http = createFetchMock([
    { match: () => true, respond: () => new Response('Upstream body', { status }) },
  ]);
  http.install();
  try {
    return await fetchWithTimeout('https://pokeapi.co/api/v2/machine/1', 1_000, createMockContext())
      .then(() => undefined)
      .catch((err: unknown) => err);
  } finally {
    http.restore();
  }
}

describe('isUpstreamUnavailable', () => {
  it.each([400, 404, 429, 500, 503, 504])('matches an HTTP %i response', async (status) => {
    expect(isUpstreamUnavailable(await httpFailure(status))).toBe(true);
  });

  it.each([
    ['an unusable body', serviceUnavailable('PokéAPI returned an invalid machine record.')],
    ['a request or retry deadline', timeout('PokéAPI machine request exceeded its deadline.')],
  ])('matches %s', (_label, err) => {
    expect(isUpstreamUnavailable(err)).toBe(true);
  });

  it.each([
    [
      'a miss raised before any request',
      notFound('No PokéAPI move record matches the identifier.'),
    ],
    ['a cancelled request', requestCancelled('Cancelled')],
    ['an internal fault', internalError('Unexpected state')],
    ['a programmer error', new TypeError('Cannot read properties of undefined')],
    ['a malformed body', new SyntaxError('Unexpected token <')],
    ['an abort reason', new DOMException('Caller cancelled', 'AbortError')],
  ])('does not match %s', (_label, err) => {
    expect(isUpstreamUnavailable(err)).toBe(false);
  });
});
