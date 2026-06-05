# PokéAPI MCP Server — Design

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations | Error Contract |
|:-----|:------------|:-----------|:------------|:--------------|
| `pokeapi_get_pokemon` | Denormalized Pokémon dossier in one call — base stats, types, abilities (with effect text), height/weight, resolved evolution chain, learnable moves (latest-gen summary), sprite URLs (including `sprites.other['official-artwork'].front_default` for high-quality art), species flavor text, variant list, `capture_rate`, `growth_rate`, `gender_rate`, `is_legendary`, `is_mythical`. Replaces 10–30 sub-resource GETs across `/pokemon`, `/pokemon-species`, `/evolution-chain`, and each `/ability`. | `identifier` (name or Pokédex number), `include_moves` bool (default false — move list is large), `game_version` string for flavor-text filtering (e.g. `"sword"`, `"red"` — PokéAPI version name; no-match silently returns first available) | `readOnlyHint: true` | `not_found` (NotFound): identifier resolves to no PokéAPI entry (HTTP 404 with empty body) |
| `pokeapi_get_move` | Move details by name or ID — type, damage class, power, accuracy, PP, priority, target, stat changes, status-effect chance, full English effect text, and the Pokémon that can learn it (`learned_by_pokemon`). | `identifier` (name or ID), `include_learners` bool (default false) | `readOnlyHint: true` | `not_found` (NotFound): identifier resolves to no move |
| `pokeapi_get_ability` | Ability details by name or ID — full English effect text, short effect text, and the Pokémon that have it (with hidden-ability flag and slot). | `identifier` (name or ID) | `readOnlyHint: true` | `not_found` (NotFound): identifier resolves to no ability |
| `pokeapi_get_type_matchups` | Computed type effectiveness. Given a type name or Pokémon identifier, returns the full offensive and defensive matchup breakdown — super-effective, resisted, and immune — with multiplier values. For dual-type Pokémon, composes both type relations correctly. | `type` (type name) or `pokemon` (name/dex number) — one required | `readOnlyHint: true` | `not_found` (NotFound): type or Pokémon identifier not recognized; `invalid_input` (InvalidParams): neither `type` nor `pokemon` provided |
| `pokeapi_get_item` | Item details by name or ID — effect text, category, cost, fling power, attributes, and Pokémon that commonly hold it. | `identifier` (name or ID) | `readOnlyHint: true` | `not_found` (NotFound): identifier resolves to no item |
| `pokeapi_find_pokemon` | Filter Pokémon by generation, type, Pokédex (region), or egg group. Returns names and dex numbers for follow-up `get_pokemon` calls. Also resolves fuzzy name queries and dex numbers to canonical entries. | `generation` (e.g. `"generation-i"`), `type` (e.g. `"fire"`), `pokedex` (e.g. `"kanto"`), `egg_group` (e.g. `"fairy"`), `query` (fuzzy name search), `limit`, `offset` | `readOnlyHint: true`, `openWorldHint: false` | `no_results` (NotFound): filter values are valid but yield no matches; `invalid_filter` (InvalidParams): unrecognized generation/type/pokedex/egg-group name |
| `pokeapi_get_nature` | Nature details by name or ID — stat boost and penalty (increased/decreased stat names), preferred and disliked berry flavor. Returns all 25 natures when called without an identifier. Critical for team-building: natures apply +10%/−10% to two stats. | `identifier` (name e.g. `"modest"` or ID 1–25; omit to list all) | `readOnlyHint: true`, `openWorldHint: false` | `not_found` (NotFound): identifier resolves to no nature |

### Resources

| URI Template | Description | Pagination |
|:-------------|:------------|:-----------|
| `pokeapi://pokemon/{identifier}` | Pokémon dossier addressable by name or dex number. Same payload as `pokeapi_get_pokemon` without moves. | No |
| `pokeapi://type/{typeName}` | Type damage relations — raw multiplier table, offensive and defensive. | No |

### Prompts

None. This is a data-retrieval server; no recurring interaction patterns warrant a prompt template.

---

## Overview

PokéAPI MCP Server wraps [PokéAPI v2](https://pokeapi.co/api/v2/) — a keyless, fully static, and deeply normalized REST API covering all mainline Pokémon game data through Generation IX. The API's strength is its completeness; its friction is its graph depth: a full picture of one Pokémon spans 3–5 resource types and 10–30 HTTP GETs when walked naively.

This server's entire value proposition is consolidation. `pokeapi_get_pokemon` fans out across the resource graph in parallel and returns one denormalized object. `pokeapi_get_type_matchups` computes the dual-type effectiveness matrix from raw damage relations so agents don't have to. Every other tool similarly flattens a normalized sub-graph into a single useful answer.

**Audience:** Broad — anyone asking a game-data question, building a team, or running a quiz/trivia workflow. PokéAPI is the single most-tutorialed public API; its data is pristine and universally understood.

---

## Requirements

- Keyless — no API key, no auth, no configuration required to run
- Read-only — all tools are `readOnlyHint: true`; no writes to PokéAPI
- Cache aggressively — PokéAPI data is static game data; the API's fair-use policy asks consumers to cache. TTL of several hours is appropriate for a hosted deployment
- English text — `effect_entries` and `flavor_text_entries` exist in multiple languages; always filter `language.name === 'en'`. When no English entry exists, surface `null` rather than a foreign-language string
- Fuzzy identifier input — all single-item GET tools accept lowercase hyphenated name (PokéAPI canonical form, e.g. `"bulbasaur"`, `"choice-specs"`) or numeric ID as a string or number. Normalize inputs before fetching (lowercase, replace spaces with hyphens)
- Variants awareness — Pokémon with regional/cosmetic forms (Pikachu cap variants, Alolan forms, Gigantamax, Mega) are separate entries in PokéAPI; surface the variant list so callers can request a specific form
- Moves are large — `/pokemon/{id}` returns 100–200+ moves with multi-game version history. Default `include_moves: false`; when true, summarize to the move name and learn method only (not every version-group detail)
- 404 responses from PokéAPI return an empty body — check HTTP status, not body parsing

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `PokeApiService` | PokéAPI v2 REST (`https://pokeapi.co/api/v2/`) | All tools |

Single service — one upstream, no auth variation. Init/accessor pattern. Exposes typed fetch methods per resource type; tools compose these into their outputs. Caches responses in `ctx.state` with a long TTL (configurable, default 6 hours).

**Resilience:**
- Retry: 2 attempts, 500ms base backoff (PokéAPI is stable; network blips are the primary failure mode)
- Timeout: 10s per request
- Parse: check HTTP status before body parse; empty 404 body → `notFound()`
- Rate limits: PokéAPI has no published hard rate limit; cache policy absorbs most repetition

---

## Config

| Env Var | Required | Default | Description |
|:--------|:---------|:--------|:------------|
| `POKEAPI_BASE_URL` | No | `https://pokeapi.co/api/v2` | Override for local mirrors or proxies |
| `POKEAPI_CACHE_TTL_SECONDS` | No | `21600` (6 h) | How long to cache PokéAPI responses in `ctx.state` |
| `POKEAPI_REQUEST_TIMEOUT_MS` | No | `10000` | Per-request timeout in ms |

All in `src/config/server-config.ts` via `parseEnvConfig`.

---

## Implementation Order

1. Config (`src/config/server-config.ts`) and `PokeApiService` (`src/services/pokeapi/`)
2. `pokeapi_get_pokemon` — flagship; exercises the full fan-out pattern
3. `pokeapi_get_type_matchups` — second priority; the computed answer to "what beats X?"
4. `pokeapi_get_move`, `pokeapi_get_ability`, `pokeapi_get_item`, `pokeapi_get_nature` — single-resource tools, straightforward
5. `pokeapi_find_pokemon` — list/filter tool; requires MCP-side filtering logic
6. Resources (`pokeapi://pokemon/{id}`, `pokeapi://type/{typeName}`)

Each tool is independently testable after its service methods are in place.

---

## Domain Mapping

| Noun | PokéAPI Endpoint(s) | Operations |
|:-----|:--------------------|:-----------|
| Pokémon | `/pokemon/{id}` + `/pokemon-species/{id}` + `/evolution-chain/{id}` + `/ability/{id}` (×N) | get (denormalized), list (filtered) |
| Move | `/move/{id}` | get |
| Ability | `/ability/{id}` | get |
| Type | `/type/{id}` | get (raw relations), compute matchups |
| Item | `/item/{id}` | get |
| Nature | `/nature/{id}` | get, list all (25 total) |
| Generation | `/generation/{id}` | list species by generation (for `find_pokemon`) |
| Pokédex | `/pokedex/{id}` | list entries by regional dex (for `find_pokemon`) |
| Egg Group | `/egg-group/{id}` | list species by egg group (for `find_pokemon`) |

---

## Workflow Analysis

### `pokeapi_get_pokemon` (up to 3 + N calls, two async tiers)

**Tier 1 (parallel):** Steps 1 and 2 fan out simultaneously.
**Tier 2 (parallel):** Step 3 fires after step 2 resolves (needs evolution-chain URL from species); ability fetches (step 4) fire after step 1 resolves (needs ability refs). Steps 3 and 4 run concurrently within tier 2.

| # | Call | Purpose | Tier | Condition |
|:--|:-----|:--------|:-----|:----------|
| 1 | `GET /pokemon/{identifier}` | Base stats, types, abilities refs, moves refs, sprites | 1 | always |
| 2 | `GET /pokemon-species/{identifier}` | Flavor text, evolution-chain URL, generation, varieties, egg groups, `is_legendary`, `is_mythical`, `capture_rate`, `growth_rate`, `gender_rate` | 1 | always |
| 3 | `GET /evolution-chain/{id}` | Full evolution tree (URL extracted from step 2 `species.evolution_chain.url`) | 2 | always |
| 4…N | `GET /ability/{id}` (×1–3) | Effect text for each ability (refs from step 1) | 2 | always, parallel via `Promise.allSettled` |
| — | Move summarization | Deduplicate + summarize moves array from step 1 | — | only when `include_moves: true` |

### `pokeapi_get_type_matchups` (1–3 calls)

| # | Call | Purpose | Condition |
|:--|:-----|:--------|:----------|
| 1a | `GET /type/{typeName}` | Damage relations | when input is a type name |
| 1b | `GET /pokemon/{identifier}` | Resolve Pokémon's type(s) | when input is a Pokémon identifier |
| 2 | `GET /type/{type2}` | Second type's damage relations | only for dual-type Pokémon |
| — | Matrix composition | Multiply effectiveness factors for dual types | always |

For dual-type Pokémon: multiply per-type defensive factors. A Fire/Flying Pokémon vs. Rock: Fire takes 2× from Rock, Flying takes 2× from Rock → 4× total. Immune in either type always wins (0×).

---

## Design Decisions

**`pokeapi_get_pokemon` as the flagship workflow tool.** The graph-walk consolidation is the entire point of this server. A single call replaces what would be 10–30 agent-initiated HTTP GETs with manual stitching. All other tools exist to answer more focused questions the flagship doesn't cover (move details, ability lookup, type matchups as a computed answer).

**`include_moves: false` default.** Pikachu has 119 learnable moves in the API, each with multi-game version history. Returning the full list by default would produce a 20KB+ payload that buries the stats and evolution data. The default returns move names only as a count; `include_moves: true` returns a summarized list (name, type, learn method, level) filtered to the latest game generation.

**Separate `pokeapi_get_type_matchups` tool rather than bundling into `get_pokemon`.** Matchup queries are a standalone workflow — "what beats Charizard?" or "what does Fire resist?" don't need the full Pokémon dossier. Keeping it separate lets agents call it cheaply for type questions without triggering the full fan-out.

**`pokeapi_find_pokemon` uses MCP-side list filtering.** PokéAPI has no native multi-filter search (`/pokemon` only lists all). The server fetches the relevant bounded set (generation species list, pokedex entries, type members, egg group members) and filters client-side. Each sub-list is bounded (151 for Kanto, ~100–200 per type), making this appropriate. `query` parameter does strict token matching on names.

**`pokeapi_get_nature` added.** Natures are the primary stat modifier in competitive team-building: every 1 of 25 natures gives +10% to one stat and −10% to another. "What nature should my Garchomp run?" and "which natures boost Sp. Atk?" are among the most common questions for the audience this server targets. The `/nature/{name}` endpoint is a trivial GET with a 25-item bounded domain; the omission was a gap, not a deliberate deferral.

**`pokeapi_` prefix over `pokemon_` or `pokedex_`.** `pokemon_get_pokemon` stutters. `pokedex_` is cuter but breaks the standard `{brand}-mcp-server` → `{brand}_` tool prefix convention. `pokeapi_` reads cleanly and names the data source correctly.

**No prompts.** The server is pure data retrieval with no recurring compositional workflow that would benefit from a structured message template.

**Resources as supplementary only.** `pokeapi://pokemon/{id}` and `pokeapi://type/{typeName}` are convenience resources for clients that support injectable context. All data is reachable through tools; resources add nothing for tool-only clients.

---

## Known Limitations

- **No competitive data.** PokéAPI doesn't cover competitive tiers (Smogon OU/UU/etc.), usage stats, or meta analysis. Those belong in a hypothetical `smogon-mcp-server`.
- **Game version filtering is limited.** Flavor text exists per game version but move learnsets are complex to filter by game — the server picks the latest generation's learnset for simplicity.
- **Variants require explicit lookup.** Forms like `pikachu-alola-cap` are separate PokéAPI entries. `get_pokemon` surfaces the varieties list; callers must re-call with the specific variant name for its stats.
- **Static data only.** PokéAPI covers mainline series data through its last-updated generation. Fan games, ROM hacks, and unofficial data are out of scope.

---

## API Reference

**Base URL:** `https://pokeapi.co/api/v2/`

**Auth:** None.

**Rate limits:** No published limit. Fair-use policy asks for aggressive caching; data is static and versioned.

**Pagination:** List endpoints (`/pokemon`, `/generation`, etc.) use `limit`/`offset` query params. `count` field on list responses gives total. Each page item has `{ name, url }` only — individual resources must be fetched by URL or name.

**Language filtering:** `effect_entries` and `flavor_text_entries` are multilingual arrays. Always filter `language.name === 'en'` before returning text to the agent. When no English entry exists, return `null` for that field.

**404 behavior:** Returns HTTP 404 with an empty body (not JSON). Check `response.ok` / status before calling `.json()`.

**Identifier forms:** Resources accept both lowercase-hyphenated names (`"bulbasaur"`, `"choice-specs"`) and numeric IDs. Input normalization: lowercase, trim, replace spaces with hyphens.

**Evolution chain structure:** Recursive `chain.evolves_to[]` tree. The tree must be walked recursively to flatten into a linear or branching evolution path. Evolution triggers include `level-up` (with optional `min_level`, `min_happiness`), `use-item` (with `item.name`), `trade`, and others — surface the trigger and its condition.

**Type damage keys:** `damage_relations.double_damage_to/from` (2×), `half_damage_to/from` (0.5×), `no_damage_to/from` (0×). For dual-type defensive matchup: multiply the two types' `*_from` multipliers together. Immunity (0×) in either type overrides all.
