---
name: pokeapi-mcp-server
description: "Everything about a Pokémon in one call — stats, abilities, evolutions, moves, and type matchups, denormalized from PokéAPI's resource graph."
version: 0.0.0
status: idea
category: external-data
hosted: false
subdomain: ""
port: 0
tools: 0
resources: 0
prompts: 0
rating: unrated
stars: 0
open_issues: 0
auth: none
framework: mcp-ts-core
core_version: ""
npm: "@cyanheads/pokeapi-mcp-server"
created: 2026-05-30
error_handling: unaudited
response_enrichment: unaudited
needs_migration: false
pattern: single-source graph-walk consolidation
complexity: low-medium
api-deps: PokéAPI (pokeapi.co) v2
api-cost: free (keyless, no auth; fair-use — cache heavily, data is static)
hostable: true
composes-with: wikidata-mcp-server, wikipedia-mcp-server
---

# pokeapi-mcp-server

The complete Pokédex over PokéAPI. The data is pristine — so where's the value over a curl? PokéAPI is **deeply normalized and chatty**: a full picture of one Pokémon means walking a resource graph — `pokemon` → `pokemon-species` → `evolution-chain`, plus N `move`, `ability`, and `type` sub-resources, each a separate HTTP GET. An agent naively curling it makes 10–30 calls and stitches the result by hand, burning tokens. The server fans out internally and returns one denormalized dossier — the PokéAPI analog of `finnhub_company` or `clinicaltrials_find_studies`.

**Audience:** Enormous and dual. PokéAPI is the single most-tutorialed public API (every "learn to fetch" tutorial uses it), and Pokémon is a massive hobby domain. The value here over raw PokéAPI is the consolidation and the computed type matchups, not new data.

## User Goals

- Get everything about a Pokémon in one call: stats, types, abilities, evolution chain, moves, sprites, flavor text
- Look up a move: power, accuracy, type, effect, and which Pokémon learn it
- Get type matchups — what's super-effective against / weak to a type or Pokémon
- Look up an ability and which Pokémon have it
- Browse by generation, type, region/Pokédex, or egg group
- Resolve a fuzzy name or dex number to the canonical entry

## API Surface

PokéAPI v2, keyless, fully static versioned game data. Heavily normalized — the consolidation is the whole point.

| Resource | Provides |
|:---------|:---------|
| `/pokemon/{id}` | Base stats, types, abilities, moves, sprites |
| `/pokemon-species/{id}` | Flavor text, evolution-chain link, generation, varieties |
| `/evolution-chain/{id}` | The full evolution tree (resolve, don't return a URL) |
| `/move/{id}` | Power, accuracy, PP, type, damage class, effect |
| `/ability/{id}` | Effect text + Pokémon that have it |
| `/type/{id}` | Damage relations (the raw material for matchups) |
| `/generation`, `/region`, `/pokedex`, `/egg-group` | Browse/filter axes |

## Tool Surface (sketch)

Tool prefix `pokeapi_` (canonical brand; avoids the `pokemon_pokemon` stutter).

```
pokeapi_get_pokemon   — the flagship. Name or dex number → a denormalized dossier in
                        one call: base stats, types, abilities (with effects),
                        height/weight, full resolved evolution chain, learnable moves
                        (summarized), sprite URLs, and species flavor text. Replaces
                        the 10–30 sub-resource GETs an agent would otherwise walk
                        across pokemon / species / evolution-chain.

pokeapi_get_move      — move by name/id: type, damage class, power, accuracy, PP,
                        priority, effect text, and the Pokémon that can learn it.

pokeapi_get_ability   — ability by name/id: effect text, and the Pokémon that have it
                        (with the hidden-ability flag).

pokeapi_get_matchups  — type effectiveness. Input a type, or a Pokémon (resolving its
                        1–2 types) → super-effective / not-very-effective / immune
                        breakdown, offensive and defensive. The computed answer to
                        "what beats Charizard?" — tedious to derive by hand from raw
                        type relations.

pokeapi_find_pokemon  — list/filter entries by generation, type, region/pokedex, or
                        egg group. Returns names + dex numbers for follow-up
                        get_pokemon calls. Also serves fuzzy name resolution.

pokeapi_get_item      — item by name/id: effect text, category (held, consumable,
                        berry, TM/HM), fling power, and which Pokémon commonly hold
                        it. Covers the item half of team-building questions
                        ("what does Choice Specs do?") that get_pokemon doesn't reach.
```

## Design Notes

- **The moat is graph-walk consolidation.** `pokeapi_get_pokemon` fans out across the normalized graph (Promise.allSettled) and returns one complete object; agents otherwise make 10–30 calls and stitch by hand. Same pattern as `finnhub_company` and `clinicaltrials_find_studies` — the data's clean, the assembly isn't.
- **Data is static** — versioned game data that rarely changes. Cache aggressively (long TTL, effectively a static dataset); PokéAPI's fair-use ask is "cache, don't hammer." Hosting cost is near-zero.
- **`pokeapi_type_matchups` earns its keep** because type effectiveness is *computable but tedious* — the raw API gives type→type relations; the agent wants "what's super-effective vs this Pokémon," which means resolving its types and composing the matrix. Bake it.
- Sprites are URLs (official artwork + game sprites) — return full URLs; note shiny/animated variants exist.
- Name resolution: accept fuzzy names and dex numbers; forms/variants (Alolan, Mega, regional, Gigantamax) are distinct species entries — surface them rather than silently picking one.
- Prefix `pokeapi_` chosen over `pokemon_` (stutter) and `pokedex_` (cuter, but breaks name↔prefix consistency).
- Composes with `wikidata` / `wikipedia` for lore and competitive context the structured game data doesn't carry.
- README one-liner: "Everything about a Pokémon in one call — stats, abilities, evolutions, moves, and type matchups, denormalized from PokéAPI's resource graph."
