/**
 * @fileoverview pokeapi_get_item tool — item details by name or ID.
 * @module mcp-server/tools/definitions/get-item.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getPokeApiService, UnknownVersionGroupError } from '@/services/pokeapi/pokeapi-service.js';

export const getItem = tool('pokeapi_get_item', {
  title: 'Get Item',
  description:
    'Get item details by name or numeric ID — English effect text (the latest in-game description when PokéAPI has no effect text), category, versioned purchase and sell prices, fling power, item attributes (holdable, consumable, etc.), sprite URL, Pokémon that commonly hold it, and, for a TM, TR, or HM, the move it teaches in each version group.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    identifier: z
      .string()
      .describe('Item name (e.g. "Poké Ball", "choice-specs", "tm25") or numeric ID as a string.'),
    version_group: z
      .string()
      .optional()
      .describe(
        'PokéAPI version-group name (e.g. "scarlet-violet"). Limits machine rows to this group.',
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
      .describe(
        "PokéAPI's full English effect description. When it has none, the latest English in-game flavor text, folded to one line and named by effectTextVersionGroup. Null when neither exists.",
      ),
    shortEffectText: z
      .string()
      .nullable()
      .describe(
        "PokéAPI's short English effect summary. Null when unavailable, including whenever effectText is flavor text.",
      ),
    effectTextVersionGroup: z
      .string()
      .nullable()
      .describe(
        "Version group whose in-game flavor text effectText carries. Null when effectText is PokéAPI's effect description or absent.",
      ),
    attributes: z
      .array(z.string())
      .describe('Item attributes (e.g. "holdable", "consumable", "usable-in-battle").'),
    heldByPokemon: z
      .array(z.string())
      .describe('Pokémon that commonly hold this item in the wild.'),
    spriteUrl: z.string().nullable().describe('Item sprite URL. Null when no sprite is available.'),
    machines: z
      .array(
        z
          .object({
            versionGroup: z.string().describe('Version group this machine row applies to.'),
            move: z
              .string()
              .nullable()
              .describe(
                'Move this item teaches in the version group. Null when its machine record could not be read; notices name the group.',
              ),
          })
          .describe('The move a TM, TR, or HM teaches in one version group.'),
      )
      .describe(
        'One row per version group in upstream order. Empty for items that are not machines, or when version_group names a group without a row. Unless effectTextVersionGroup names a group, effectText is one description for every group and can name another move.',
      ),
    notices: z
      .array(z.string())
      .describe('Notices about version-group selection and machine records that were not read.'),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The identifier resolves to no item in PokéAPI.',
      recovery: 'Check the item name in PokéAPI (e.g. "choice-specs") or use the numeric ID.',
    },
    {
      reason: 'invalid_version_group',
      code: JsonRpcErrorCode.InvalidParams,
      when: 'The supplied version_group is not a known PokéAPI version-group name.',
      recovery:
        'Use a version-group name such as scarlet-violet or sword-shield, or omit version_group.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Getting item details', { identifier: input.identifier });
    const svc = getPokeApiService();
    try {
      return await svc.getItemDetails(input.identifier, ctx, input.version_group);
    } catch (err) {
      if (err instanceof UnknownVersionGroupError) {
        throw ctx.fail('invalid_version_group', 'Use a known PokéAPI version-group name.');
      }
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail(
          'not_found',
          `Item "${input.identifier}" not found — check spelling or use a numeric ID.`,
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

    // A machine's effect prose is one description for every version group; its rows are per group.
    const isMachine = result.machines.length > 0 || result.category === 'all-machines';
    if (result.effectTextVersionGroup) {
      lines.push(`\n## Effect (${result.effectTextVersionGroup} flavor text)`);
    } else if (isMachine && (result.effectText || result.shortEffectText)) {
      lines.push("\n## Effect (PokéAPI's unversioned description)");
    } else {
      lines.push('\n## Effect');
    }
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

    if (result.machines.length > 0) {
      lines.push('\n## Machines', '| Version group | Move |', '| --- | --- |');
      for (const row of result.machines) {
        lines.push(`| ${row.versionGroup} | ${row.move ?? 'Unavailable'} |`);
      }
    }
    if (result.notices.length > 0) {
      lines.push('\n## Notices', ...result.notices.map((notice) => `- ${notice}`));
    }

    lines.push('\n## Commonly Held By');
    lines.push(
      result.heldByPokemon.length > 0 ? result.heldByPokemon.join(', ') : 'No known holders.',
    );

    lines.push(`\n**Sprite:** ${result.spriteUrl ?? 'Not available'}`);

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
