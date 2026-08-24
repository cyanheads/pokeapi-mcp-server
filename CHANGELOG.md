# Changelog

All notable changes to this project. Each entry links to its full per-version file in [changelog/](changelog/).

## [0.1.8](changelog/0.1.x/0.1.8.md) — 2026-08-23

MCP SDK v2 and protocol 2026-07-28 support with stateless sessions, bounded PokéAPI requests, and formatter parity fixes.

## [0.1.7](changelog/0.1.x/0.1.7.md) — 2026-07-11

Patch release: adopts mcp-ts-core 0.10.14 and Bun supply-chain hardening (minimumReleaseAge, Socket scanner); fixes find-pokemon negative pagination (#7) and query-only notice rendering (#6), and get-type-matchups composed-multiplier documentation (#5).

## [0.1.6](changelog/0.1.x/0.1.6.md) — 2026-06-20

Maintenance: adopt mcp-ts-core ^0.10.9, re-sync framework scripts + vendored skills, add the check-dependency-specifiers devcheck step and plugin-manifest packaging checks. No tool or behavior changes.

## [0.1.5](changelog/0.1.x/0.1.5.md) — 2026-06-12

Adopt mcp-ts-core ^0.10.6: explicit name/title identity, ValidationError on input-guard tools, MCPB bundle hygiene, Dockerfile healthcheck

## [0.1.4](changelog/0.1.x/0.1.4.md) — 2026-06-06

Three bug fixes: mutual-exclusion guard on type/pokemon inputs, empty-result guidance mirrored to content[], variant-form species resolution

## [0.1.3](changelog/0.1.x/0.1.3.md) — 2026-06-06

Add public hosted endpoint at pokeapi.caseyjhand.com/mcp

## [0.1.2](changelog/0.1.x/0.1.2.md) — 2026-06-05

Document POKEAPI_BASE_URL self-hosting path per PokéAPI Fair Use Policy

## [0.1.1](changelog/0.1.x/0.1.1.md) — 2026-06-05 · 🛡️ Security

Initial public release — 7 tools and 2 resources over PokéAPI v2, with path-traversal hardening
