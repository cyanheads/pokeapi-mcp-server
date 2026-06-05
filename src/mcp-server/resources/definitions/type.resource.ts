/**
 * @fileoverview pokeapi://type/{typeName} resource — type damage relations.
 * @module mcp-server/resources/definitions/type.resource
 */

import { resource, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

const VALID_TYPES = [
  'normal',
  'fire',
  'water',
  'electric',
  'grass',
  'ice',
  'fighting',
  'poison',
  'ground',
  'flying',
  'psychic',
  'bug',
  'rock',
  'ghost',
  'dragon',
  'dark',
  'steel',
  'fairy',
];

export const typeResource = resource('pokeapi://type/{typeName}', {
  name: 'Type Damage Relations',
  description:
    'Type damage relations — offensive and defensive multiplier tables for a given type.',
  mimeType: 'application/json',
  params: z.object({
    typeName: z.string().describe('Type name in lowercase (e.g. "fire", "psychic").'),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The type name does not exist in PokéAPI.',
      recovery:
        'Use a valid Pokémon type name: normal, fire, water, electric, grass, ice, fighting, poison, ground, flying, psychic, bug, rock, ghost, dragon, dark, steel, or fairy.',
    },
  ],

  async handler(params, ctx) {
    ctx.log.debug('Fetching type resource', { typeName: params.typeName });
    const svc = getPokeApiService();
    try {
      return await svc.getTypeMatchups(params.typeName, ctx);
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail(
          'not_found',
          `Type "${params.typeName}" not found — use a valid Pokémon type name (fire, water, grass, etc.).`,
          ctx.recoveryFor('not_found'),
        );
      }
      throw err;
    }
  },

  list: async () => ({
    resources: VALID_TYPES.map((t) => ({
      uri: `pokeapi://type/${t}`,
      name: `${t.charAt(0).toUpperCase() + t.slice(1)} type`,
      mimeType: 'application/json',
    })),
  }),
});
