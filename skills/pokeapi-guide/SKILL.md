---
name: pokeapi-guide
description: Use pokeapi_* tools for form-aware Pokémon discovery, evolution requirements, and type-matchup research. Follow identifier chains and check search coverage and game-version limits before drawing conclusions.
license: Apache-2.0
metadata:
  author: "cyanheads"
  version: "1.0"
---

## Scope

Use PokéAPI for static mainline Pokémon game data. Access is keyless and read-only. Competitive tiers, usage statistics, and metagame analysis are outside this server's coverage; it does not calculate battle damage or establish game-specific team legality.

## Identifiers

Carry the names returned by `pokeapi_find_pokemon` into `pokeapi_get_pokemon`. Type-only searches return Pokémon-record IDs, including alternate forms; searches containing a generation, regional pokédex, or egg-group filter return species IDs. Those IDs are not interchangeable with alternate-form record IDs or regional dex entry numbers.

Use the dossier's `varieties` names to request a particular form. Use its move and ability names with `pokeapi_get_move` and `pokeapi_get_ability`. Evolution alternatives can supply item and move names for `pokeapi_get_item` and `pokeapi_get_move`.

## Gates

- Before reporting no matches, inspect the search notice and total. A missing category filter is not a completed search; an empty page beyond the total is not an empty result set. Follow pagination until the requested set is covered before claiming an exhaustive list.
- Before ruling out an alternate form by type, distinguish type-only searches from mixed searches. Mixed searches intersect species/default-record IDs; a type found only on an alternate form does not qualify its species. Use a type-only search and inspect the relevant form dossiers when alternate forms matter.
- Before claiming a Pokémon can learn a move in a particular game, obtain game-specific evidence elsewhere. `game_version` selects flavor text only. The move summary chooses each move's last upstream version-group entry independently, not a single game's complete learnset; a move's learner list also has no game-version qualification.
- Before explaining an evolution, inspect the relevant branch's complete `evolutionDetails`. Requirements combine within one alternative, not across alternatives. Preserve version and form qualifiers; the compatibility summary covers only the first alternative. An unevaluated condition expression is not a verified satisfied condition.
- Before recommending a battle counter, separate type effectiveness from the battle outcome. The matchup calculation uses type relations; consult the actual form's ability effects and relevant move/item details rather than treating its multiplier table as a damage calculation or win guarantee.

## Core chain

Discover candidates with `pokeapi_find_pokemon`, then inspect returned names with `pokeapi_get_pokemon`. When the task names a regional, Mega, or other alternate form, select its exact name from `varieties` and fetch that dossier before comparing stats, abilities, or matchups.

## Workflows

For a type-coverage comparison, query each resolved form with `pokeapi_get_type_matchups`. Retain the numeric composed multipliers so a 4× weakness remains distinct from a 2× weakness. For offensive coverage, inspect the actual moves with `pokeapi_get_move`; a dual-type Pokémon's unavailable offensive breakdown does not imply it has no useful attacks.

For evolution research, walk the dossier's tree to the requested starting stage, then follow the desired descendant branch. Read every applicable evolution alternative at each step. Resolve named items or moves with their detail tools when the user needs their effects, keeping unknown version/form conditions explicit.
