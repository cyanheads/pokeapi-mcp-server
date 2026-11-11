/**
 * @fileoverview pokeapi_find_pokemon tool — filter Pokémon by generation, type, pokédex, or egg group.
 * @module mcp-server/tools/definitions/find-pokemon.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getPokeApiService } from '@/services/pokeapi/pokeapi-service.js';
import type { PokemonListEntry } from '@/services/pokeapi/types.js';

// Species lists lead mixed searches, so their row identity survives the intersection.
const categoryFilters = [
  ['generation', 'generation', 'getPokemonByGeneration'],
  ['pokedex', 'pokedex', 'getPokemonByPokedex'],
  ['egg_group', 'egg-group', 'getPokemonByEggGroup'],
  ['type', 'type', 'getPokemonByType'],
] as const;

const eggGroupAliases = new Map([
  ['field', 'ground'],
  ['water-1', 'water1'],
  ['water-2', 'water2'],
  ['water-3', 'water3'],
  ['grass', 'plant'],
  ['human-like', 'humanshape'],
  ['amorphous', 'indeterminate'],
  ['undiscovered', 'no-eggs'],
]);

export const findPokemon = tool('pokeapi_find_pokemon', {
  title: 'Find Pokémon',
  description:
    'Filter Pokémon by generation, type, regional pokédex, or egg group. Returns names and PokéAPI IDs; every returned name works as a pokeapi_get_pokemon identifier, where a species name resolves to its default variety. Pokédex searches include regional entry numbers and sort by those numbers before pagination. At least one of generation, type, pokedex, or egg_group is required; the ones provided are combined with AND logic, and query adds strict token matching on name within them. A call with no category filter, with or without query, returns an empty result and a notice naming the requirement.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    generation: z
      .string()
      .optional()
      .describe(
        'Generation name (e.g. "generation-i", "generation-iii"). Filters to Pokémon introduced in this generation.',
      ),
    type: z
      .string()
      .optional()
      .describe('Type name (e.g. "fire", "psychic"). Filters to Pokémon of this type.'),
    pokedex: z
      .string()
      .optional()
      .describe(
        'PokéAPI pokédex name (e.g. "kanto", "hoenn", "original-sinnoh"). Use the specific dex for a region with multiple dexes.',
      ),
    egg_group: z
      .string()
      .optional()
      .describe(
        'Egg group name (e.g. "monster", "fairy", "field", "water 1"). Accepts PokéAPI names and in-game names.',
      ),
    query: z
      .string()
      .max(100)
      .optional()
      .describe(
        'Strict token match on name. "chu" matches "pikachu" and "raichu". Case-insensitive. At most 100 characters; whitespace separates tokens, and every token must match.',
      ),
    limit: z
      .number()
      .int()
      .positive()
      .default(50)
      .describe('Maximum results to return. Positive integer; defaults to 50.'),
    offset: z
      .number()
      .int()
      .nonnegative()
      .default(0)
      .describe(
        'Offset into the filtered result set for pagination. Non-negative integer; defaults to 0.',
      ),
  }),
  output: z.object({
    pokemon: z
      .array(
        z
          .object({
            id: z
              .number()
              .describe(
                'PokéAPI ID: Pokémon record for type-only searches, species record whenever generation, pokedex, or egg_group is present. Form IDs are not National Pokédex numbers.',
              ),
            name: z.string().describe('Pokémon name.'),
            entryNumber: z
              .number()
              .optional()
              .describe('Number in the selected Pokédex. Present when pokedex is supplied.'),
          })
          .describe('Pokémon entry with PokéAPI ID and name.'),
      )
      .describe('Matching Pokémon entries.'),
    totalCount: z.number().describe('Total matching Pokémon before limit/offset.'),
    shown: z.number().describe('Number of results in this response.'),
  }),
  enrichment: {
    appliedFilters: z
      .object({
        generation: z.string().optional().describe('Normalized generation filter, when applied.'),
        type: z.string().optional().describe('Normalized type filter, when applied.'),
        pokedex: z.string().optional().describe('Normalized pokédex filter, when applied.'),
        egg_group: z
          .string()
          .optional()
          .describe('Canonical PokéAPI egg-group name or ID, when applied.'),
        query: z
          .string()
          .optional()
          .describe(
            'Applied lowercase query tokens joined with single spaces. Omitted without a category filter.',
          ),
        limit: z
          .number()
          .int()
          .positive()
          .describe('Accepted page size, including the default of 50.'),
        offset: z
          .number()
          .int()
          .nonnegative()
          .describe('Accepted page offset, including the default of 0.'),
      })
      .describe('Effective nonblank filters and pagination controls for this response.'),
    notice: z
      .string()
      .optional()
      .describe(
        'Guidance for missing category filters, zero matches, or an offset beyond the results.',
      ),
  },
  enrichmentTrailer: {
    appliedFilters: { render: (filters) => `**appliedFilters:** ${JSON.stringify(filters)}` },
  },

  errors: [
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.ValidationError,
      when: 'An unrecognized generation, type, pokédex, or egg-group name was provided.',
      recovery:
        'Use a valid PokéAPI name for the failed filter. See the error for its accepted names when available.',
    },
  ],

  async handler(input, ctx) {
    const svc = getPokeApiService();
    const filters = categoryFilters.flatMap(([key, resource, method]) => {
      const supplied = input[key];
      if (!supplied?.trim()) return [];
      const normalized = svc.normalizeIdentifier(supplied);
      const value =
        key === 'egg_group' ? (eggGroupAliases.get(normalized) ?? normalized) : normalized;
      return [{ key, resource, method, supplied, value }];
    });
    const tokens = input.query?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];
    const hasFilter = filters.length > 0;
    ctx.enrich({
      appliedFilters: {
        ...Object.fromEntries(filters.map(({ key, value }) => [key, value])),
        ...(hasFilter && tokens.length > 0 ? { query: tokens.join(' ') } : {}),
        limit: input.limit,
        offset: input.offset,
      },
    });

    // PokéAPI has no name search, so a query can only narrow a category's bounded list.
    if (!hasFilter) {
      ctx.enrich.notice(
        'No category filters were provided. Provide at least one of generation, type, pokedex, or egg_group; query narrows those results by name and cannot search on its own.',
      );
      return { pokemon: [], totalCount: 0, shown: 0 };
    }

    // Collect candidate sets from each specified filter
    const candidateSets: PokemonListEntry[][] = [];
    let dexNumbers: Map<number, number> | undefined;

    for (const { key, resource, method, supplied, value } of filters) {
      try {
        if (method === 'getPokemonByPokedex') {
          const entries = await svc[method](value, ctx);
          dexNumbers = new Map(entries.map(({ id, entryNumber }) => [id, entryNumber]));
          candidateSets.push(entries);
        } else {
          candidateSets.push(await svc[method](value, ctx));
        }
      } catch (err) {
        if (!(err instanceof McpError) || err.code !== JsonRpcErrorCode.NotFound) throw err;
        const names = await svc.getFilterNames(resource, ctx);
        const guidance = names?.length
          ? `Valid names: ${names.join(', ')}.`
          : 'The list of valid names could not be retrieved.';
        const suppliedValue = JSON.stringify(supplied);
        throw ctx.fail(
          'invalid_filter',
          `Unrecognized ${key} filter ${suppliedValue}. ${guidance}`,
        );
      }
    }

    /**
     * Species rows lead mixed searches. Default Pokémon-record IDs equal species IDs;
     * alternate records have distinct IDs, so a matching alternate alone cannot qualify
     * its species. The endpoint lists supply the entire join without extra requests.
     */
    const [firstSet, ...otherSets] = candidateSets;
    let results: PokemonListEntry[] = firstSet ?? [];
    for (const set of otherSets) {
      const nextSet = new Set(set.map((e) => e.id));
      results = results.filter((e) => nextSet.has(e.id));
    }

    // Apply query filter (token match on name)
    if (tokens.length > 0) {
      results = results.filter((e) => tokens.every((tok) => e.name.includes(tok)));
    }

    if (results.length === 0) {
      ctx.enrich.notice(
        'No Pokémon matched the provided filters. Try relaxing one or more filter values.',
      );
      return { pokemon: [], totalCount: 0, shown: 0 };
    }

    if (dexNumbers) {
      const numbered = results.flatMap((entry) => {
        const entryNumber = dexNumbers.get(entry.id);
        return entryNumber === undefined ? [] : [{ ...entry, entryNumber }];
      });
      results = numbered.sort((a, b) => a.entryNumber - b.entryNumber || a.id - b.id);
    } else {
      results.sort((a, b) => a.id - b.id);
    }

    const totalCount = results.length;
    const page = results.slice(input.offset, input.offset + input.limit);
    if (page.length === 0) {
      ctx.enrich.notice(
        `Offset ${input.offset} is beyond the ${totalCount} matching Pokémon. Retry with offset: 0.`,
      );
    }

    ctx.log.info('Found Pokémon', { totalCount, shown: page.length });
    return {
      pokemon: page,
      totalCount,
      shown: page.length,
    };
  },

  format: (result) => {
    const lines: string[] = [];

    lines.push(`# Pokémon Search Results`);
    lines.push(`**Total matches:** ${result.totalCount} | **Showing:** ${result.shown}`);

    if (result.pokemon.length === 0) {
      lines.push(result.totalCount > 0 ? '\n*(No entries on this page.)*' : '\n*(No results.)*');
    } else {
      const showDexNumbers = result.pokemon[0]?.entryNumber !== undefined;
      lines.push(
        showDexNumbers ? '\n| PokéAPI ID | Name | Pokédex number |' : '\n| PokéAPI ID | Name |',
      );
      lines.push(
        showDexNumbers ? '|------------|------|----------------|' : '|------------|------|',
      );
      for (const p of result.pokemon) {
        lines.push(
          `| ${p.id} | ${p.name} |${p.entryNumber === undefined ? '' : ` ${p.entryNumber} |`}`,
        );
      }
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
