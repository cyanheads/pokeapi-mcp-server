/**
 * @fileoverview Tests for pokeapi_get_pokemon tool.
 * @module tests/tools/get-pokemon.tool.test
 */

import { McpError } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { getPokemon } from '@/mcp-server/tools/definitions/get-pokemon.tool.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

// Use a mock AppConfig — the service only reads server config from env vars
const mockAppConfig = {} as Parameters<typeof initPokeApiService>[0];
const mockStorage = createInMemoryStorage();

describe('getPokemon', () => {
  beforeEach(() => {
    initPokeApiService(mockAppConfig, mockStorage);
  });

  it('returns dossier for a well-known Pokémon by name', async () => {
    const ctx = createMockContext({ errors: getPokemon.errors, tenantId: 'test-tenant' });
    const input = getPokemon.input.parse({ identifier: 'bulbasaur' });
    const result = await getPokemon.handler(input, ctx);

    expect(result.id).toBe(1);
    expect(result.name).toBe('bulbasaur');
    expect(result.types).toContain('grass');
    expect(result.stats.length).toBeGreaterThan(0);
    expect(result.abilities.length).toBeGreaterThan(0);
    expect(result.moveCount).toBeGreaterThan(0);
    expect(result.moves).toHaveLength(0); // include_moves defaults to false
    expect(result.generation).toBe('generation-i');
    expect(typeof result.captureRate).toBe('number');
    expect(typeof result.isLegendary).toBe('boolean');
    expect(typeof result.isMythical).toBe('boolean');
    expect(result.evolutionChain).not.toBeNull();
    expect(result.varieties.length).toBeGreaterThan(0);
    expect(result.eggGroups.length).toBeGreaterThan(0);
  }, 15000);

  it('accepts Pokédex number as a string identifier', async () => {
    const ctx = createMockContext({ errors: getPokemon.errors, tenantId: 'test-tenant' });
    const input = getPokemon.input.parse({ identifier: '25' });
    const result = await getPokemon.handler(input, ctx);

    expect(result.id).toBe(25);
    expect(result.name).toBe('pikachu');
  }, 15000);

  it('returns move list when include_moves is true', async () => {
    const ctx = createMockContext({ errors: getPokemon.errors, tenantId: 'test-tenant' });
    const input = getPokemon.input.parse({ identifier: 'charmander', include_moves: true });
    const result = await getPokemon.handler(input, ctx);

    expect(result.moves.length).toBeGreaterThan(0);
    expect(result.moves[0]).toHaveProperty('name');
    expect(result.moves[0]).toHaveProperty('learnMethod');
    expect(result.moves[0]).toHaveProperty('levelLearnedAt');
  }, 15000);

  it('resolves flavor text for a specific game_version', async () => {
    const ctx = createMockContext({ errors: getPokemon.errors, tenantId: 'test-tenant' });
    const input = getPokemon.input.parse({ identifier: 'bulbasaur', game_version: 'red' });
    const result = await getPokemon.handler(input, ctx);

    // Should return a non-null flavor text (red version has Bulbasaur entry)
    expect(result.speciesFlavorText).not.toBeNull();
    expect(typeof result.speciesFlavorText).toBe('string');
  }, 15000);

  it('falls back to most recent English flavor text when game_version not found', async () => {
    const ctx = createMockContext({ errors: getPokemon.errors, tenantId: 'test-tenant' });
    const input = getPokemon.input.parse({
      identifier: 'bulbasaur',
      game_version: 'nonexistent-version-xyz',
    });
    const result = await getPokemon.handler(input, ctx);

    // Should fall back gracefully — still returns flavor text, just not version-specific
    expect(result.speciesFlavorText).not.toBeNull();
  }, 15000);

  it('handles legendary Pokémon correctly', async () => {
    const ctx = createMockContext({ errors: getPokemon.errors, tenantId: 'test-tenant' });
    const input = getPokemon.input.parse({ identifier: 'mewtwo' });
    const result = await getPokemon.handler(input, ctx);

    expect(result.isLegendary).toBe(true);
    expect(result.isMythical).toBe(false);
  }, 15000);

  it('resolves a variety/form name that is listed in varieties[]', async () => {
    // pikachu-rock-star is a variant form listed in pikachu's varieties[].
    // The pokemon-species endpoint does not exist for the form name — the fix
    // must derive the species from pokemon.species.name ("pikachu") instead.
    const ctx = createMockContext({ errors: getPokemon.errors, tenantId: 'test-tenant' });
    const input = getPokemon.input.parse({ identifier: 'pikachu-rock-star' });
    const result = await getPokemon.handler(input, ctx);

    expect(result.name).toBe('pikachu-rock-star');
    // Species data comes from the base species (pikachu)
    expect(result.generation).toBe('generation-i');
    expect(result.captureRate).toBeGreaterThan(0);
    expect(result.varieties.length).toBeGreaterThan(1); // pikachu has many forms
  }, 20000);

  it('throws McpError (NotFound) for unknown identifier with data.reason populated', async () => {
    const ctx = createMockContext({ errors: getPokemon.errors, tenantId: 'test-tenant' });
    const input = getPokemon.input.parse({ identifier: 'totally-fake-pokemon-xyz-999' });
    let caught: unknown;
    try {
      await getPokemon.handler(input, ctx);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(McpError);
    const mcpErr = caught as McpError;
    expect(mcpErr.code).toBe(-32001); // JsonRpcErrorCode.NotFound
    expect((mcpErr.data as Record<string, unknown>)?.reason).toBe('not_found');
  }, 15000);

  it('formats output with key fields included', () => {
    const result = getPokemon.output.parse({
      id: 1,
      name: 'bulbasaur',
      heightDm: 7,
      weightHg: 69,
      types: ['grass', 'poison'],
      stats: [{ name: 'hp', baseStat: 45, effort: 0 }],
      abilities: [
        {
          name: 'overgrow',
          isHidden: false,
          slot: 1,
          effectText: 'Powers up grass moves.',
          shortEffectText: 'Powers up grass moves.',
        },
      ],
      sprites: {
        frontDefault: 'http://example.com/1.png',
        frontShiny: null,
        officialArtwork: null,
      },
      moves: [],
      moveCount: 80,
      speciesFlavorText: 'A strange seed was planted on its back at birth.',
      genus: 'Seed Pokémon',
      captureRate: 45,
      growthRate: 'medium-slow',
      genderRate: 4,
      isLegendary: false,
      isMythical: false,
      evolutionChain: {
        species: 'bulbasaur',
        trigger: 'base',
        minLevel: null,
        item: null,
        condition: null,
        evolvesTo: [],
      },
      varieties: [{ name: 'bulbasaur', isDefault: true }],
      generation: 'generation-i',
      eggGroups: ['monster', 'grass'],
    });

    const blocks = getPokemon.format!(result);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('text');
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('bulbasaur');
    expect(text).toContain('#1');
    expect(text).toContain('grass');
    expect(text).toContain('poison');
    expect(text).toContain('overgrow');
    expect(text).toContain('80'); // moveCount
    expect(text).toContain('Seed Pokémon');
    expect(text).toContain('**Legendary:** No');
    expect(text).toContain('**Mythical:** No');
  });

  it('formats evolution chain correctly', () => {
    const result = getPokemon.output.parse({
      id: 1,
      name: 'bulbasaur',
      heightDm: 7,
      weightHg: 69,
      types: ['grass', 'poison'],
      stats: [],
      abilities: [],
      sprites: { frontDefault: null, frontShiny: null, officialArtwork: null },
      moves: [],
      moveCount: 0,
      speciesFlavorText: null,
      genus: null,
      captureRate: 45,
      growthRate: 'medium-slow',
      genderRate: 4,
      isLegendary: false,
      isMythical: false,
      evolutionChain: {
        species: 'bulbasaur',
        trigger: 'base',
        minLevel: null,
        item: null,
        condition: null,
        evolvesTo: [
          {
            species: 'ivysaur',
            trigger: 'level-up',
            minLevel: 16,
            item: null,
            condition: 'level 16+',
            evolvesTo: [],
          },
        ],
      },
      varieties: [{ name: 'bulbasaur', isDefault: true }],
      generation: 'generation-i',
      eggGroups: ['monster'],
    });

    const blocks = getPokemon.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('ivysaur');
    expect(text).toContain('level-up');
  });
});
