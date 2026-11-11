/**
 * @fileoverview Tests for pokeapi_get_pokemon tool.
 * @module tests/tools/get-pokemon.tool.test
 */

import { databaseError, JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getServerConfig } from '@/config/server-config.js';
import { getPokemon } from '@/mcp-server/tools/definitions/get-pokemon.tool.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';
import { handlerHttp } from '../fixtures/handler-fixtures.js';

// Use a mock AppConfig — the service only reads server config from env vars
const mockAppConfig = {} as Parameters<typeof initPokeApiService>[0];
const mockStorage = createInMemoryStorage();
let http: ReturnType<typeof handlerHttp>;
afterEach(() => http.restore());

describe('getPokemon', () => {
  beforeEach(() => {
    http = handlerHttp();
    http.install();
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
    expect(
      http.calls.some(({ request }) => new URL(request.url).pathname.includes('/version-group/')),
    ).toBe(false);
    expect(result.notices).toContain('Pass include_moves=true to include the full move summary.');
    expect(getPokemon.format!(getPokemon.output.parse(result))).toEqual([
      expect.objectContaining({
        text: expect.stringContaining('Pass include_moves=true to include the full move summary.'),
      }),
    ]);
    expect(result.generation).toBe('generation-i');
    expect(typeof result.captureRate).toBe('number');
    expect(typeof result.isLegendary).toBe('boolean');
    expect(typeof result.isMythical).toBe('boolean');
    expect(result.evolutionChain).not.toBeNull();
    expect(result.varieties.length).toBeGreaterThan(0);
    expect(result.eggGroups.length).toBeGreaterThan(0);
  }, 15000);

  it('accepts PokéAPI Pokémon-record ID as a string identifier', async () => {
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

  it('uses PokéAPI order per method and keeps every distinct level from the chosen group', async () => {
    const ctx = createMockContext({ errors: getPokemon.errors });
    const input = getPokemon.input.parse({ identifier: 'charmander', include_moves: true });
    const result = getPokemon.output.parse(await getPokemon.handler(input, ctx));
    expect(result.moveCount).toBe(1);
    expect(result.moves).toEqual([
      {
        name: 'dragon-claw',
        learnMethod: 'level-up',
        levelLearnedAt: 42,
        versionGroup: 'scarlet-violet',
      },
      {
        name: 'dragon-claw',
        learnMethod: 'level-up',
        levelLearnedAt: 45,
        versionGroup: 'scarlet-violet',
      },
      {
        name: 'dragon-claw',
        learnMethod: 'machine',
        levelLearnedAt: 0,
        versionGroup: 'scarlet-violet',
      },
      { name: 'dragon-claw', learnMethod: 'train', levelLearnedAt: 0, versionGroup: 'champions' },
    ]);
    expect(getPokemon.format!(result)).toEqual([
      expect.objectContaining({
        text: expect.stringContaining('level: 45, version group: scarlet-violet'),
      }),
    ]);
    await getPokemon.handler(input, ctx);
    expect(
      http.calls.filter(({ request }) => new URL(request.url).pathname.includes('/version-group/')),
    ).toHaveLength(2);
  });

  it('scopes moves to a represented group without metadata reads', async () => {
    const ctx = createMockContext({ errors: getPokemon.errors });
    const input = getPokemon.input.parse({
      identifier: 'charmander',
      version_group: 'scarlet-violet',
    });
    const result = getPokemon.output.parse(await getPokemon.handler(input, ctx));
    expect(result.moves.map((move) => move.levelLearnedAt)).toEqual([42, 45, 0]);
    expect(result.moveCount).toBe(1);
    expect(
      http.calls.filter(({ request }) => new URL(request.url).pathname.includes('/version-group/')),
    ).toHaveLength(0);
  });

  it('distinguishes a valid empty group from an unknown group', async () => {
    const ctx = createMockContext({ errors: getPokemon.errors });
    const input = getPokemon.input.parse({ identifier: 'charmander', version_group: 'red-blue' });
    const result = getPokemon.output.parse(await getPokemon.handler(input, ctx));
    expect(result.moves).toEqual([]);
    expect(result.notices).toEqual(['No learnable moves are listed for red-blue.']);
    expect(getPokemon.format!(result)).toEqual([
      expect.objectContaining({ text: expect.stringContaining(result.notices[0]!) }),
    ]);
    await expect(
      getPokemon.handler(
        getPokemon.input.parse({ identifier: 'charmander', version_group: 'unknown-group' }),
        ctx,
      ),
    ).rejects.toMatchObject({ data: { reason: 'invalid_version_group' } });
  });

  it.each([404, 403, 422, 429, 502])(
    'reports source-order fallback after chronology HTTP %i',
    async (status) => {
      http.restore();
      http = handlerHttp({
        'version-group/scarlet-violet': new Response('Unavailable', { status }),
      });
      http.install();
      const ctx = createMockContext({ errors: getPokemon.errors });
      const input = getPokemon.input.parse({ identifier: 'charmander', include_moves: true });
      const result = getPokemon.output.parse(await getPokemon.handler(input, ctx));
      expect(result.moves[0]).toMatchObject({
        learnMethod: 'level-up',
        levelLearnedAt: 40,
        versionGroup: 'sword-shield',
      });
      expect(result.notices).toEqual([expect.stringContaining('chronology')]);
      expect(getPokemon.format!(result)).toEqual([
        expect.objectContaining({ text: expect.stringContaining(result.notices[0]!) }),
      ]);
      expect(
        http.calls.filter(({ request }) =>
          new URL(request.url).pathname.endsWith('/version-group/scarlet-violet'),
        ),
      ).toHaveLength(1);
    },
  );

  it.each([
    ['malformed JSON', new Response('<html>Gateway response</html>')],
    ['invalid metadata', Response.json({ name: 'scarlet-violet', order: null })],
    ['mismatched name', Response.json({ name: 'red-blue', order: 3 })],
  ])('discloses chronology fallback for %s without caching it', async (_label, response) => {
    http.restore();
    http = handlerHttp({ 'version-group/scarlet-violet': response });
    http.install();
    const ctx = createMockContext({ errors: getPokemon.errors });
    const input = getPokemon.input.parse({ identifier: 'charmander', include_moves: true });
    for (let call = 0; call < 2; call++) {
      const result = getPokemon.output.parse(await getPokemon.handler(input, ctx));
      expect(result.notices).toEqual([expect.stringContaining('chronology')]);
      expect(result.moves[0]).toMatchObject({ learnMethod: 'level-up', levelLearnedAt: 40 });
    }
    expect(
      http.calls.filter(({ request }) =>
        new URL(request.url).pathname.endsWith('/version-group/scarlet-violet'),
      ),
    ).toHaveLength(2);
  });

  it.each(['caller cancellation', 'deadline', 'connection failure'])(
    'settles correctly when a metadata request ends in %s',
    async (failure) => {
      http.restore();
      const caller = new AbortController();
      const deadline = new AbortController();
      const abortReason = new DOMException('Caller cancelled', 'AbortError');
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
      http = handlerHttp({}, [
        {
          match: 'https://pokeapi.co/api/v2/version-group/scarlet-violet',
          respond: ({ signal }) => {
            if (failure === 'caller cancellation') caller.abort(abortReason);
            if (failure === 'deadline')
              deadline.abort(new DOMException('Deadline elapsed', 'TimeoutError'));
            signal.throwIfAborted();
            throw new TypeError('Connection closed');
          },
        },
      ]);
      http.install();
      try {
        const ctx = createMockContext({ errors: getPokemon.errors, signal: caller.signal });
        const input = getPokemon.input.parse({ identifier: 'charmander', include_moves: true });
        const pending = getPokemon.handler(input, ctx);
        if (failure === 'caller cancellation') {
          await expect(pending).rejects.toBe(abortReason);
        } else {
          const result = getPokemon.output.parse(await pending);
          expect(result.notices).toEqual([expect.stringContaining('chronology')]);
          expect(result.moves[0]).toMatchObject({
            levelLearnedAt: 40,
            versionGroup: 'sword-shield',
          });
        }
        expect(timeout).toHaveBeenCalledExactlyOnceWith(3_000);
      } finally {
        timeout.mockRestore();
      }
    },
  );

  it.each([
    ['get', new McpError(JsonRpcErrorCode.SerializationError, 'Malformed metadata cache entry')],
    ['set', databaseError('Metadata cache cannot be written')],
  ] as const)(
    'keeps an unscoped dossier usable when the metadata cache %s fails',
    async (operation, error) => {
      const ctx = createMockContext({ errors: getPokemon.errors });
      const input = getPokemon.input.parse({ identifier: 'charmander', include_moves: true });
      await getPokemon.handler({ ...input, include_moves: false }, ctx);
      const original = ctx.state[operation].bind(ctx.state);
      vi.spyOn(ctx.state, operation).mockImplementation(
        (key: string, value: unknown, options?: { ttl?: number }) => {
          if (key.startsWith('pokeapi/version-group-order/')) return Promise.reject(error);
          return original(key, value, options);
        },
      );
      const result = getPokemon.output.parse(await getPokemon.handler(input, ctx));
      expect(result.moves[0]).toMatchObject({
        learnMethod: 'level-up',
        levelLearnedAt: 40,
        versionGroup: 'sword-shield',
      });
      expect(result.notices).toEqual([expect.stringContaining('chronology')]);
    },
  );

  it('keeps metadata on the tenant cache and rereads it after expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const first = createMockContext({ errors: getPokemon.errors, tenantId: 'first' });
      const other = createMockContext({ errors: getPokemon.errors, tenantId: 'other' });
      const input = getPokemon.input.parse({ identifier: 'charmander', include_moves: true });
      const groupReads = () =>
        http.calls.filter(({ request }) =>
          new URL(request.url).pathname.includes('/version-group/'),
        ).length;
      const initial = getPokemon.output.parse(await getPokemon.handler(input, first));
      initial.moves[0]!.levelLearnedAt = 999;
      expect((await getPokemon.handler(input, first)).moves[0]?.levelLearnedAt).toBe(42);
      expect(groupReads()).toBe(2);
      expect((await getPokemon.handler(input, other)).moves[0]?.levelLearnedAt).toBe(42);
      expect(groupReads()).toBe(4);
      vi.setSystemTime(Date.now() + getServerConfig().cacheTtlSeconds * 1_000 + 1);
      expect((await getPokemon.handler(input, first)).moves[0]?.levelLearnedAt).toBe(42);
      expect(groupReads()).toBe(6);
    } finally {
      vi.useRealTimers();
    }
  });

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
      resolvedFromSpecies: null,
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
      notices: [],
      moveCount: 80,
      speciesId: 1,
      pokedexNumbers: [],
      hatchCounter: null,
      baseHappiness: null,
      isBaby: false,
      speciesFlavorText: 'A strange seed was planted on its back at birth.',
      flavorTextVersion: 'red',
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
        evolutionDetails: [],
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
    expect(text).toContain('PokéAPI ID: 1');
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
      resolvedFromSpecies: null,
      heightDm: 7,
      weightHg: 69,
      types: ['grass', 'poison'],
      stats: [],
      abilities: [],
      sprites: { frontDefault: null, frontShiny: null, officialArtwork: null },
      moves: [],
      notices: [],
      moveCount: 0,
      speciesId: 1,
      pokedexNumbers: [],
      hatchCounter: null,
      baseHappiness: null,
      isBaby: false,
      speciesFlavorText: null,
      flavorTextVersion: null,
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
        evolutionDetails: [],
        evolvesTo: [
          {
            species: 'ivysaur',
            trigger: 'level-up',
            minLevel: 16,
            item: null,
            condition: 'level 16+',
            evolutionDetails: [],
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
