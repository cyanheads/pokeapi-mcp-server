/**
 * @fileoverview Raw PokéAPI v2 response types and normalized domain types.
 * @module services/pokeapi/types
 */

// ---------------------------------------------------------------------------
// Shared PokéAPI primitives
// ---------------------------------------------------------------------------

export interface NamedResource {
  name: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Raw PokéAPI response shapes
// ---------------------------------------------------------------------------

export interface RawPokemon {
  abilities: Array<{
    is_hidden: boolean;
    slot: number;
    ability: NamedResource;
  }>;
  base_experience?: number | null;
  height: number;
  held_items?: Array<{
    item: NamedResource;
    version_details: Array<{
      rarity: number;
      version: NamedResource;
    }>;
  }>;
  id: number;
  is_default: boolean;
  moves: Array<{
    move: NamedResource;
    version_group_details: Array<{
      level_learned_at: number;
      move_learn_method: NamedResource;
      version_group: NamedResource;
    }>;
  }>;
  name: string;
  order: number;
  species: NamedResource;
  sprites: {
    front_default: string | null;
    front_shiny: string | null;
    back_default: string | null;
    back_shiny: string | null;
    other?: {
      'official-artwork'?: { front_default: string | null };
      dream_world?: { front_default: string | null };
    };
  };
  stats: Array<{
    base_stat: number;
    effort: number;
    stat: NamedResource;
  }>;
  types: Array<{
    slot: number;
    type: NamedResource;
  }>;
  weight: number;
}

export interface RawPokemonSpecies {
  base_happiness?: number | null;
  capture_rate: number;
  color: NamedResource;
  egg_groups: NamedResource[];
  evolution_chain: { url: string };
  evolves_from_species?: NamedResource | null;
  flavor_text_entries: Array<{
    flavor_text: string;
    language: NamedResource;
    version: NamedResource;
  }>;
  form_descriptions: Array<{ description: string; language: NamedResource }>;
  forms_switchable: boolean;
  gender_rate: number;
  genera: Array<{ genus: string; language: NamedResource }>;
  generation: NamedResource;
  growth_rate: NamedResource;
  habitat?: NamedResource | null;
  has_gender_differences: boolean;
  hatch_counter?: number | null;
  id: number;
  is_baby: boolean;
  is_legendary: boolean;
  is_mythical: boolean;
  name: string;
  names: Array<{ name: string; language: NamedResource }>;
  order: number;
  pokedex_numbers: Array<{
    entry_number: number;
    pokedex: NamedResource;
  }>;
  shape?: NamedResource | null;
  varieties: Array<{ is_default: boolean; pokemon: NamedResource }>;
}

export interface RawEvolutionChain {
  baby_trigger_item?: NamedResource | null;
  chain: RawChainLink;
  id: number;
}

export interface RawChainLink {
  evolution_details: Array<{
    item?: NamedResource | null;
    trigger: NamedResource;
    gender?: number | null;
    held_item?: NamedResource | null;
    known_move?: NamedResource | null;
    known_move_type?: NamedResource | null;
    location?: NamedResource | null;
    min_level?: number | null;
    min_happiness?: number | null;
    min_beauty?: number | null;
    min_affection?: number | null;
    needs_overworld_rain: boolean;
    party_species?: NamedResource | null;
    party_type?: NamedResource | null;
    relative_physical_stats?: number | null;
    time_of_day: string;
    trade_species?: NamedResource | null;
    turn_upside_down: boolean;
  }>;
  evolves_to: RawChainLink[];
  is_baby: boolean;
  species: NamedResource;
}

export interface RawAbility {
  effect_changes: unknown[];
  effect_entries: Array<{
    effect: string;
    short_effect: string;
    language: NamedResource;
  }>;
  flavor_text_entries: Array<{
    flavor_text: string;
    language: NamedResource;
    version_group: NamedResource;
  }>;
  generation: NamedResource;
  id: number;
  is_main_series: boolean;
  name: string;
  names: Array<{ name: string; language: NamedResource }>;
  pokemon: Array<{
    is_hidden: boolean;
    slot: number;
    pokemon: NamedResource;
  }>;
}

export interface RawType {
  damage_relations: {
    no_damage_to: NamedResource[];
    half_damage_to: NamedResource[];
    double_damage_to: NamedResource[];
    no_damage_from: NamedResource[];
    half_damage_from: NamedResource[];
    double_damage_from: NamedResource[];
  };
  game_indices: unknown[];
  generation: NamedResource;
  id: number;
  move_damage_class?: NamedResource | null;
  moves: NamedResource[];
  name: string;
  names: Array<{ name: string; language: NamedResource }>;
  past_damage_relations: unknown[];
  pokemon: Array<{ slot: number; pokemon: NamedResource }>;
}

export interface RawMove {
  accuracy?: number | null;
  contest_combos?: unknown;
  contest_effect?: { url: string } | null;
  contest_type?: NamedResource | null;
  damage_class?: NamedResource | null;
  effect_chance?: number | null;
  effect_changes: unknown[];
  effect_entries: Array<{
    effect: string;
    short_effect: string;
    language: NamedResource;
  }>;
  flavor_text_entries: Array<{
    flavor_text: string;
    language: NamedResource;
    version_group: NamedResource;
  }>;
  generation: NamedResource;
  id: number;
  learned_by_pokemon: NamedResource[];
  machines: unknown[];
  meta?: {
    ailment: NamedResource;
    category: NamedResource;
    min_hits?: number | null;
    max_hits?: number | null;
    min_turns?: number | null;
    max_turns?: number | null;
    drain?: number | null;
    healing?: number | null;
    crit_rate: number;
    ailment_chance: number;
    flinch_chance: number;
    stat_chance: number;
  } | null;
  name: string;
  names: Array<{ name: string; language: NamedResource }>;
  past_values: unknown[];
  power?: number | null;
  pp?: number | null;
  priority: number;
  stat_changes: Array<{
    change: number;
    stat: NamedResource;
  }>;
  super_contest_effect?: { url: string } | null;
  target: NamedResource;
  type: NamedResource;
}

export interface RawItem {
  attributes: NamedResource[];
  baby_trigger_for?: { url: string } | null;
  category: NamedResource;
  cost: number;
  effect_entries: Array<{
    effect: string;
    short_effect: string;
    language: NamedResource;
  }>;
  flavor_text_entries: Array<{
    text: string;
    version_group: NamedResource;
    language: NamedResource;
  }>;
  fling_effect?: NamedResource | null;
  fling_power?: number | null;
  game_indices: Array<{
    game_index: number;
    generation: NamedResource;
  }>;
  held_by_pokemon: Array<{
    pokemon: NamedResource;
    version_details: Array<{ rarity: number; version: NamedResource }>;
  }>;
  id: number;
  machines: unknown[];
  name: string;
  names: Array<{ name: string; language: NamedResource }>;
  sprites: { default: string | null };
}

export interface RawNature {
  decreased_stat?: NamedResource | null;
  hates_flavor?: NamedResource | null;
  id: number;
  increased_stat?: NamedResource | null;
  likes_flavor?: NamedResource | null;
  move_battle_style_preferences: Array<{
    low_hp_preference: number;
    high_hp_preference: number;
    move_battle_style: NamedResource;
  }>;
  name: string;
  names: Array<{ name: string; language: NamedResource }>;
  pokeathlon_stat_changes: Array<{
    max_change: number;
    pokeathlon_stat: NamedResource;
  }>;
}

export interface RawGeneration {
  abilities: NamedResource[];
  id: number;
  main_region: NamedResource;
  moves: NamedResource[];
  name: string;
  names: Array<{ name: string; language: NamedResource }>;
  pokemon_species: NamedResource[];
  types: NamedResource[];
  version_groups: NamedResource[];
}

export interface RawPokedex {
  descriptions: Array<{ description: string; language: NamedResource }>;
  id: number;
  is_main_series: boolean;
  name: string;
  names: Array<{ name: string; language: NamedResource }>;
  pokemon_entries: Array<{
    entry_number: number;
    pokemon_species: NamedResource;
  }>;
  region?: NamedResource | null;
  version_groups: NamedResource[];
}

export interface RawEggGroup {
  id: number;
  name: string;
  names: Array<{ name: string; language: NamedResource }>;
  pokemon_species: NamedResource[];
}

// ---------------------------------------------------------------------------
// Normalized domain types (used by tools)
// ---------------------------------------------------------------------------

export interface PokemonStat {
  baseStat: number;
  effort: number;
  name: string;
}

export interface PokemonAbilityRef {
  effectText: string | null;
  isHidden: boolean;
  name: string;
  shortEffectText: string | null;
  slot: number;
}

export interface PokemonMoveSummary {
  learnMethod: string;
  levelLearnedAt: number;
  name: string;
}

export interface EvolutionStep {
  condition: string | null;
  evolvesTo: EvolutionStep[];
  item: string | null;
  minLevel: number | null;
  species: string;
  trigger: string;
}

export interface PokemonDossier {
  abilities: PokemonAbilityRef[];
  captureRate: number;
  eggGroups: string[];
  evolutionChain: EvolutionStep | null;
  genderRate: number;
  generation: string;
  genus: string | null;
  growthRate: string;
  heightDm: number;
  id: number;
  isLegendary: boolean;
  isMythical: boolean;
  moveCount: number;
  moves: PokemonMoveSummary[];
  name: string;
  speciesFlavorText: string | null;
  sprites: {
    frontDefault: string | null;
    frontShiny: string | null;
    officialArtwork: string | null;
  };
  stats: PokemonStat[];
  types: string[];
  varieties: Array<{ name: string; isDefault: boolean }>;
  weightHg: number;
}

export interface TypeMatchups {
  defensiveRelations: {
    weakTo: string[];
    resists: string[];
    immuneTo: string[];
  };
  offensiveRelations: {
    superEffectiveTo: string[];
    notVeryEffectiveTo: string[];
    noEffectTo: string[];
  };
  typeName: string;
}

export interface DualTypeMatchups {
  defensiveMatchups: Record<string, number>;
  types: string[];
}

export interface MoveDetails {
  accuracy: number | null;
  damageClass: string | null;
  effectChance: number | null;
  effectText: string | null;
  id: number;
  learnedByPokemon: string[];
  name: string;
  power: number | null;
  pp: number | null;
  priority: number;
  shortEffectText: string | null;
  statChanges: Array<{ stat: string; change: number }>;
  target: string;
  type: string;
}

export interface AbilityDetails {
  effectText: string | null;
  generation: string;
  id: number;
  name: string;
  pokemon: Array<{ name: string; isHidden: boolean; slot: number }>;
  shortEffectText: string | null;
}

export interface ItemDetails {
  attributes: string[];
  category: string;
  cost: number;
  effectText: string | null;
  flingPower: number | null;
  heldByPokemon: string[];
  id: number;
  name: string;
  shortEffectText: string | null;
  spriteUrl: string | null;
}

export interface NatureDetails {
  decreasedStat: string | null;
  hatesFlavor: string | null;
  id: number;
  increasedStat: string | null;
  likesFlavor: string | null;
  name: string;
}

export interface PokemonListEntry {
  id: number;
  name: string;
  types?: string[];
}
