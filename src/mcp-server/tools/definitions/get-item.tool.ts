/**
 * @fileoverview pokeapi_get_item tool — item details by name or ID.
 * @module mcp-server/tools/definitions/get-item.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { getPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

export const getItem = tool('pokeapi_get_item', {
  title: 'Get Item',
  description:
    'Get item details by name or numeric ID — effect text, category, in-game cost, ' +
    'fling power, item attributes (holdable, consumable, etc.), sprite URL, and Pokémon that commonly hold it.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    identifier: z
      .string()
      .describe(
        'Item name in lowercase hyphenated form (e.g. "choice-specs", "leftovers") or numeric ID as a string.',
      ),
  }),
  output: z.object({
    id: z.number().describe('Item ID.'),
    name: z.string().describe('Item name in hyphenated lowercase.'),
    category: z.string().describe('Item category (e.g. "held-items", "medicine").'),
    cost: z.number().describe('Purchase cost in Pokédollars. 0 means not sold in shops.'),
    flingPower: z
      .number()
      .nullable()
      .describe('Fling move base power when this item is flung. Null if not throwable.'),
    effectText: z
      .string()
      .nullable()
      .describe('Full English effect description. Null when unavailable.'),
    shortEffectText: z
      .string()
      .nullable()
      .describe('Short English effect summary. Null when unavailable.'),
    attributes: z
      .array(z.string())
      .describe('Item attributes (e.g. "holdable", "consumable", "usable-in-battle").'),
    heldByPokemon: z
      .array(z.string())
      .describe('Pokémon that commonly hold this item in the wild.'),
    spriteUrl: z.string().nullable().describe('Item sprite URL. Null when no sprite is available.'),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The identifier resolves to no item in PokéAPI.',
      recovery:
        'Use a valid lowercase hyphenated item name (e.g. "choice-specs") or numeric ID. Check PokéAPI for the canonical name.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Getting item details', { identifier: input.identifier });
    const svc = getPokeApiService();
    return svc.getItemDetails(input.identifier, ctx);
  },

  format: (result) => {
    const lines: string[] = [];

    lines.push(`# ${result.name} (Item #${result.id})`);
    lines.push(`**Category:** ${result.category}`);
    lines.push(`**Cost:** ${result.cost > 0 ? `₽${result.cost}` : 'Not sold'}`);
    if (result.flingPower != null) {
      lines.push(`**Fling Power:** ${result.flingPower}`);
    }
    if (result.attributes.length > 0) {
      lines.push(`**Attributes:** ${result.attributes.join(', ')}`);
    }

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

    if (result.heldByPokemon.length > 0) {
      lines.push('\n## Commonly Held By');
      lines.push(result.heldByPokemon.join(', '));
    }

    if (result.spriteUrl) {
      lines.push(`\n**Sprite:** ${result.spriteUrl}`);
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
