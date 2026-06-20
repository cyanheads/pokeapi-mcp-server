<div align="center">
  <h1>@cyanheads/pokeapi-mcp-server</h1>
  <p><b>Look up Pokémon, moves, abilities, items, natures, and type matchups from PokéAPI v2 via MCP. STDIO or Streamable HTTP.</b>
  <div>7 Tools • 2 Resources</div>
  </p>
</div>

<div align="center">

[![Version](https://img.shields.io/badge/Version-0.1.6-blue.svg?style=flat-square)](./CHANGELOG.md) [![License](https://img.shields.io/badge/License-Apache%202.0-orange.svg?style=flat-square)](./LICENSE) [![Docker](https://img.shields.io/badge/Docker-ghcr.io-2496ED?style=flat-square&logo=docker&logoColor=white)](https://github.com/users/cyanheads/packages/container/package/pokeapi-mcp-server) [![MCP SDK](https://img.shields.io/badge/MCP%20SDK-^1.29.0-green.svg?style=flat-square)](https://modelcontextprotocol.io/) [![npm](https://img.shields.io/npm/v/@cyanheads/pokeapi-mcp-server?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/@cyanheads/pokeapi-mcp-server) [![TypeScript](https://img.shields.io/badge/TypeScript-^5.9.3-3178C6.svg?style=flat-square)](https://www.typescriptlang.org/) [![Bun](https://img.shields.io/badge/Bun-v1.3.11-blueviolet.svg?style=flat-square)](https://bun.sh/)

</div>

<div align="center">

[![Install in Claude Desktop](https://img.shields.io/badge/Install_in-Claude_Desktop-D97757?style=for-the-badge&logo=anthropic&logoColor=white)](https://github.com/cyanheads/pokeapi-mcp-server/releases/latest/download/pokeapi-mcp-server.mcpb) [![Install in Cursor](https://cursor.com/deeplink/mcp-install-dark.svg)](https://cursor.com/en/install-mcp?name=pokeapi-mcp-server&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsIkBjeWFuaGVhZHMvcG9rZWFwaS1tY3Atc2VydmVyIl19) [![Install in VS Code](https://img.shields.io/badge/VS_Code-Install_Server-0098FF?style=for-the-badge&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode:mcp/install?%7B%22name%22%3A%22pokeapi-mcp-server%22%2C%22command%22%3A%22npx%22%2C%22args%22%3A%5B%22-y%22%2C%22%40cyanheads%2Fpokeapi-mcp-server%22%5D%7D)

[![Framework](https://img.shields.io/badge/Built%20on-@cyanheads/mcp--ts--core-67E8F9?style=flat-square)](https://www.npmjs.com/package/@cyanheads/mcp-ts-core)

</div>

<div align="center">

**Public Hosted Server:** [https://pokeapi.caseyjhand.com/mcp](https://pokeapi.caseyjhand.com/mcp)

</div>

---

## Tools

Seven tools covering the full PokéAPI v2 surface — a flagship consolidation tool, a computed matchup tool, single-resource lookups, and a filter tool:

| Tool | Description |
|:-----|:------------|
| `pokeapi_get_pokemon` | Denormalized Pokémon dossier in one call: base stats, types, abilities with effect text, height/weight, evolution chain, learnable moves, sprites, species flavor text, and variant list |
| `pokeapi_get_type_matchups` | Computed offensive and defensive type effectiveness — for a type name or Pokémon identifier; correctly composes dual-type matchups |
| `pokeapi_get_move` | Move details: type, damage class, power, accuracy, PP, priority, target, stat changes, status-effect chance, and full English effect text |
| `pokeapi_get_ability` | Ability details: full and short English effect text, and the Pokémon that have it (with hidden-ability flag and slot) |
| `pokeapi_get_item` | Item details: effect text, category, cost, fling power, attributes, and Pokémon that commonly hold it |
| `pokeapi_get_nature` | Nature details: stat boost/penalty, preferred and disliked berry flavor. Returns all 25 natures when called without an identifier |
| `pokeapi_find_pokemon` | Filter Pokémon by generation, type, pokédex, or egg group; also resolves fuzzy name queries to canonical entries |

### `pokeapi_get_pokemon`

The flagship tool — fans out across the PokéAPI resource graph in parallel and returns one denormalized dossier, replacing 10–30 sub-resource GETs.

- Fetches `/pokemon`, `/pokemon-species`, `/evolution-chain`, and each `/ability` in a two-tier parallel fan-out
- Includes sprites (with `official-artwork` high-quality art URL), `is_legendary`, `is_mythical`, `capture_rate`, `growth_rate`, `gender_rate`
- `include_moves` (default `false`) — set to `true` for a summarized learnable-move list filtered to the latest generation
- `game_version` string to select flavor text by game (e.g. `"sword"`, `"red"`) — silently falls back to first available when no match
- Surfaces the variant list so callers can re-call with a specific form name (regional forms, Gigantamax, Mega, etc.)

---

### `pokeapi_get_type_matchups`

Computed type effectiveness — pass a type name or Pokémon identifier to get the full offensive and defensive breakdown with multiplier values.

- For dual-type Pokémon: composes both type defensive relations correctly (immune in either type wins)
- Returns `superEffective`, `resistant`, and `immune` lists for both offense and defense
- Accepts either `type` (type name) or `pokemon` (name or dex number) — exactly one required

---

### `pokeapi_find_pokemon`

Filter Pokémon by multiple criteria — returns names and dex numbers for follow-up `pokeapi_get_pokemon` calls.

- Filters: `generation` (e.g. `"generation-i"`), `type` (e.g. `"fire"`), `pokedex` (e.g. `"kanto"`), `egg_group` (e.g. `"fairy"`)
- `query` parameter for fuzzy name search
- Pagination via `limit` and `offset`

---

## Resources and prompts

| Type | Name | Description |
|:-----|:-----|:------------|
| Resource | `pokeapi://pokemon/{identifier}` | Pokémon dossier by name or dex number — same payload as `pokeapi_get_pokemon` without moves |
| Resource | `pokeapi://type/{typeName}` | Type damage relations — raw multiplier table, offensive and defensive |

All resource data is also reachable via tools.

---

## Features

Built on [`@cyanheads/mcp-ts-core`](https://www.npmjs.com/package/@cyanheads/mcp-ts-core):

- Declarative tool and resource definitions — single file per primitive, framework handles registration and validation
- Unified error handling — handlers throw, framework catches, classifies, and formats
- Pluggable auth: `none`, `jwt`, `oauth`
- Swappable storage backends: `in-memory`, `filesystem`, `Supabase`, `Cloudflare KV/R2/D1`
- Structured logging with optional OpenTelemetry tracing
- STDIO and Streamable HTTP transports

PokéAPI-specific:

- Keyless and read-only — no API key, no auth, no configuration required to run
- Graph-walk consolidation — `pokeapi_get_pokemon` fans out across `/pokemon`, `/pokemon-species`, `/evolution-chain`, and N `/ability` endpoints in two parallel tiers, returning one object
- Aggressive caching — PokéAPI data is static game data; responses are cached in `ctx.state` with a configurable TTL (default 6 h) to respect PokéAPI's fair-use policy
- Input normalization — accepts lowercase-hyphenated names or numeric IDs; strips and lowercases user input before fetching
- English-first — `effect_entries` and `flavor_text_entries` are always filtered to `language.name === 'en'`; absent entries surface as `null` rather than a foreign-language string

Agent-friendly output:

- Dual-type composition — `pokeapi_get_type_matchups` computes the effective matchup matrix from raw damage relations, so agents get a direct answer rather than raw tables to multiply
- Variant surface — `pokeapi_get_pokemon` lists all form variants so agents can identify and re-call with specific forms (Alolan, Galarian, Mega, Gigantamax)
- Sparse-safe nullable fields — upstream absent fields surface as `null` rather than crashing or returning a fabricated default

---

## Getting started

### Public Hosted Instance

A public instance is available at `https://pokeapi.caseyjhand.com/mcp` — no installation required. Point any MCP client at it via Streamable HTTP:

```json
{
  "mcpServers": {
    "pokeapi-mcp-server": {
      "type": "streamable-http",
      "url": "https://pokeapi.caseyjhand.com/mcp"
    }
  }
}
```

### Self-Hosted / Local

No API key required. Add the following to your MCP client configuration file:

```json
{
  "mcpServers": {
    "pokeapi-mcp-server": {
      "type": "stdio",
      "command": "bunx",
      "args": ["@cyanheads/pokeapi-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with npx (no Bun required):

```json
{
  "mcpServers": {
    "pokeapi-mcp-server": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@cyanheads/pokeapi-mcp-server@latest"],
      "env": {
        "MCP_TRANSPORT_TYPE": "stdio",
        "MCP_LOG_LEVEL": "info"
      }
    }
  }
}
```

Or with Docker:

```json
{
  "mcpServers": {
    "pokeapi-mcp-server": {
      "type": "stdio",
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "MCP_TRANSPORT_TYPE=stdio",
        "ghcr.io/cyanheads/pokeapi-mcp-server:latest"
      ]
    }
  }
}
```

For Streamable HTTP, set the transport and start the server:

```sh
MCP_TRANSPORT_TYPE=http MCP_HTTP_PORT=3010 bun run start:http
# Server listens at http://localhost:3010/mcp
```

### Prerequisites

- [Bun v1.3.0](https://bun.sh/) or higher (or Node.js v24+).
- No API key required — PokéAPI is fully public.

### Installation

1. **Clone the repository:**

```sh
git clone https://github.com/cyanheads/pokeapi-mcp-server.git
```

2. **Navigate into the directory:**

```sh
cd pokeapi-mcp-server
```

3. **Install dependencies:**

```sh
bun install
```

4. **Configure environment (optional):**

```sh
cp .env.example .env
# All vars are optional — the server works with defaults
```

---

## Configuration

| Variable | Description | Default |
|:---------|:------------|:--------|
| `POKEAPI_BASE_URL` | PokéAPI base URL — override for local mirrors or proxies. | `https://pokeapi.co/api/v2` |
| `POKEAPI_CACHE_TTL_SECONDS` | How long to cache PokéAPI responses (seconds). | `21600` (6 h) |
| `POKEAPI_REQUEST_TIMEOUT_MS` | Per-request timeout in milliseconds. | `10000` |
| `MCP_TRANSPORT_TYPE` | Transport: `stdio` or `http`. | `stdio` |
| `MCP_HTTP_PORT` | Port for HTTP server. | `3010` |
| `MCP_AUTH_MODE` | Auth mode: `none`, `jwt`, or `oauth`. | `none` |
| `MCP_LOG_LEVEL` | Log level (RFC 5424). | `info` |
| `LOGS_DIR` | Directory for log files (Node.js only). | `<project-root>/logs` |
| `OTEL_ENABLED` | Enable [OpenTelemetry instrumentation](https://github.com/cyanheads/mcp-ts-core/tree/main/docs/telemetry). | `false` |

See [`.env.example`](./.env.example) for the full list of optional overrides.

### Self-hosting for high-volume use

PokéAPI's [Fair Use Policy](https://pokeapi.co/docs/v2#fairuse) asks consumers to cache aggressively and points high-volume deployments toward running a local instance. This server already caches responses for 6 hours by default (`POKEAPI_CACHE_TTL_SECONDS`), which covers most workloads. For hosted or batch-heavy deployments, run the [official PokéAPI Docker image](https://github.com/PokeAPI/pokeapi) locally and point `POKEAPI_BASE_URL` at it — the server switches transparently.

---

## Running the server

### Local development

- **Build and run:**

  ```sh
  bun run rebuild

  bun run start:stdio
  # or
  bun run start:http
  ```

- **Run checks and tests:**

  ```sh
  bun run devcheck   # Lint, format, typecheck, security
  bun run test       # Vitest test suite
  bun run lint:mcp   # Validate MCP definitions against spec
  ```

### Docker

```sh
docker build -t pokeapi-mcp-server .
docker run --rm -p 3010:3010 pokeapi-mcp-server
```

The Dockerfile defaults to HTTP transport, stateless session mode, and logs to `/var/log/pokeapi-mcp-server`. Build with `--build-arg OTEL_ENABLED=false` to omit OpenTelemetry peer dependencies.

---

## Project structure

| Path | Purpose |
|:-----|:--------|
| `src/index.ts` | `createApp()` entry point — registers tools, resources, and inits services. |
| `src/config/` | Server-specific env var parsing with Zod (`server-config.ts`). |
| `src/mcp-server/tools/` | Tool definitions (`*.tool.ts`). |
| `src/mcp-server/resources/` | Resource definitions (`*.resource.ts`). |
| `src/services/pokeapi/` | `PokeApiService` — typed fetch methods, caching, retry, timeout. |
| `tests/` | Vitest test suite mirroring `src/`. |

---

## Development guide

See [`CLAUDE.md`](./CLAUDE.md) for development guidelines and architectural rules. The short version:

- Handlers throw, framework catches — no `try/catch` in tool logic
- Use `ctx.log` for request-scoped logging, `ctx.state` for tenant-scoped storage (and caching)
- Register new tools and resources via the barrels in `src/mcp-server/*/definitions/index.ts`
- Wrap external API calls: validate raw → normalize to domain type → return output schema; never fabricate missing fields

---

## Contributing

Issues and pull requests are welcome. Run checks and tests before submitting:

```sh
bun run devcheck
bun run test
```

---

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
