/**
 * @fileoverview pokeapi_get_nature tool — nature details by name or ID, or list all 25.
 * @module mcp-server/tools/definitions/get-nature.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

const NatureSchema = z.object({
  id: z.number().describe('Nature ID (1–25).'),
  name: z.string().describe('Nature name (e.g. "modest").'),
  increasedStat: z.string().nullable().describe('Stat boosted by 10%. Null for neutral natures.'),
  decreasedStat: z.string().nullable().describe('Stat reduced by 10%. Null for neutral natures.'),
  likesFlavor: z
    .string()
    .nullable()
    .describe('Berry flavor the Pokémon prefers. Null for neutral natures.'),
  hatesFlavor: z
    .string()
    .nullable()
    .describe('Berry flavor the Pokémon dislikes. Null for neutral natures.'),
});

export const getNature = tool('pokeapi_get_nature', {
  title: 'Get Nature',
  description:
    'Get nature details — the stat boosted (+10%), stat reduced (-10%), ' +
    'and preferred/disliked berry flavors. Omit the identifier to list all 25 natures at once. ' +
    'Natures are critical for competitive team-building: every non-neutral nature modifies two stats by ±10%.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  input: z.object({
    identifier: z
      .string()
      .optional()
      .describe(
        'Nature name (e.g. "modest", "jolly") or ID 1–25 as a string. Omit to list all 25 natures.',
      ),
  }),
  output: z.object({
    natures: z
      .array(NatureSchema.describe('Nature entry with stat modifiers and flavor preferences.'))
      .describe('One or all 25 natures depending on whether identifier was provided.'),
    isListAll: z
      .boolean()
      .describe('True when all 25 natures are returned (no identifier provided).'),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The identifier resolves to no nature in PokéAPI.',
      recovery: 'Use a valid nature name (modest, jolly, adamant, etc.) or an ID between 1 and 25.',
    },
  ],

  async handler(input, ctx) {
    const svc = getPokeApiService();
    if (!input.identifier) {
      ctx.log.info('Listing all natures');
      const natures = await svc.getAllNatureDetails(ctx);
      return { natures, isListAll: true };
    }
    ctx.log.info('Getting nature details', { identifier: input.identifier });
    try {
      const nature = await svc.getNatureDetails(input.identifier, ctx);
      return { natures: [nature], isListAll: false };
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail(
          'not_found',
          `Nature "${input.identifier}" not found — use a valid name (e.g. "modest", "jolly") or an ID between 1 and 25.`,
          ctx.recoveryFor('not_found'),
        );
      }
      throw err;
    }
  },

  format: (result) => {
    const lines: string[] = [];

    if (result.isListAll) {
      lines.push('# All Natures');
      lines.push('| ID | Name | Boosts | Lowers | Likes Flavor | Hates Flavor |');
      lines.push('|----|------|--------|--------|--------------|--------------|');
      for (const n of result.natures) {
        const boosts = n.increasedStat ?? '—';
        const lowers = n.decreasedStat ?? '—';
        const likes = n.likesFlavor ?? '—';
        const hates = n.hatesFlavor ?? '—';
        lines.push(`| ${n.id} | ${n.name} | ${boosts} | ${lowers} | ${likes} | ${hates} |`);
      }
    } else {
      const n = result.natures[0]!;
      lines.push(`# ${n.name} (Nature #${n.id})`);
      if (n.increasedStat || n.decreasedStat) {
        lines.push(`**Boosts:** ${n.increasedStat ?? '—'} (+10%)`);
        lines.push(`**Lowers:** ${n.decreasedStat ?? '—'} (-10%)`);
      } else {
        lines.push('**Effect:** Neutral — no stat modifications.');
      }
      if (n.likesFlavor || n.hatesFlavor) {
        lines.push(`**Likes Flavor:** ${n.likesFlavor ?? '—'}`);
        lines.push(`**Hates Flavor:** ${n.hatesFlavor ?? '—'}`);
      }
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
