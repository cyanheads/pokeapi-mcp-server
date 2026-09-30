/**
 * @fileoverview Captured-upstream regressions for evolution and item-price contracts.
 * @module tests/tools/domain-contracts.test
 */

import { readFileSync } from 'node:fs';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createFetchMock,
  createInMemoryStorage,
  createMockContext,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { pokemonResource } from '@/mcp-server/resources/definitions/pokemon.resource.js';
import { getItem } from '@/mcp-server/tools/definitions/get-item.tool.js';
import { getPokemon } from '@/mcp-server/tools/definitions/get-pokemon.tool.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';
import type { RawChainLink, RawEvolutionChain, RawItem } from '@/services/pokeapi/types.js';

const captures = JSON.parse(
  readFileSync(new URL('../fixtures/domain-captures.json', import.meta.url), 'utf8'),
) as {
  chains: Record<string, RawEvolutionChain>;
  items: Record<string, RawItem>;
  pokemon: Record<string, Record<string, unknown>>;
  species: Record<string, Record<string, unknown>>;
  abilities: Record<string, Record<string, unknown>>;
  syntheticDetail: RawChainLink['evolution_details'][number];
};

function capturedHttp(overrides: Record<string, unknown> = {}) {
  const payloads: Record<string, unknown> = { ...overrides };
  for (const [kind, records] of Object.entries({
    'evolution-chain': captures.chains,
    item: captures.items,
    pokemon: captures.pokemon,
    'pokemon-species': captures.species,
    ability: captures.abilities,
  })) {
    for (const [name, value] of Object.entries(records)) {
      payloads[`${kind}/${name}`] ??= value;
    }
  }
  return createFetchMock(
    Object.entries(payloads).map(([path, value]) => ({
      match: (request) => {
        const url = new URL(request.url);
        return (
          url.origin === 'https://pokeapi.co' &&
          (url.pathname === `/api/v2/${path}` || url.pathname === `/api/v2/${path}/`)
        );
      },
      respond: Response.json(value),
    })),
  );
}

function textOf(result: Awaited<ReturnType<typeof runToolContract>>) {
  return result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

describe('domain characterization', () => {
  beforeEach(() => {
    initPokeApiService({} as Parameters<typeof initPokeApiService>[0], createInMemoryStorage());
  });

  it('keeps the base and two simple level-up summaries on both surfaces and the resource', async () => {
    const http = capturedHttp();
    http.install();
    try {
      const result = await runToolContract(getPokemon, { identifier: 'bulbasaur' });
      const tree = {
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
            evolvesTo: [
              {
                species: 'venusaur',
                trigger: 'level-up',
                minLevel: 32,
                item: null,
                condition: 'level 32+',
                evolvesTo: [],
              },
            ],
          },
        ],
      };
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ evolutionChain: tree, moves: [] });
      expect(textOf(result)).toContain('level 16+');
      expect(textOf(result)).toContain('level 32+');
      const resource = await pokemonResource.handler(
        { identifier: 'bulbasaur' },
        createMockContext({ errors: pokemonResource.errors }),
      );
      expect(resource).toMatchObject({ evolutionChain: tree, moves: [] });
      expect(http.calls).toHaveLength(10);
    } finally {
      http.restore();
    }
  });

  it('resolves form dossiers through the base species', async () => {
    const http = capturedHttp();
    http.install();
    try {
      const result = await runToolContract(getPokemon, { identifier: 'charizard-mega-x' });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        name: 'charizard-mega-x',
        evolutionChain: { species: 'charmander' },
      });
      expect(textOf(result)).toContain('charizard-mega-x');
      expect(http.calls.map((call) => call.request.url)).toContain(
        'https://pokeapi.co/api/v2/pokemon-species/charizard',
      );
      expect(http.calls).toHaveLength(4);
    } finally {
      http.restore();
    }
  });

  it('preserves a supplied legacy item cost and the existing item fields', async () => {
    const http = capturedHttp({ 'item/leftovers': { ...captures.items.leftovers, cost: 9800 } });
    http.install();
    try {
      const result = await runToolContract(getItem, { identifier: 'leftovers' });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        name: 'leftovers',
        cost: 9800,
        category: 'held-items',
        flingPower: 10,
      });
      expect(textOf(result)).toContain('₽9800');
      expect(http.calls).toHaveLength(1);
    } finally {
      http.restore();
    }
  });
});

describe('complete evolution and price data', () => {
  beforeEach(() => {
    initPokeApiService({} as Parameters<typeof initPokeApiService>[0], createInMemoryStorage());
  });

  it.each(Object.keys(captures.chains))(
    'retains every alternative and field in captured chain %s',
    async (id) => {
      const chain = captures.chains[id]!;
      const http = capturedHttp({
        'pokemon-species/bulbasaur': {
          ...captures.species.bulbasaur,
          evolution_chain: { url: `https://pokeapi.co/api/v2/evolution-chain/${id}/` },
        },
      });
      http.install();
      try {
        const result = await runToolContract(getPokemon, { identifier: 'bulbasaur' });
        expect(result.isError).not.toBe(true);
        const resource = await pokemonResource.handler(
          { identifier: 'bulbasaur' },
          createMockContext({ errors: pokemonResource.errors }),
        );
        const output = getPokemon.output.parse(result.structuredContent);
        expect(getPokemon.output.parse(resource).evolutionChain).toEqual(output.evolutionChain);
        const check = (raw: RawChainLink, normalized: unknown) => {
          const step = normalized as {
            evolutionDetails: Record<string, unknown>[];
            evolvesTo: unknown[];
          };
          expect(step.evolutionDetails).toHaveLength(raw.evolution_details.length);
          raw.evolution_details.forEach((detail, index) => {
            for (const [rawKey, rawValue] of Object.entries(detail)) {
              const key = rawKey.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
              const expected =
                rawValue && typeof rawValue === 'object' && 'name' in rawValue
                  ? rawValue.name
                  : rawValue;
              expect(
                step.evolutionDetails[index],
                `${raw.species.name} alternative ${index + 1} ${key}`,
              ).toHaveProperty(key, expected);
            }
          });
          expect(step.evolvesTo).toHaveLength(raw.evolves_to.length);
          raw.evolves_to.forEach((child, index) => {
            check(child, step.evolvesTo[index]);
          });
        };
        check(chain.chain, output.evolutionChain);
        expect(http.calls).toHaveLength(10);
        const text = textOf(result);
        if (id === '352') expect(text).toContain('Turn upside down: true');
        if (id === '47') expect(text).toContain('Relative physical stats: 0');
        if (id === '67') {
          expect(text).toContain('Alternative 6');
          expect(text).toContain('lush-jungle');
          expect(text).toContain('leaf-stone');
        }
        if (id === '362') {
          expect(text).toContain('sliggoo-hisui');
          expect(text).toContain('goodra-hisui');
          expect(text).toContain('Needs overworld rain: true');
        }
      } finally {
        http.restore();
      }
    },
  );

  it('retains all documented fields, false metadata, zero and expression data', async () => {
    const chain = structuredClone(captures.chains['1']!);
    chain.chain.evolves_to[0]!.evolves_to[0]!.evolution_details = [captures.syntheticDetail];
    const http = capturedHttp({ 'evolution-chain/1': chain });
    http.install();
    try {
      const result = await runToolContract(getPokemon, { identifier: 'bulbasaur' });
      expect(result.isError).not.toBe(true);
      const expected = {
        versionGroup: 'x-y',
        isDefault: false,
        item: null,
        trigger: 'level-up',
        gender: 1,
        heldItem: 'fixture-item',
        knownMove: 'fixture-move',
        knownMoveType: 'fairy',
        location: 'fixture-location',
        minLevel: 30,
        minHappiness: 160,
        minBeauty: 170,
        minAffection: 2,
        nearSpecialRock: true,
        needsMultiplayer: true,
        needsOverworldRain: true,
        partySpecies: 'fixture-species',
        partyType: 'dark',
        relativePhysicalStats: 0,
        timeOfDay: 'night',
        tradeSpecies: 'fixture-trade-species',
        turnUpsideDown: true,
        region: 'hisui',
        requiredPokemonForm: 'fixture-base-form',
        evolvedPokemonForm: 'fixture-evolved-form',
        usedMove: 'fixture-used-move',
        minMoveCount: 20,
        minSteps: 1000,
        minDamageTaken: 49,
        allowedNatures: ['hardy'],
        conditionExpression: {
          expression: 'EC 100 % 0 ==',
          percentageChance: 1,
          variables: ['encryption-constant'],
        },
      };
      const output = getPokemon.output.parse(result.structuredContent);
      expect(output.evolutionChain?.evolvesTo[0]?.evolvesTo[0]).toHaveProperty('evolutionDetails', [
        expected,
      ]);
      const text = textOf(result);
      for (const token of [
        'Default: false',
        'fixture-item',
        'fixture-move',
        'fairy',
        'fixture-location',
        '160',
        '170',
        '2',
        'fixture-species',
        'dark',
        'Relative physical stats: 0',
        'night',
        'fixture-trade-species',
        'hisui',
        'fixture-base-form',
        'fixture-evolved-form',
        'fixture-used-move',
        '20',
        '1000',
        '49',
        'hardy',
        'EC 100 % 0 ==',
        'Chance: 1',
        'encryption-constant',
      ]) {
        expect(text).toContain(token);
      }
      const resource = await pokemonResource.handler(
        { identifier: 'bulbasaur' },
        createMockContext({ errors: pokemonResource.errors }),
      );
      expect(getPokemon.output.parse(resource).evolutionChain).toEqual(output.evolutionChain);
    } finally {
      http.restore();
    }
  });

  it('distinguishes sparse details from literal empty, false and zero values without evaluating expressions', async () => {
    const chain = structuredClone(captures.chains['1']!);
    chain.chain.evolves_to[0]!.evolution_details = [
      { trigger: { name: 'level-up', url: 'https://pokeapi.co/api/v2/evolution-trigger/1/' } },
      {
        ...captures.syntheticDetail,
        is_default: false,
        min_level: 0,
        min_happiness: 0,
        needs_overworld_rain: false,
        near_special_rock: false,
        needs_multiplayer: false,
        turn_upside_down: false,
        time_of_day: '',
        allowed_natures: [],
        condition_expression: {
          expression: 'globalThis.shouldNeverRun = true; EC 100 % 0 ==',
          percentage_chance: 0,
          variables: [],
        },
      },
    ];
    const http = capturedHttp({ 'evolution-chain/1': chain });
    http.install();
    try {
      const result = await runToolContract(getPokemon, { identifier: 'bulbasaur' });
      expect(result.isError).not.toBe(true);
      const output = getPokemon.output.parse(result.structuredContent);
      const details = output.evolutionChain!.evolvesTo[0]!.evolutionDetails;
      expect(details[0]).toMatchObject({
        versionGroup: null,
        isDefault: null,
        minLevel: null,
        needsOverworldRain: null,
        timeOfDay: null,
        allowedNatures: null,
        conditionExpression: null,
      });
      expect(details[1]).toMatchObject({
        isDefault: false,
        minLevel: 0,
        minHappiness: 0,
        needsOverworldRain: false,
        timeOfDay: '',
        allowedNatures: [],
        conditionExpression: {
          expression: 'globalThis.shouldNeverRun = true; EC 100 % 0 ==',
          percentageChance: 0,
          variables: [],
        },
      });
      const text = textOf(result);
      for (const token of [
        'Minimum level: 0',
        'Minimum happiness: 0',
        'Needs overworld rain: false',
        'Time of day: ""',
        'Allowed natures: []',
        'globalThis.shouldNeverRun = true; EC 100 % 0 ==',
        'Chance: 0%',
        'Variables: []',
      ])
        expect(text).toContain(token);
      expect(globalThis).not.toHaveProperty('shouldNeverRun');
      const resource = await pokemonResource.handler(
        { identifier: 'bulbasaur' },
        createMockContext({ errors: pokemonResource.errors }),
      );
      expect(getPokemon.output.parse(resource).evolutionChain).toEqual(output.evolutionChain);
    } finally {
      http.restore();
    }
  });

  it.each(['ultra-ball', 'master-ball', 'choice-specs', 'leftovers', 'poke-ball'])(
    'preserves all price rows for %s on both surfaces',
    async (name) => {
      const http = capturedHttp();
      http.install();
      try {
        const result = await runToolContract(getItem, { identifier: name });
        expect(result.isError).not.toBe(true);
        const raw = captures.items[name]! as RawItem & {
          prices: Array<{
            version_group: { name: string };
            currency: { name: string };
            purchase_price: number | null;
            sell_price: number | null;
          }>;
        };
        expect(result.structuredContent).toMatchObject({
          cost: null,
          prices: raw.prices.map((price) => ({
            versionGroup: price.version_group.name,
            currency: price.currency.name,
            purchasePrice: price.purchase_price,
            sellPrice: price.sell_price,
          })),
        });
        const text = textOf(result);
        expect(text).toContain('Legacy cost:');
        expect(text).not.toContain('Not sold');
        for (const price of raw.prices) {
          expect(text).toContain(
            `| ${price.version_group.name} | ${price.currency.name} | ${price.purchase_price ?? 'Not purchasable'} | ${price.sell_price ?? 'Not sellable'} |`,
          );
        }
        if (raw.prices.length === 0) expect(text).toContain('No price records available');
        expect(http.calls).toHaveLength(1);
      } finally {
        http.restore();
      }
    },
  );

  it.each([9800, 0, null, undefined])(
    'keeps legacy cost %s independent of prices and currencies',
    async (cost) => {
      const item = {
        ...captures.items.leftovers,
        cost,
        prices: [
          {
            version_group: { name: 'red-blue' },
            currency: { name: 'poke-dollar' },
            purchase_price: 0,
            sell_price: null,
          },
          {
            version_group: { name: 'red-blue' },
            currency: { name: 'battle-point' },
            purchase_price: 5,
            sell_price: 0,
          },
        ],
      };
      const http = capturedHttp({ 'item/leftovers': item });
      http.install();
      try {
        const result = await runToolContract(getItem, { identifier: 'leftovers' });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          cost: cost ?? null,
          prices: [
            {
              versionGroup: 'red-blue',
              currency: 'poke-dollar',
              purchasePrice: 0,
              sellPrice: null,
            },
            { versionGroup: 'red-blue', currency: 'battle-point', purchasePrice: 5, sellPrice: 0 },
          ],
        });
        expect(textOf(result)).toContain(
          `**Legacy cost:** ${cost == null ? 'Not available' : `₽${cost}`}`,
        );
        expect(textOf(result)).toContain('| red-blue | poke-dollar | 0 | Not sellable |');
        // A blank line ends the Markdown table; without it the next line renders as a row.
        expect(textOf(result)).toContain('| red-blue | battle-point | 5 | 0 |\n\n## Effect');
      } finally {
        http.restore();
      }
    },
  );

  it('leaves missing price records unavailable', async () => {
    const { prices: _prices, ...item } = captures.items.leftovers as RawItem & { prices: unknown };
    const http = capturedHttp({ 'item/leftovers': item });
    http.install();
    try {
      const result = await runToolContract(getItem, { identifier: 'leftovers' });
      expect(result.structuredContent).toMatchObject({ cost: null, prices: [] });
      expect(textOf(result)).toContain('No price records available');
    } finally {
      http.restore();
    }
  });

  for (const definition of [getPokemon, getItem]) {
    it(`${definition.name} rejects invalid identifiers and cancellation without fetching`, async () => {
      const http = createFetchMock();
      http.install();
      try {
        // @ts-expect-error Wrong-type wire input must remain a caller error.
        const invalid = await runToolContract(definition, { identifier: true });
        expect(invalid.structuredContent).toMatchObject({
          error: { code: JsonRpcErrorCode.InvalidParams, data: { reason: 'invalid_arguments' } },
        });
        expect(textOf(invalid)).toContain('identifier');
        const controller = new AbortController();
        controller.abort();
        const cancelled = await runToolContract(
          definition,
          { identifier: 'bulbasaur' },
          { context: { signal: controller.signal } },
        );
        expect(cancelled.structuredContent).toMatchObject({
          error: { code: JsonRpcErrorCode.RequestCancelled },
        });
        expect(http.calls).toHaveLength(0);
      } finally {
        http.restore();
      }
    });
  }
});
