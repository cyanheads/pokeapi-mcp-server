/**
 * @fileoverview pokeapi_get_type_matchups tool — offensive and defensive type effectiveness for
 * one or two types or a Pokémon, currently or as of an earlier generation.
 * @module mcp-server/tools/definitions/get-type-matchups.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError, serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import { getPokeApiService, UnknownGenerationError } from '@/services/pokeapi/pokeapi-service.js';
import {
  type GenerationScope,
  NotInGenerationError,
  UnknownTypeError,
} from '@/services/pokeapi/type-matchups.js';
import type { TypeRelations, TypeSetMatchups } from '@/services/pokeapi/types.js';

/** No PokéAPI type name contains these, so they separate the types of a two-type query. */
const TYPE_SEPARATORS = /[\s/,+]+/;

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

const relationLines = (relations: TypeRelations) => [
  `**Super Effective (2×):** ${relations.superEffectiveTo.join(', ') || 'None'}`,
  `**Not Very Effective (0.5×):** ${relations.notVeryEffectiveTo.join(', ') || 'None'}`,
  `**No Effect (0×):** ${relations.noEffectTo.join(', ') || 'None'}`,
];

export const getTypeMatchups = tool('pokeapi_get_type_matchups', {
  title: 'Get Type Matchups',
  description:
    'Offensive and defensive type effectiveness for one type, two types, or a Pokémon\'s typing. Provide type (one type, or two separated by "/", ",", "+", or a space, e.g. "water/ground") or pokemon (name or PokéAPI Pokémon-record ID; a species name resolves to its default variety), not both. Two types compose defense as a dual-type Pokémon does (Fire/Flying vs Rock = 4×), and offensiveByType lists each type\'s attacking relations. Pass generation for an older game: relations and Pokémon typings are then as they stood in that generation. PokéAPI records no damage relations for stellar, shadow, and unknown, so theirs come back empty.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    type: z
      .string()
      .optional()
      .describe(
        'One type, or two separated by "/", ",", "+", or a space (e.g. "fire", "Water / Ground"); case-insensitive. Provide this or pokemon, not both.',
      ),
    pokemon: z
      .string()
      .optional()
      .describe(
        'Pokémon name or PokéAPI Pokémon-record ID; a species name resolves to its default variety. The server resolves the types automatically. Provide this or type, not both.',
      ),
    generation: z
      .string()
      .optional()
      .describe(
        'Answer as of this generation: a PokéAPI name ("generation-v"), in-game name ("Generation V"), or number ("5"). Type relations and Pokémon typings are then as they stood in that generation. Omit for current data.',
      ),
  }),
  output: z.object({
    queryType: z
      .string()
      .describe(
        'How the query was resolved: "type" for a direct type query, "pokemon" for a Pokémon lookup.',
      ),
    resolvedTypes: z.array(z.string()).describe('The type name(s) the query resolved to.'),
    resolvedPokemon: z
      .object({
        id: z.number().describe('Resolved PokéAPI Pokémon-record ID, including form IDs.'),
        name: z.string().describe('Resolved Pokémon-record name.'),
      })
      .nullable()
      .describe('Resolved Pokémon record for a pokemon query; null for direct type queries.'),
    resolvedFromSpecies: z
      .string()
      .nullable()
      .describe(
        'Species name when it resolved to its default variety; null for direct record or type queries.',
      ),
    generation: z
      .string()
      .nullable()
      .describe(
        'Canonical generation the answer is scoped to (e.g. "generation-v"); null for current data.',
      ),
    offensiveRelations: TypeRelationsSchema.nullable().describe(
      'Offensive effectiveness when one type resolved; null when two did, since each type attacks on its own (see offensiveByType).',
    ),
    offensiveByType: z
      .record(z.string(), TypeRelationsSchema)
      .describe(
        'Offensive effectiveness of each resolved type, keyed by type name, for single types too.',
      ),
    defensiveMatchups: DefensiveMatchupsSchema.describe(
      'Defensive matchups — composed correctly for two types.',
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
      when: 'A type name or the Pokémon identifier was not found in PokéAPI.',
      recovery:
        'Verify the type name is a valid Pokémon type (fire, water, etc.) or use a Pokémon name or PokéAPI Pokémon-record ID.',
    },
    {
      reason: 'invalid_input',
      code: JsonRpcErrorCode.ValidationError,
      when: 'Neither or both of type and pokemon were provided, or type named more than two types.',
      recovery:
        'Provide exactly one of type or pokemon, with type naming one type or two (e.g. "water/ground").',
    },
    {
      reason: 'invalid_generation',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'The generation matches no PokéAPI generation.',
      recovery:
        'Use a PokéAPI generation name such as "generation-v", its in-game name ("Generation V"), or its number ("5").',
    },
    {
      reason: 'not_in_generation',
      code: JsonRpcErrorCode.InvalidParams,
      when: "A requested type, or the Pokémon's form, was introduced after the requested generation.",
      recovery:
        'Use the generation named in the error or a later one, or omit generation for current data.',
    },
  ],

  async handler(input, ctx) {
    const svc = getPokeApiService();

    if (input.type && input.pokemon) {
      throw ctx.fail('invalid_input', 'Provide either type or pokemon — not both.');
    }

    /** The requested generation's scope, read only after the query itself validates. */
    const scopeOf = async (): Promise<GenerationScope | undefined> => {
      if (!input.generation?.trim()) return;
      try {
        return await svc.getGenerationScope(input.generation, ctx);
      } catch (err) {
        if (!(err instanceof UnknownGenerationError)) throw err;
        const guidance = err.validNames?.length
          ? `Valid names: ${err.validNames.join(', ')}.`
          : 'The list of valid names could not be retrieved.';
        throw ctx.fail(
          'invalid_generation',
          `Unrecognized generation "${input.generation}". ${guidance}`,
          undefined,
          { cause: err },
        );
      }
    };

    try {
      if (input.type) {
        /**
         * Normalized type name → the part as supplied. Splitting precedes the identifier fold;
         * a blank or separator-only value stays one part, which then misses as not_found.
         */
        const parts = new Map<string, string>();
        const split = input.type.split(TYPE_SEPARATORS).filter(Boolean);
        for (const supplied of split.length > 0 ? split : [input.type]) {
          const name = svc.normalizeIdentifier(supplied);
          if (!parts.has(name)) parts.set(name, supplied);
        }
        if (parts.size > 2) {
          throw ctx.fail(
            'invalid_input',
            `type takes one type or two types separated by "/", ",", "+", or a space; "${input.type}" names ${parts.size}.`,
          );
        }
        const scope = await scopeOf();
        ctx.log.info('Getting type matchups', { types: [...parts.keys()], scope: scope?.name });
        const matchups = await svc
          .getTypeSetMatchups([...parts.keys()], ctx, scope)
          .catch((err: unknown) => {
            if (!(err instanceof UnknownTypeError)) throw err;
            const missing = err.types.map((name) => `"${parts.get(name) ?? name}"`);
            throw ctx.fail(
              'not_found',
              `${missing.length > 1 ? 'Types' : 'Type'} ${missing.join(', ')} not found — use a valid type name (e.g. "fire").`,
              undefined,
              { cause: err },
            );
          });
        return {
          queryType: 'type',
          ...summarize(matchups),
          resolvedPokemon: null,
          resolvedFromSpecies: null,
          generation: scope?.name ?? null,
        };
      }

      if (!input.pokemon) {
        throw ctx.fail(
          'invalid_input',
          'Provide either type or pokemon — exactly one is required.',
        );
      }
      const scope = await scopeOf();
      const pokemonId = svc.normalizeIdentifier(input.pokemon);
      ctx.log.info('Getting type matchups for Pokémon', { pokemon: pokemonId, scope: scope?.name });
      const { pokemon, resolvedFromSpecies } = await svc
        .resolvePokemon(pokemonId, ctx)
        .catch((err: unknown) => {
          if (!(err instanceof McpError) || err.code !== JsonRpcErrorCode.NotFound) throw err;
          throw ctx.fail(
            'not_found',
            `"${input.pokemon}" not found — use a valid type name (e.g. "fire"), Pokémon name, or PokéAPI Pokémon-record ID.`,
            undefined,
            { cause: err },
          );
        });
      const types = await svc.getPokemonTypes(pokemon, ctx, scope);
      // A type the Pokémon's own record names but PokéAPI cannot serve is an upstream gap.
      const matchups = await svc.getTypeSetMatchups(types, ctx, scope).catch((err: unknown) => {
        if (!(err instanceof UnknownTypeError)) throw err;
        throw serviceUnavailable(
          `PokéAPI lists type ${err.types.join(', ')} for ${pokemon.name} but serves no record for it.`,
          undefined,
          { cause: err },
        );
      });
      return {
        queryType: 'pokemon',
        ...summarize(matchups),
        resolvedPokemon: { id: pokemon.id, name: pokemon.name },
        resolvedFromSpecies,
        generation: scope?.name ?? null,
      };
    } catch (err) {
      if (!(err instanceof NotInGenerationError)) throw err;
      throw ctx.fail(
        'not_in_generation',
        `${err.kind === 'type' ? 'Type' : 'Pokémon'} "${err.subject}" was introduced in ${err.introducedIn}, after ${err.generation}.`,
        undefined,
        { cause: err },
      );
    }
  },

  format: (result) => {
    const lines: string[] = [];

    lines.push(`# Type Matchups: ${result.resolvedTypes.join(' / ')}`);
    lines.push(`**Query type:** ${result.queryType}`);
    if (result.generation) lines.push(`**Generation:** ${result.generation}`);
    if (result.resolvedPokemon) {
      lines.push(
        `**Resolved Pokémon:** ${result.resolvedPokemon.name} (PokéAPI ID: ${result.resolvedPokemon.id})`,
      );
      if (result.resolvedFromSpecies) {
        lines.push(
          `**Resolved from species:** ${result.resolvedFromSpecies} (default variety: ${result.resolvedPokemon.name})`,
        );
      }
    }

    if (result.offensiveRelations) {
      lines.push('\n## Offensive Relations', ...relationLines(result.offensiveRelations));
    }
    const shown = JSON.stringify(result.offensiveRelations);
    for (const [type, relations] of Object.entries(result.offensiveByType)) {
      // A single type's entry is offensiveRelations, already shown above.
      if (JSON.stringify(relations) === shown) continue;
      lines.push(`\n## Offensive Relations: ${type}`, ...relationLines(relations));
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

/** Response fields shared by type and Pokémon queries. */
function summarize({ offensiveByType, composedMultipliers }: TypeSetMatchups) {
  const [first, second] = Object.values(offensiveByType);
  const multiplied = (keep: (multiplier: number) => boolean) =>
    Object.entries(composedMultipliers)
      .filter(([, multiplier]) => keep(multiplier))
      .map(([type]) => type);
  return {
    resolvedTypes: Object.keys(offensiveByType),
    // Two types each attack on their own, so only a single type has one offensive table.
    offensiveRelations: second ? null : (first ?? null),
    offensiveByType,
    defensiveMatchups: {
      weakTo: multiplied((m) => m >= 2),
      resists: multiplied((m) => m > 0 && m < 1),
      immuneTo: multiplied((m) => m === 0),
    },
    composedMultipliers,
  };
}
