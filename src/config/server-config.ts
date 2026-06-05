/**
 * @fileoverview Server-specific configuration for pokeapi-mcp-server.
 * @module config/server-config
 */

import { z } from '@cyanheads/mcp-ts-core';
import { parseEnvConfig } from '@cyanheads/mcp-ts-core/config';

const ServerConfigSchema = z.object({
  baseUrl: z
    .string()
    .default('https://pokeapi.co/api/v2')
    .describe('PokéAPI base URL — override for local mirrors or proxies'),
  cacheTtlSeconds: z.coerce
    .number()
    .default(21600)
    .describe('How long to cache PokéAPI responses in ctx.state (seconds)'),
  requestTimeoutMs: z.coerce
    .number()
    .default(10000)
    .describe('Per-request timeout in milliseconds'),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

let _config: ServerConfig | undefined;

export function getServerConfig(): ServerConfig {
  _config ??= parseEnvConfig(ServerConfigSchema, {
    baseUrl: 'POKEAPI_BASE_URL',
    cacheTtlSeconds: 'POKEAPI_CACHE_TTL_SECONDS',
    requestTimeoutMs: 'POKEAPI_REQUEST_TIMEOUT_MS',
  });
  return _config;
}
