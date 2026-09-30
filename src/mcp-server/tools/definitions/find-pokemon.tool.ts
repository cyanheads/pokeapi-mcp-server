/**
 * @fileoverview pokeapi_find_pokemon tool — filter Pokémon by generation, type, pokédex, or egg group.
 * @module mcp-server/tools/definitions/find-pokemon.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getPokeApiService } from '@/services/pokeapi/pokeapi-service.js';
import type { PokemonListEntry } from '@/services/pokeapi/types.js';

export const findPokemon = tool('pokeapi_find_pokemon', {
  title: 'Find Pokémon',
  description:
    'Filter Pokémon by generation, type, regional pokédex, or egg group. ' +
    'Returns names and PokéAPI IDs; every returned name works as a pokeapi_get_pokemon identifier, where a species name resolves to its default variety. ' +
    'At least one of generation, type, pokedex, or egg_group is required; the ones provided are combined with AND logic, ' +
    'and query adds strict token matching on name within them. ' +
    'A call with no category filter, with or without query, returns an empty result and a notice naming the requirement.',
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
        'Regional pokédex name (e.g. "kanto", "hoenn", "galar"). Filters to entries in that dex.',
      ),
    egg_group: z
      .string()
      .optional()
      .describe(
        'Egg group name (e.g. "monster", "fairy", "dragon"). Filters to Pokémon in this egg group.',
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
                'PokéAPI ID: Pokémon record for type filters, species record for generation, pokedex, or egg_group filters. Form IDs are not National Pokédex numbers.',
              ),
            name: z.string().describe('Pokémon name.'),
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
        egg_group: z.string().optional().describe('Normalized egg-group filter, when applied.'),
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
        'Use a valid lowercase PokéAPI name (e.g. "generation-i", "fire", "kanto", "monster").',
    },
  ],

  async handler(input, ctx) {
    const svc = getPokeApiService();
    const generation = input.generation?.trim()
      ? svc.normalizeIdentifier(input.generation)
      : undefined;
    const typeName = input.type?.trim() ? svc.normalizeIdentifier(input.type) : undefined;
    const pokedex = input.pokedex?.trim() ? svc.normalizeIdentifier(input.pokedex) : undefined;
    const eggGroup = input.egg_group?.trim() ? svc.normalizeIdentifier(input.egg_group) : undefined;
    const tokens = input.query?.trim().toLowerCase().split(/\s+/).filter(Boolean) ?? [];
    const hasFilter = Boolean(generation || typeName || pokedex || eggGroup);
    ctx.enrich({
      appliedFilters: {
        ...(generation ? { generation } : {}),
        ...(typeName ? { type: typeName } : {}),
        ...(pokedex ? { pokedex } : {}),
        ...(eggGroup ? { egg_group: eggGroup } : {}),
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

    try {
      if (generation) {
        const entries = await svc.getPokemonByGeneration(generation, ctx);
        candidateSets.push(entries);
      }

      if (typeName) {
        const entries = await svc.getPokemonByType(typeName, ctx);
        candidateSets.push(entries);
      }

      if (pokedex) {
        const entries = await svc.getPokemonByPokedex(pokedex, ctx);
        candidateSets.push(entries);
      }

      if (eggGroup) {
        const entries = await svc.getPokemonByEggGroup(eggGroup, ctx);
        candidateSets.push(entries);
      }
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail(
          'invalid_filter',
          `One of the provided filter values was not recognized by PokéAPI. Use valid lowercase PokéAPI names (e.g. "generation-i", "fire", "kanto", "monster").`,
        );
      }
      throw err;
    }

    // Intersect all candidate sets by name (AND logic).
    const [firstSet, ...otherSets] = candidateSets;
    let results: PokemonListEntry[] = firstSet ?? [];
    for (const set of otherSets) {
      const nextSet = new Set(set.map((e) => e.name));
      results = results.filter((e) => nextSet.has(e.name));
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

    // Sort by id ascending
    results.sort((a, b) => a.id - b.id);

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
      lines.push('\n| PokéAPI ID | Name |');
      lines.push('|------------|------|');
      for (const p of result.pokemon) {
        lines.push(`| ${p.id} | ${p.name} |`);
      }
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
