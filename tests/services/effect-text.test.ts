/**
 * @fileoverview Effect text for moves and items: effect prose first, then the latest real English
 * flavor text, with placeholders skipped and line breaks folded; and the dossier's use of the fold.
 * @module tests/services/effect-text.test
 */

import { readFileSync } from 'node:fs';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { effectTextOf, foldFlavorText } from '@/services/pokeapi/effect-text.js';
import { getPokeApiService, initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';
import type { RawItem, RawMove, RawPokemonSpecies } from '@/services/pokeapi/types.js';
import { handlerHttp } from '../fixtures/handler-fixtures.js';

const captures = JSON.parse(
  readFileSync(new URL('../fixtures/effect-text-captures.json', import.meta.url), 'utf8'),
) as { moves: Record<string, RawMove>; items: Record<string, RawItem> };

const ref = (kind: string, name: string) => ({
  name,
  url: `https://pokeapi.co/api/v2/${kind}/${name}/`,
});
const itemRow = (text: string, versionGroup: string, language = 'en') => ({
  text,
  language: ref('language', language),
  version_group: ref('version-group', versionGroup),
});
const prose = (effect: string, language = 'en') => ({
  effect,
  short_effect: `${effect} (short)`,
  language: ref('language', language),
});
const none = { effectText: null, shortEffectText: null, effectTextVersionGroup: null };

describe('effectTextOf', () => {
  it('keeps English effect prose, with no version group, over any flavor text', () => {
    const result = effectTextOf(
      [prose('Wirkung.', 'de'), prose('Burns the target.')],
      [itemRow('Flavor text.', 'scarlet-violet')],
    );
    expect(result).toEqual({
      effectText: 'Burns the target.',
      shortEffectText: 'Burns the target. (short)',
      effectTextVersionGroup: null,
    });
  });

  it('falls back past non-English prose to the last English row, not the last row', () => {
    const result = effectTextOf(
      [prose('Wirkung.', 'de')],
      [
        itemRow('Older text.', 'sword-shield'),
        itemRow('Newer text.', 'scarlet-violet'),
        itemRow('Texte récent.', 'legends-za', 'fr'),
      ],
    );
    expect(result).toEqual({
      effectText: 'Newer text.',
      shortEffectText: null,
      effectTextVersionGroup: 'scarlet-violet',
    });
  });

  it('reads move rows by flavor_text and folds page and line breaks', () => {
    const row = {
      flavor_text: 'Strikes the target.\nIt may\fflinch.',
      language: ref('language', 'en'),
      version_group: ref('version-group', 'x-y'),
    };
    expect(effectTextOf([], [row])).toEqual({
      effectText: 'Strikes the target. It may flinch.',
      shortEffectText: null,
      effectTextVersionGroup: 'x-y',
    });
  });

  it.each([
    ['N/A'],
    [' N/A '],
    ['- - -'],
    ['-\n-\n-'],
    ['ー ー ー'],
    ['An item that causes [VAR]\u0002ā'],
    [''],
  ])('skips the placeholder %j for the latest real text before it', (placeholder) => {
    const result = effectTextOf(
      [],
      [itemRow('Real text.', 'sword-shield'), itemRow(placeholder, 'scarlet-violet')],
    );
    expect(result).toEqual({
      effectText: 'Real text.',
      shortEffectText: null,
      effectTextVersionGroup: 'sword-shield',
    });
  });

  it('keeps real text that only contains dashes among words', () => {
    const result = effectTextOf([], [itemRow('A well-made, long-lasting - item.', 'legends-za')]);
    expect(result.effectText).toBe('A well-made, long-lasting - item.');
  });

  it.each([
    ['no rows', []],
    ['only non-English rows', [itemRow('Texte.', 'legends-za', 'fr')]],
    ['only placeholders', [itemRow('N/A', 'scarlet-violet'), itemRow('- - -', 'legends-za')]],
  ])('leaves the text null with %s', (_label, rows) => {
    expect(effectTextOf([], rows)).toEqual(none);
  });

  it.each([
    ['tm101', 'N/A in every English row'],
    ['tm229', 'dash rows'],
    ['lastrange-ball', 'katakana and ASCII dash rows'],
  ])('leaves captured %s (%s) without text', (name) => {
    const item = captures.items[name]!;
    expect(effectTextOf(item.effect_entries, item.flavor_text_entries)).toEqual(none);
  });

  it('skips captured rows whose game-text variables were never filled', () => {
    const item = captures.items['dynamax-crystal-and15']!;
    expect(effectTextOf(item.effect_entries, item.flavor_text_entries)).toEqual({
      effectText:
        'An item that causes to appear from the Watchtower Lair in the Wild Area until the end of the day.',
      shortEffectText: null,
      effectTextVersionGroup: 'brilliant-diamond-shining-pearl',
    });
  });

  it('leaves a captured move with no flavor rows without text', () => {
    const move = captures.moves['blazing-torque']!;
    expect(effectTextOf(move.effect_entries, move.flavor_text_entries)).toEqual(none);
  });
});

describe('foldFlavorText', () => {
  it('turns each page and line break into one space and leaves other text alone', () => {
    expect(foldFlavorText('A\fB\nC\n\nD  E')).toBe('A B C  D  E');
  });

  it('rejoins a word the game text box hyphenated softly across a line break', () => {
    // gold-silver flavor text breaks words with a soft hyphen (U+00AD) before the newline.
    expect(foldFlavorText('Pounds with fore\u00ad\nlegs or tail.')).toBe(
      'Pounds with forelegs or tail.',
    );
    expect(foldFlavorText('fore\u00ad\flegs')).toBe('forelegs');
  });
});

describe('dossier flavor text', () => {
  let http: ReturnType<typeof handlerHttp> | undefined;
  afterEach(() => http?.restore());

  it('folds the selected species entry with the shared fold', async () => {
    const domain = JSON.parse(
      readFileSync(new URL('../fixtures/domain-captures.json', import.meta.url), 'utf8'),
    ) as { species: Record<string, RawPokemonSpecies> };
    http = handlerHttp({
      'pokemon-species/bulbasaur': {
        ...domain.species.bulbasaur,
        flavor_text_entries: [
          {
            flavor_text: 'A strange seed was\nplanted on its\fback at birth.',
            language: ref('language', 'en'),
            version: ref('version', 'red'),
          },
        ],
      },
    });
    http.install();
    initPokeApiService({} as Parameters<typeof initPokeApiService>[0], createInMemoryStorage());
    const dossier = await getPokeApiService().getPokemonDossier(
      'bulbasaur',
      false,
      undefined,
      createMockContext(),
    );
    expect(dossier).toMatchObject({
      speciesFlavorText: 'A strange seed was planted on its back at birth.',
      flavorTextVersion: 'red',
    });
  });
});
