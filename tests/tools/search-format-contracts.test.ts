/**
 * @fileoverview Search pagination, identifier provenance, and sparse text contracts.
 * @module tests/tools/search-format-contracts.test
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
import { findPokemon } from '@/mcp-server/tools/definitions/find-pokemon.tool.js';
import { getAbility } from '@/mcp-server/tools/definitions/get-ability.tool.js';
import { getItem } from '@/mcp-server/tools/definitions/get-item.tool.js';
import { getMove } from '@/mcp-server/tools/definitions/get-move.tool.js';
import { getNature } from '@/mcp-server/tools/definitions/get-nature.tool.js';
import { getPokemon } from '@/mcp-server/tools/definitions/get-pokemon.tool.js';
import { getTypeMatchups } from '@/mcp-server/tools/definitions/get-type-matchups.tool.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';
import type { RawAbility, RawPokemon, RawPokemonSpecies } from '@/services/pokeapi/types.js';

const captures = JSON.parse(
  readFileSync(new URL('../fixtures/domain-captures.json', import.meta.url), 'utf8'),
) as {
  chains: Record<string, unknown>;
  items: Record<string, Record<string, unknown>>;
  pokemon: Record<string, RawPokemon>;
  species: Record<string, RawPokemonSpecies>;
  abilities: Record<string, RawAbility>;
};

const ref = (name: string, kind = 'pokemon-species', id = 1) => ({
  name,
  url: `https://pokeapi.co/api/v2/${kind}/${id}/`,
});
const entries = [
  ref('charizard-mega-x', 'pokemon', 10034),
  ref('charmeleon', 'pokemon', 5),
  ref('charmander', 'pokemon', 4),
  ref('charizard', 'pokemon', 6),
];
const speciesEntries = entries
  .filter((entry) => entry.name !== 'charizard-mega-x')
  .map((entry) => ({ ...entry, url: entry.url.replace('/pokemon/', '/pokemon-species/') }));
const move = {
  id: 53,
  name: 'fixture-move',
  type: ref('fire'),
  damage_class: ref('special'),
  power: 90,
  accuracy: 100,
  pp: 15,
  priority: 0,
  effect_chance: 10,
  effect_entries: [
    { language: ref('en'), effect: 'Full move effect.', short_effect: 'Short move effect.' },
  ],
  target: ref('selected-pokemon'),
  stat_changes: [
    { stat: ref('attack'), change: -1 },
    { stat: ref('speed'), change: 2 },
  ],
  learned_by_pokemon: [ref('charmander'), ref('charizard-mega-x')],
};
const ability = {
  id: 65,
  name: 'fixture-ability',
  generation: ref('generation-iii'),
  effect_entries: [
    { language: ref('en'), effect: 'Full ability effect.', short_effect: 'Short ability effect.' },
  ],
  pokemon: [
    { pokemon: ref('bulbasaur'), is_hidden: false, slot: 1 },
    { pokemon: ref('ivysaur'), is_hidden: true, slot: 3 },
  ],
};
const type = {
  name: 'fire',
  pokemon: entries.map((pokemon) => ({ slot: 1, pokemon })),
  damage_relations: {
    double_damage_to: [ref('grass')],
    half_damage_to: [ref('water')],
    no_damage_to: [ref('fixture-immune')],
    double_damage_from: [ref('ground')],
    half_damage_from: [ref('steel')],
    no_damage_from: [ref('fixture-harmless')],
  },
};

function fixtureHttp(overrides: Record<string, unknown> = {}) {
  const records: Record<string, unknown> = {
    'type/fire': type,
    'type/dragon': { ...type, name: 'dragon' },
    'generation/generation-i': { pokemon_species: speciesEntries },
    'pokedex/kanto': {
      pokemon_entries: speciesEntries.map((pokemon_species, index) => ({
        entry_number: index + 1,
        pokemon_species,
      })),
    },
    'egg-group/monster': { pokemon_species: speciesEntries },
    'move/fixture-move': move,
    'ability/fixture-ability': ability,
    'nature/hardy': { id: 1, name: 'hardy' },
    'nature/modest': {
      id: 15,
      name: 'modest',
      increased_stat: ref('special-attack'),
      decreased_stat: ref('attack'),
      likes_flavor: ref('dry'),
      hates_flavor: ref('spicy'),
    },
  };
  for (const [kind, values] of Object.entries({
    pokemon: captures.pokemon,
    'pokemon-species': captures.species,
    ability: captures.abilities,
    item: captures.items,
    'evolution-chain': captures.chains,
  })) {
    for (const [name, value] of Object.entries(values)) records[`${kind}/${name}`] = value;
  }
  records['pokemon/10034'] = captures.pokemon['charizard-mega-x'];
  Object.assign(records, overrides);
  return createFetchMock(
    Object.entries(records).map(([path, value]) => ({
      match: (request) => request.url.replace(/\/$/, '') === `https://pokeapi.co/api/v2/${path}`,
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

beforeEach(() => {
  initPokeApiService({} as Parameters<typeof initPokeApiService>[0], createInMemoryStorage());
});

describe('search and format characterization', () => {
  it('keeps ordered pagination, intersections, and strict query tokens', async () => {
    const http = fixtureHttp();
    http.install();
    try {
      for (const [offset, ids] of [
        [0, [4, 5]],
        [2, [6, 10034]],
        [3, [10034]],
      ] as const) {
        const result = await runToolContract(findPokemon, { type: 'fire', limit: 2, offset });
        expect(result.isError).not.toBe(true);
        const output = findPokemon.output.parse(result.structuredContent);
        expect(output.pokemon.map((entry) => entry.id)).toEqual(ids);
        expect(output).toMatchObject({ totalCount: 4, shown: ids.length });
        for (const id of ids) expect(textOf(result)).toContain(`| ${id} |`);
      }
      const combined = await runToolContract(findPokemon, {
        type: ' FIRE ',
        generation: ' Generation I ',
        pokedex: 'KANTO',
        egg_group: 'monster',
        query: ' CHAR ',
        limit: 1,
      });
      expect(combined.structuredContent).toMatchObject({
        pokemon: [{ id: 4, name: 'charmander' }],
        totalCount: 3,
        shown: 1,
      });
      const form = await runToolContract(findPokemon, { type: 'fire', query: 'mega x' });
      expect(form.structuredContent).toMatchObject({
        pokemon: [{ id: 10034, name: 'charizard-mega-x' }],
        totalCount: 1,
      });
      expect(http.calls).toHaveLength(8);
    } finally {
      http.restore();
    }
  });

  it('retains full positive move lists, effects, chance and signed stat changes', async () => {
    const http = fixtureHttp();
    http.install();
    try {
      const result = await runToolContract(getMove, {
        identifier: 'fixture-move',
        include_learners: true,
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        learnedByPokemon: ['charmander', 'charizard-mega-x'],
        effectChance: 10,
        statChanges: [
          { stat: 'attack', change: -1 },
          { stat: 'speed', change: 2 },
        ],
      });
      for (const value of [
        'Full move effect.',
        'Short move effect.',
        '**attack:** -1',
        '**speed:** +2',
        'charmander',
        'charizard-mega-x',
        '10%',
      ])
        expect(textOf(result)).toContain(value);
    } finally {
      http.restore();
    }
  });

  it('retains regular and hidden holder groups and every holder', async () => {
    const http = fixtureHttp();
    http.install();
    try {
      const result = await runToolContract(getAbility, { identifier: 'fixture-ability' });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        pokemon: [
          { name: 'bulbasaur', isHidden: false, slot: 1 },
          { name: 'ivysaur', isHidden: true, slot: 3 },
        ],
      });
      for (const value of [
        'Regular ability slots',
        'Hidden ability',
        'bulbasaur (slot 1)',
        'ivysaur (slot 3)',
        'Full ability effect.',
        'Short ability effect.',
      ])
        expect(textOf(result)).toContain(value);
    } finally {
      http.restore();
    }
  });

  it('retains item attributes, holders, numeric fling power and sprite', async () => {
    const http = fixtureHttp({
      'item/leftovers': {
        ...captures.items.leftovers,
        attributes: [ref('holdable'), ref('consumable')],
        held_by_pokemon: [{ pokemon: ref('snorlax') }, { pokemon: ref('munchlax') }],
        fling_power: 0,
        sprites: { default: 'https://example.test/item.png' },
      },
    });
    http.install();
    try {
      const result = await runToolContract(getItem, { identifier: 'leftovers' });
      expect(result.structuredContent).toMatchObject({
        attributes: ['holdable', 'consumable'],
        heldByPokemon: ['snorlax', 'munchlax'],
        flingPower: 0,
        spriteUrl: 'https://example.test/item.png',
      });
      for (const value of [
        'holdable, consumable',
        'snorlax, munchlax',
        '**Fling Power:** 0',
        'https://example.test/item.png',
      ])
        expect(textOf(result)).toContain(value);
    } finally {
      http.restore();
    }
  });

  it('retains positive flavor preferences and all 25 nature rows', async () => {
    const natures = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      name: `nature-${i + 1}`,
      increased_stat: ref('attack'),
      decreased_stat: ref('defense'),
      likes_flavor: ref('spicy'),
      hates_flavor: ref('dry'),
    }));
    const http = fixtureHttp({
      'nature?limit=25': { results: natures.map((nature) => ref(nature.name)) },
      ...Object.fromEntries(natures.map((nature) => [`nature/${nature.name}`, nature])),
    });
    http.install();
    try {
      const single = await runToolContract(getNature, { identifier: 'modest' });
      expect(single.structuredContent).toMatchObject({
        isListAll: false,
        natures: [{ likesFlavor: 'dry', hatesFlavor: 'spicy' }],
      });
      expect(textOf(single)).toContain('**Likes Flavor:** dry');
      expect(textOf(single)).toContain('**Hates Flavor:** spicy');
      const all = await runToolContract(getNature, {});
      expect(getNature.output.parse(all.structuredContent).natures).toHaveLength(25);
      for (const nature of natures)
        expect(textOf(all)).toContain(
          `| ${nature.id} | ${nature.name} | attack | defense | spicy | dry |`,
        );
    } finally {
      http.restore();
    }
  });

  it('retains dossier moves, false flags, and form-to-species resolution', async () => {
    const http = fixtureHttp();
    http.install();
    try {
      const result = await runToolContract(getPokemon, {
        identifier: 'bulbasaur',
        include_moves: true,
      });
      const output = getPokemon.output.parse(result.structuredContent);
      expect(output.moves.length).toBeGreaterThan(0);
      for (const entry of output.moves)
        expect(textOf(result)).toContain(
          `- ${entry.name} — ${entry.learnMethod} (level: ${entry.levelLearnedAt})`,
        );
      expect(textOf(result)).toContain('**Legendary:** No');
      expect(textOf(result)).toContain('**Mythical:** No');
      const form = await runToolContract(getPokemon, { identifier: '10034' });
      expect(form.structuredContent).toMatchObject({
        id: 10034,
        name: 'charizard-mega-x',
        evolutionChain: { species: 'charmander' },
      });
      expect(http.calls.map((call) => call.request.url)).toContain(
        'https://pokeapi.co/api/v2/pokemon-species/charizard',
      );
    } finally {
      http.restore();
    }
  });

  it('retains positive relations and explicit unavailable dual-type offense', async () => {
    const http = fixtureHttp();
    http.install();
    try {
      const single = await runToolContract(getTypeMatchups, { type: 'fire' });
      expect(single.structuredContent).toMatchObject({
        offensiveRelations: {
          superEffectiveTo: ['grass'],
          notVeryEffectiveTo: ['water'],
          noEffectTo: ['fixture-immune'],
        },
        defensiveMatchups: {
          weakTo: ['ground'],
          resists: ['steel'],
          immuneTo: ['fixture-harmless'],
        },
      });
      for (const value of [
        'grass',
        'water',
        'fixture-immune',
        'ground',
        'steel',
        'fixture-harmless',
      ])
        expect(textOf(single)).toContain(value);
      const dual = await runToolContract(getTypeMatchups, { pokemon: 'charizard-mega-x' });
      expect(dual.structuredContent).toMatchObject({
        offensiveRelations: null,
        resolvedTypes: ['fire', 'dragon'],
      });
      expect(textOf(dual)).toContain('Offensive breakdown unavailable for dual-type');
    } finally {
      http.restore();
    }
  });
});

describe('effective search filters and empty-page guidance', () => {
  it.each([
    ['type', 'type'],
    ['generation', 'generation'],
    ['pokedex', 'pokedex'],
    ['egg_group', 'egg-group'],
  ] as const)('encodes the %s filter once at the upstream boundary', async (key, path) => {
    const http = createFetchMock([
      {
        match: /^https:\/\/pokeapi.co\/api\/v2\//,
        respond: new Response('Not Found', { status: 404 }),
      },
    ]);
    http.install();
    try {
      const result = await runToolContract(findPokemon, { [key]: ' Missing/Type Value ' });
      expect(http.calls.map((call) => call.request.url)).toEqual([
        `https://pokeapi.co/api/v2/${path}/missing%2Ftype-value`,
      ]);
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.ValidationError, data: { reason: 'invalid_filter' } },
      });
      expect(textOf(result)).toContain(findPokemon.errors![0]!.recovery);
    } finally {
      http.restore();
    }
  });

  it.each([
    [
      {
        type: ' FIRE ',
        generation: ' Generation I ',
        pokedex: ' KANTO ',
        egg_group: ' MONSTER ',
        query: ' CHAR  ',
      },
      {
        type: 'fire',
        generation: 'generation-i',
        pokedex: 'kanto',
        egg_group: 'monster',
        query: 'char',
        limit: 50,
        offset: 0,
      },
    ],
    [
      { type: 'fire', query: '  MEGA \t X  ', limit: 3, offset: 0 },
      { type: 'fire', query: 'mega x', limit: 3, offset: 0 },
    ],
    [
      { type: 'fire', generation: ' ', egg_group: '', pokedex: '\t', query: ' ' },
      { type: 'fire', limit: 50, offset: 0 },
    ],
    [
      { type: 'fire', query: 'no-match', offset: 100 },
      { type: 'fire', query: 'no-match', limit: 50, offset: 100 },
    ],
    [
      { type: 'fire', limit: 2, offset: 4 },
      { type: 'fire', limit: 2, offset: 4 },
    ],
    [
      { query: ' Pikachu ', generation: ' ', type: '', limit: 1, offset: 10 },
      { limit: 1, offset: 10 },
    ],
    [{}, { limit: 50, offset: 0 }],
    [
      { type: ' ', generation: '', query: '\t' },
      { limit: 50, offset: 0 },
    ],
  ])('echoes only effective normalized filters for %j', async (input, expected) => {
    const http = fixtureHttp();
    http.install();
    try {
      const result = await runToolContract(findPokemon, input);
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toHaveProperty('appliedFilters', expected);
      const blocks = result.content.filter((block) => block.type === 'text');
      const trailer = blocks.find((block) => block.text.includes('**appliedFilters:**'));
      expect(trailer).toBeDefined();
      const line = trailer!.text
        .split('\n')
        .find((value) => value.startsWith('**appliedFilters:** '))!;
      expect(JSON.parse(line.slice('**appliedFilters:** '.length))).toEqual(expected);
      expect(textOf(result).split('**appliedFilters:**')).toHaveLength(2);
      expect(blocks[0]!.text).not.toContain('appliedFilters');
      if (!('type' in expected)) expect(http.calls).toHaveLength(0);
    } finally {
      http.restore();
    }
  });

  it.each([4, 10000])(
    'identifies offset %i beyond a nonempty result set on both surfaces',
    async (offset) => {
      const http = fixtureHttp();
      http.install();
      try {
        const result = await runToolContract(findPokemon, { type: 'fire', limit: 2, offset });
        expect(result.structuredContent).toMatchObject({
          totalCount: 4,
          shown: 0,
          pokemon: [],
          notice: expect.stringContaining('offset: 0'),
        });
        const text = textOf(result);
        expect(text).toContain('beyond');
        expect(text).toContain('offset: 0');
        expect(text).not.toMatch(/no (?:results|pokémon) matched/i);
        expect(text.split('offset: 0')).toHaveLength(2);
      } finally {
        http.restore();
      }
    },
  );

  it('keeps true-zero guidance and query-only guidance exclusively in enrichment', async () => {
    const http = fixtureHttp();
    http.install();
    try {
      const zero = await runToolContract(findPokemon, { type: 'fire', query: 'no-match' });
      expect(zero.structuredContent).toMatchObject({
        totalCount: 0,
        shown: 0,
        pokemon: [],
        notice: expect.stringContaining('relaxing'),
      });
      expect(textOf(zero).split('relaxing')).toHaveLength(2);
      const queryOnly = await runToolContract(findPokemon, { query: 'pikachu' });
      expect(queryOnly.structuredContent).toMatchObject({
        totalCount: 0,
        notice: expect.stringContaining('No category filters'),
      });
      expect(textOf(queryOnly)).not.toContain('relaxing');
      expect(textOf(queryOnly).split('No category filters')).toHaveLength(2);
    } finally {
      http.restore();
    }
  });

  it.each([
    {},
    { type: '  ' },
    { generation: '', pokedex: '\t', query: ' ' },
    { limit: 5, offset: 3 },
    { query: 'pikachu' },
    { query: ' Mega  X ', egg_group: ' ' },
  ])('asks for a category on both surfaces when none is applied: %j', async (input) => {
    const http = fixtureHttp();
    http.install();
    try {
      const result = await runToolContract(findPokemon, input);
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        pokemon: [],
        totalCount: 0,
        shown: 0,
        notice: expect.stringContaining('No category filters'),
      });
      const text = textOf(result);
      expect(text).toContain('generation, type, pokedex, or egg_group');
      expect(text.split('No category filters')).toHaveLength(2);
      expect(text).not.toMatch(/relax/i);
      expect(text).toContain('*(No results.)*');
      expect(http.calls).toHaveLength(0);
    } finally {
      http.restore();
    }
  });

  it('states the category requirement in the tool description', () => {
    expect(findPokemon.description).toContain(
      'At least one of generation, type, pokedex, or egg_group',
    );
    expect(findPokemon.description).not.toMatch(/all filters are optional/i);
  });

  it.each([{ limit: -1 }, { limit: 0 }, { limit: 1.5 }, { offset: -1 }, { offset: 0.5 }])(
    'keeps invalid pagination rejected before fetching: %j',
    async (input) => {
      const http = fixtureHttp();
      http.install();
      try {
        const result = await runToolContract(findPokemon, { type: 'fire', ...input });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          error: { code: JsonRpcErrorCode.InvalidParams, data: { reason: 'invalid_arguments' } },
        });
        expect(textOf(result)).toContain(Object.keys(input)[0]!);
        expect(http.calls).toHaveLength(0);
      } finally {
        http.restore();
      }
    },
  );

  it.each(['a'.repeat(101), 'a '.repeat(51), ' '.repeat(101), 'a'.repeat(80_000)])(
    'rejects a query over 100 characters before fetching: %#',
    async (query) => {
      const http = fixtureHttp();
      http.install();
      try {
        const result = await runToolContract(findPokemon, { type: 'fire', query });
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          error: { code: JsonRpcErrorCode.InvalidParams, data: { reason: 'invalid_arguments' } },
        });
        expect(textOf(result)).toContain('query');
        expect(JSON.stringify(result).length).toBeLessThan(2_000);
        expect(http.calls).toHaveLength(0);
      } finally {
        http.restore();
      }
    },
  );

  it('accepts a query of exactly 100 characters and applies every token', async () => {
    const http = fixtureHttp();
    http.install();
    try {
      const unmatched = await runToolContract(findPokemon, {
        type: 'fire',
        query: 'a'.repeat(100),
      });
      expect(unmatched.isError).not.toBe(true);
      expect(unmatched.structuredContent).toMatchObject({
        totalCount: 0,
        appliedFilters: { type: 'fire', query: 'a'.repeat(100) },
        notice: expect.stringContaining('relaxing'),
      });
      const tokens = `${'char '.repeat(19)}mega`;
      expect(tokens).toHaveLength(99);
      const matched = await runToolContract(findPokemon, { type: 'fire', query: tokens });
      expect(matched.structuredContent).toMatchObject({
        pokemon: [{ id: 10034, name: 'charizard-mega-x' }],
        totalCount: 1,
        appliedFilters: { query: tokens },
      });
      expect(textOf(matched)).toContain('| 10034 | charizard-mega-x |');
    } finally {
      http.restore();
    }
  });

  it('keeps numeric-string pagination invalid without fetching', async () => {
    const http = fixtureHttp();
    http.install();
    try {
      // @ts-expect-error Number fields do not accept numeric strings from wire clients.
      const result = await runToolContract(findPokemon, { type: 'fire', limit: '1', offset: '2' });
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.InvalidParams, data: { reason: 'invalid_arguments' } },
      });
      expect(textOf(result)).toContain('Send limit as a number');
      expect(http.calls).toHaveLength(0);
    } finally {
      http.restore();
    }
  });
});

describe('PokéAPI record and species provenance', () => {
  it('labels schemas and recovery without identifying forms as National Pokédex numbers', () => {
    expect(getPokemon.output.shape.id.description).toBe(
      'PokéAPI Pokémon-record ID. Form IDs are not National Pokédex numbers.',
    );
    expect(findPokemon.output.shape.pokemon.element.shape.id.description).toContain('species');
    for (const text of [
      getPokemon.input.shape.identifier.description,
      getTypeMatchups.input.shape.pokemon.description,
      pokemonResource.params!.shape.identifier.description,
      pokemonResource.description,
      getPokemon.errors![0]!.recovery,
      getTypeMatchups.errors![0]!.recovery,
      pokemonResource.errors![0]!.recovery,
    ]) {
      expect(text).toContain('PokéAPI');
      expect(text).not.toMatch(/dex number/i);
    }
  });

  it.each(['charizard-mega-x', '10034'])(
    'preserves form %s and explicitly labels its ID in the dossier and resource',
    async (identifier) => {
      const http = fixtureHttp();
      http.install();
      try {
        const result = await runToolContract(getPokemon, { identifier });
        expect(result.structuredContent).toMatchObject({
          id: 10034,
          name: 'charizard-mega-x',
          generation: 'generation-i',
        });
        expect(textOf(result)).toContain('# charizard-mega-x (PokéAPI ID: 10034)');
        const resource = await pokemonResource.handler(
          { identifier },
          createMockContext({ errors: pokemonResource.errors }),
        );
        expect(resource).toEqual(result.structuredContent);
        expect(captures.pokemon['charizard-mega-x']!.species).toEqual({
          name: 'charizard',
          url: 'https://pokeapi.co/api/v2/pokemon-species/6/',
        });
        expect(http.calls.map((call) => call.request.url)).not.toContain(
          `https://pokeapi.co/api/v2/pokemon-species/${identifier}`,
        );
      } finally {
        http.restore();
      }
    },
  );

  it.each([
    { type: 'fire' },
    { generation: 'generation-i' },
    { pokedex: 'kanto' },
    { egg_group: 'monster' },
    { type: 'fire', generation: 'generation-i' },
  ])('retains source IDs for %j', async (filter) => {
    const http = fixtureHttp();
    http.install();
    try {
      const result = await runToolContract(findPokemon, { ...filter, query: 'charizard' });
      const ids = filter.type && !filter.generation ? [6, 10034] : [6];
      expect(
        findPokemon.output.parse(result.structuredContent).pokemon.map((entry) => entry.id),
      ).toEqual(ids);
      expect(textOf(result)).toContain('| PokéAPI ID | Name |');
      expect(http.calls).toHaveLength(Object.keys(filter).length);
    } finally {
      http.restore();
    }
  });
});

describe('species names as Pokémon identifiers', () => {
  const deoxysVarieties = [
    { is_default: true, pokemon: ref('deoxys-normal', 'pokemon', 386) },
    { is_default: false, pokemon: ref('deoxys-attack', 'pokemon', 10001) },
    { is_default: false, pokemon: ref('deoxys-defense', 'pokemon', 10002) },
    { is_default: false, pokemon: ref('deoxys-speed', 'pokemon', 10003) },
  ];
  const deoxysNormal = {
    ...captures.pokemon.bulbasaur,
    id: 386,
    name: 'deoxys-normal',
    species: ref('deoxys', 'pokemon-species', 386),
  };
  const deoxysSpecies = {
    ...captures.species.bulbasaur,
    id: 386,
    name: 'deoxys',
    varieties: deoxysVarieties,
  };
  const dependencies = {
    'evolution-chain/1': captures.chains['1'],
    'ability/overgrow': captures.abilities.overgrow,
    'ability/chlorophyll': captures.abilities.chlorophyll,
  };
  const API = 'https://pokeapi.co/api/v2';

  /** Serves `records` and answers every other PokéAPI path with 404, as upstream does. */
  function upstream(records: Record<string, unknown>) {
    return createFetchMock([
      ...Object.entries({ ...dependencies, ...records }).map(([path, value]) => ({
        match: (request: Request) => request.url.replace(/\/$/, '') === `${API}/${path}`,
        respond: () => Response.json(value),
      })),
      {
        match: /^https:\/\/pokeapi\.co\/api\/v2\//,
        respond: () => new Response('Not Found', { status: 404 }),
      },
    ]);
  }
  const pathsOf = (http: ReturnType<typeof upstream>) =>
    http.calls.map((call) => call.request.url.replace(/\/$/, '').slice(API.length + 1));

  it('makes no extra upstream request when the identifier names a Pokémon record', async () => {
    const http = upstream({
      'pokemon/bulbasaur': captures.pokemon.bulbasaur,
      'pokemon-species/bulbasaur': captures.species.bulbasaur,
    });
    http.install();
    try {
      const result = await runToolContract(getPokemon, { identifier: 'bulbasaur' });
      expect(result.structuredContent).toMatchObject({ id: 1, name: 'bulbasaur' });
      expect(pathsOf(http).sort()).toEqual([
        'ability/chlorophyll',
        'ability/overgrow',
        'evolution-chain/1',
        'pokemon-species/bulbasaur',
        'pokemon/bulbasaur',
      ]);
    } finally {
      http.restore();
    }
  });

  it.each(['deoxys', ' Deoxys '])(
    'resolves species name %j to its default variety and names that record',
    async (identifier) => {
      const http = upstream({
        'pokemon/deoxys-normal': deoxysNormal,
        'pokemon-species/deoxys': deoxysSpecies,
      });
      http.install();
      try {
        const result = await runToolContract(getPokemon, { identifier });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          id: 386,
          name: 'deoxys-normal',
          resolvedFromSpecies: 'deoxys',
          varieties: [
            { name: 'deoxys-normal', isDefault: true },
            { name: 'deoxys-attack', isDefault: false },
            { name: 'deoxys-defense', isDefault: false },
            { name: 'deoxys-speed', isDefault: false },
          ],
        });
        const text = textOf(result);
        expect(text).toContain('# deoxys-normal (PokéAPI ID: 386)');
        expect(text).toContain(
          '**Resolved from species:** deoxys (default variety: deoxys-normal)',
        );
        expect(text).toContain('- deoxys-attack *(alternative)*');
        expect(pathsOf(http).slice(0, 3)).toEqual([
          'pokemon/deoxys',
          'pokemon-species/deoxys',
          'pokemon/deoxys-normal',
        ]);
        expect(pathsOf(http).filter((path) => path === 'pokemon-species/deoxys')).toHaveLength(1);
        expect(pathsOf(http)).toHaveLength(6);
      } finally {
        http.restore();
      }
    },
  );

  it.each(['386', 'deoxys-normal'])(
    'reports no species resolution when %j names the record directly',
    async (identifier) => {
      const http = upstream({
        'pokemon/386': deoxysNormal,
        'pokemon/deoxys-normal': deoxysNormal,
        'pokemon-species/deoxys': deoxysSpecies,
      });
      http.install();
      try {
        const result = await runToolContract(getPokemon, { identifier });
        expect(result.structuredContent).toMatchObject({
          id: 386,
          name: 'deoxys-normal',
          resolvedFromSpecies: null,
        });
        expect(textOf(result)).not.toContain('Resolved from species');
        expect(pathsOf(http)).toHaveLength(5);
      } finally {
        http.restore();
      }
    },
  );

  it('returns not_found after one species lookup when the name is neither', async () => {
    const http = upstream({});
    http.install();
    try {
      const result = await runToolContract(getPokemon, { identifier: 'missingno' });
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.NotFound, data: { reason: 'not_found' } },
      });
      expect(textOf(result)).toContain(getPokemon.errors![0]!.recovery);
      expect(pathsOf(http)).toEqual(['pokemon/missingno', 'pokemon-species/missingno']);
    } finally {
      http.restore();
    }
  });

  it('does not try a species lookup for an unknown numeric ID', async () => {
    const http = upstream({});
    http.install();
    try {
      const result = await runToolContract(getPokemon, { identifier: '99999' });
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.NotFound, data: { reason: 'not_found' } },
      });
      expect(pathsOf(http)).toEqual(['pokemon/99999']);
    } finally {
      http.restore();
    }
  });

  it.each([
    ['its default variety has no Pokémon record', { 'pokemon-species/deoxys': deoxysSpecies }, 3],
    [
      'it lists no default variety',
      {
        'pokemon-species/deoxys': {
          ...deoxysSpecies,
          varieties: deoxysVarieties.map((variety) => ({ ...variety, is_default: false })),
        },
        'pokemon/deoxys-normal': deoxysNormal,
      },
      2,
    ],
    ['it lists no varieties', { 'pokemon-species/deoxys': { ...deoxysSpecies, varieties: [] } }, 2],
  ])('returns not_found for a species when %s', async (_case, records, requests) => {
    const http = upstream(records);
    http.install();
    try {
      const result = await runToolContract(getPokemon, { identifier: 'deoxys' });
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.NotFound, data: { reason: 'not_found' } },
      });
      expect(pathsOf(http)).toHaveLength(requests);
    } finally {
      http.restore();
    }
  });

  it('resolves a species name through the pokemon resource with the same payload', async () => {
    const http = upstream({
      'pokemon/deoxys-normal': deoxysNormal,
      'pokemon-species/deoxys': deoxysSpecies,
    });
    http.install();
    try {
      const tool = await runToolContract(getPokemon, { identifier: 'deoxys' });
      const resource = await pokemonResource.handler(
        { identifier: 'deoxys' },
        createMockContext({ errors: pokemonResource.errors }),
      );
      expect(resource).toMatchObject({ name: 'deoxys-normal', resolvedFromSpecies: 'deoxys' });
      expect(resource).toEqual(tool.structuredContent);
      await expect(
        pokemonResource.handler(
          { identifier: 'missingno' },
          createMockContext({ errors: pokemonResource.errors }),
        ),
      ).rejects.toMatchObject({ code: JsonRpcErrorCode.NotFound, data: { reason: 'not_found' } });
    } finally {
      http.restore();
    }
  });

  it('describes species-name resolution wherever a Pokémon identifier is documented', () => {
    for (const text of [
      getPokemon.description,
      getPokemon.input.shape.identifier.description,
      getPokemon.output.shape.resolvedFromSpecies.description,
      pokemonResource.description,
    ])
      expect(text).toContain('default variety');
  });
});

describe('meaningful sparse values', () => {
  it('renders each absent item property without changing nullable prices or cost', async () => {
    const http = fixtureHttp({
      'item/master-ball': {
        ...captures.items['master-ball'],
        fling_power: null,
        attributes: [],
        held_by_pokemon: [],
        sprites: { default: null },
      },
    });
    http.install();
    try {
      const result = await runToolContract(getItem, { identifier: 'master-ball' });
      expect(result.structuredContent).toMatchObject({
        cost: null,
        flingPower: null,
        attributes: [],
        heldByPokemon: [],
        spriteUrl: null,
      });
      for (const value of [
        '**Fling Power:** Not throwable',
        '**Attributes:** None listed',
        'No known holders.',
        '**Sprite:** Not available',
        '**Legacy cost:** Not available',
      ])
        expect(textOf(result)).toContain(value);
    } finally {
      http.restore();
    }
  });

  it('renders both absent preferences for a neutral nature', async () => {
    const http = fixtureHttp();
    http.install();
    try {
      const result = await runToolContract(getNature, { identifier: 'hardy' });
      expect(result.structuredContent).toMatchObject({
        natures: [
          { increasedStat: null, decreasedStat: null, likesFlavor: null, hatesFlavor: null },
        ],
      });
      for (const value of [
        'Neutral — no stat modifications',
        '**Likes Flavor:** None',
        '**Hates Flavor:** None',
      ])
        expect(textOf(result)).toContain(value);
    } finally {
      http.restore();
    }
  });

  it('renders absent dossier scalars and keeps explicit ability and variety categories', async () => {
    const raw = captures.pokemon.bulbasaur!;
    const http = fixtureHttp({
      'pokemon/bulbasaur': {
        ...raw,
        moves: [],
        sprites: { front_default: null, front_shiny: null },
      },
      'pokemon-species/bulbasaur': {
        ...captures.species.bulbasaur,
        genera: [],
        flavor_text_entries: [],
        varieties: [
          { pokemon: ref('bulbasaur'), is_default: true },
          { pokemon: ref('fixture-alternative'), is_default: false },
        ],
      },
      ...Object.fromEntries(
        raw.abilities.map((entry) => [
          `ability/${entry.ability.name}`,
          { ...captures.abilities[entry.ability.name], effect_entries: [] },
        ]),
      ),
    });
    http.install();
    try {
      const result = await runToolContract(getPokemon, {
        identifier: 'bulbasaur',
        include_moves: true,
      });
      expect(result.structuredContent).toMatchObject({
        genus: null,
        speciesFlavorText: null,
        sprites: { officialArtwork: null, frontDefault: null, frontShiny: null },
        moves: [],
        moveCount: 0,
      });
      for (const value of [
        '**Genus:** Not available',
        'Flavor text not available',
        '**Effect:** Not available',
        '**Short:** Not available',
        '**Official Artwork:** Not available',
        '**Front Default:** Not available',
        '**Front Shiny:** Not available',
        '*(regular)*',
        '*(hidden)*',
        '*(default)*',
        '*(alternative)*',
        'No learnable moves listed.',
      ])
        expect(textOf(result)).toContain(value);
      expect(textOf(result)).not.toContain('Pass include_moves');
    } finally {
      http.restore();
    }
  });

  it('retains every populated dossier list in text', async () => {
    const http = fixtureHttp();
    http.install();
    try {
      const result = await runToolContract(getPokemon, { identifier: 'bulbasaur' });
      expect(result.structuredContent).toMatchObject({
        types: ['grass', 'poison'],
        eggGroups: ['monster', 'plant'],
        varieties: [{ name: 'bulbasaur', isDefault: true }],
      });
      for (const value of [
        '**Types:** grass, poison',
        '**Egg Groups:** monster, plant',
        '**hp:** 45 (EV: 0)',
        '**special-attack:** 65 (EV: 1)',
        '### overgrow (slot 1) *(regular)*',
        '### chlorophyll (slot 3) *(hidden)*',
        '- bulbasaur *(default)*',
      ])
        expect(textOf(result)).toContain(value);
      expect(textOf(result)).not.toMatch(
        /None listed|No (?:base stats|abilities|varieties) listed/,
      );
    } finally {
      http.restore();
    }
  });

  it('states each empty dossier list instead of a bare label or empty heading', async () => {
    const http = fixtureHttp({
      'pokemon/bulbasaur': { ...captures.pokemon.bulbasaur, types: [], stats: [], abilities: [] },
      'pokemon-species/bulbasaur': {
        ...captures.species.bulbasaur,
        egg_groups: [],
        varieties: [],
      },
    });
    http.install();
    try {
      const result = await runToolContract(getPokemon, { identifier: 'bulbasaur' });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        types: [],
        eggGroups: [],
        stats: [],
        abilities: [],
        varieties: [],
      });
      const text = textOf(result);
      for (const value of [
        '**Types:** None listed',
        '**Egg Groups:** None listed',
        '## Base Stats\nNo base stats listed.',
        '## Abilities\nNo abilities listed.',
        '## Varieties\nNo varieties listed.',
      ])
        expect(text).toContain(value);
      expect(text).not.toMatch(/\*\*(?:Types|Egg Groups):\*\* *\n/);
      expect(text).not.toMatch(/## (?:Base Stats|Abilities|Varieties)\n\n/);
    } finally {
      http.restore();
    }
  });

  it.each([true, false])(
    'distinguishes requested empty move learners from disabled inclusion: %s',
    async (included) => {
      const { effect_chance: _chance, ...sparse } = move;
      const http = fixtureHttp({
        'move/fixture-move': { ...sparse, stat_changes: [], learned_by_pokemon: [] },
      });
      http.install();
      try {
        const result = await runToolContract(getMove, {
          identifier: 'fixture-move',
          include_learners: included,
        });
        expect(result.structuredContent).toMatchObject({
          effectChance: null,
          statChanges: [],
          learnedByPokemon: [],
          learnersIncluded: included,
        });
        for (const value of [
          '**Effect Chance:** Not applicable',
          'No stat changes.',
          `**Learners included:** ${included ? 'Yes' : 'No'}`,
        ])
          expect(textOf(result)).toContain(value);
        expect(textOf(result)).toContain(
          included ? 'No known learners.' : 'Pass include_learners=true',
        );
        if (included) expect(textOf(result)).not.toContain('Pass include_learners');
      } finally {
        http.restore();
      }
    },
  );

  it('renders an empty ability holder list', async () => {
    const http = fixtureHttp({ 'ability/fixture-ability': { ...ability, pokemon: [] } });
    http.install();
    try {
      const result = await runToolContract(getAbility, { identifier: 'fixture-ability' });
      expect(result.structuredContent).toHaveProperty('pokemon', []);
      expect(textOf(result)).toContain('No known Pokémon with this ability.');
    } finally {
      http.restore();
    }
  });

  it('renders every empty relation list and explains neutral multipliers', async () => {
    const http = fixtureHttp({
      'type/fire': {
        ...type,
        damage_relations: Object.fromEntries(
          Object.keys(type.damage_relations).map((name) => [name, []]),
        ),
      },
    });
    http.install();
    try {
      const result = await runToolContract(getTypeMatchups, { type: 'fire' });
      expect(result.structuredContent).toMatchObject({
        offensiveRelations: { superEffectiveTo: [], notVeryEffectiveTo: [], noEffectTo: [] },
        defensiveMatchups: { weakTo: [], resists: [], immuneTo: [] },
        composedMultipliers: {},
      });
      for (const label of [
        'Super Effective (2×)',
        'Not Very Effective (0.5×)',
        'No Effect (0×)',
        'Immune (0×)',
        'Resists',
        'Weak To',
      ])
        expect(textOf(result)).toContain(`**${label}:** None`);
      expect(textOf(result)).toContain('types not listed deal 1×');
    } finally {
      http.restore();
    }
  });
});
