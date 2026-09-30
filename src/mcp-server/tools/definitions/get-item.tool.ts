/**
 * @fileoverview pokeapi_get_item tool — item details by name or ID.
 * @module mcp-server/tools/definitions/get-item.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

export const getItem = tool('pokeapi_get_item', {
  title: 'Get Item',
  description:
    'Get item details by name or numeric ID — effect text, category, versioned purchase and sell prices, ' +
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
    cost: z
      .number()
      .nullable()
      .describe(
        'Legacy Pokédollar cost when supplied. Null when unavailable; zero is a literal amount. Independent of versioned prices.',
      ),
    prices: z
      .array(
        z
          .object({
            versionGroup: z.string().describe('Version group these prices apply to.'),
            currency: z.string().describe('Currency name for both prices.'),
            purchasePrice: z
              .number()
              .nullable()
              .describe(
                'Purchase price in this currency and version group. Null means not purchasable; zero is a literal amount.',
              ),
            sellPrice: z
              .number()
              .nullable()
              .describe(
                'Sell price in this currency and version group. Null means not sellable; zero is a literal amount.',
              ),
          })
          .describe('One version and currency price record.'),
      )
      .describe(
        'All supplied price records in upstream order. Empty when no records are available.',
      ),
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
    try {
      return await svc.getItemDetails(input.identifier, ctx);
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail(
          'not_found',
          `Item "${input.identifier}" not found — use a valid lowercase hyphenated name (e.g. "choice-specs") or numeric ID.`,
        );
      }
      throw err;
    }
  },

  format: (result) => {
    const lines: string[] = [];

    lines.push(`# ${result.name} (Item #${result.id})`);
    lines.push(`**Category:** ${result.category}`);
    lines.push(`**Legacy cost:** ${result.cost == null ? 'Not available' : `₽${result.cost}`}`);
    lines.push(`**Fling Power:** ${result.flingPower ?? 'Not throwable'}`);
    lines.push(
      `**Attributes:** ${result.attributes.length > 0 ? result.attributes.join(', ') : 'None listed'}`,
    );

    lines.push('\n## Prices');
    if (result.prices.length === 0) {
      lines.push('No price records available.');
    } else {
      lines.push('| Version group | Currency | Purchase | Sell |', '| --- | --- | --- | --- |');
      for (const price of result.prices) {
        lines.push(
          `| ${price.versionGroup} | ${price.currency} | ${price.purchasePrice ?? 'Not purchasable'} | ${price.sellPrice ?? 'Not sellable'} |`,
        );
      }
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

    lines.push('\n## Commonly Held By');
    lines.push(
      result.heldByPokemon.length > 0 ? result.heldByPokemon.join(', ') : 'No known holders.',
    );

    lines.push(`\n**Sprite:** ${result.spriteUrl ?? 'Not available'}`);

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
