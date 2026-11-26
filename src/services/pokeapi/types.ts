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
  /** Form records of this Pokémon; each form record names the version group that introduced it. */
  forms: NamedResource[];
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
  /**
   * Ability slots as they stood through `generation` (the last generation the old value applied).
   * Lists only changed slots; a null `ability` means the slot was empty then.
   */
  past_abilities: Array<{
    generation: NamedResource;
    abilities: Array<{
      ability: NamedResource | null;
      is_hidden: boolean;
      slot: number;
    }>;
  }>;
  /**
   * Base stats and effort yields as they stood through `generation`. Lists only changed stats;
   * Gen 1 `special` appears here under its own stat name.
   */
  past_stats: Array<{
    generation: NamedResource;
    stats: Array<{
      base_stat: number;
      effort: number;
      stat: NamedResource;
    }>;
  }>;
  /** Complete typing as it stood through `generation` (the last generation the old typing applied). */
  past_types: Array<{
    generation: NamedResource;
    types: Array<{
      slot: number;
      type: NamedResource;
    }>;
  }>;
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

/** One upstream evolution method, including its version and form metadata. */
export interface RawEvolutionDetail {
  allowed_natures?: NamedResource[] | null;
  condition_expression?: {
    expression: string;
    percentage_chance: number | null;
    variables: NamedResource[];
  } | null;
  evolved_pokemon_form?: NamedResource | null;
  gender?: number | null;
  held_item?: NamedResource | null;
  is_default?: boolean | null;
  item?: NamedResource | null;
  known_move?: NamedResource | null;
  known_move_type?: NamedResource | null;
  location?: NamedResource | null;
  min_affection?: number | null;
  min_beauty?: number | null;
  min_damage_taken?: number | null;
  min_happiness?: number | null;
  min_level?: number | null;
  min_move_count?: number | null;
  min_steps?: number | null;
  near_special_rock?: boolean | null;
  needs_multiplayer?: boolean | null;
  needs_overworld_rain?: boolean | null;
  party_species?: NamedResource | null;
  party_type?: NamedResource | null;
  region?: NamedResource | null;
  relative_physical_stats?: number | null;
  required_pokemon_form?: NamedResource | null;
  time_of_day?: string | null;
  trade_species?: NamedResource | null;
  trigger: NamedResource;
  turn_upside_down?: boolean | null;
  used_move?: NamedResource | null;
  version_group?: NamedResource | null;
}

export interface RawChainLink {
  evolution_details: RawEvolutionDetail[];
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

export interface RawDamageRelations {
  double_damage_from: NamedResource[];
  double_damage_to: NamedResource[];
  half_damage_from: NamedResource[];
  half_damage_to: NamedResource[];
  no_damage_from: NamedResource[];
  no_damage_to: NamedResource[];
}

export interface RawType {
  damage_relations: RawDamageRelations;
  game_indices: unknown[];
  generation: NamedResource;
  id: number;
  move_damage_class?: NamedResource | null;
  moves: NamedResource[];
  name: string;
  names: Array<{ name: string; language: NamedResource }>;
  /** Complete damage relations as they stood through `generation` (the last generation they applied). */
  past_damage_relations: Array<{
    generation: NamedResource;
    damage_relations: RawDamageRelations;
  }>;
  pokemon: Array<{ slot: number; pokemon: NamedResource }>;
}

/** One TM, TR, or HM row on an item or move: the machine record that applies in one version group. */
export interface RawMachineRef {
  machine: { url: string };
  version_group: NamedResource;
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
  machines: RawMachineRef[];
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
  cost?: number | null;
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
  machines: RawMachineRef[];
  name: string;
  names: Array<{ name: string; language: NamedResource }>;
  prices?: Array<{
    version_group: NamedResource;
    currency: NamedResource;
    purchase_price: number | null;
    sell_price: number | null;
  }>;
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

export interface RawPokemonForm {
  id: number;
  name: string;
  /** Version group that introduced this form. */
  version_group: NamedResource;
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
  versionGroup: string;
}

export interface EvolutionStep {
  condition: string | null;
  evolutionDetails: EvolutionDetail[];
  evolvesTo: EvolutionStep[];
  item: string | null;
  minLevel: number | null;
  species: string;
  trigger: string;
}

/** Complete alternative; null means upstream did not specify the field. */
export interface EvolutionDetail {
  allowedNatures: string[] | null;
  conditionExpression: {
    expression: string;
    percentageChance: number | null;
    variables: string[];
  } | null;
  evolvedPokemonForm: string | null;
  gender: number | null;
  heldItem: string | null;
  isDefault: boolean | null;
  item: string | null;
  knownMove: string | null;
  knownMoveType: string | null;
  location: string | null;
  minAffection: number | null;
  minBeauty: number | null;
  minDamageTaken: number | null;
  minHappiness: number | null;
  minLevel: number | null;
  minMoveCount: number | null;
  minSteps: number | null;
  nearSpecialRock: boolean | null;
  needsMultiplayer: boolean | null;
  needsOverworldRain: boolean | null;
  partySpecies: string | null;
  partyType: string | null;
  region: string | null;
  relativePhysicalStats: number | null;
  requiredPokemonForm: string | null;
  timeOfDay: string | null;
  tradeSpecies: string | null;
  trigger: string;
  turnUpsideDown: boolean | null;
  usedMove: string | null;
  versionGroup: string | null;
}

export interface PokemonDossier {
  abilities: PokemonAbilityRef[];
  baseHappiness: number | null;
  captureRate: number;
  eggGroups: string[];
  evolutionChain: EvolutionStep | null;
  flavorTextVersion: string | null;
  genderRate: number;
  generation: string;
  genus: string | null;
  growthRate: string;
  hatchCounter: number | null;
  heightDm: number;
  /** Pokémon-record ID, including form IDs; not necessarily a National Pokédex number. */
  id: number;
  isBaby: boolean;
  isLegendary: boolean;
  isMythical: boolean;
  moveCount: number;
  moves: PokemonMoveSummary[];
  name: string;
  notices: string[];
  /** Ability slots that differed, each through the last generation it applied to; null name = empty slot. */
  pastAbilities: Array<{
    abilities: Array<{ isHidden: boolean; name: string | null; slot: number }>;
    throughGeneration: string;
  }>;
  /** Base stats and effort yields that differed, each through the last generation it applied to. */
  pastStats: Array<{ stats: PokemonStat[]; throughGeneration: string }>;
  /** Complete earlier typings, each through the last generation it applied to. */
  pastTypes: Array<{ throughGeneration: string; types: string[] }>;
  pokedexNumbers: Array<{ pokedex: string; entryNumber: number }>;
  /** Species name the identifier matched instead of a Pokémon record; null for a direct match. */
  resolvedFromSpecies: string | null;
  speciesFlavorText: string | null;
  speciesId: number;
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

/** Damage one attacking type deals, by multiplier. */
export interface TypeRelations {
  noEffectTo: string[];
  notVeryEffectiveTo: string[];
  superEffectiveTo: string[];
}

export interface TypeMatchups {
  defensiveRelations: {
    weakTo: string[];
    resists: string[];
    immuneTo: string[];
  };
  offensiveRelations: TypeRelations;
  typeName: string;
}

/** Matchups for one or two defending types, derived from one read of each type record. */
export interface TypeSetMatchups {
  /** Attacking type → multiplier against the composed defending types. */
  composedMultipliers: Record<string, number>;
  /** Offensive relations of each type, keyed in query order. */
  offensiveByType: Record<string, TypeRelations>;
}

export interface MoveDetails {
  accuracy: number | null;
  damageClass: string | null;
  effectChance: number | null;
  effectText: string | null;
  /** Version group of the flavor text standing in for effect prose; null for prose or no text. */
  effectTextVersionGroup: string | null;
  id: number;
  learnedByPokemon: string[];
  /** TM, TR, or HM item teaching the move in each version group, in upstream order. */
  machines: Array<{ versionGroup: string; item: string | null }>;
  name: string;
  notices: string[];
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
  cost: number | null;
  effectText: string | null;
  /** Version group of the flavor text standing in for effect prose; null for prose or no text. */
  effectTextVersionGroup: string | null;
  flingPower: number | null;
  heldByPokemon: string[];
  id: number;
  /** Move this TM, TR, or HM teaches in each version group, in upstream order. */
  machines: Array<{ versionGroup: string; move: string | null }>;
  name: string;
  notices: string[];
  prices: Array<{
    versionGroup: string;
    currency: string;
    purchasePrice: number | null;
    sellPrice: number | null;
  }>;
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
  entryNumber?: number;
  /** Pokémon-record ID for type catalogs; species ID for generation, pokédex and egg groups. */
  id: number;
  name: string;
  types?: string[];
}
