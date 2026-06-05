/**
 * @fileoverview pokeapi_get_type_matchups tool — computed offensive and defensive type effectiveness.
 * @module mcp-server/tools/definitions/get-type-matchups.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

const TypeRelationsSchema = z.object({
  superEffectiveTo: z.array(z.string()).describe('Types this type deals 2× damage to.'),
  notVeryEffectiveTo: z.array(z.string()).describe('Types this type deals 0.5× damage to.'),
  noEffectTo: z.array(z.string()).describe('Types this type deals 0× damage to (immune).'),
});

const DefensiveMatchupsSchema = z.object({
  weakTo: z.array(z.string()).describe('Attacking types that deal 2× or more damage.'),
  resists: z
    .array(z.string())
    .describe('Attacking types that deal 0.5× or less damage (but not immune).'),
  immuneTo: z.array(z.string()).describe('Attacking types that deal 0× damage.'),
});

export const getTypeMatchups = tool('pokeapi_get_type_matchups', {
  title: 'Get Type Matchups',
  description:
    'Get the full offensive and defensive type effectiveness breakdown. ' +
    'Provide either a type name (e.g. "fire", "psychic") or a Pokémon identifier ' +
    '(name or dex number). For dual-type Pokémon, the defensive multipliers are ' +
    'correctly composed (e.g. Fire/Flying vs Rock = 4× because both types are ' +
    'weak to Rock). Exactly one of type or pokemon must be provided.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    type: z
      .string()
      .optional()
      .describe(
        'Type name in lowercase (e.g. "fire", "water", "psychic"). Provide this or pokemon, not both.',
      ),
    pokemon: z
      .string()
      .optional()
      .describe(
        'Pokémon name or Pokédex number. The server resolves the types automatically. Provide this or type, not both.',
      ),
  }),
  output: z.object({
    queryType: z
      .string()
      .describe(
        'How the query was resolved: "type" for a direct type query, "pokemon" for a Pokémon lookup.',
      ),
    resolvedTypes: z.array(z.string()).describe('The type name(s) the query resolved to.'),
    offensiveRelations: TypeRelationsSchema.nullable().describe(
      'Offensive effectiveness (populated for single-type queries; null for dual-type Pokémon where per-type breakdown does not compose cleanly).',
    ),
    defensiveMatchups: DefensiveMatchupsSchema.describe(
      'Defensive matchups — composed correctly for dual-type Pokémon.',
    ),
    composedMultipliers: z
      .record(z.string(), z.number())
      .describe(
        'Multiplier for each non-neutral attacking type (0, 0.25, 0.5, 1, 2, 4). Types absent from this map deal 1× damage.',
      ),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The type name or Pokémon identifier was not found in PokéAPI.',
      recovery:
        'Verify the type name is a valid Pokémon type (fire, water, etc.) or use a valid Pokémon name/number.',
    },
    {
      reason: 'invalid_input',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'Neither type nor pokemon was provided.',
      recovery: 'Provide either a type name or a Pokémon identifier — exactly one is required.',
    },
  ],

  async handler(input, ctx) {
    const svc = getPokeApiService();

    if (!input.type && !input.pokemon) {
      throw ctx.fail(
        'invalid_input',
        'Provide either type or pokemon — exactly one is required.',
        ctx.recoveryFor('invalid_input'),
      );
    }

    try {
      if (input.type) {
        // Single-type query
        const typeName = svc.normalizeIdentifier(input.type);
        ctx.log.info('Getting type matchups', { type: typeName });
        const matchups = await svc.getTypeMatchups(typeName, ctx);

        const multipliers: Record<string, number> = {};
        for (const t of matchups.defensiveRelations.immuneTo) multipliers[t] = 0;
        for (const t of matchups.defensiveRelations.resists) multipliers[t] = 0.5;
        for (const t of matchups.defensiveRelations.weakTo) multipliers[t] = 2;

        return {
          queryType: 'type',
          resolvedTypes: [matchups.typeName],
          offensiveRelations: matchups.offensiveRelations,
          defensiveMatchups: matchups.defensiveRelations,
          composedMultipliers: multipliers,
        };
      }

      // Pokémon query
      const pokemonId = svc.normalizeIdentifier(input.pokemon!);
      ctx.log.info('Getting type matchups for Pokémon', { pokemon: pokemonId });
      const rawPokemon = await svc.fetchPokemon(pokemonId, ctx);
      const types = rawPokemon.types.sort((a, b) => a.slot - b.slot).map((t) => t.type.name);

      const composedMultipliers = await svc.getDualTypeDefensive(types, ctx);

      const weakTo = Object.entries(composedMultipliers)
        .filter(([, m]) => m >= 2)
        .map(([t]) => t);
      const resists = Object.entries(composedMultipliers)
        .filter(([, m]) => m > 0 && m < 1)
        .map(([t]) => t);
      const immuneTo = Object.entries(composedMultipliers)
        .filter(([, m]) => m === 0)
        .map(([t]) => t);

      return {
        queryType: 'pokemon',
        resolvedTypes: types,
        offensiveRelations:
          types.length === 1
            ? (await svc.getTypeMatchups(types[0]!, ctx)).offensiveRelations
            : null,
        defensiveMatchups: { weakTo, resists, immuneTo },
        composedMultipliers,
      };
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        const subject = input.type ?? input.pokemon ?? 'identifier';
        throw ctx.fail(
          'not_found',
          `"${subject}" not found — verify it is a valid type name (e.g. "fire") or Pokémon name/number.`,
          ctx.recoveryFor('not_found'),
        );
      }
      throw err;
    }
  },

  format: (result) => {
    const lines: string[] = [];

    lines.push(`# Type Matchups: ${result.resolvedTypes.join(' / ')}`);
    lines.push(`**Query type:** ${result.queryType}`);

    if (result.offensiveRelations) {
      lines.push('\n## Offensive Relations');
      if (result.offensiveRelations.superEffectiveTo.length > 0)
        lines.push(
          `**Super Effective (2×):** ${result.offensiveRelations.superEffectiveTo.join(', ')}`,
        );
      if (result.offensiveRelations.notVeryEffectiveTo.length > 0)
        lines.push(
          `**Not Very Effective (0.5×):** ${result.offensiveRelations.notVeryEffectiveTo.join(', ')}`,
        );
      if (result.offensiveRelations.noEffectTo.length > 0)
        lines.push(`**No Effect (0×):** ${result.offensiveRelations.noEffectTo.join(', ')}`);
    }

    lines.push('\n## Defensive Matchups');
    if (result.defensiveMatchups.immuneTo.length > 0)
      lines.push(`**Immune (0×):** ${result.defensiveMatchups.immuneTo.join(', ')}`);
    if (result.defensiveMatchups.resists.length > 0)
      lines.push(`**Resists:** ${result.defensiveMatchups.resists.join(', ')}`);
    if (result.defensiveMatchups.weakTo.length > 0)
      lines.push(`**Weak To:** ${result.defensiveMatchups.weakTo.join(', ')}`);

    lines.push('\n## Composed Multipliers');
    const sorted = Object.entries(result.composedMultipliers).sort(([, a], [, b]) => b - a);
    for (const [type, mult] of sorted) {
      lines.push(`**${type}:** ${mult}×`);
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
