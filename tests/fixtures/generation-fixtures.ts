/**
 * @fileoverview Captured type, generation, Pokémon, and form records for generation-scoped matchups.
 * @module tests/fixtures/generation-fixtures
 */

import { readFileSync } from 'node:fs';

const captures = JSON.parse(
  readFileSync(new URL('./generation-captures.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

/** `handlerHttp` overrides: every capture, with each generation also routed by its numeric ID. */
export const generationRoutes: Record<string, unknown> = { ...captures };
for (const [path, record] of Object.entries(captures)) {
  if (path.startsWith('generation/')) {
    generationRoutes[`generation/${(record as { id: number }).id}`] = record;
  }
}
