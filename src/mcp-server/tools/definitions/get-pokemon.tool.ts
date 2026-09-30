/**
 * @fileoverview pokeapi_get_pokemon tool — denormalized Pokémon dossier in one call.
 * @module mcp-server/tools/definitions/get-pokemon.tool
 */

import { tool, z } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import { getPokeApiService } from '@/services/pokeapi/pokeapi-service.js';
import type { EvolutionDetail, EvolutionStep } from '@/services/pokeapi/types.js';

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

const EvolutionDetailSchema = z.object({
  versionGroup: z
    .string()
    .nullable()
    .describe('Version group that introduced this method. Null when unspecified.'),
  isDefault: z
    .boolean()
    .nullable()
    .describe(
      'Whether this is the expected main-series evolution for its variety. Null when unspecified.',
    ),
  requiredPokemonForm: z
    .string()
    .nullable()
    .describe('Required starting form. Null when unspecified.'),
  evolvedPokemonForm: z.string().nullable().describe('Resulting form. Null when unspecified.'),
  trigger: z.string().describe('Event that triggers this alternative.'),
  item: z.string().nullable().describe('Item used for evolution. Null when unspecified.'),
  gender: z.number().nullable().describe('Required gender ID. Null when unspecified.'),
  heldItem: z.string().nullable().describe('Required held item. Null when unspecified.'),
  knownMove: z.string().nullable().describe('Required known move. Null when unspecified.'),
  knownMoveType: z
    .string()
    .nullable()
    .describe('Type of a required known move. Null when unspecified.'),
  location: z.string().nullable().describe('Required location. Null when unspecified.'),
  minLevel: z.number().nullable().describe('Minimum level. Null when unspecified.'),
  minHappiness: z.number().nullable().describe('Minimum happiness. Null when unspecified.'),
  minBeauty: z.number().nullable().describe('Minimum beauty. Null when unspecified.'),
  minAffection: z.number().nullable().describe('Minimum affection. Null when unspecified.'),
  nearSpecialRock: z
    .boolean()
    .nullable()
    .describe('Whether proximity to a Moss Rock or Icy Rock is required. Null when unspecified.'),
  needsMultiplayer: z
    .boolean()
    .nullable()
    .describe('Whether multiplayer link play is required. Null when unspecified.'),
  needsOverworldRain: z
    .boolean()
    .nullable()
    .describe('Whether overworld rain is required. Null when unspecified.'),
  partySpecies: z
    .string()
    .nullable()
    .describe('Species required in the party. Null when unspecified.'),
  partyType: z.string().nullable().describe('Type required in the party. Null when unspecified.'),
  relativePhysicalStats: z
    .number()
    .nullable()
    .describe(
      'Required Attack relative to Defense: 1 greater, 0 equal, -1 less. Null when unspecified.',
    ),
  timeOfDay: z
    .string()
    .nullable()
    .describe('Required time of day. Empty string is preserved; null when unspecified.'),
  tradeSpecies: z.string().nullable().describe('Species to trade for. Null when unspecified.'),
  turnUpsideDown: z
    .boolean()
    .nullable()
    .describe('Whether the device must be upside down. Null when unspecified.'),
  region: z.string().nullable().describe('Required region. Null when unspecified.'),
  usedMove: z.string().nullable().describe('Move that must be used. Null when unspecified.'),
  minMoveCount: z.number().nullable().describe('Minimum move uses. Null when unspecified.'),
  minSteps: z.number().nullable().describe('Minimum steps. Null when unspecified.'),
  minDamageTaken: z.number().nullable().describe('Minimum damage taken. Null when unspecified.'),
  allowedNatures: z
    .array(z.string())
    .nullable()
    .describe('Allowed nature names. Empty lists are preserved; null when unspecified.'),
  conditionExpression: z
    .object({
      expression: z.string().describe('Verbatim upstream RPN condition expression; not evaluated.'),
      percentageChance: z.number().describe('Upstream chance percentage, including zero.'),
      variables: z.array(z.string()).describe('Names of expression variables in upstream order.'),
    })
    .nullable()
    .describe('Variable-dependent condition supplied by PokéAPI. Null when unspecified.'),
});

const EvolutionStepSchema: z.ZodType<EvolutionStep> = z.lazy(() =>
  z.object({
    species: z.string().describe('Species name.'),
    trigger: z.string().describe('First alternative trigger, or base for the root stage.'),
    minLevel: z
      .number()
      .nullable()
      .describe('First alternative minimum level. Null when unspecified.'),
    item: z
      .string()
      .nullable()
      .describe('First alternative evolution item. Null when unspecified.'),
    condition: z
      .string()
      .nullable()
      .describe(
        'Compatibility summary of the first alternative; evolutionDetails contains the complete methods.',
      ),
    evolutionDetails: z
      .array(EvolutionDetailSchema.describe('One complete alternative evolution method.'))
      .describe(
        'All alternative methods in upstream order; empty for a base stage. Requirements apply within each method, never across alternatives.',
      ),
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
    'Accepts a name (lowercase, hyphens for spaces, e.g. "bulbasaur", "mr-mime") or PokéAPI Pokémon-record ID. ' +
    'A species name with no Pokémon record of its own (e.g. "deoxys") resolves to the default variety of that species ' +
    '("deoxys-normal"), reported in resolvedFromSpecies. ' +
    'Set include_moves=true to include the move summary (large); defaults to false. ' +
    'Use game_version to select flavor text from a specific game (e.g. "sword", "red"); ' +
    'falls back to the most recent English entry when the version is not found. ' +
    'Use pokeapi_find_pokemon to discover Pokémon by type, generation, or egg group before calling this tool.',
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  input: z.object({
    identifier: z
      .string()
      .describe(
        'Pokémon name (lowercase hyphenated, e.g. "bulbasaur", "charizard-mega-x") or PokéAPI Pokémon-record ID as a string (e.g. "1", "10034"). A species name (e.g. "deoxys") resolves to its default variety.',
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
    id: z
      .number()
      .describe('PokéAPI Pokémon-record ID. Form IDs are not National Pokédex numbers.'),
    name: z.string().describe('Canonical Pokémon name in hyphenated lowercase.'),
    resolvedFromSpecies: z
      .string()
      .nullable()
      .describe(
        'Species name the identifier matched when it named no Pokémon record; this dossier is the default variety of that species. Null when the identifier named a Pokémon record directly.',
      ),
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
      when: 'The identifier matches no Pokémon record and no species.',
      recovery:
        'Check the spelling against the PokéAPI name list or use a numeric PokéAPI Pokémon-record ID. Common names use hyphens, not spaces.',
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
          `Pokémon "${input.identifier}" not found — check spelling or use a numeric PokéAPI Pokémon-record ID.`,
        );
      }
      throw err;
    }
  },

  format: (result) => {
    const lines: string[] = [];

    lines.push(`# ${result.name} (PokéAPI ID: ${result.id})`);
    if (result.resolvedFromSpecies) {
      lines.push(
        `**Resolved from species:** ${result.resolvedFromSpecies} (default variety: ${result.name})`,
      );
    }
    lines.push(`**Genus:** ${result.genus ?? 'Not available'}`);
    lines.push(
      result.speciesFlavorText
        ? `\n> ${result.speciesFlavorText}`
        : '\n*(Flavor text not available.)*',
    );

    lines.push('\n## Overview');
    lines.push(`**Types:** ${result.types.join(', ') || 'None listed'}`);
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
    lines.push(`**Legendary:** ${result.isLegendary ? 'Yes' : 'No'}`);
    lines.push(`**Mythical:** ${result.isMythical ? 'Yes' : 'No'}`);
    lines.push(`**Egg Groups:** ${result.eggGroups.join(', ') || 'None listed'}`);

    lines.push('\n## Base Stats');
    if (result.stats.length === 0) lines.push('No base stats listed.');
    for (const s of result.stats) {
      lines.push(`**${s.name}:** ${s.baseStat} (EV: ${s.effort})`);
    }

    lines.push('\n## Abilities');
    if (result.abilities.length === 0) lines.push('No abilities listed.');
    for (const a of result.abilities) {
      const tag = a.isHidden ? ' *(hidden)*' : ' *(regular)*';
      lines.push(`### ${a.name} (slot ${a.slot})${tag}`);
      lines.push(a.effectText ?? '**Effect:** Not available');
      lines.push(`**Short:** ${a.shortEffectText ?? 'Not available'}`);
    }

    lines.push('\n## Sprites');
    lines.push(`**Official Artwork:** ${result.sprites.officialArtwork ?? 'Not available'}`);
    lines.push(`**Front Default:** ${result.sprites.frontDefault ?? 'Not available'}`);
    lines.push(`**Front Shiny:** ${result.sprites.frontShiny ?? 'Not available'}`);

    lines.push('\n## Evolution Chain');
    if (result.evolutionChain) {
      lines.push(
        'Alternative methods are separate. Unspecified requirement fields are omitted; false, zero and empty values are shown.',
      );
      lines.push(renderEvolutionStep(result.evolutionChain, 0));
    } else {
      lines.push('*(Evolution chain unavailable.)*');
    }

    lines.push('\n## Varieties');
    if (result.varieties.length === 0) lines.push('No varieties listed.');
    for (const v of result.varieties) {
      lines.push(`- ${v.name}${v.isDefault ? ' *(default)*' : ' *(alternative)*'}`);
    }

    lines.push(`\n## Moves`);
    lines.push(`**Total learnable moves:** ${result.moveCount}`);
    if (result.moves.length > 0) {
      for (const m of result.moves) {
        // Always include levelLearnedAt (0 for non-level-up moves)
        lines.push(`- ${m.name} — ${m.learnMethod} (level: ${m.levelLearnedAt})`);
      }
    } else if (result.moveCount === 0) {
      lines.push('No learnable moves listed.');
    } else {
      lines.push('*(Pass include_moves=true to include the full move list.)*');
    }

    return [{ type: 'text', text: lines.join('\n') }];
  },
});

function renderEvolutionStep(step: EvolutionStep, depth: number): string {
  const indent = '  '.repeat(depth);
  const details = [`trigger: ${step.trigger}`];
  if (step.condition) details.push(step.condition);
  if (step.minLevel != null) details.push(`minimum level: ${step.minLevel}`);
  if (step.item != null) details.push(`item: ${step.item}`);
  const line = `${indent}→ **${step.species}** *(${details.join(', ')})*`;
  const alternatives = step.evolutionDetails.map((detail, index) =>
    renderEvolutionDetail(detail, index + 1, indent),
  );
  const children = step.evolvesTo.map((child) => renderEvolutionStep(child, depth + 1));
  return [line, ...alternatives, ...children].join('\n');
}

function renderEvolutionDetail(detail: EvolutionDetail, index: number, indent: string): string {
  const requirements: Array<[string, string | number | boolean | string[] | null]> = [
    ['Trigger', detail.trigger],
    ['Item', detail.item],
    ['Gender ID', detail.gender],
    ['Held item', detail.heldItem],
    ['Known move', detail.knownMove],
    ['Known move type', detail.knownMoveType],
    ['Location', detail.location],
    ['Minimum level', detail.minLevel],
    ['Minimum happiness', detail.minHappiness],
    ['Minimum beauty', detail.minBeauty],
    ['Minimum affection', detail.minAffection],
    ['Near special rock', detail.nearSpecialRock],
    ['Needs multiplayer', detail.needsMultiplayer],
    ['Needs overworld rain', detail.needsOverworldRain],
    ['Party species', detail.partySpecies],
    ['Party type', detail.partyType],
    ['Relative physical stats', detail.relativePhysicalStats],
    ['Time of day', detail.timeOfDay],
    ['Trade species', detail.tradeSpecies],
    ['Turn upside down', detail.turnUpsideDown],
    ['Region', detail.region],
    ['Used move', detail.usedMove],
    ['Minimum move count', detail.minMoveCount],
    ['Minimum steps', detail.minSteps],
    ['Minimum damage taken', detail.minDamageTaken],
    ['Allowed natures', detail.allowedNatures],
  ];
  const rendered = requirements
    .filter(([, value]) => value !== null)
    .map(([label, value]) => {
      const text = Array.isArray(value)
        ? value.length > 0
          ? value.join(', ')
          : '[]'
        : value === ''
          ? '""'
          : String(value);
      return `${label}: ${text}`;
    });
  const lines = [
    `${indent}  Alternative ${index} — Introduced: ${detail.versionGroup ?? 'Not specified'}; Default: ${detail.isDefault ?? 'Not specified'}`,
    `${indent}    Forms — Required: ${detail.requiredPokemonForm ?? 'Not specified'}; Evolved: ${detail.evolvedPokemonForm ?? 'Not specified'}`,
    `${indent}    Requirements — ${rendered.join('; ')}`,
  ];
  if (detail.conditionExpression) {
    const condition = detail.conditionExpression;
    lines.push(
      `${indent}    Condition expression (not evaluated): ${condition.expression}; Chance: ${condition.percentageChance}%; Variables: ${condition.variables.length > 0 ? condition.variables.join(', ') : '[]'}`,
    );
  }
  return lines.join('\n');
}
