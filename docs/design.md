# PokéAPI MCP Server — Design

## MCP Surface

### Tools

| Name | Description | Key Inputs | Annotations | Error Contract |
|:-----|:------------|:-----------|:------------|:--------------|
| `pokeapi_get_pokemon` | Denormalized Pokémon dossier — stats, types, ability effects, earlier-generation typing, abilities, and stats (`pastTypes`, `pastAbilities`, `pastStats`), height/weight, evolution alternatives, move methods and levels, sprites, attributed flavor text, varieties, National/regional dex numbers, breeding data, capture/growth/gender rates, and legendary/mythical flags. | `identifier` (name or PokéAPI Pokémon-record ID; species names resolve to their default variety, reported in `resolvedFromSpecies`), `include_moves` bool (default false), `version_group` for a recorded learnset (implies move inclusion), `game_version` for English flavor text, as a version name or in-game title (fallback disclosed) | `readOnlyHint: true` | `not_found` (NotFound): identifier resolves to no PokéAPI entry; `invalid_version_group` (InvalidParams): unknown version-group name |
| `pokeapi_get_move` | Move details by name or ID — type, damage class, power, accuracy, PP, priority, target, stat changes, status-effect chance, English effect text (the latest in-game text, named by `effectTextVersionGroup`, when PokéAPI has no effect description), the TM, TR, or HM that teaches it per version group (`machines`, with `notices`), and the Pokémon that can learn it (`learned_by_pokemon`). | `identifier` (name or ID), `include_learners` bool (default false), `version_group` to limit machine rows to one group | `readOnlyHint: true` | `not_found` (NotFound): identifier resolves to no move; `invalid_version_group` (InvalidParams): unknown version-group name |
| `pokeapi_get_ability` | Ability details by name or ID — full English effect text, short effect text, and the Pokémon that have it (with hidden-ability flag and slot). | `identifier` (name or ID) | `readOnlyHint: true` | `not_found` (NotFound): identifier resolves to no ability |
| `pokeapi_get_type_matchups` | Computed offensive (`offensiveByType`, plus `offensiveRelations` for one type) and defensive type effectiveness for one type, two types, or a Pokémon, with composed dual-type defenses, resolved record identity, species-fallback attribution, and an optional generation scope. | `type` (one type name, or two separated by whitespace, `/`, `,`, or `+`) or `pokemon` (name or PokéAPI Pokémon-record ID; species names resolve to their default variety) — exactly one required; `generation` (name, in-game name, or number) for relations and typings as of that generation | `readOnlyHint: true` | `not_found` (NotFound): type (naming the unknown part) or Pokémon identifier not recognized; `invalid_input` (ValidationError): neither or both inputs provided, or more than two types; `invalid_generation` (InvalidParams): unknown generation; `not_in_generation` (InvalidParams): a type or Pokémon form introduced after the generation |
| `pokeapi_get_item` | Item details by name or ID — English effect text (the latest in-game text, named by `effectTextVersionGroup`, when PokéAPI has no effect description), category, cost, fling power, attributes, Pokémon that commonly hold it, and for a TM, TR, or HM the move it teaches per version group (`machines`, with `notices`). | `identifier` (name or ID), `version_group` to limit machine rows to one group | `readOnlyHint: true` | `not_found` (NotFound): identifier resolves to no item; `invalid_version_group` (InvalidParams): unknown version-group name |
| `pokeapi_find_pokemon` | Filter Pokémon by generation, type, pokédex, or egg group. Returns names, PokéAPI IDs, pre-pagination count, applied filters, and empty/past-end guidance. Dex filters add regional entry numbers and order pages by them. Type-only searches return Pokémon records; species filters return species rows joined by default-record ID. | `generation`, `type`, `pokedex`, `egg_group` (at least one required; a call without one returns an empty result and a notice), `query` (strict name-token matching within a category, at most 100 characters), positive integer `limit`, nonnegative integer `offset` | `readOnlyHint: true`, `openWorldHint: false` | `invalid_filter` (ValidationError): names the unrecognized category and its accepted values when available; schema failures are InvalidParams |
| `pokeapi_get_nature` | Nature details by name or ID — stat boost and penalty (increased/decreased stat names), preferred and disliked berry flavor. Returns all 25 natures when called without an identifier. Critical for team-building: natures apply +10%/−10% to two stats. | `identifier` (name e.g. `"modest"` or ID 1–25; omit to list all) | `readOnlyHint: true`, `openWorldHint: false` | `not_found` (NotFound): identifier resolves to no nature |

### Resources

| URI Template | Description | Pagination |
|:-------------|:------------|:-----------|
| `pokeapi://pokemon/{identifier}` | Pokémon dossier addressable by name or PokéAPI Pokémon-record ID. Same payload as `pokeapi_get_pokemon` without moves. | No |
| `pokeapi://type/{typeName}` | Type damage relations — raw multiplier table, offensive and defensive. | No |

### Prompts

| Name | Arguments | Workflow |
|:-----|:----------|:---------|
| `pokeapi_team_builder` | Required `lead`, `opponent`, `opponent_kind` (`pokemon` or `type`) | Pure client-directed template: resolve the lead and opponent, discover and verify complementary candidates, and propose six members including the lead where evidence permits. No retrieval-time fetches, battle guarantees, or game-legality claims. |

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
- Identifier input — all single-item GET tools accept canonical names, display spellings, or numeric IDs as strings; the framework repairs integer IDs to strings. Normalize before fetching: lowercase, remove diacritics, apostrophes, periods, and colons, map `♀`/`♂` to `-f`/`-m`, trim, and hyphenate whitespace. Reject an empty result, a result outside `[a-z0-9-]`, or one over 100 characters before storage or record requests. Tool misses are `not_found`; search misses are `invalid_filter`. Canonical upstream failures other than 404 remain operational errors
- Variants awareness — Pokémon with regional/cosmetic forms (Pikachu cap variants, Alolan forms, Gigantamax, Mega) are separate entries in PokéAPI; surface the variant list so callers can request a specific form
- Moves are large — `/pokemon/{id}` includes multi-game history. Default `include_moves: false`; when requested, retain each move and method's distinct levels from the latest version group by PokéAPI `order`. `version_group` implies inclusion and selects that group's methods and levels. Every returned row identifies its group, while `moveCount` counts distinct moves across all groups
- 404 responses from PokéAPI return an empty body — check HTTP status, not body parsing

---

## Services

| Service | Wraps | Used By |
|:--------|:------|:--------|
| `PokeApiService` | PokéAPI v2 REST (`https://pokeapi.co/api/v2/`) | All tools |

Single service — one upstream, no auth variation. Init/accessor pattern. Exposes typed fetch methods per resource type; tools compose these into their outputs. Caches responses in `ctx.state` with a long TTL (configurable, default 6 hours). Every cache read and write goes through one module (`state-cache.ts`). A storage-provider failure, including the in-memory store's 10,000-entry cap, reads as a cache miss on read and leaves the value unstored on write (one warning per resource), so the cache saves requests and never fails a call; defects in the call's own key, TTL, or tenant still propagate, and so does caller cancellation.

Besides per-record keys (`pokeapi/{resource}/{identifier}`), the cache holds `pokeapi/evolution-chain/{id}`, `pokeapi/nature-catalog`, `pokeapi/generation-catalog`, and `pokeapi/machine/{id}`. Evolution chains and machine records are read by the ID in the upstream reference URL, from `POKEAPI_BASE_URL`, so a mirror or proxy set there serves them too.

Machine records (`/machine/{id}`) are read best-effort for `pokeapi_get_move` and `pokeapi_get_item`: 8 at a time under one 3-second budget covering every request and response body of the call, each cached for the configured TTL. A record that fails or runs late is never cached; its row reports a null name and a notice, and only caller cancellation and programmer errors propagate. A 429 on a machine read pauses machine reads for every call for at least 5 seconds, or until its `Retry-After` passes when that is later (60 at most); paused rows report null with a rate-limit notice, and cached rows are still served.

The lightweight `resolvePokemon` method serves dossiers and matchups. It stores a normalized species-name → default-record-name mapping only after the default record fetch succeeds, using the same tenant-scoped state and configured TTL as response caching. No failed lookup or operational error creates a mapping.

Filter recovery reads only the failed category's complete name catalog, with offset pagination and one three-second deadline. If the catalog is unavailable or incomplete, `invalid_filter` still identifies the supplied filter and value and says the accepted names could not be retrieved. Successful searches make no catalog request; caller cancellation propagates.

**Resilience:**
- Retry: up to 3 retries after the initial attempt, 500ms base backoff
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
| Move | `/move/{id}` + `/machine/{id}` (×N, one per machine row) | get |
| Ability | `/ability/{id}` | get |
| Type | `/type/{id}` | get (raw relations), compute matchups |
| Item | `/item/{id}` + `/machine/{id}` (×N, for a TM, TR, or HM) | get |
| Nature | `/nature/{id}` | get, list all (25 total) |
| Generation | `/generation/{id}` | list species by generation (for `find_pokemon`); scope type matchups to a generation (with `/pokemon-form/{id}` for a Pokémon's introduction) |
| Pokédex | `/pokedex/{id}` | list entries by regional dex (for `find_pokemon`) |
| Egg Group | `/egg-group/{id}` | list species by egg group (for `find_pokemon`) |

---

## Workflow Analysis

### `pokeapi_get_pokemon` (3 + N base calls, or 4 + N for a species name)

Fetch the Pokémon record first, then resolve its species using `pokemon.species.name`. This preserves form lookup: a form record such as `charizard-mega-x` (10034) points to species `charizard` (6). Evolution-chain and ability fetches then run in parallel.

A cold name with no Pokémon record of its own that names a species (`deoxys`) costs one extra call: `GET /pokemon/{identifier}` returns 404, `GET /pokemon-species/{identifier}` supplies the default variety, and that variety (`deoxys-normal`) is fetched as the Pokémon record. Call 2 reuses the cached species response. Warm resolutions skip the initial 404; when the mapping and all dependent responses remain valid, the dossier makes zero requests.

| # | Call | Purpose | Tier | Condition |
|:--|:-----|:--------|:-----|:----------|
| 1 | `GET /pokemon/{identifier}` | Base stats, types, abilities refs, moves refs, sprites | 1 | always |
| 2 | `GET /pokemon-species/{pokemon.species.name}` | Flavor text, evolution-chain URL, generation, varieties, egg groups, legendary/mythical flags, capture/growth/gender rates | 1 | after Pokémon lookup |
| 3 | `GET /evolution-chain/{id}` | Full evolution tree (ID parsed from step 2 `species.evolution_chain.url`; requested from the configured base URL, not the host in that URL) | 2 | always |
| 4…N | `GET /ability/{id}` (×1–3) | Effect text for each ability (refs from step 1) | 2 | always, parallel via `Promise.all` |
| — | Move summarization | Group the moves from step 1 by move, method, version group, and distinct level | — | when `include_moves: true` or `version_group` is supplied |
| — | `GET /version-group/{name}` | Resolve chronology, caching each group's order with the configured TTL | — | unscoped summaries with competing groups; an explicit group absent from the Pokémon's details gets one existence check |

Supplementary chronology requests to PokéAPI run with bounded concurrency and share a three-second deadline across fetches and response bodies. In-flight cache reads and writes await the storage provider. A failed chronology lookup leaves the dossier usable: each move and method uses its last group in source order, with that fallback stated in `notices`. Caller cancellation propagates. Omitted moves and groups already present in an explicitly selected learnset need no chronology requests.

### `pokeapi_get_move` and `pokeapi_get_item` (1 call plus one machine read per machine row)

`GET /move/{id}` or `GET /item/{id}` supplies the details and a list of machine references, one per version group. Each reference is read from `GET /machine/{id}` to name the item (move) or move (item) it pairs, under the machine-read budget above. Non-machine items and moves without machines make no machine requests. Unscoped calls read every row (at most 26 across all machines, median 3 per machine item and 4 per move). With `version_group`, only that group's row is read; a group no row names costs one `GET /version-group/{name}` existence check, which either rejects an unknown group or returns an empty list with a notice.

### `pokeapi_get_type_matchups` (1–3 cold calls for direct queries; 4–5 for species fallback)

| # | Call | Purpose | Condition |
|:--|:-----|:--------|:----------|
| 1a | `GET /type/{typeName}` (×1–2) | Damage relations | when input is a type name or two |
| 1b | Shared Pokémon resolver | Resolve record and its type(s), with default-variety fallback for species names | when input is a Pokémon identifier |
| 2 | `GET /type/{type}` (×1–2) | Resolved type damage relations | when input is a Pokémon identifier |
| — | Matrix composition | Multiply effectiveness factors for dual types | always |

A call with `generation` adds the generation record, the generation catalog, each later generation (to learn which types and version groups came after it), and, for a Pokémon, its form record (to check when that form appeared). All are cached, so a repeat call makes no request; calls without `generation` are unchanged.

For dual-type Pokémon: multiply per-type defensive factors. A Fire/Flying Pokémon vs. Rock: Fire takes 2× from Rock, Flying takes 2× from Rock → 4× total. Immune in either type always wins (0×).

Pokémon queries return `resolvedPokemon: {id, name}` and nullable `resolvedFromSpecies`; direct type queries return null for both. Record and mapping caches are shared with dossiers and resources, without fetching dossier dependencies.

---

## Design Decisions

**`pokeapi_get_pokemon` as the flagship workflow tool.** The graph-walk consolidation is the entire point of this server. A single call replaces what would be 10–30 agent-initiated HTTP GETs with manual stitching. All other tools exist to answer more focused questions the flagship doesn't cover (move details, ability lookup, type matchups as a computed answer).

**`include_moves: false` default.** Keep routine dossiers focused on stats and evolution while always returning a distinct move count. An unscoped summary selects the latest group separately for each move and method, because a newer method must not hide a level-up method. `version_group` selects the recorded learnset for one group; multiple levels for the same move and method remain distinct.

**Flavor-text provenance preserves selection behavior.** `game_version` selects the English entry whose version name has the same key as the input, otherwise the last English entry in source order. A key is the identifier fold with every character outside `[a-z0-9]` removed, so `Fire Red`, `Let's Go, Pikachu!`, and `Legends: Z-A` select `firered`, `lets-go-pikachu`, and `legends-za`; every PokéAPI version name has a distinct key, so canonical names select themselves. A blank `game_version` counts as omitted. `flavorTextVersion` identifies the source, and a requested-version fallback is disclosed on both surfaces with `No English flavor text matches <input>. Showing the entry from <version>.` Unknown versions remain successful; missing English text yields null text and source fields with a notice. A soft hyphen before a line break rejoins the word (fore, soft hyphen, line break, legs → "forelegs") in every flavor-text field, instead of leaving a stray space.

**The evolution summary is the first default alternative.** A stage's `trigger`, `minLevel`, `item`, and `condition` summarize its first `isDefault` alternative in upstream order, else its first, and `condition` phrases every populated requirement of that alternative. PokéAPI marks one default per variety, and the first alternative is often an older method (Sylveon's first alternative is a fairy-move-and-affection method; its default is Sword/Shield's). A summary built from the first alternative describes an older method for some stages and omits requirements the summarized method carries; `evolutionDetails` remains the complete record.

**Past-generation fields relay PokéAPI's records.** `pastTypes`, `pastAbilities`, and `pastStats` keep PokéAPI's shape, oldest first, each entry tagged with the last generation its values applied to. `pastTypes` entries are complete; `pastAbilities` and `pastStats` list only changes, and a stat or slot an entry omits takes its value from the next later entry that lists it, else the current data. Generation I `special` stays its own stat rather than being split into special attack and defense, and effort is kept because some past rows change only it. Relaying the records keeps callers' resolution rules explicit instead of baking one reading into a derived per-generation snapshot.

**Effect text falls back to the last English flavor text.** When PokéAPI has no English effect description for a move or item, `effectText` is the last English flavor row in PokéAPI order, which is chronological for every move and item, so no version-group reads are needed; `effectTextVersionGroup` names its source and `shortEffectText` stays null. Flavor text that stands for no text (`N/A`, rows of dashes, unfilled game-text variables) is skipped, so those items keep null text. PokéAPI's placeholder `0` for move `power` and `accuracy` is reported as null, matching every other move without a value.

**Machine rows are per version group and best-effort.** A TM's effect prose is one description for every version group, but the move it teaches changes between games, so `machines` carries one row per group and the prose is documented as unversioned. A failed or late machine read nulls that row and adds a notice instead of failing the call, because the move or item details are still complete without it. A call can need 26 machine reads beside its one main read, so once PokéAPI rate-limits a machine read, machine reads stop process-wide for at least 5 seconds or the `Retry-After` window, whichever is longer, up to 60 seconds, and leave the request budget to main reads. The pause has a 5-second floor because a pause as short as a 1-second limit window lets each resumed burst of machine reads refill that window, and main reads would still draw 429s. `version_group` reuses the dossier's parsing and `invalid_version_group` contract so one group name works across tools.

**Separate `pokeapi_get_type_matchups` tool rather than bundling into `get_pokemon`.** Matchup queries are a standalone workflow — "what beats Charizard?" or "what does Fire resist?" don't need the full Pokémon dossier. Keeping it separate lets agents call it cheaply for type questions without triggering the full fan-out.

**Two-type matchups keep `type` a string.** `type` takes one type or two separated by whitespace, `/`, `,`, or `+`, split before the identifier fold; no PokéAPI type name contains those characters. An array form would turn the advertised schema into a union for every client. `offensiveByType` is built from the type records the call already fetched and is present for single types too, so a dual-type answer needs no follow-up call; `offensiveRelations` keeps its shape (null for two types).

**Generation scoping rejects what did not exist.** A type or Pokémon form introduced after the requested generation returns `not_in_generation` rather than a notice, because no typing existed then and any answer would be fabricated. PokéAPI tags each past entry with the last generation its value applied to, so the entry in force is the earliest one tagged at or after the requested generation; relations then drop target types introduced in later generations. A Pokémon's introduction is its form record's version group compared with the version groups of later generations.

**A 404 on a record PokéAPI listed is an upstream failure, not a miss.** Only the caller's own identifier can be `not_found`: a Pokémon whose record and species both 404, an unknown type, move, item, ability, or nature. Once a lookup resolves, a 404 on a record its data names (a species' default variety, a species, an evolution chain, an ability, a type, a form, a generation the catalog lists) reports `ServiceUnavailable` with the record named, and a body that is not JSON does too. Reporting those as `not_found` would tell the caller its input was wrong when PokéAPI's own data is inconsistent.

**`pokeapi_find_pokemon` uses MCP-side list filtering.** PokéAPI has no native multi-filter search (`/pokemon` only lists all). The server fetches the relevant bounded set (generation species list, pokedex entries, type members, egg group members) and filters client-side. Each sub-list is bounded (151 for Kanto, ~100–200 per type), making this appropriate. `query` parameter does strict token matching on names.

**Mixed filters intersect IDs and preserve species rows.** Official PokéAPI default-record IDs equal their species IDs, while alternate forms have distinct IDs. Joining the existing lists by ID preserves suffix-named defaults without per-record fetches or suffix guessing. A type represented only by an alternate form does not qualify the default species. Type-only searches preserve all record names and IDs.

**Pokédex numbers are separate from record identity.** Dossiers retain the Pokémon-record `id` and add the species `speciesId` as the National number, plus all `pokedexNumbers` entries and the species' `hatchCounter`, `baseHappiness`, and `isBaby`. The species record is already fetched, so these fields add no requests. A dex-filtered search joins `entryNumber` by species ID and sorts on it before pagination; other searches keep ID order. This preserves form identity and makes regional pages follow the game's numbering.

**`pokeapi_get_nature` added.** Natures are the primary stat modifier in competitive team-building: every 1 of 25 natures gives +10% to one stat and −10% to another. "What nature should my Garchomp run?" and "which natures boost Sp. Atk?" are among the most common questions for the audience this server targets. The `/nature/{name}` endpoint is a trivial GET with a 25-item bounded domain; the omission was a gap, not a deliberate deferral.

**`pokeapi_` prefix over `pokemon_` or `pokedex_`.** `pokemon_get_pokemon` stutters. `pokedex_` is cuter but breaks the standard `{brand}-mcp-server` → `{brand}_` tool prefix convention. `pokeapi_` reads cleanly and names the data source correctly.

**Team synthesis is a client-directed prompt.** Building a candidate team around a lead combines repeated dossier, discovery, and matchup calls into one workflow. A pure template keeps execution with the client and uses existing tools without adding a simulator. The six-member target includes the lead; missing evidence leaves explicit gaps rather than invented members. Type membership, composed defenses, ability effects, move details, and base Speed support recommendations, never guarantees of wins, turn order, or game legality.

**Resources as supplementary only.** `pokeapi://pokemon/{id}` and `pokeapi://type/{typeName}` are convenience resources for clients that support injectable context. All data is reachable through tools; resources add nothing for tool-only clients.

**Resource decoding belongs at registration.** `createApp({ decodeResourceParams: true })` decodes URI variables once before the service normalizes them. Malformed escapes fail framework validation, and double-encoded values remain invalid identifiers. Keeping decoding out of service methods prevents a second decode on resource calls.

---

## Known Limitations

- **No competitive data.** PokéAPI doesn't cover competitive tiers (Smogon OU/UU/etc.), usage stats, or meta analysis. Those belong in a hypothetical `smogon-mcp-server`.
- **Game version and version group are separate.** `game_version` selects flavor text; `version_group` selects recorded move methods and levels. The unscoped summary combines groups, and even a scoped learnset does not establish competitive-format legality or transfer eligibility. A move's learner list is not version-qualified.
- **Move stat changes carry no side or condition.** `statChanges` lists the stage changes PokéAPI records without saying whether they land on the user or the target, or when; `effectText` is the only place that says.
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

**Identifier forms:** Lookups accept canonical names, numeric IDs, and display spellings such as `Mr. Mime`, `Farfetch’d`, `Nidoran♀`, and `Poké Ball`. Search additionally maps the in-game egg-group names Field, Water 1/2/3, Grass, Human-Like, Amorphous, and Undiscovered to PokéAPI's `ground`, `water1`/`water2`/`water3`, `plant`, `humanshape`, `indeterminate`, and `no-eggs` names. A region with multiple dexes requires the specific dex name; no ambiguous region alias is selected for the caller.

**Evolution chain structure:** Recursive `chain.evolves_to[]` tree. The tree must be walked recursively to flatten into a linear or branching evolution path. Evolution triggers include `level-up` (with optional `min_level`, `min_happiness`), `use-item` (with `item.name`), `trade`, and others — surface the trigger and its condition. A stage may list several alternatives (a trigger plus its requirements each); the stage summary reads its first `is_default` alternative, else the first.

**Type damage keys:** `damage_relations.double_damage_to/from` (2×), `half_damage_to/from` (0.5×), `no_damage_to/from` (0×). For dual-type defensive matchup: multiply the two types' `*_from` multipliers together. Immunity (0×) in either type overrides all.
