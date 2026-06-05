/**
 * @fileoverview pokeapi_get_pokemon tool — denormalized Pokémon dossier in one call.
 * @module mcp-server/tools/definitions/get-pokemon.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

const StatSchema = z.object({
  name: z
    .string()
    .describe('Stat name (hp, attack, defense, special-attack, special-defense, speed).'),
  baseStat: z.number().describe('Base stat value.'),
  effort: z.number().describe('Effort value (EV) yield.'),
});

const AbilitySchema = z.object({
  name: z.string().describe('Ability name in hyphenated lowercase (e.g. "overgrow").'),
  isHidden: z.boolean().describe('True when this is the hidden ability.'),
  slot: z.number().describe('Ability slot (1, 2, or 3).'),
  effectText: z
    .string()
    .nullable()
    .describe('Full English effect description. Null when unavailable.'),
  shortEffectText: z
    .string()
    .nullable()
    .describe('Short English effect description. Null when unavailable.'),
});

const MoveSummarySchema = z.object({
  name: z.string().describe('Move name.'),
  learnMethod: z.string().describe('How the move is learned (level-up, machine, egg, tutor).'),
  levelLearnedAt: z
    .number()
    .describe('Level at which the move is learned. Zero for non-level-up methods.'),
});

interface EvolutionStepType {
  condition: string | null;
  evolvesTo: EvolutionStepType[];
  item: string | null;
  minLevel: number | null;
  species: string;
  trigger: string;
}

const EvolutionStepSchema: z.ZodType<EvolutionStepType> = z.lazy(() =>
  z.object({
    species: z.string().describe('Species name.'),
    trigger: z.string().describe('Evolution trigger (level-up, use-item, trade, shed, base).'),
    minLevel: z.number().nullable().describe('Minimum level required. Null if not applicable.'),
    item: z.string().nullable().describe('Item used in evolution. Null if not applicable.'),
    condition: z
      .string()
      .nullable()
      .describe('Human-readable summary of additional conditions (happiness, time of day, etc.).'),
    evolvesTo: z.array(EvolutionStepSchema).describe('Further evolutions from this stage.'),
  }),
);

const SpritesSchema = z.object({
  frontDefault: z.string().nullable().describe('Front default sprite URL.'),
  frontShiny: z.string().nullable().describe('Front shiny sprite URL.'),
  officialArtwork: z.string().nullable().describe('High-quality official artwork URL.'),
});

const VarietySchema = z.object({
  name: z.string().describe('Variety/form name (e.g. "pikachu-alola-cap").'),
  isDefault: z.boolean().describe('True for the canonical form.'),
});

export const getPokemon = tool('pokeapi_get_pokemon', {
  title: 'Get Pokémon',
  description:
    'Get a fully denormalized Pokémon dossier in a single call — base stats, types, abilities ' +
    '(with full English effect text), height/weight, resolved evolution chain, sprite URLs including ' +
    'official artwork, species flavor text, variety list, capture rate, growth rate, gender rate, ' +
    'legendary/mythical flags, egg groups, and (optionally) a summarized learnable-move list. ' +
    'Accepts a name (lowercase, hyphens for spaces, e.g. "bulbasaur", "mr-mime") or Pokédex number. ' +
    'Set include_moves=true to include the move summary (large); defaults to false. ' +
    'Use game_version to select flavor text from a specific game (e.g. "sword", "red"); ' +
    'falls back to the most recent English entry when the version is not found. ' +
    'Use pokeapi_find_pokemon to discover Pokémon by type, generation, or egg group before calling this tool.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    identifier: z
      .string()
      .describe(
        'Pokémon name (lowercase hyphenated, e.g. "bulbasaur", "mr-mime") or Pokédex number as a string (e.g. "1", "25").',
      ),
    include_moves: z
      .boolean()
      .default(false)
      .describe(
        'Include the full learnable-move summary. Defaults to false because the list is large (100–200+ moves).',
      ),
    game_version: z
      .string()
      .optional()
      .describe(
        'PokéAPI version name to filter flavor text (e.g. "sword", "red", "scarlet"). ' +
          'Falls back to the most recent English entry when the version is not found.',
      ),
  }),
  output: z.object({
    id: z.number().describe('National Pokédex number.'),
    name: z.string().describe('Canonical Pokémon name in hyphenated lowercase.'),
    heightDm: z.number().describe('Height in decimetres.'),
    weightHg: z.number().describe('Weight in hectograms.'),
    types: z.array(z.string()).describe('Type names ordered by slot (e.g. ["fire", "flying"]).'),
    stats: z.array(StatSchema.describe('Individual base stat entry.')).describe('Base stats.'),
    abilities: z
      .array(AbilitySchema.describe('Ability entry with effect text and hidden-ability flag.'))
      .describe('Abilities with full effect text.'),
    sprites: SpritesSchema.describe('Sprite URLs.'),
    moves: z
      .array(MoveSummarySchema.describe('Move summary entry — name, learn method, and level.'))
      .describe('Learnable moves (populated when include_moves=true, empty otherwise).'),
    moveCount: z.number().describe('Total number of learnable moves regardless of include_moves.'),
    speciesFlavorText: z
      .string()
      .nullable()
      .describe(
        'Flavor text from the selected (or most recent) game version. Null when none available.',
      ),
    genus: z
      .string()
      .nullable()
      .describe('English genus (e.g. "Seed Pokémon"). Null when unavailable.'),
    captureRate: z.number().describe('Base capture rate (0–255).'),
    growthRate: z.string().describe('Growth rate name (e.g. "medium-slow").'),
    genderRate: z
      .number()
      .describe(
        'Gender ratio: -1 genderless, 0 always male, 8 always female, 1–7 fraction (eighths) female.',
      ),
    isLegendary: z.boolean().describe('True for legendary Pokémon.'),
    isMythical: z.boolean().describe('True for mythical Pokémon.'),
    evolutionChain: EvolutionStepSchema.nullable().describe(
      'Evolution tree rooted at the base species.',
    ),
    varieties: z
      .array(VarietySchema.describe('Form or variant entry with name and default flag.'))
      .describe('All forms and variants of this species.'),
    generation: z.string().describe('Generation introduced (e.g. "generation-i").'),
    eggGroups: z.array(z.string()).describe('Egg group names.'),
  }),

  errors: [
    {
      reason: 'not_found',
      code: JsonRpcErrorCode.NotFound,
      when: 'The identifier resolves to no PokéAPI entry (HTTP 404).',
      recovery:
        'Check the spelling against the PokéAPI name list or use a numeric Pokédex number. Common names use hyphens, not spaces.',
    },
  ],

  async handler(input, ctx) {
    ctx.log.info('Getting Pokémon dossier', { identifier: input.identifier });
    const svc = getPokeApiService();
    try {
      return await svc.getPokemonDossier(
        input.identifier,
        input.include_moves,
        input.game_version,
        ctx,
      );
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw ctx.fail(
          'not_found',
          `Pokémon "${input.identifier}" not found — check spelling or use a numeric Pokédex number.`,
          ctx.recoveryFor('not_found'),
        );
      }
      throw err;
    }
  },

  format: (result) => {
    const lines: string[] = [];

    lines.push(`# ${result.name} (#${result.id})`);
    if (result.genus) lines.push(`*${result.genus}*`);
    if (result.speciesFlavorText) lines.push(`\n> ${result.speciesFlavorText}`);

    lines.push('\n## Overview');
    lines.push(`**Types:** ${result.types.join(', ')}`);
    lines.push(`**Generation:** ${result.generation}`);
    // heightDm and weightHg are the raw API values; converted to SI for readability
    lines.push(
      `**Height:** ${(result.heightDm / 10).toFixed(1)} m (${result.heightDm} dm) | **Weight:** ${(result.weightHg / 10).toFixed(1)} kg (${result.weightHg} hg)`,
    );
    lines.push(`**Capture Rate:** ${result.captureRate} | **Growth Rate:** ${result.growthRate}`);
    // genderRate: -1=genderless, 0=always male, 8=always female, 1–7 = eighths female
    const genderLabel =
      result.genderRate === -1
        ? 'Genderless'
        : result.genderRate === 0
          ? 'Always male'
          : result.genderRate === 8
            ? 'Always female'
            : `${((result.genderRate / 8) * 100).toFixed(0)}% female`;
    lines.push(`**Gender Rate:** ${genderLabel} (raw: ${result.genderRate})`);
    if (result.isLegendary) lines.push('**Legendary:** Yes');
    if (result.isMythical) lines.push('**Mythical:** Yes');
    lines.push(`**Egg Groups:** ${result.eggGroups.join(', ')}`);

    lines.push('\n## Base Stats');
    for (const s of result.stats) {
      lines.push(`**${s.name}:** ${s.baseStat} (EV: ${s.effort})`);
    }

    lines.push('\n## Abilities');
    for (const a of result.abilities) {
      const tag = a.isHidden ? ' *(hidden)*' : '';
      lines.push(`### ${a.name} (slot ${a.slot})${tag}`);
      if (a.effectText) lines.push(a.effectText);
      if (a.shortEffectText) lines.push(`**Short:** ${a.shortEffectText}`);
    }

    lines.push('\n## Sprites');
    if (result.sprites.officialArtwork)
      lines.push(`**Official Artwork:** ${result.sprites.officialArtwork}`);
    if (result.sprites.frontDefault)
      lines.push(`**Front Default:** ${result.sprites.frontDefault}`);
    if (result.sprites.frontShiny) lines.push(`**Front Shiny:** ${result.sprites.frontShiny}`);

    lines.push('\n## Evolution Chain');
    if (result.evolutionChain) {
      lines.push(renderEvolutionStep(result.evolutionChain, 0));
    } else {
      lines.push('*(Evolution chain unavailable.)*');
    }

    lines.push('\n## Varieties');
    for (const v of result.varieties) {
      lines.push(`- ${v.name}${v.isDefault ? ' *(default)*' : ''}`);
    }

    lines.push(`\n## Moves`);
    lines.push(`**Total learnable moves:** ${result.moveCount}`);
    if (result.moves.length > 0) {
      for (const m of result.moves) {
        // Always include levelLearnedAt (0 for non-level-up moves)
        lines.push(`- ${m.name} — ${m.learnMethod} (level: ${m.levelLearnedAt})`);
      }
    } else {
      lines.push('*(Pass include_moves=true to include the full move list.)*');
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});

function renderEvolutionStep(
  step: {
    species: string;
    trigger: string;
    minLevel: number | null;
    item: unknown;
    condition: string | null;
    evolvesTo: unknown[];
  },
  depth: number,
): string {
  const indent = '  '.repeat(depth);
  const parts: string[] = [`${indent}→ **${step.species}**`];
  if (step.trigger !== 'base') {
    const details: string[] = [`trigger: ${step.trigger}`];
    if (step.condition) details.push(step.condition);
    parts.push(` *(${details.join(', ')})*`);
  }
  const line = parts.join('');
  const children = (step.evolvesTo as (typeof step)[]).map((child) =>
    renderEvolutionStep(child, depth + 1),
  );
  return [line, ...children].join('\n');
}
