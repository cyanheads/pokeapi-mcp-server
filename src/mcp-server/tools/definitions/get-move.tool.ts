/**
 * @fileoverview pokeapi_get_move tool — move details by name or ID.
 * @module mcp-server/tools/definitions/get-move.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getPokeApiService, UnknownVersionGroupError } from '@/services/pokeapi/pokeapi-service.js';

export const getMove = tool('pokeapi_get_move', {
  title: 'Get Move',
  description:
    'Get move details by name or numeric ID — type, damage class, power, accuracy, PP, priority, target, stat changes, status-effect chance, English effect text (the latest in-game description when PokéAPI has no effect text), and the TM, TR, or HM that teaches it in each version group. Set include_learners=true to include the list of Pokémon that can learn the move. Move names are available from pokeapi_get_pokemon when include_moves=true.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    identifier: z
      .string()
      .describe(
        'Move name (e.g. "flamethrower", "King’s Shield", "close-combat") or numeric ID as a string.',
      ),
    include_learners: z
      .boolean()
      .default(false)
      .describe(
        'Include the list of Pokémon that can learn this move. Defaults to false as the list can be large.',
      ),
    version_group: z
      .string()
      .optional()
      .describe(
        'PokéAPI version-group name (e.g. "scarlet-violet"). Limits machine rows to this group.',
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
    power: z
      .number()
      .nullable()
      .describe(
        'Base power. Null when the move has no fixed base power (status moves and variable-power moves), including where PokéAPI lists a placeholder power of 0.',
      ),
    accuracy: z
      .number()
      .nullable()
      .describe(
        'Accuracy percentage (1–100). Null for moves that never miss or skip the accuracy check, including where PokéAPI lists a placeholder accuracy of 0.',
      ),
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
      .describe(
        'Stat stage changes PokéAPI lists for this move. PokéAPI does not record whether they apply to the user or the target, or under what condition; see effectText for both.',
      ),
    learnedByPokemon: z
      .array(z.string())
      .describe('Pokémon names that can learn this move (populated when include_learners=true).'),
    learnersIncluded: z
      .boolean()
      .describe('True when the learner list was requested, including when no learners are known.'),
    machines: z
      .array(
        z
          .object({
            versionGroup: z.string().describe('Version group this machine row applies to.'),
            item: z
              .string()
              .nullable()
              .describe(
                'TM, TR, or HM item (e.g. "tm149") that teaches the move in the version group. Null when its machine record could not be read; notices name the group.',
              ),
          })
          .describe('The machine that teaches this move in one version group.'),
      )
      .describe(
        'One row per version group in upstream order. Empty when no machine teaches the move, or when version_group names a group without a row.',
      ),
    notices: z
      .array(z.string())
      .describe('Notices about version-group selection and machine records that were not read.'),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The identifier resolves to no move in PokéAPI.',
      recovery: 'Check the move name in PokéAPI (e.g. "close-combat") or use the numeric ID.',
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
    ctx.log.info('Getting move details', { identifier: input.identifier });
    const svc = getPokeApiService();
    try {
      const move = await svc.getMoveDetails(input.identifier, ctx, input.version_group);
      return {
        ...move,
        learnedByPokemon: input.include_learners ? move.learnedByPokemon : [],
        learnersIncluded: input.include_learners,
      };
    } catch (err) {
      if (err instanceof UnknownVersionGroupError) {
        throw ctx.fail('invalid_version_group', 'Use a known PokéAPI version-group name.');
      }
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail(
          'not_found',
          `Move "${input.identifier}" not found — check spelling or use a numeric ID.`,
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

    lines.push(
      `**Effect Chance:** ${result.effectChance == null ? 'Not applicable' : `${result.effectChance}%`}`,
    );

    lines.push(
      result.effectTextVersionGroup
        ? `\n## Effect (${result.effectTextVersionGroup} flavor text)`
        : '\n## Effect',
    );
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

    lines.push('\n## Stat Changes');
    if (result.statChanges.length > 0) {
      for (const sc of result.statChanges) {
        const sign = sc.change > 0 ? '+' : '';
        lines.push(`**${sc.stat}:** ${sign}${sc.change}`);
      }
    } else {
      lines.push('No stat changes.');
    }

    lines.push('\n## Machines');
    if (result.machines.length > 0) {
      lines.push('| Version group | Item |', '| --- | --- |');
      for (const row of result.machines) {
        lines.push(`| ${row.versionGroup} | ${row.item ?? 'Unavailable'} |`);
      }
    } else {
      lines.push('No TM, TR, or HM listed.');
    }
    if (result.notices.length > 0) {
      lines.push('\n## Notices', ...result.notices.map((notice) => `- ${notice}`));
    }

    lines.push('\n## Learned By');
    lines.push(`**Learners included:** ${result.learnersIncluded ? 'Yes' : 'No'}`);
    if (result.learnedByPokemon.length > 0) {
      lines.push(result.learnedByPokemon.join(', '));
    } else if (result.learnersIncluded) {
      lines.push('No known learners.');
    } else {
      lines.push('\n*(Pass include_learners=true to include the learner list.)*');
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});
