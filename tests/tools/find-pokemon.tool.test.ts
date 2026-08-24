/**
 * @fileoverview Tests for pokeapi_find_pokemon tool.
 * @module tests/tools/find-pokemon.tool.test
 */

import { McpError } from '@cyanheads/mcp-ts-core/errors';
import {
  createInMemoryStorage,
  createMockContext,
  getEnrichment,
} from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { findPokemon } from '@/mcp-server/tools/definitions/find-pokemon.tool.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

const mockAppConfig = {} as Parameters<typeof initPokeApiService>[0];
const mockStorage = createInMemoryStorage();

describe('findPokemon', () => {
  beforeEach(() => {
    initPokeApiService(mockAppConfig, mockStorage);
  });

  it('filters Pokémon by generation', async () => {
    const ctx = createMockContext({ errors: findPokemon.errors, tenantId: 'test-tenant' });
    const input = findPokemon.input.parse({ generation: 'generation-i' });
    const result = await findPokemon.handler(input, ctx);

    expect(result.totalCount).toBeGreaterThan(0);
    expect(result.shown).toBeLessThanOrEqual(50);
    expect(result.pokemon.length).toBeGreaterThan(0);
    // Generation I should include Bulbasaur (#1)
    const names = result.pokemon.map((p) => p.name);
    expect(names).toContain('bulbasaur');
  }, 20000);

  it('filters Pokémon by type', async () => {
    const ctx = createMockContext({ errors: findPokemon.errors, tenantId: 'test-tenant' });
    const input = findPokemon.input.parse({ type: 'dragon', limit: 20 });
    const result = await findPokemon.handler(input, ctx);

    expect(result.totalCount).toBeGreaterThan(0);
    expect(result.pokemon.length).toBeGreaterThan(0);
  }, 20000);

  it('applies query filter within a generation', async () => {
    const ctx = createMockContext({ errors: findPokemon.errors, tenantId: 'test-tenant' });
    // "chu" should match pikachu and raichu within generation-i
    const input = findPokemon.input.parse({ generation: 'generation-i', query: 'chu' });
    const result = await findPokemon.handler(input, ctx);

    expect(result.totalCount).toBeGreaterThan(0);
    // All results should contain "chu" in the name
    for (const p of result.pokemon) {
      expect(p.name).toContain('chu');
    }
  }, 20000);

  it('returns empty results with enrichment notice when no category filter and query only', async () => {
    const ctx = createMockContext({ errors: findPokemon.errors, tenantId: 'test-tenant' });
    // query without any category filter — should return empty with enrichment notice
    const input = findPokemon.input.parse({ query: 'pikachu' });
    const result = await findPokemon.handler(input, ctx);

    expect(result.pokemon).toHaveLength(0);
    expect(result.totalCount).toBe(0);
    expect(result.shown).toBe(0);

    // The query-only path enriches a category-filter-required notice. The framework appends
    // any populated enrichment field to content[] as a trailer, so content-only clients get
    // it too (#6). Assert the notice text carries the query-only-specific guidance.
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toContain('No category filters were provided');
  });

  it('applies pagination with offset and limit', async () => {
    const ctx = createMockContext({ errors: findPokemon.errors, tenantId: 'test-tenant' });
    const inputPage1 = findPokemon.input.parse({ generation: 'generation-i', limit: 5, offset: 0 });
    const inputPage2 = findPokemon.input.parse({ generation: 'generation-i', limit: 5, offset: 5 });

    const page1 = await findPokemon.handler(inputPage1, ctx);
    const page2 = await findPokemon.handler(inputPage2, ctx);

    expect(page1.shown).toBe(5);
    expect(page2.shown).toBe(5);
    // Pages should not overlap
    const page1Names = new Set(page1.pokemon.map((p) => p.name));
    const page2Names = page2.pokemon.map((p) => p.name);
    for (const name of page2Names) {
      expect(page1Names.has(name)).toBe(false);
    }
  }, 20000);

  it('rejects a negative limit at input validation (#7)', () => {
    // limit must be a positive integer — negatives previously reached Array.slice and
    // returned misleading successes. A Zod failure on the input schema surfaces to the
    // client as ValidationError (-32007) via the framework's ZodError auto-classification.
    expect(() => findPokemon.input.parse({ generation: 'generation-i', limit: -5 })).toThrow();
  });

  it('rejects a negative offset at input validation (#7)', () => {
    // offset must be a non-negative integer — negatives previously reached Array.slice.
    expect(() => findPokemon.input.parse({ generation: 'generation-i', offset: -5 })).toThrow();
  });

  it('throws McpError for an invalid generation name', async () => {
    const ctx = createMockContext({ errors: findPokemon.errors, tenantId: 'test-tenant' });
    const input = findPokemon.input.parse({ generation: 'fake-generation-xyz' });
    await expect(findPokemon.handler(input, ctx)).rejects.toThrow(McpError);
  }, 15000);

  it('returns empty results with notice for valid filters that yield no matches (AND intersection)', async () => {
    const ctx = createMockContext({ errors: findPokemon.errors, tenantId: 'test-tenant' });
    // Generation-i + ice type — unlikely to have many, test intersection
    const input = findPokemon.input.parse({
      generation: 'generation-i',
      type: 'ice',
      query: 'zzz-no-match-xyz',
    });
    const result = await findPokemon.handler(input, ctx);

    expect(result.pokemon).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  }, 20000);

  it('formats results with count and table', () => {
    const result = findPokemon.output.parse({
      pokemon: [
        { id: 1, name: 'bulbasaur' },
        { id: 4, name: 'charmander' },
        { id: 7, name: 'squirtle' },
      ],
      totalCount: 151,
      shown: 3,
    });

    const blocks = findPokemon.format!(result);
    expect(blocks).toHaveLength(1);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('151');
    expect(text).toContain('3');
    expect(text).toContain('bulbasaur');
    expect(text).toContain('charmander');
    expect(text).toContain('squirtle');
  });

  it('formats empty results with actionable guidance mirroring the enrichment notice', () => {
    const result = findPokemon.output.parse({ pokemon: [], totalCount: 0, shown: 0 });

    const blocks = findPokemon.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('No results');
    // Actionable guidance must appear in content[] so clients that only read content[] get it
    expect(text).toContain('relaxing');
  });
});
