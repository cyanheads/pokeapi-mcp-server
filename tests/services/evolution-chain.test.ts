/**
 * @fileoverview Evolution summary selection and requirement phrases at the chain-walk seam.
 * @module tests/services/evolution-chain.test
 */

import { describe, expect, it } from 'vitest';
import { walkEvolutionChain } from '@/services/pokeapi/evolution-chain.js';
import type { RawChainLink, RawEvolutionDetail } from '@/services/pokeapi/types.js';

const ref = (name: string) => ({ name, url: `https://pokeapi.co/api/v2/fixture/${name}/` });

/** Every field as PokéAPI serves an unset requirement: null, false, or "". */
const UNSET: RawEvolutionDetail = {
  version_group: ref('x-y'),
  is_default: true,
  trigger: ref('level-up'),
  item: null,
  gender: null,
  held_item: null,
  known_move: null,
  known_move_type: null,
  location: null,
  min_level: null,
  min_happiness: null,
  min_beauty: null,
  min_affection: null,
  near_special_rock: false,
  needs_multiplayer: false,
  needs_overworld_rain: false,
  party_species: null,
  party_type: null,
  relative_physical_stats: null,
  time_of_day: '',
  trade_species: null,
  turn_upside_down: false,
  region: null,
  required_pokemon_form: null,
  evolved_pokemon_form: null,
  used_move: null,
  min_move_count: null,
  min_steps: null,
  min_damage_taken: null,
  allowed_natures: null,
  condition_expression: null,
};

const chain = (...details: RawEvolutionDetail[]): RawChainLink => ({
  is_baby: false,
  species: ref('base'),
  evolution_details: [],
  evolves_to: [
    {
      is_baby: false,
      species: ref('middle'),
      evolution_details: [UNSET],
      evolves_to: [
        { is_baby: false, species: ref('final'), evolution_details: details, evolves_to: [] },
      ],
    },
  ],
});

/** The summary of the third stage, two hops below the root. */
const summaryOf = (...details: RawEvolutionDetail[]) => {
  const { trigger, minLevel, item, condition } = walkEvolutionChain(chain(...details)).evolvesTo[0]!
    .evolvesTo[0]!;
  return { trigger, minLevel, item, condition };
};

describe('walkEvolutionChain requirement phrases', () => {
  it.each([
    [{ min_level: 16 }, 'level 16+'],
    [{ min_level: 0 }, 'level 0+'],
    [{ min_happiness: 220 }, 'happiness 220+'],
    [{ item: ref('moon-stone') }, 'use moon-stone'],
    [{ held_item: ref('metal-coat') }, 'hold metal-coat'],
    [{ time_of_day: 'dusk' }, 'dusk time'],
    [{ known_move: ref('mimic') }, 'know mimic'],
    [{ location: ref('mt-coronet') }, 'at mt-coronet'],
    [{ known_move_type: ref('fairy') }, 'know a fairy-type move'],
    [{ min_beauty: 171 }, 'beauty 171+'],
    [{ min_affection: 0 }, 'affection 0+'],
    [{ gender: 1 }, 'female'],
    [{ gender: 2 }, 'male'],
    [{ gender: 3 }, 'gender ID 3'],
    [{ relative_physical_stats: 1 }, 'attack > defense'],
    [{ relative_physical_stats: 0 }, 'attack = defense'],
    [{ relative_physical_stats: -1 }, 'attack < defense'],
    [{ party_species: ref('remoraid') }, 'remoraid in party'],
    [{ party_type: ref('dark') }, 'dark-type Pokémon in party'],
    [{ trade_species: ref('shelmet') }, 'trade for shelmet'],
    [{ near_special_rock: true }, 'near special rock'],
    [{ needs_multiplayer: true }, 'multiplayer'],
    [{ needs_overworld_rain: true }, 'overworld rain'],
    [{ turn_upside_down: true }, 'turn upside down'],
    [{ region: ref('hisui') }, 'in hisui'],
    [{ used_move: ref('rage-fist') }, 'use move rage-fist'],
    [{ min_move_count: 20 }, '20+ move uses'],
    [{ min_steps: 1000 }, '1000+ steps'],
    [{ min_damage_taken: 294 }, '294+ damage taken'],
    [{ allowed_natures: [ref('hardy'), ref('brave')] }, 'nature hardy/brave'],
    [{ allowed_natures: [] }, 'no allowed nature'],
    [
      {
        condition_expression: {
          expression: 'EC 100 % 0 ==',
          percentage_chance: 0,
          variables: [ref('encryption-constant')],
        },
      },
      'expression EC 100 % 0 == at 0% chance',
    ],
  ] as Array<[Partial<RawEvolutionDetail>, string]>)('renders %j as %j', (fields, phrase) => {
    expect(summaryOf({ ...UNSET, ...fields }).condition).toBe(phrase);
  });

  it('leaves null, false, empty-string, trigger, version, default, and form fields out', () => {
    expect(
      summaryOf({
        ...UNSET,
        trigger: ref('trade'),
        required_pokemon_form: ref('fixture-base-form'),
        evolved_pokemon_form: ref('fixture-evolved-form'),
      }),
    ).toEqual({ trigger: 'trade', minLevel: null, item: null, condition: null });
  });

  it('renders every populated requirement of a fully populated alternative in one condition', () => {
    const full: RawEvolutionDetail = {
      ...UNSET,
      is_default: false,
      required_pokemon_form: ref('fixture-base-form'),
      evolved_pokemon_form: ref('fixture-evolved-form'),
      item: ref('fixture-stone'),
      gender: 1,
      held_item: ref('fixture-item'),
      known_move: ref('fixture-move'),
      known_move_type: ref('fairy'),
      location: ref('fixture-location'),
      min_level: 30,
      min_happiness: 160,
      min_beauty: 170,
      min_affection: 2,
      near_special_rock: true,
      needs_multiplayer: true,
      needs_overworld_rain: true,
      party_species: ref('fixture-species'),
      party_type: ref('dark'),
      relative_physical_stats: 0,
      time_of_day: 'night',
      trade_species: ref('fixture-trade-species'),
      turn_upside_down: true,
      region: ref('hisui'),
      used_move: ref('fixture-used-move'),
      min_move_count: 20,
      min_steps: 1000,
      min_damage_taken: 49,
      allowed_natures: [ref('hardy')],
      condition_expression: {
        expression: 'EC 100 % 0 ==',
        percentage_chance: 1,
        variables: [ref('encryption-constant')],
      },
    };
    expect(summaryOf(full)).toEqual({
      trigger: 'level-up',
      minLevel: 30,
      item: 'fixture-stone',
      condition: [
        'level 30+',
        'happiness 160+',
        'use fixture-stone',
        'hold fixture-item',
        'night time',
        'know fixture-move',
        'at fixture-location',
        'know a fairy-type move',
        'beauty 170+',
        'affection 2+',
        'female',
        'attack = defense',
        'fixture-species in party',
        'dark-type Pokémon in party',
        'trade for fixture-trade-species',
        'near special rock',
        'multiplayer',
        'overworld rain',
        'turn upside down',
        'in hisui',
        'use move fixture-used-move',
        '20+ move uses',
        '1000+ steps',
        '49+ damage taken',
        'nature hardy',
        'expression EC 100 % 0 == at 1% chance',
      ].join(', '),
    });
  });
});

describe('walkEvolutionChain summary selection', () => {
  const legacy: RawEvolutionDetail = {
    ...UNSET,
    is_default: false,
    location: ref('eterna-forest'),
    near_special_rock: true,
  };
  const stone: RawEvolutionDetail = { ...UNSET, trigger: ref('use-item'), item: ref('leaf-stone') };
  const later: RawEvolutionDetail = { ...UNSET, min_level: 50 };

  it('summarizes the first default alternative in upstream order', () => {
    expect(summaryOf(legacy, stone, later)).toEqual({
      trigger: 'use-item',
      minLevel: null,
      item: 'leaf-stone',
      condition: 'use leaf-stone',
    });
  });

  it.each([false, null])(
    'falls back to the first alternative when every is_default is %s',
    (flag) => {
      expect(summaryOf({ ...stone, is_default: flag }, { ...later, is_default: flag })).toEqual({
        trigger: 'use-item',
        minLevel: null,
        item: 'leaf-stone',
        condition: 'use leaf-stone',
      });
    },
  );

  it('keeps every alternative in upstream order and summarizes the root as base', () => {
    const root = walkEvolutionChain(chain(legacy, stone, later));
    expect(root).toMatchObject({ trigger: 'base', minLevel: null, item: null, condition: null });
    const final = root.evolvesTo[0]!.evolvesTo[0]!;
    expect(final.evolutionDetails.map((detail) => [detail.isDefault, detail.location])).toEqual([
      [false, 'eterna-forest'],
      [true, null],
      [true, null],
    ]);
  });
});
