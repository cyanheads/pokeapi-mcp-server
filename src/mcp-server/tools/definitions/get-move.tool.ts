/**
 * @fileoverview pokeapi_get_move tool — move details by name or ID.
 * @module mcp-server/tools/definitions/get-move.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

export const getMove = tool('pokeapi_get_move', {
  title: 'Get Move',
  description:
    'Get move details by name or numeric ID — type, damage class, power, accuracy, PP, ' +
    'priority, target, stat changes, status-effect chance, and full English effect text. ' +
    'Set include_learners=true to include the list of Pokémon that can learn the move. ' +
    'Move names are available from pokeapi_get_pokemon when include_moves=true.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    identifier: z
      .string()
      .describe(
        'Move name in lowercase hyphenated form (e.g. "flamethrower", "close-combat") or numeric ID as a string.',
      ),
    include_learners: z
      .boolean()
      .default(false)
      .describe(
        'Include the list of Pokémon that can learn this move. Defaults to false as the list can be large.',
      ),
  }),
  output: z.object({
    id: z.number().describe('Move ID.'),
    name: z.string().describe('Move name in hyphenated lowercase.'),
    type: z.string().describe('Elemental type (e.g. "fire").'),
    damageClass: z
      .string()
      .nullable()
      .describe('Damage class: physical, special, or status. Null when unavailable.'),
    power: z.number().nullable().describe('Base power. Null for status moves.'),
    accuracy: z
      .number()
      .nullable()
      .describe('Accuracy percentage (0–100). Null for moves that always hit.'),
    pp: z.number().nullable().describe('Base PP. Null when unavailable.'),
    priority: z
      .number()
      .describe('Priority bracket (positive = higher priority, negative = lower).'),
    effectChance: z
      .number()
      .nullable()
      .describe('Secondary effect chance percentage. Null when not applicable.'),
    effectText: z
      .string()
      .nullable()
      .describe('Full English effect description. Null when unavailable.'),
    shortEffectText: z
      .string()
      .nullable()
      .describe('Short English effect summary. Null when unavailable.'),
    target: z.string().describe('Target selection (e.g. "selected-pokemon", "all-opponents").'),
    statChanges: z
      .array(
        z
          .object({
            stat: z.string().describe('Stat name.'),
            change: z.number().describe('Stat stage change (positive = buff, negative = debuff).'),
          })
          .describe('Stat stage change entry — affected stat and magnitude.'),
      )
      .describe('Stat stage changes caused by this move.'),
    learnedByPokemon: z
      .array(z.string())
      .describe('Pokémon names that can learn this move (populated when include_learners=true).'),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The identifier resolves to no move in PokéAPI.',
      recovery:
        'Verify the move name uses lowercase hyphens (e.g. "close-combat" not "Close Combat") or use the numeric ID.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Getting move details', { identifier: input.identifier });
    const svc = getPokeApiService();
    try {
      const move = await svc.getMoveDetails(input.identifier, ctx);
      return { ...move, learnedByPokemon: input.include_learners ? move.learnedByPokemon : [] };
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail(
          'not_found',
          `Move "${input.identifier}" not found — check spelling or use a numeric ID.`,
          ctx.recoveryFor('not_found'),
        );
      }
      throw err;
    }
  },

  format: (result) => {
    const lines: string[] = [];

    lines.push(`# ${result.name} (Move #${result.id})`);
    lines.push(
      `**Type:** ${result.type} | **Class:** ${result.damageClass ?? 'N/A'} | **Target:** ${result.target}`,
    );

    const powerStr = result.power != null ? String(result.power) : '—';
    const accStr = result.accuracy != null ? `${result.accuracy}%` : '—';
    const ppStr = result.pp != null ? String(result.pp) : '—';
    lines.push(
      `**Power:** ${powerStr} | **Accuracy:** ${accStr} | **PP:** ${ppStr} | **Priority:** ${result.priority}`,
    );

    if (result.effectChance != null) {
      lines.push(`**Effect Chance:** ${result.effectChance}%`);
    }

    lines.push('\n## Effect');
    if (result.effectText) {
      lines.push(result.effectText);
    } else if (result.shortEffectText) {
      lines.push(result.shortEffectText);
    } else {
      lines.push('*(Effect description not available.)*');
    }
    // Always surface shortEffectText when distinct
    if (result.shortEffectText && result.shortEffectText !== result.effectText) {
      lines.push(`\n**Summary:** ${result.shortEffectText}`);
    }

    if (result.statChanges.length > 0) {
      lines.push('\n## Stat Changes');
      for (const sc of result.statChanges) {
        const sign = sc.change > 0 ? '+' : '';
        lines.push(`**${sc.stat}:** ${sign}${sc.change}`);
      }
    }

    if (result.learnedByPokemon.length > 0) {
      lines.push('\n## Learned By');
      lines.push(result.learnedByPokemon.join(', '));
    } else {
      lines.push('\n*(Pass include_learners=true to include the learner list.)*');
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
