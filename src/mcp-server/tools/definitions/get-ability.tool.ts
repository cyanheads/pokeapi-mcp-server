/**
 * @fileoverview pokeapi_get_ability tool — ability details by name or ID.
 * @module mcp-server/tools/definitions/get-ability.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

export const getAbility = tool('pokeapi_get_ability', {
  title: 'Get Ability',
  description:
    'Get ability details by name or numeric ID — full English effect text, short effect text, ' +
    'generation introduced, and the list of Pokémon that have the ability (including hidden-ability flag and slot). ' +
    'Ability names are returned by pokeapi_get_pokemon in the abilities array.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    identifier: z
      .string()
      .describe(
        'Ability name in lowercase hyphenated form (e.g. "overgrow", "speed-boost") or numeric ID as a string.',
      ),
  }),
  output: z.object({
    id: z.number().describe('Ability ID.'),
    name: z.string().describe('Ability name in hyphenated lowercase.'),
    effectText: z
      .string()
      .nullable()
      .describe('Full English effect description. Null when unavailable.'),
    shortEffectText: z
      .string()
      .nullable()
      .describe('Short English effect summary. Null when unavailable.'),
    generation: z.string().describe('Generation in which the ability was introduced.'),
    pokemon: z
      .array(
        z
          .object({
            name: z.string().describe('Pokémon name.'),
            isHidden: z.boolean().describe('True when this is the hidden ability for the Pokémon.'),
            slot: z.number().describe('Ability slot (1, 2, or 3).'),
          })
          .describe('Pokémon entry with ability slot and hidden-ability flag.'),
      )
      .describe('Pokémon that have this ability.'),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The identifier resolves to no ability in PokéAPI.',
      recovery:
        'Use a valid lowercase hyphenated ability name (e.g. "speed-boost") or numeric ID. Check PokéAPI for the canonical name.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Getting ability details', { identifier: input.identifier });
    const svc = getPokeApiService();
    return svc.getAbilityDetails(input.identifier, ctx);
  },

  format: (result) => {
    const lines: string[] = [];

    lines.push(`# ${result.name} (Ability #${result.id})`);
    lines.push(`**Generation:** ${result.generation}`);

    lines.push('\n## Effect');
    if (result.effectText) {
      lines.push(result.effectText);
    } else if (result.shortEffectText) {
      lines.push(result.shortEffectText);
    } else {
      lines.push('*(Effect description not available.)*');
    }
    // Always surface shortEffectText when distinct from effectText
    if (result.shortEffectText && result.shortEffectText !== result.effectText) {
      lines.push(`\n**Summary:** ${result.shortEffectText}`);
    }

    if (result.pokemon.length > 0) {
      lines.push('\n## Pokémon with this Ability');
      const regular = result.pokemon.filter((p) => !p.isHidden);
      const hidden = result.pokemon.filter((p) => p.isHidden);
      if (regular.length > 0) {
        lines.push(`**Regular ability slots:**`);
        for (const p of regular) {
          lines.push(`- ${p.name} (slot ${p.slot})`);
        }
      }
      if (hidden.length > 0) {
        lines.push(`**Hidden ability (slot 3):**`);
        for (const p of hidden) {
          lines.push(`- ${p.name} (slot ${p.slot})`);
        }
      }
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
