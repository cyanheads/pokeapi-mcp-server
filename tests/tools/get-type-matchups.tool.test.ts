/**
 * @fileoverview Tests for pokeapi_get_type_matchups tool.
 * @module tests/tools/get-type-matchups.tool.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import {
  createInMemoryStorage,
  createMockContext,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTypeMatchups } from '@/mcp-server/tools/definitions/get-type-matchups.tool.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';
import { generationRoutes } from '../fixtures/generation-fixtures.js';
import { handlerHttp, resolutionCaptures } from '../fixtures/handler-fixtures.js';

const mockAppConfig = {} as Parameters<typeof initPokeApiService>[0];
const mockStorage = createInMemoryStorage();
let http: ReturnType<typeof handlerHttp>;
afterEach(() => http.restore());

type ToolResult = Awaited<ReturnType<typeof runToolContract>>;
const textOf = (result: ToolResult) =>
  result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
const pathsOf = () =>
  http.calls.map((call) => new URL(call.request.url).pathname.replace('/api/v2/', ''));
const recoveryOf = (reason: string) =>
  getTypeMatchups.errors!.find((entry) => entry.reason === reason)!.recovery;

/** Installs the captured generation, type, Pokémon, and form records over the default fixtures. */
function installCaptures(overrides: Record<string, unknown> = {}) {
  http.restore();
  http = handlerHttp({ ...generationRoutes, ...overrides });
  http.install();
}

const LATER_THAN_GEN_1 = [
  'generation-ii',
  'generation-iii',
  'generation-iv',
  'generation-v',
  'generation-vi',
  'generation-vii',
  'generation-viii',
  'generation-ix',
].map((name) => `generation/${name}`);

describe('getTypeMatchups', () => {
  beforeEach(() => {
    http = handlerHttp();
    http.install();
    initPokeApiService(mockAppConfig, mockStorage);
  });

  it('returns offensive and defensive matchups for a single type', async () => {
    const ctx = createMockContext({ errors: getTypeMatchups.errors, tenantId: 'test-tenant' });
    const input = getTypeMatchups.input.parse({ type: 'fire' });
    const result = await getTypeMatchups.handler(input, ctx);

    expect(result.queryType).toBe('type');
    expect(result.resolvedTypes).toContain('fire');
    expect(result.offensiveRelations).not.toBeNull();
    expect(result.offensiveRelations!.superEffectiveTo).toBeInstanceOf(Array);
    expect(result.defensiveMatchups).toHaveProperty('weakTo');
    expect(result.defensiveMatchups).toHaveProperty('resists');
    expect(result.defensiveMatchups).toHaveProperty('immuneTo');
    expect(result.composedMultipliers).toBeTypeOf('object');
  }, 15000);

  it('fire type is super effective against grass', async () => {
    const ctx = createMockContext({ errors: getTypeMatchups.errors, tenantId: 'test-tenant' });
    const input = getTypeMatchups.input.parse({ type: 'fire' });
    const result = await getTypeMatchups.handler(input, ctx);

    expect(result.offensiveRelations!.superEffectiveTo).toContain('grass');
  }, 15000);

  it('fire type is weak to water defensively', async () => {
    const ctx = createMockContext({ errors: getTypeMatchups.errors, tenantId: 'test-tenant' });
    const input = getTypeMatchups.input.parse({ type: 'fire' });
    const result = await getTypeMatchups.handler(input, ctx);

    expect(result.defensiveMatchups.weakTo).toContain('water');
  }, 15000);

  it('resolves matchups for a Pokémon identifier', async () => {
    const ctx = createMockContext({ errors: getTypeMatchups.errors, tenantId: 'test-tenant' });
    // Charizard is Fire/Flying
    const input = getTypeMatchups.input.parse({ pokemon: 'charizard' });
    const result = await getTypeMatchups.handler(input, ctx);

    expect(result.queryType).toBe('pokemon');
    expect(result.resolvedTypes).toContain('fire');
    expect(result.resolvedTypes).toContain('flying');
    // A dual type has no single offensive table; each type's relations are keyed instead.
    expect(result.offensiveRelations).toBeNull();
    expect(Object.keys(result.offensiveByType)).toEqual(['fire', 'flying']);
  }, 15000);

  it('computes 4× weakness for dual-type Pokémon (Charizard vs Rock)', async () => {
    const ctx = createMockContext({ errors: getTypeMatchups.errors, tenantId: 'test-tenant' });
    const input = getTypeMatchups.input.parse({ pokemon: 'charizard' });
    const result = await getTypeMatchups.handler(input, ctx);

    // Fire and Flying are both weak to Rock — should compose to 4×
    expect(result.composedMultipliers.rock).toBe(4);
  }, 15000);

  it('keeps net-neutral 1× cancellations in composedMultipliers (Charizard vs Ice) (#5)', async () => {
    const ctx = createMockContext({ errors: getTypeMatchups.errors, tenantId: 'test-tenant' });
    const input = getTypeMatchups.input.parse({ pokemon: 'charizard' });
    const result = await getTypeMatchups.handler(input, ctx);

    // Fire resists Ice (0.5×), Flying is weak to Ice (2×) → composes to exactly 1×. The entry
    // is kept, not filtered, so "touched but canceled to neutral" stays distinct from "absent".
    expect(result.composedMultipliers.ice).toBe(1);
  }, 15000);

  it('throws invalid_input when neither type nor pokemon provided', async () => {
    const ctx = createMockContext({ errors: getTypeMatchups.errors, tenantId: 'test-tenant' });
    const input = getTypeMatchups.input.parse({});
    await expect(getTypeMatchups.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_input' },
    });
  });

  it('throws invalid_input when both type and pokemon are provided', async () => {
    const ctx = createMockContext({ errors: getTypeMatchups.errors, tenantId: 'test-tenant' });
    const input = getTypeMatchups.input.parse({ type: 'fire', pokemon: 'charizard' });
    await expect(getTypeMatchups.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_input' },
    });
  });

  it('throws not_found for an unrecognized type', async () => {
    const ctx = createMockContext({ errors: getTypeMatchups.errors, tenantId: 'test-tenant' });
    const input = getTypeMatchups.input.parse({ type: 'faketype-xyz-999' });
    await expect(getTypeMatchups.handler(input, ctx)).rejects.toThrow(McpError);
  }, 15000);

  it('formats output with resolved types and matchups', () => {
    const fire = {
      superEffectiveTo: ['grass', 'ice', 'bug', 'steel'],
      notVeryEffectiveTo: ['fire', 'water', 'rock', 'dragon'],
      noEffectTo: [],
    };
    const result = getTypeMatchups.output.parse({
      queryType: 'type',
      resolvedPokemon: null,
      resolvedFromSpecies: null,
      generation: null,
      resolvedTypes: ['fire'],
      offensiveRelations: fire,
      offensiveByType: { fire },
      defensiveMatchups: {
        weakTo: ['water', 'ground', 'rock'],
        resists: ['fire', 'grass', 'ice', 'bug', 'steel', 'fairy'],
        immuneTo: [],
      },
      composedMultipliers: { water: 2, rock: 2, grass: 0.5 },
    });

    const blocks = getTypeMatchups.format!(result);
    expect(blocks).toHaveLength(1);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('fire');
    expect(text).toContain('grass');
    expect(text).toContain('water');
  });

  it('formats each type of a dual-type query under its own heading', () => {
    const result = getTypeMatchups.output.parse({
      queryType: 'pokemon',
      resolvedPokemon: { id: 6, name: 'charizard' },
      resolvedFromSpecies: null,
      generation: 'generation-v',
      resolvedTypes: ['fire', 'flying'],
      offensiveRelations: null,
      offensiveByType: {
        fire: { superEffectiveTo: ['grass'], notVeryEffectiveTo: ['rock'], noEffectTo: [] },
        flying: { superEffectiveTo: ['bug'], notVeryEffectiveTo: ['steel'], noEffectTo: [] },
      },
      defensiveMatchups: {
        weakTo: ['water', 'electric', 'rock'],
        resists: ['fire', 'grass', 'fighting', 'bug', 'steel'],
        immuneTo: ['ground'],
      },
      composedMultipliers: { rock: 4, electric: 2, ground: 0 },
    });

    const blocks = getTypeMatchups.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('**Generation:** generation-v');
    expect(text).toContain('## Offensive Relations: fire\n**Super Effective (2×):** grass');
    expect(text).toContain('## Offensive Relations: flying\n**Super Effective (2×):** bug');
    expect(text).not.toContain('unavailable');
  });
});

describe('per-type offense and two-type queries (#37)', () => {
  beforeEach(() => {
    http = handlerHttp();
    http.install();
    initPokeApiService(mockAppConfig, mockStorage);
  });

  it('lists each type of a dual-type Pokémon from the records already fetched', async () => {
    installCaptures();
    const result = await runToolContract(getTypeMatchups, { pokemon: 'garchomp' });
    expect(result.structuredContent).toMatchObject({
      queryType: 'pokemon',
      resolvedTypes: ['dragon', 'ground'],
      offensiveRelations: null,
      offensiveByType: {
        dragon: {
          superEffectiveTo: ['dragon'],
          notVeryEffectiveTo: ['steel'],
          noEffectTo: ['fairy'],
        },
        ground: {
          superEffectiveTo: ['poison', 'rock', 'steel', 'fire', 'electric'],
          notVeryEffectiveTo: ['bug', 'grass'],
          noEffectTo: ['flying'],
        },
      },
    });
    const text = textOf(result);
    expect(text).toContain('## Offensive Relations: dragon');
    expect(text).toContain('## Offensive Relations: ground');
    expect(text).toContain('**Super Effective (2×):** poison, rock, steel, fire, electric');
    expect(text).toContain('**Not Very Effective (0.5×):** bug, grass');
    expect(text).toContain('**No Effect (0×):** flying');
    expect(text).toContain('**No Effect (0×):** fairy');
    expect(text).not.toContain('unavailable');
    expect(pathsOf()).toEqual(['pokemon/garchomp', 'type/dragon', 'type/ground']);
  });

  it('keeps offensiveRelations for a single type and keys the same relations by type', async () => {
    const result = await runToolContract(getTypeMatchups, { pokemon: 'charmander' });
    const output = getTypeMatchups.output.parse(result.structuredContent);
    expect(output.offensiveRelations).not.toBeNull();
    expect(output.offensiveByType).toEqual({ fire: output.offensiveRelations });
    expect(textOf(result)).toContain('## Offensive Relations');
    expect(textOf(result)).toContain('**Super Effective (2×):** bug, steel, grass, ice');
    expect(pathsOf()).toEqual(['pokemon/charmander', 'type/fire']);
  });

  it.each(['water/ground', 'Water / Ground', 'water ground', 'water,ground', 'water+ground'])(
    'composes the two types in %j as a dual-type defense',
    async (type) => {
      installCaptures();
      const result = await runToolContract(getTypeMatchups, { type });
      expect(result.structuredContent).toMatchObject({
        queryType: 'type',
        resolvedTypes: ['water', 'ground'],
        resolvedPokemon: null,
        offensiveRelations: null,
        composedMultipliers: { grass: 4, electric: 0, water: 1, ice: 1 },
      });
      const output = getTypeMatchups.output.parse(result.structuredContent);
      expect(Object.keys(output.offensiveByType)).toEqual(['water', 'ground']);
      expect(output.defensiveMatchups.immuneTo).toEqual(['electric']);
      expect(output.defensiveMatchups.weakTo).toEqual(['grass']);
      expect(textOf(result)).toContain('# Type Matchups: water / ground');
      expect(textOf(result)).toContain('**grass:** 4×');
      expect(pathsOf()).toEqual(['type/water', 'type/ground']);
    },
  );

  it('collapses a repeated type to the single-type answer', async () => {
    const single = await runToolContract(getTypeMatchups, { type: 'fire' });
    const repeated = await runToolContract(getTypeMatchups, { type: 'fire/FIRE' });
    expect(repeated.structuredContent).toEqual(single.structuredContent);
    expect(repeated.structuredContent).toMatchObject({ resolvedTypes: ['fire'] });
    expect(textOf(repeated)).toEqual(textOf(single));
  });

  it.each(['fire/', '/fire', ' fire, ', '+fire+'])(
    'answers %j, a separator at either end, as the single type',
    async (type) => {
      const single = await runToolContract(getTypeMatchups, { type: 'fire' });
      const edged = await runToolContract(getTypeMatchups, { type });
      expect(edged.structuredContent).toEqual(single.structuredContent);
    },
  );

  it('composes a type named by name and by ID once', async () => {
    installCaptures({ 'type/10': resolutionCaptures['type/fire'] });
    const single = await runToolContract(getTypeMatchups, { type: 'fire' });
    const both = await runToolContract(getTypeMatchups, { type: 'fire/10' });
    expect(both.structuredContent).toEqual(single.structuredContent);
    expect(both.structuredContent).toMatchObject({ composedMultipliers: { water: 2 } });
  });

  it.each(['fire/water/grass', 'fire water grass dragon'])(
    'rejects three or more types in %j before any request',
    async (type) => {
      const result = await runToolContract(getTypeMatchups, { type });
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.ValidationError,
          data: { reason: 'invalid_input', recovery: { hint: recoveryOf('invalid_input') } },
        },
      });
      expect(textOf(result)).toContain('two types');
      expect(http.calls).toHaveLength(0);
    },
  );

  it('names the unknown part of a two-type query on both surfaces', async () => {
    installCaptures({ 'type/faketype': new Response('Not Found', { status: 404 }) });
    const result = await runToolContract(getTypeMatchups, { type: 'water/FakeType' });
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.NotFound,
        message: expect.stringContaining('"FakeType"'),
        data: { reason: 'not_found', recovery: { hint: recoveryOf('not_found') } },
      },
    });
    const output = result.structuredContent as { error: { message: string } };
    expect(output.error.message).not.toContain('water');
    expect(textOf(result)).toContain('"FakeType"');
  });

  it('reports an upstream failure on one part instead of a miss on the other', async () => {
    vi.useFakeTimers();
    try {
      installCaptures({
        'type/water': new Response('Unavailable', { status: 503 }),
        'type/faketype': new Response('Not Found', { status: 404 }),
      });
      const pending = runToolContract(getTypeMatchups, { type: 'water/faketype' });
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.ServiceUnavailable },
      });
      expect(result.structuredContent).not.toMatchObject({
        error: { data: { reason: 'not_found' } },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('names every unknown part when both miss', async () => {
    installCaptures({
      'type/nope': new Response('Not Found', { status: 404 }),
      'type/nada': new Response('Not Found', { status: 404 }),
    });
    const result = await runToolContract(getTypeMatchups, { type: 'nope+nada' });
    expect(result.structuredContent).toMatchObject({
      error: { message: expect.stringMatching(/"nope".*"nada"/), data: { reason: 'not_found' } },
    });
  });

  it('keeps the array form rejected with the string-type guidance', async () => {
    // @ts-expect-error The wire can carry an array where the schema declares a string.
    const result = await runToolContract(getTypeMatchups, { type: ['water', 'ground'] });
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.InvalidParams, data: { reason: 'invalid_arguments' } },
    });
    expect(textOf(result)).toContain('Send type as a string');
    expect(http.calls).toHaveLength(0);
  });

  it('renders each per-type relation and the single-type relations once', () => {
    const relations = (prefix: string) => ({
      superEffectiveTo: [`${prefix}-se`],
      notVeryEffectiveTo: [`${prefix}-nve`],
      noEffectTo: [`${prefix}-ne`],
    });
    const base = {
      queryType: 'type',
      resolvedPokemon: null,
      resolvedFromSpecies: null,
      generation: null,
      defensiveMatchups: { weakTo: [], resists: [], immuneTo: [] },
      composedMultipliers: {},
    };
    const dual = getTypeMatchups.format!(
      getTypeMatchups.output.parse({
        ...base,
        resolvedTypes: ['a', 'b'],
        offensiveRelations: null,
        offensiveByType: { a: relations('a'), b: relations('b') },
      }),
    );
    const dualText = (dual[0] as { text: string }).text;
    for (const value of ['a-se', 'a-nve', 'a-ne', 'b-se', 'b-nve', 'b-ne'])
      expect(dualText).toContain(value);
    const single = getTypeMatchups.format!(
      getTypeMatchups.output.parse({
        ...base,
        resolvedTypes: ['a'],
        offensiveRelations: relations('a'),
        offensiveByType: { a: relations('a') },
      }),
    );
    const singleText = (single[0] as { text: string }).text;
    expect(singleText.match(/a-se/g)).toHaveLength(1);
    expect(singleText).not.toContain('## Offensive Relations: a');
  });
});

describe('generation scope (#38)', () => {
  beforeEach(() => {
    http = handlerHttp();
    http.install();
    initPokeApiService(mockAppConfig, mockStorage);
  });

  it('answers Gen 1 Ghost from its past relations', async () => {
    installCaptures();
    const result = await runToolContract(getTypeMatchups, { type: 'ghost', generation: '1' });
    expect(result.structuredContent).toMatchObject({
      generation: 'generation-i',
      resolvedTypes: ['ghost'],
      offensiveRelations: {
        superEffectiveTo: ['ghost'],
        notVeryEffectiveTo: [],
        noEffectTo: ['normal', 'psychic'],
      },
      defensiveMatchups: { weakTo: ['ghost'], immuneTo: ['normal', 'fighting'] },
    });
    expect(textOf(result)).toContain('**Generation:** generation-i');
    expect(textOf(result)).toContain('**No Effect (0×):** normal, psychic');
  });

  it.each([
    ['1', ['ghost'], [], ['normal', 'psychic']],
    ['3', ['ghost', 'psychic'], ['dark', 'steel'], ['normal']],
    ['5', ['ghost', 'psychic'], ['dark', 'steel'], ['normal']],
    ['6', ['ghost', 'psychic'], ['dark'], ['normal']],
    ['9', ['ghost', 'psychic'], ['dark'], ['normal']],
  ] as const)(
    'picks the Ghost entry in force at generation %s across its two past entries',
    async (generation, superEffectiveTo, notVeryEffectiveTo, noEffectTo) => {
      installCaptures();
      const result = await runToolContract(getTypeMatchups, { type: 'ghost', generation });
      expect(result.structuredContent).toMatchObject({
        offensiveRelations: { superEffectiveTo, notVeryEffectiveTo, noEffectTo },
      });
    },
  );

  it('answers Gen 5 Steel with its Ghost and Dark resistances and without Fairy', async () => {
    installCaptures();
    const result = await runToolContract(getTypeMatchups, { type: 'steel', generation: '5' });
    const output = getTypeMatchups.output.parse(result.structuredContent);
    expect(output.defensiveMatchups.resists).toEqual(expect.arrayContaining(['ghost', 'dark']));
    expect(output.composedMultipliers).toMatchObject({ ghost: 0.5, dark: 0.5 });
    expect(JSON.stringify(output)).not.toContain('fairy');
  });

  it.each([
    ['dragon', '5', 'fairy'],
    ['normal', '1', 'steel'],
    ['fire', 'generation-i', 'steel'],
  ])('drops %s targets introduced after generation %s (%s)', async (type, generation, later) => {
    installCaptures();
    const result = await runToolContract(getTypeMatchups, { type, generation });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.structuredContent)).not.toContain(`"${later}"`);
    expect(textOf(result)).not.toMatch(new RegExp(`\\b${later}\\b`));
  });

  it('keeps Normal resisting Rock alone in Gen 1', async () => {
    installCaptures();
    const result = await runToolContract(getTypeMatchups, { type: 'normal', generation: '1' });
    expect(result.structuredContent).toMatchObject({
      offensiveRelations: {
        superEffectiveTo: [],
        notVeryEffectiveTo: ['rock'],
        noEffectTo: ['ghost'],
      },
    });
  });

  it.each([
    ['clefairy', 'generation-v', 'generation-v', ['normal']],
    ['magnemite', '1', 'generation-i', ['electric']],
    ['rotom-heat', '4', 'generation-iv', ['electric', 'ghost']],
    ['clefairy', 'Generation VI', 'generation-vi', ['fairy']],
    ['magnemite', '2', 'generation-ii', ['electric', 'steel']],
  ] as const)('types %s by its typing in %s', async (pokemon, generation, canonical, types) => {
    installCaptures();
    const result = await runToolContract(getTypeMatchups, { pokemon, generation });
    expect(result.structuredContent).toMatchObject({
      queryType: 'pokemon',
      generation: canonical,
      resolvedTypes: types,
    });
    const output = getTypeMatchups.output.parse(result.structuredContent);
    expect(Object.keys(output.offensiveByType)).toEqual(types);
    expect(textOf(result)).toContain(`# Type Matchups: ${types.join(' / ')}`);
    expect(textOf(result)).toContain(`**Generation:** ${canonical}`);
  });

  it('uses scoped relations for each type of a scoped Pokémon', async () => {
    installCaptures();
    const result = await runToolContract(getTypeMatchups, {
      pokemon: 'rotom-heat',
      generation: '4',
    });
    expect(result.structuredContent).toMatchObject({
      offensiveRelations: null,
      offensiveByType: {
        ghost: {
          superEffectiveTo: ['ghost', 'psychic'],
          notVeryEffectiveTo: ['dark', 'steel'],
          noEffectTo: ['normal'],
        },
      },
      composedMultipliers: { normal: 0, fighting: 0, ghost: 2, dark: 2, ground: 2 },
    });
  });

  it.each([
    [{ type: 'fairy', generation: '5' }, 'fairy', 'generation-vi'],
    [{ type: 'water/fairy', generation: 'generation-v' }, 'fairy', 'generation-vi'],
    [{ pokemon: 'garchomp', generation: '1' }, 'garchomp', 'generation-iv'],
    [{ pokemon: 'raichu-alola', generation: '6' }, 'raichu-alola', 'generation-vii'],
  ])('rejects %j as not_in_generation naming %s and %s', async (input, subject, first) => {
    installCaptures();
    const result = await runToolContract(getTypeMatchups, input);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.InvalidParams,
        message: expect.stringContaining(first),
        data: {
          reason: 'not_in_generation',
          recovery: { hint: recoveryOf('not_in_generation') },
        },
      },
    });
    const { message } = (result.structuredContent as { error: { message: string } }).error;
    expect(message).toContain(subject);
    expect(textOf(result)).toContain(first);
  });

  it('rejects an unknown generation with the valid generation names on both surfaces', async () => {
    installCaptures({ 'generation/gen-5': new Response('Not Found', { status: 404 }) });
    const result = await runToolContract(getTypeMatchups, { type: 'fire', generation: 'gen 5' });
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.InvalidParams,
        message: expect.stringContaining('generation-i, generation-ii'),
        data: {
          reason: 'invalid_generation',
          recovery: { hint: recoveryOf('invalid_generation') },
        },
      },
    });
    expect(textOf(result)).toContain('"gen 5"');
    expect(textOf(result)).toContain('generation-ix');
    expect(pathsOf()).toEqual(['generation/gen-5', 'generation']);
  });

  it('still rejects an unknown generation when the catalog cannot be listed', async () => {
    installCaptures({
      'generation/gen-5': new Response('Not Found', { status: 404 }),
      'generation?limit=100': new Response('Unavailable', { status: 503 }),
    });
    const result = await runToolContract(getTypeMatchups, { type: 'fire', generation: 'gen 5' });
    expect(result.structuredContent).toMatchObject({
      error: {
        message: expect.stringContaining('The list of valid names could not be retrieved.'),
        data: { reason: 'invalid_generation' },
      },
    });
  });

  it('reports an unreadable catalog for a valid generation as an upstream failure', async () => {
    vi.useFakeTimers();
    try {
      installCaptures({ 'generation?limit=100': new Response('Unavailable', { status: 503 }) });
      const pending = runToolContract(getTypeMatchups, { type: 'fire', generation: '5' });
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.ServiceUnavailable },
      });
      expect(pathsOf().filter((path) => path === 'generation')).toHaveLength(4);
      expect(pathsOf()).not.toContain('type/fire');
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['the generation catalog', { type: 'fire', generation: '5' }, 'generation?limit=100'],
    ['a type record the Pokémon names', { pokemon: 'garchomp' }, 'type/ground'],
    [
      'a type record the scoped Pokémon names',
      { pokemon: 'garchomp', generation: '4' },
      'type/ground',
    ],
    [
      'a later generation the catalog lists',
      { type: 'ghost', generation: '1' },
      'generation/generation-vi',
    ],
    [
      'the Pokémon form record',
      { pokemon: 'magnemite', generation: '1' },
      'pokemon-form/magnemite',
    ],
  ])('reports a 404 on %s as an upstream failure', async (_label, input, path) => {
    installCaptures({ [path]: new Response('Not Found', { status: 404 }) });
    const result = await runToolContract(getTypeMatchups, input);
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.ServiceUnavailable },
    });
  });

  it('reports a scoped Pokémon record that lists no form as an upstream failure', async () => {
    const magnemite = generationRoutes['pokemon/magnemite'] as Record<string, unknown>;
    installCaptures({ 'pokemon/magnemite': { ...magnemite, forms: [] } });
    const result = await runToolContract(getTypeMatchups, {
      pokemon: 'magnemite',
      generation: '1',
    });
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.ServiceUnavailable },
    });
  });

  it.each(['generation-v', 'Generation V', '5'])('echoes %j canonically', async (generation) => {
    installCaptures();
    const result = await runToolContract(getTypeMatchups, { type: 'fire', generation });
    expect(result.structuredContent).toMatchObject({ generation: 'generation-v' });
  });

  it.each(['', '   '])('treats a blank generation %j as current data', async (generation) => {
    const result = await runToolContract(getTypeMatchups, { type: 'fire', generation });
    expect(result.structuredContent).toMatchObject({ generation: null });
    expect(textOf(result)).not.toContain('**Generation:**');
    expect(pathsOf()).toEqual(['type/fire']);
  });

  it('reads nothing past the latest generation and answers its types', async () => {
    installCaptures();
    const result = await runToolContract(getTypeMatchups, { type: 'stellar', generation: '9' });
    expect(result.structuredContent).toMatchObject({
      generation: 'generation-ix',
      offensiveByType: {
        stellar: { superEffectiveTo: [], notVeryEffectiveTo: [], noEffectTo: [] },
      },
      composedMultipliers: {},
    });
    expect(pathsOf()).toEqual(['generation/9', 'generation', 'type/stellar']);
  });

  it('adds no request to a call without generation', async () => {
    installCaptures();
    await runToolContract(getTypeMatchups, { pokemon: 'clefairy' });
    expect(pathsOf()).toEqual(['pokemon/clefairy', 'type/fairy']);
    await runToolContract(getTypeMatchups, { type: 'water/ground' });
    expect(pathsOf().slice(2)).toEqual(['type/water', 'type/ground']);
  });

  it('reads each later generation once and serves a repeat from cache', async () => {
    installCaptures();
    const ctx = createMockContext({ errors: getTypeMatchups.errors });
    const input = getTypeMatchups.input.parse({ pokemon: 'magnemite', generation: '1' });
    const first = await getTypeMatchups.handler(input, ctx);
    expect(pathsOf().toSorted()).toEqual(
      [
        'generation/1',
        'generation',
        ...LATER_THAN_GEN_1,
        'pokemon/magnemite',
        'pokemon-form/magnemite',
        'type/electric',
      ].toSorted(),
    );
    const cold = http.calls.length;
    expect(await getTypeMatchups.handler(input, ctx)).toEqual(first);
    expect(http.calls).toHaveLength(cold);
  });
});
