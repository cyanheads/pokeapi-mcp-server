/**
 * @fileoverview pokeapi://pokemon/{identifier} resource — Pokémon dossier by name or PokéAPI record ID.
 * @module mcp-server/resources/definitions/pokemon.resource
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

export const pokemonResource = resource('pokeapi://pokemon/{identifier}', {
  name: 'Pokémon Dossier',
  description:
    'Pokémon dossier addressable by name or PokéAPI Pokémon-record ID, including forms. ' +
    'A species name with no Pokémon record of its own resolves to the default variety of that species, named in resolvedFromSpecies. ' +
    'Same payload as pokeapi_get_pokemon without move details, including every evolution alternative and its version and form metadata.',
  mimeType: 'application/json',
  params: z.object({
    identifier: z
      .string()
      .describe(
        'Pokémon name (e.g. "bulbasaur", "charizard-mega-x") or PokéAPI Pokémon-record ID (e.g. "1", "10034").',
      ),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The identifier matches no Pokémon record and no species.',
      recovery:
        'Use a valid lowercase hyphenated Pokémon name or a numeric PokéAPI Pokémon-record ID.',
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
          `Pokémon "${params.identifier}" not found — use a valid lowercase name or numeric PokéAPI Pokémon-record ID.`,
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
        name: 'Bulbasaur (PokéAPI ID: 1)',
        mimeType: 'application/json',
      },
    ],
  }),
});
