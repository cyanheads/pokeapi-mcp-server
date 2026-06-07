/**
 * @fileoverview Tests for pokeapi_find_pokemon tool.
 * @module tests/tools/find-pokemon.tool.test
 */

import { McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { findPokemon } from '@/mcp-server/tools/definitions/find-pokemon.tool.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

const mockAppConfig = {} as Parameters<typeof initPokeApiService>[0];
const mockStorage = {} as Parameters<typeof initPokeApiService>[1];

describe('findPokemon', () => {
  beforeEach(() => {
    initPokeApiService(mockAppConfig, mockStorage);
  });

  it('filters Pokémon by generation', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
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
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const input = findPokemon.input.parse({ type: 'dragon', limit: 20 });
    const result = await findPokemon.handler(input, ctx);

    expect(result.totalCount).toBeGreaterThan(0);
    expect(result.pokemon.length).toBeGreaterThan(0);
  }, 20000);

  it('applies query filter within a generation', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
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
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    // query without any category filter — should return empty with enrichment notice
    const input = findPokemon.input.parse({ query: 'pikachu' });
    const result = await findPokemon.handler(input, ctx);

    expect(result.pokemon).toHaveLength(0);
    expect(result.totalCount).toBe(0);
    expect(result.shown).toBe(0);
  });

  it('applies pagination with offset and limit', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
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

  it('throws McpError for an invalid generation name', async () => {
    const ctx = createMockContext({ errors: findPokemon.errors, tenantId: 'test-tenant' });
    const input = findPokemon.input.parse({ generation: 'fake-generation-xyz' });
    await expect(findPokemon.handler(input, ctx)).rejects.toThrow(McpError);
  }, 15000);

  it('returns empty results with notice for valid filters that yield no matches (AND intersection)', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
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
