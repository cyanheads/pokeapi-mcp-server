/**
 * @fileoverview Normalizes a PokéAPI evolution chain: every alternative method of each stage, plus a
 * summary of the stage's default alternative.
 * @module services/pokeapi/evolution-chain
 */

import type { EvolutionDetail, EvolutionStep, RawChainLink, RawEvolutionDetail } from './types.js';

/** Evolution-detail fields that are requirements; the rest describe the alternative itself. */
type RequirementField = Exclude<
  keyof EvolutionDetail,
  'trigger' | 'versionGroup' | 'isDefault' | 'requiredPokemonForm' | 'evolvedPokemonForm'
>;

/**
 * Summary phrase per requirement, in the order the summary lists them. The mapped type makes a
 * requirement field added to EvolutionDetail a compile error here until it has a phrase.
 */
export const REQUIREMENT_PHRASES: {
  [K in RequirementField]: (value: NonNullable<EvolutionDetail[K]>) => string;
} = {
  minLevel: (level) => `level ${level}+`,
  minHappiness: (happiness) => `happiness ${happiness}+`,
  item: (item) => `use ${item}`,
  heldItem: (item) => `hold ${item}`,
  timeOfDay: (time) => `${time} time`,
  knownMove: (move) => `know ${move}`,
  location: (location) => `at ${location}`,
  knownMoveType: (type) => `know a ${type}-type move`,
  minBeauty: (beauty) => `beauty ${beauty}+`,
  minAffection: (affection) => `affection ${affection}+`,
  // PokéAPI gender IDs: 1 female, 2 male.
  gender: (gender) => (gender === 1 ? 'female' : gender === 2 ? 'male' : `gender ID ${gender}`),
  relativePhysicalStats: (relation) =>
    `attack ${relation > 0 ? '>' : relation < 0 ? '<' : '='} defense`,
  partySpecies: (species) => `${species} in party`,
  partyType: (type) => `${type}-type Pokémon in party`,
  tradeSpecies: (species) => `trade for ${species}`,
  nearSpecialRock: () => 'near special rock',
  needsMultiplayer: () => 'multiplayer',
  needsOverworldRain: () => 'overworld rain',
  turnUpsideDown: () => 'turn upside down',
  region: (region) => `in ${region}`,
  usedMove: (move) => `use move ${move}`,
  minMoveCount: (count) => `${count}+ move uses`,
  minSteps: (steps) => `${steps}+ steps`,
  minDamageTaken: (damage) => `${damage}+ damage taken`,
  allowedNatures: (natures) =>
    natures.length > 0 ? `nature ${natures.join('/')}` : 'no allowed nature',
  conditionExpression: ({ expression, percentageChance }) =>
    percentageChance === null
      ? `expression ${expression}`
      : `expression ${expression} at ${percentageChance}% chance`,
};

/** Normalizes a chain link and its descendants. */
export function walkEvolutionChain(link: RawChainLink): EvolutionStep {
  const evolutionDetails = link.evolution_details.map(normalizeDetail);
  // PokéAPI marks one default alternative per variety; the first in upstream order is the summary.
  const summary =
    evolutionDetails.find((detail) => detail.isDefault === true) ?? evolutionDetails[0];
  return {
    species: link.species.name,
    trigger: summary?.trigger ?? 'base',
    minLevel: summary?.minLevel ?? null,
    item: summary?.item ?? null,
    condition: summary ? describeRequirements(summary) : null,
    evolutionDetails,
    evolvesTo: link.evolves_to.map(walkEvolutionChain),
  };
}

function describeRequirements(detail: EvolutionDetail): string | null {
  const parts = (Object.keys(REQUIREMENT_PHRASES) as RequirementField[]).flatMap((field) => {
    const phrase = phraseFor(field, detail);
    return phrase === null ? [] : [phrase];
  });
  return parts.length > 0 ? parts.join(', ') : null;
}

function phraseFor<K extends RequirementField>(field: K, detail: EvolutionDetail): string | null {
  const value = detail[field];
  // PokéAPI reports an unset requirement as null, false, or ""; zero and an empty list are values.
  if (value === null || value === false || value === '') return null;
  return REQUIREMENT_PHRASES[field](value as NonNullable<EvolutionDetail[K]>);
}

function normalizeDetail(method: RawEvolutionDetail): EvolutionDetail {
  return {
    versionGroup: method.version_group?.name ?? null,
    isDefault: method.is_default ?? null,
    item: method.item?.name ?? null,
    trigger: method.trigger.name,
    gender: method.gender ?? null,
    heldItem: method.held_item?.name ?? null,
    knownMove: method.known_move?.name ?? null,
    knownMoveType: method.known_move_type?.name ?? null,
    location: method.location?.name ?? null,
    minLevel: method.min_level ?? null,
    minHappiness: method.min_happiness ?? null,
    minBeauty: method.min_beauty ?? null,
    minAffection: method.min_affection ?? null,
    nearSpecialRock: method.near_special_rock ?? null,
    needsMultiplayer: method.needs_multiplayer ?? null,
    needsOverworldRain: method.needs_overworld_rain ?? null,
    partySpecies: method.party_species?.name ?? null,
    partyType: method.party_type?.name ?? null,
    relativePhysicalStats: method.relative_physical_stats ?? null,
    timeOfDay: method.time_of_day ?? null,
    tradeSpecies: method.trade_species?.name ?? null,
    turnUpsideDown: method.turn_upside_down ?? null,
    region: method.region?.name ?? null,
    requiredPokemonForm: method.required_pokemon_form?.name ?? null,
    evolvedPokemonForm: method.evolved_pokemon_form?.name ?? null,
    usedMove: method.used_move?.name ?? null,
    minMoveCount: method.min_move_count ?? null,
    minSteps: method.min_steps ?? null,
    minDamageTaken: method.min_damage_taken ?? null,
    allowedNatures: method.allowed_natures?.map((nature) => nature.name) ?? null,
    conditionExpression: method.condition_expression
      ? {
          expression: method.condition_expression.expression,
          percentageChance: method.condition_expression.percentage_chance,
          variables: method.condition_expression.variables.map((variable) => variable.name),
        }
      : null,
  };
}
