/**
 * @fileoverview Type-matchup composition and generation scoping over PokéAPI type, generation,
 * and Pokémon records: per-type offense, composed defense, and the past entries in force for a
 * requested generation.
 * @module services/pokeapi/type-matchups
 */

import type {
  NamedResource,
  RawDamageRelations,
  RawGeneration,
  RawPokemon,
  RawType,
  TypeRelations,
  TypeSetMatchups,
} from './types.js';

/** A requested generation and what later generations introduced. */
export interface GenerationScope {
  id: number;
  /** Type introduced after this generation → the generation that introduced it. */
  laterTypes: ReadonlyMap<string, string>;
  /** Version group released after this generation → its generation. */
  laterVersionGroups: ReadonlyMap<string, string>;
  /** Canonical PokéAPI name, e.g. "generation-v". */
  name: string;
}

/** No PokéAPI type record matches these requested type names. */
export class UnknownTypeError extends Error {
  readonly types: string[];
  constructor(types: string[], options?: ErrorOptions) {
    super('No PokéAPI type record matches the requested type.', options);
    this.types = types;
  }
}

/** A type or Pokémon form first appeared after the requested generation. */
export class NotInGenerationError extends Error {
  readonly kind: 'type' | 'pokemon';
  readonly subject: string;
  readonly introducedIn: string;
  /** The requested generation. */
  readonly generation: string;
  constructor(
    kind: 'type' | 'pokemon',
    subject: string,
    introducedIn: string,
    scope: GenerationScope,
  ) {
    super(`${subject} was introduced in ${introducedIn}, after ${scope.name}.`);
    this.kind = kind;
    this.subject = subject;
    this.introducedIn = introducedIn;
    this.generation = scope.name;
  }
}

/** Numeric ID from a PokéAPI resource URL (".../generation/5/" → 5). */
export function generationIdOf(ref: NamedResource): number {
  const match = /\/(\d+)\/?$/.exec(ref.url);
  if (!match) throw new Error(`PokéAPI reference ${ref.name} carries no numeric ID.`);
  return Number(match[1]);
}

/** Scope for `generation`, given the records of every generation after it. */
export function buildGenerationScope(
  generation: RawGeneration,
  later: RawGeneration[],
): GenerationScope {
  const laterTypes = new Map<string, string>();
  const laterVersionGroups = new Map<string, string>();
  for (const { name, types, version_groups } of later) {
    for (const type of types) laterTypes.set(type.name, name);
    for (const group of version_groups) laterVersionGroups.set(group.name, name);
  }
  return { id: generation.id, name: generation.name, laterTypes, laterVersionGroups };
}

/**
 * PokéAPI tags each past entry with the last generation its value applied to, so the entry in
 * force for a generation is the earliest one tagged at or after it.
 */
function entryInForce<T extends { generation: NamedResource }>(
  entries: readonly T[],
  scope: GenerationScope,
): T | undefined {
  let inForce: { entry: T; id: number } | undefined;
  for (const entry of entries) {
    const id = generationIdOf(entry.generation);
    if (id >= scope.id && (!inForce || id < inForce.id)) inForce = { entry, id };
  }
  return inForce?.entry;
}

/** Type names of a Pokémon record's type slots, in slot order. */
export function typeNamesBySlot(types: RawPokemon['types']): string[] {
  return types.toSorted((a, b) => a.slot - b.slot).map((t) => t.type.name);
}

/** A Pokémon record's typing in slot order: current, or as it stood in the scope's generation. */
export function pokemonTypes(pokemon: RawPokemon, scope?: GenerationScope): string[] {
  const past = scope ? entryInForce(pokemon.past_types, scope) : undefined;
  return typeNamesBySlot(past?.types ?? pokemon.types);
}

/** A type's damage relations as they stood in the scope's generation, minus later types. */
function scopedDamageRelations(type: RawType, scope: GenerationScope): RawDamageRelations {
  const relations =
    entryInForce(type.past_damage_relations, scope)?.damage_relations ?? type.damage_relations;
  const existing = (refs: NamedResource[]) => refs.filter((ref) => !scope.laterTypes.has(ref.name));
  return {
    no_damage_to: existing(relations.no_damage_to),
    half_damage_to: existing(relations.half_damage_to),
    double_damage_to: existing(relations.double_damage_to),
    no_damage_from: existing(relations.no_damage_from),
    half_damage_from: existing(relations.half_damage_from),
    double_damage_from: existing(relations.double_damage_from),
  };
}

/** Damage one type deals, by multiplier. */
export function offenseOf(relations: RawDamageRelations): TypeRelations {
  return {
    superEffectiveTo: relations.double_damage_to.map((t) => t.name),
    notVeryEffectiveTo: relations.half_damage_to.map((t) => t.name),
    noEffectTo: relations.no_damage_to.map((t) => t.name),
  };
}

/** Attacking type → multiplier against every defending type at once. */
function composeDefense(defenders: RawDamageRelations[]): Record<string, number> {
  const multipliers: Record<string, number> = {};
  for (const relations of defenders) {
    // Immunity always wins — set to 0 and don't overwrite
    for (const t of relations.no_damage_from) multipliers[t.name] = 0;
    for (const t of relations.half_damage_from) {
      if (multipliers[t.name] !== 0) multipliers[t.name] = (multipliers[t.name] ?? 1) * 0.5;
    }
    for (const t of relations.double_damage_from) {
      if (multipliers[t.name] !== 0) multipliers[t.name] = (multipliers[t.name] ?? 1) * 2;
    }
  }
  return multipliers;
}

/**
 * Per-type offense and composed defense for distinct type records, current or as of a scope.
 * Throws NotInGenerationError for a type the scope's generation did not have.
 */
export function matchupsOf(records: RawType[], scope?: GenerationScope): TypeSetMatchups {
  const relations = records.map((record) => {
    if (!scope) return { name: record.name, relations: record.damage_relations };
    const introducedIn = scope.laterTypes.get(record.name);
    if (introducedIn) throw new NotInGenerationError('type', record.name, introducedIn, scope);
    return { name: record.name, relations: scopedDamageRelations(record, scope) };
  });
  return {
    offensiveByType: Object.fromEntries(relations.map((r) => [r.name, offenseOf(r.relations)])),
    composedMultipliers: composeDefense(relations.map((r) => r.relations)),
  };
}
