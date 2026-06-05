/**
 * @fileoverview pokeapi://pokemon/{identifier} resource — Pokémon dossier by name or dex number.
 * @module mcp-server/resources/definitions/pokemon.resource
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

export const pokemonResource = resource('pokeapi://pokemon/{identifier}', {
  name: 'Pokémon Dossier',
  description:
    'Pokémon dossier addressable by name or Pokédex number. ' +
    'Same payload as pokeapi_get_pokemon without move details.',
  mimeType: 'application/json',
  params: z.object({
    identifier: z
      .string()
      .describe('Pokémon name (e.g. "bulbasaur") or Pokédex number (e.g. "1").'),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'No Pokémon matches the identifier.',
      recovery: 'Use a valid lowercase hyphenated Pokémon name or a numeric Pokédex number.',
    },
  ],

  async handler(params, ctx) {
    ctx.log.debug('Fetching Pokémon resource', { identifier: params.identifier });
    const svc = getPokeApiService();
    try {
      return await svc.getPokemonDossier(params.identifier, false, undefined, ctx);
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail(
          'not_found',
          `Pokémon "${params.identifier}" not found — use a valid lowercase name or numeric Pokédex number.`,
          ctx.recoveryFor('not_found'),
        );
      }
      throw err;
    }
  },

  list: async () => ({
    resources: [
      {
        uri: 'pokeapi://pokemon/bulbasaur',
        name: 'Bulbasaur (example)',
        mimeType: 'application/json',
      },
      {
        uri: 'pokeapi://pokemon/1',
        name: 'Pokémon #1 (Bulbasaur)',
        mimeType: 'application/json',
      },
    ],
  }),
});
