/**
 * @fileoverview Deterministic fetch fixtures for handler tests, combining captures and explicit synthetic records.
 * @module tests/fixtures/handler-fixtures
 */

import { readFileSync } from 'node:fs';
import { createFetchMock } from '@cyanheads/mcp-ts-core/testing';
import type { RawPokemon, RawPokemonSpecies } from '@/services/pokeapi/types.js';

const domain = JSON.parse(
  readFileSync(new URL('./domain-captures.json', import.meta.url), 'utf8'),
) as {
  pokemon: Record<string, RawPokemon>;
  species: Record<string, RawPokemonSpecies>;
  abilities: Record<string, Record<string, unknown>>;
  items: Record<string, unknown>;
  chains: Record<string, unknown>;
};

/** Captured successful upstream responses, projected to fields consumed by the service. */
export const resolutionCaptures = JSON.parse(
  readFileSync(new URL('./resolution-captures.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

const ref = (name: string, kind = 'pokemon', id = 1) => ({
  name,
  url: `https://pokeapi.co/api/v2/${kind}/${id}/`,
});

const records: Record<string, unknown> = { ...resolutionCaptures };
for (const [kind, values] of Object.entries({
  pokemon: domain.pokemon,
  'pokemon-species': domain.species,
  ability: domain.abilities,
  item: domain.items,
  'evolution-chain': domain.chains,
})) {
  for (const [name, value] of Object.entries(values)) records[`${kind}/${name}`] = value;
}

/** Synthetic dossiers exercise wiring; their copied non-identity fields are not game-data assertions. */
for (const [name, id, species, types] of [
  ['pikachu', 25, 'pikachu', ['electric']],
  ['pikachu-rock-star', 10080, 'pikachu', ['electric']],
  ['charmander', 4, 'charmander', ['fire']],
  ['charizard', 6, 'charizard', ['fire', 'flying']],
  ['mewtwo', 150, 'mewtwo', ['psychic']],
] as const) {
  records[`pokemon/${name}`] = {
    ...domain.pokemon.bulbasaur,
    id,
    name,
    species: ref(species, 'pokemon-species', id),
    types: types.map((type, index) => ({ slot: index + 1, type: ref(type, 'type') })),
  };
  records[`pokemon-species/${species}`] = {
    ...domain.species.bulbasaur,
    is_legendary: species === 'mewtwo',
    is_mythical: false,
    varieties: [
      { is_default: true, pokemon: ref(species) },
      ...(species === 'pikachu'
        ? [{ is_default: false, pokemon: ref('pikachu-rock-star', 'pokemon', 10080) }]
        : []),
    ],
  };
}
for (const [path, id, name] of [
  ['pokemon/1', 1, 'bulbasaur'],
  ['pokemon/25', 25, 'pikachu'],
] as const) {
  records[path] = { ...(records[`pokemon/${name}`] as object), id };
}
records['item/4'] = domain.items['poke-ball'];
records['ability/overgrow'] = {
  ...domain.abilities.overgrow,
  id: 65,
  name: 'overgrow',
  generation: ref('generation-iii', 'generation'),
  pokemon: [{ pokemon: ref('bulbasaur'), is_hidden: false, slot: 1 }],
};
records['ability/65'] = records['ability/overgrow'];
records['ability/speed-boost'] = {
  ...(records['ability/overgrow'] as object),
  id: 3,
  name: 'speed-boost',
};

const move = {
  id: 53,
  name: 'flamethrower',
  type: ref('fire', 'type'),
  damage_class: ref('special'),
  power: 90,
  accuracy: 100,
  pp: 15,
  priority: 0,
  effect_chance: 10,
  target: ref('selected-pokemon'),
  effect_entries: [
    {
      language: ref('en'),
      effect: 'Has a 10% chance to burn the target.',
      short_effect: 'May burn.',
    },
  ],
  stat_changes: [],
  learned_by_pokemon: [ref('charizard')],
};
records['move/flamethrower'] = move;
records['move/53'] = move;
records['move/thunder-wave'] = {
  ...move,
  id: 86,
  name: 'thunder-wave',
  type: ref('electric', 'type'),
  damage_class: ref('status'),
  power: null,
  accuracy: 90,
};

const natureNames = [
  'hardy',
  'bold',
  'modest',
  'calm',
  'timid',
  'lonely',
  'docile',
  'mild',
  'gentle',
  'hasty',
  'adamant',
  'impish',
  'bashful',
  'careful',
  'rash',
  'jolly',
  'naughty',
  'lax',
  'quirky',
  'naive',
  'brave',
  'relaxed',
  'quiet',
  'sassy',
  'serious',
];
for (const [index, name] of natureNames.entries()) {
  records[`nature/${name}`] = {
    id: index + 1,
    name,
    ...(name === 'modest'
      ? {
          increased_stat: ref('special-attack'),
          decreased_stat: ref('attack'),
          likes_flavor: ref('dry'),
          hates_flavor: ref('spicy'),
        }
      : {}),
  };
}
records['nature/1'] = records['nature/hardy'];
records['nature?limit=25'] = { count: 25, results: natureNames.map((name) => ref(name, 'nature')) };

function typeRecord(name: string, relations: Partial<Record<string, string[]>> = {}) {
  return {
    name,
    pokemon: [{ slot: 1, pokemon: ref('dragonite', 'pokemon', 149) }],
    damage_relations: Object.fromEntries(
      [
        'double_damage_to',
        'half_damage_to',
        'no_damage_to',
        'double_damage_from',
        'half_damage_from',
        'no_damage_from',
      ].map((key) => [key, (relations[key] ?? []).map((type) => ref(type, 'type'))]),
    ),
  };
}
records['type/flying'] = typeRecord('flying', {
  double_damage_from: ['rock', 'ice', 'electric'],
  half_damage_from: ['grass', 'fighting', 'bug'],
  no_damage_from: ['ground'],
});
records['type/water'] = typeRecord('water', {
  double_damage_from: ['electric', 'grass'],
  half_damage_from: ['fire'],
});
records['type/normal'] = typeRecord('normal', {
  double_damage_from: ['fighting'],
  no_damage_from: ['ghost'],
});
records['type/dragon'] = typeRecord('dragon');
records['type/ice'] = typeRecord('ice');
records['type/grass'] = typeRecord('grass', {
  double_damage_from: ['fire', 'ice', 'poison', 'flying', 'bug'],
  half_damage_from: ['water', 'electric', 'grass', 'ground'],
});

const missingPaths = [
  'pokemon/totally-fake-pokemon-xyz-999',
  'pokemon-species/totally-fake-pokemon-xyz-999',
  'pokemon/totally-fake-pokemon-xyz-abc',
  'pokemon-species/totally-fake-pokemon-xyz-abc',
  'ability/fake-ability-xyz-9999',
  'item/fake-item-xyz-9999',
  'move/fake-move-xyz-9999',
  'nature/fake-nature-xyz',
  'type/faketype-xyz-999',
  'generation/fake-generation-xyz',
  'pokemon/deoxys',
  'pokemon/wormadam',
];

/** Install with explicit matches only: an unlisted request fails instead of reaching the network. */
export function handlerHttp(overrides: Record<string, unknown | Response> = {}) {
  const payloads: Record<string, unknown | Response> = {
    ...records,
    ...Object.fromEntries(
      missingPaths.map((path) => [path, new Response('Not Found', { status: 404 })]),
    ),
    ...overrides,
  };
  return createFetchMock(
    Object.entries(payloads).map(([path, value]) => ({
      match: (request) => {
        const url = new URL(request.url);
        return (
          url.origin === 'https://pokeapi.co' &&
          `${url.pathname.replace('/api/v2/', '').replace(/\/$/, '')}${url.search}` === path
        );
      },
      respond: () => (value instanceof Response ? value.clone() : Response.json(value)),
    })),
  );
}
