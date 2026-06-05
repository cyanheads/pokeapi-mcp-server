/**
 * @fileoverview Tests for pokeapi://pokemon/{identifier} resource.
 * @module tests/resources/pokemon.resource.test
 */

import { McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { pokemonResource } from '@/mcp-server/resources/definitions/pokemon.resource.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

const mockAppConfig = {} as Parameters<typeof initPokeApiService>[0];
const mockStorage = {} as Parameters<typeof initPokeApiService>[1];

describe('pokemonResource', () => {
  beforeEach(() => {
    initPokeApiService(mockAppConfig, mockStorage);
  });

  it('returns Pokémon dossier for a valid name', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = pokemonResource.params.parse({ identifier: 'pikachu' });
    const result = await pokemonResource.handler(params, ctx);

    expect(result).toHaveProperty('id', 25);
    expect(result).toHaveProperty('name', 'pikachu');
    expect((result as Record<string, unknown>).types).toBeInstanceOf(Array);
    expect((result as Record<string, unknown>).stats).toBeInstanceOf(Array);
  }, 15000);

  it('returns Pokémon dossier by dex number', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = pokemonResource.params.parse({ identifier: '1' });
    const result = await pokemonResource.handler(params, ctx);

    expect(result).toHaveProperty('id', 1);
    expect(result).toHaveProperty('name', 'bulbasaur');
  }, 15000);

  it('does not include moves (resource returns dossier without move details)', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = pokemonResource.params.parse({ identifier: 'bulbasaur' });
    const result = await pokemonResource.handler(params, ctx);

    // moves should be empty array (include_moves = false)
    const moves = (result as Record<string, unknown>).moves as unknown[];
    expect(moves).toHaveLength(0);
    // moveCount should still be populated
    expect(typeof (result as Record<string, unknown>).moveCount).toBe('number');
  }, 15000);

  it('throws not_found for unknown identifier (HTTP 404 with empty body)', async () => {
    const ctx = createMockContext({ errors: pokemonResource.errors, tenantId: 'test-tenant' });
    const params = pokemonResource.params.parse({ identifier: 'totally-fake-pokemon-xyz-abc' });
    await expect(pokemonResource.handler(params, ctx)).rejects.toThrow(McpError);
  }, 15000);

  it('lists static sample resources', async () => {
    const listing = await pokemonResource.list!();
    expect(listing.resources).toBeInstanceOf(Array);
    expect(listing.resources.length).toBeGreaterThan(0);
    for (const r of listing.resources) {
      expect(r).toHaveProperty('uri');
      expect(r).toHaveProperty('name');
      expect((r.uri as string).startsWith('pokeapi://pokemon/')).toBe(true);
    }
  });
});
