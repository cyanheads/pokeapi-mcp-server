/**
 * @fileoverview Storage-provider failures as the framework raises them, for cache-degradation tests.
 * @module tests/fixtures/storage-failures
 */

import { McpError } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';

/** The rejection a full in-memory store gives a new key, taken from the framework's own provider. */
export async function capacityError(): Promise<McpError> {
  const failure: unknown = await createInMemoryStorage({ maxEntries: 0 })
    .set('pokeapi/probe/1', 1, createMockContext())
    .catch((err: unknown) => err);
  if (!(failure instanceof McpError)) throw new Error('A store with no capacity accepted a write.');
  return failure;
}
