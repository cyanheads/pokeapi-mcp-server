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
    '(name or PokéAPI Pokémon-record ID). For dual-type Pokémon, the defensive multipliers are ' +
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
        'Pokémon name or PokéAPI Pokémon-record ID. The server resolves the types automatically. Provide this or type, not both.',
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
        'Multiplier (0, 0.25, 0.5, 1, 2, 4) for every attacking type touched by at least one of the resolved defending type(s), including net-neutral 1× entries where a dual type composes to a cancellation (e.g. Fire/Flying vs Ice: 0.5× then 2× = 1×). A type absent from this map relates to neither defending type and also deals 1× damage.',
      ),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The type name or Pokémon identifier was not found in PokéAPI.',
      recovery:
        'Verify the type name is a valid Pokémon type (fire, water, etc.) or use a Pokémon name or PokéAPI Pokémon-record ID.',
    },
    {
      reason: 'invalid_input',
      code: JsonRpcErrorCode.ValidationError,
      when: 'Neither type nor pokemon was provided, or both were provided simultaneously.',
      recovery: 'Provide either a type name or a Pokémon identifier — exactly one is required.',
    },
  ],

  async handler(input, ctx) {
    const svc = getPokeApiService();

    if (input.type && input.pokemon) {
      throw ctx.fail('invalid_input', 'Provide either type or pokemon — not both.');
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

      if (!input.pokemon) {
        throw ctx.fail(
          'invalid_input',
          'Provide either type or pokemon — exactly one is required.',
        );
      }
      const pokemonId = svc.normalizeIdentifier(input.pokemon);
      ctx.log.info('Getting type matchups for Pokémon', { pokemon: pokemonId });
      const rawPokemon = await svc.fetchPokemon(pokemonId, ctx);
      const types = rawPokemon.types.toSorted((a, b) => a.slot - b.slot).map((t) => t.type.name);

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

      // Single-type Pokémon expose a clean offensive breakdown; dual-type does not compose.
      const [firstType] = types;
      const offensiveRelations =
        types.length === 1 && firstType
          ? (await svc.getTypeMatchups(firstType, ctx)).offensiveRelations
          : null;

      return {
        queryType: 'pokemon',
        resolvedTypes: types,
        offensiveRelations,
        defensiveMatchups: { weakTo, resists, immuneTo },
        composedMultipliers,
      };
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        const subject = input.type ?? input.pokemon ?? 'identifier';
        throw ctx.fail(
          'not_found',
          `"${subject}" not found — use a valid type name (e.g. "fire"), Pokémon name, or PokéAPI Pokémon-record ID.`,
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
      lines.push(
        `**Super Effective (2×):** ${result.offensiveRelations.superEffectiveTo.join(', ') || 'None'}`,
      );
      lines.push(
        `**Not Very Effective (0.5×):** ${result.offensiveRelations.notVeryEffectiveTo.join(', ') || 'None'}`,
      );
      lines.push(
        `**No Effect (0×):** ${result.offensiveRelations.noEffectTo.join(', ') || 'None'}`,
      );
    } else {
      lines.push('\n## Offensive Relations');
      lines.push('*(Offensive breakdown unavailable for dual-type Pokémon queries.)*');
    }

    lines.push('\n## Defensive Matchups');
    lines.push(`**Immune (0×):** ${result.defensiveMatchups.immuneTo.join(', ') || 'None'}`);
    lines.push(`**Resists:** ${result.defensiveMatchups.resists.join(', ') || 'None'}`);
    lines.push(`**Weak To:** ${result.defensiveMatchups.weakTo.join(', ') || 'None'}`);

    lines.push('\n## Composed Multipliers');
    lines.push('*Includes net-neutral 1× cancellations; types not listed deal 1×.*');
    const sorted = Object.entries(result.composedMultipliers).sort(([, a], [, b]) => b - a);
    for (const [type, mult] of sorted) {
      lines.push(`**${type}:** ${mult}×`);
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
