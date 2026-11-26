/**
 * @fileoverview English effect text for moves and items: PokéAPI's effect prose, or the latest
 * in-game flavor text when it has none.
 * @module services/pokeapi/effect-text
 */

import type { MoveDetails, NamedResource } from './types.js';

/** Effect text of a move or item, and where it came from; items carry the same three fields. */
type EffectText = Pick<MoveDetails, 'effectText' | 'effectTextVersionGroup' | 'shortEffectText'>;

interface EffectEntry {
  effect: string;
  language: NamedResource;
  short_effect: string;
}

/** Move rows carry `flavor_text`, item rows `text`. */
type FlavorEntry = { language: NamedResource; version_group: NamedResource } & (
  | { flavor_text: string }
  | { text: string }
);

/**
 * Joins the lines and pages of a game text box with spaces. A soft hyphen (U+00AD) before a
 * break marks a word the text box split, so that pair is removed instead.
 */
export function foldFlavorText(text: string): string {
  return text.replace(/\u00ad[\f\n]/g, '').replace(/[\f\n]/g, ' ');
}

/**
 * A folded flavor text that stands for no text: PokéAPI's literal `N/A`, a row of dashes
 * (`- - -`, `ー ー ー`), or game text whose variables were never filled (`[VAR]` followed by a
 * control code).
 */
function isPlaceholder(text: string): boolean {
  return text.trim() === 'N/A' || /^[\s\p{Pd}ー]*$/u.test(text) || /\p{Cc}/u.test(text);
}

/**
 * PokéAPI's English effect prose when it has some. Otherwise the last English flavor text in
 * upstream order that is not a placeholder, folded to one line and named by its version group;
 * upstream lists flavor text by version group, oldest first, so that is the latest game's text.
 */
export function effectTextOf(
  effectEntries: readonly EffectEntry[],
  flavorEntries: readonly FlavorEntry[],
): EffectText {
  const prose = effectEntries.find((entry) => entry.language.name === 'en');
  if (prose) {
    return {
      effectText: prose.effect,
      shortEffectText: prose.short_effect,
      effectTextVersionGroup: null,
    };
  }
  const flavor = flavorEntries
    .filter((entry) => entry.language.name === 'en')
    .map((entry) => ({
      text: foldFlavorText('text' in entry ? entry.text : entry.flavor_text),
      versionGroup: entry.version_group.name,
    }))
    .findLast(({ text }) => !isPlaceholder(text));
  return {
    effectText: flavor?.text ?? null,
    shortEffectText: null,
    effectTextVersionGroup: flavor?.versionGroup ?? null,
  };
}
