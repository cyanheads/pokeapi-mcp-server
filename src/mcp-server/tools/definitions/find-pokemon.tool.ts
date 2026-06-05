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
    'Returns names and Pokédex numbers suitable for follow-up pokeapi_get_pokemon calls. ' +
    'All filters are optional and combined with AND logic; query adds strict token matching on name. ' +
    'When no category filter is provided alongside query, returns an empty result — at least one categorical filter is required.',
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
      .optional()
      .describe(
        'Strict token match on name. "chu" matches "pikachu" and "raichu". Case-insensitive.',
      ),
    limit: z.number().default(50).describe('Maximum results to return. Defaults to 50.'),
    offset: z
      .number()
      .default(0)
      .describe('Offset into the filtered result set for pagination. Defaults to 0.'),
  }),
  output: z.object({
    pokemon: z
      .array(
        z
          .object({
            id: z.number().describe('National Pokédex number.'),
            name: z.string().describe('Pokémon name.'),
          })
          .describe('Pokémon entry with dex number and name.'),
      )
      .describe('Matching Pokémon entries.'),
    totalCount: z.number().describe('Total matching Pokémon before limit/offset.'),
    shown: z.number().describe('Number of results in this response.'),
  }),
  enrichment: {
    notice: z.string().optional().describe('Guidance when no Pokémon matched the filters.'),
  },

  errors: [
    {
      reason: 'invalid_filter',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'An unrecognized generation, type, pokédex, or egg-group name was provided.',
      recovery:
        'Use a valid lowercase PokéAPI name (e.g. "generation-i", "fire", "kanto", "monster").',
    },
  ],

  async handler(input, ctx) {
    const svc = getPokeApiService();

    // Collect candidate sets from each specified filter
    const candidateSets: PokemonListEntry[][] = [];
    let hasFilter = false;

    try {
      if (input.generation?.trim()) {
        hasFilter = true;
        const gen = svc.normalizeIdentifier(input.generation);
        const entries = await svc.getPokemonByGeneration(gen, ctx);
        candidateSets.push(entries);
      }

      if (input.type?.trim()) {
        hasFilter = true;
        const typeName = svc.normalizeIdentifier(input.type);
        const entries = await svc.getPokemonByType(typeName, ctx);
        candidateSets.push(entries);
      }

      if (input.pokedex?.trim()) {
        hasFilter = true;
        const dex = svc.normalizeIdentifier(input.pokedex);
        const entries = await svc.getPokemonByPokedex(dex, ctx);
        candidateSets.push(entries);
      }

      if (input.egg_group?.trim()) {
        hasFilter = true;
        const eggGroup = svc.normalizeIdentifier(input.egg_group);
        const entries = await svc.getPokemonByEggGroup(eggGroup, ctx);
        candidateSets.push(entries);
      }
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail(
          'invalid_filter',
          `One of the provided filter values was not recognized by PokéAPI. Use valid lowercase PokéAPI names (e.g. "generation-i", "fire", "kanto", "monster").`,
          ctx.recoveryFor('invalid_filter'),
        );
      }
      throw err;
    }

    // Intersect all candidate sets (AND logic)
    let results: PokemonListEntry[];
    if (candidateSets.length === 0) {
      // No category filter — start with empty; query filter below requires at least one category
      results = [];
    } else if (candidateSets.length === 1) {
      results = candidateSets[0]!;
    } else {
      // Intersect by name
      results = candidateSets[0]!;
      for (let i = 1; i < candidateSets.length; i++) {
        const nextSet = new Set(candidateSets[i]!.map((e) => e.name));
        results = results.filter((e) => nextSet.has(e.name));
      }
    }

    // Apply query filter (token match on name)
    if (input.query?.trim()) {
      if (!hasFilter) {
        // No category filter provided — can't do name-only search without a bounded set
        ctx.enrich({
          notice: `No category filters were provided. Use at least one of generation, type, pokedex, or egg_group along with query to search Pokémon by name.`,
        });
        return { pokemon: [], totalCount: 0, shown: 0 };
      }
      const tokens = input.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
      results = results.filter((e) => tokens.every((tok) => e.name.includes(tok)));
    }

    if (results.length === 0) {
      ctx.enrich({
        notice: 'No Pokémon matched the provided filters. Try relaxing one or more filter values.',
      });
      return { pokemon: [], totalCount: 0, shown: 0 };
    }

    // Sort by id ascending
    results.sort((a, b) => a.id - b.id);

    const totalCount = results.length;
    const page = results.slice(input.offset, input.offset + input.limit);

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
      lines.push('\n*(No results matched the filters.)*');
    } else {
      lines.push('\n| # | Name |');
      lines.push('|---|------|');
      for (const p of result.pokemon) {
        lines.push(`| ${p.id} | ${p.name} |`);
      }
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
