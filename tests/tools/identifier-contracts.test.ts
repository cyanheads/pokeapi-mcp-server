/**
 * @fileoverview Identifier encoding, rejection, and declared-reason contracts for every lookup surface.
 * @module tests/tools/identifier-contracts.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createFetchMock,
  createInMemoryStorage,
  createMockContext,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { pokemonResource } from '@/mcp-server/resources/definitions/pokemon.resource.js';
import { typeResource } from '@/mcp-server/resources/definitions/type.resource.js';
import { findPokemon } from '@/mcp-server/tools/definitions/find-pokemon.tool.js';
import { getAbility } from '@/mcp-server/tools/definitions/get-ability.tool.js';
import { getItem } from '@/mcp-server/tools/definitions/get-item.tool.js';
import { getMove } from '@/mcp-server/tools/definitions/get-move.tool.js';
import { getNature } from '@/mcp-server/tools/definitions/get-nature.tool.js';
import { getPokemon } from '@/mcp-server/tools/definitions/get-pokemon.tool.js';
import { getTypeMatchups } from '@/mcp-server/tools/definitions/get-type-matchups.tool.js';
import { initPokeApiService, MAX_IDENTIFIER_LENGTH } from '@/services/pokeapi/pokeapi-service.js';

const BASE = 'https://pokeapi.co/api/v2';
const OVERLONG = 'a'.repeat(MAX_IDENTIFIER_LENGTH + 1);
/** A lone UTF-16 surrogate has no URL encoding. */
const UNENCODABLE = 'pika\uD800chu';
const REJECTED = ['   ', '.', '..', ' .. ', OVERLONG, UNENCODABLE];

type ToolResult = Awaited<ReturnType<typeof runToolContract>>;

function recoveryOf(
  errors: readonly { reason: string; recovery: string }[] | undefined,
  reason: string,
): string {
  const entry = errors?.find((candidate) => candidate.reason === reason);
  if (!entry) throw new Error(`No ${reason} contract declared`);
  return entry.recovery;
}

/** Every tool that resolves one identifier, with the upstream paths a miss requests in order. */
const LOOKUPS = [
  {
    name: 'pokeapi_get_pokemon',
    run: (identifier: string) => runToolContract(getPokemon, { identifier }),
    paths: ['pokemon', 'pokemon-species'],
    recovery: recoveryOf(getPokemon.errors, 'not_found'),
  },
  {
    name: 'pokeapi_get_ability',
    run: (identifier: string) => runToolContract(getAbility, { identifier }),
    paths: ['ability'],
    recovery: recoveryOf(getAbility.errors, 'not_found'),
  },
  {
    name: 'pokeapi_get_item',
    run: (identifier: string) => runToolContract(getItem, { identifier }),
    paths: ['item'],
    recovery: recoveryOf(getItem.errors, 'not_found'),
  },
  {
    name: 'pokeapi_get_move',
    run: (identifier: string) => runToolContract(getMove, { identifier }),
    paths: ['move'],
    recovery: recoveryOf(getMove.errors, 'not_found'),
  },
  {
    name: 'pokeapi_get_nature',
    run: (identifier: string) => runToolContract(getNature, { identifier }),
    paths: ['nature'],
    recovery: recoveryOf(getNature.errors, 'not_found'),
  },
  {
    name: 'pokeapi_get_type_matchups (type)',
    run: (identifier: string) => runToolContract(getTypeMatchups, { type: identifier }),
    paths: ['type'],
    recovery: recoveryOf(getTypeMatchups.errors, 'not_found'),
  },
  {
    name: 'pokeapi_get_type_matchups (pokemon)',
    run: (identifier: string) => runToolContract(getTypeMatchups, { pokemon: identifier }),
    paths: ['pokemon'],
    recovery: recoveryOf(getTypeMatchups.errors, 'not_found'),
  },
];

const RESOURCES = [
  {
    name: 'pokeapi://pokemon/{identifier}',
    read: (identifier: string) =>
      pokemonResource.handler(
        { identifier },
        createMockContext({ errors: pokemonResource.errors }),
      ),
    paths: ['pokemon', 'pokemon-species'],
  },
  {
    name: 'pokeapi://type/{typeName}',
    read: (typeName: string) =>
      typeResource.handler({ typeName }, createMockContext({ errors: typeResource.errors })),
    paths: ['type'],
  },
];

function notFoundHttp() {
  return createFetchMock([
    {
      match: /^https:\/\/pokeapi\.co\/api\/v2\//,
      respond: () => new Response('Not Found', { status: 404 }),
    },
  ]);
}

/** PokéAPI answers 400, not 404, to a path segment that carries percent-encoding. */
function badRequestHttp() {
  return createFetchMock([
    {
      match: /^https:\/\/pokeapi\.co\/api\/v2\//,
      respond: (request) =>
        request.url.includes('%')
          ? new Response('Bad Request', { status: 400 })
          : new Response('Not Found', { status: 404 }),
    },
  ]);
}

function textOf(result: ToolResult) {
  return result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

function expectDeclared(result: ToolResult, code: JsonRpcErrorCode, reason: string, hint: string) {
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({
    error: { code, data: { reason, recovery: { hint } } },
  });
  expect(textOf(result)).toContain(hint);
  expect(JSON.stringify(result)).not.toContain('pokeapi/');
}

beforeEach(() => {
  initPokeApiService({} as Parameters<typeof initPokeApiService>[0], createInMemoryStorage());
});

describe('lookup tools', () => {
  it.each(LOOKUPS)('$name encodes the identifier once and returns not_found', async (lookup) => {
    const http = notFoundHttp();
    http.install();
    try {
      const result = await lookup.run(' Missing/Type Value ');
      expect(http.calls.map((call) => call.request.url)).toEqual(
        lookup.paths.map((path) => `${BASE}/${path}/missing%2Ftype-value`),
      );
      expectDeclared(result, JsonRpcErrorCode.NotFound, 'not_found', lookup.recovery);
    } finally {
      http.restore();
    }
  });

  it.each([
    ['flabébé', 'flab%C3%A9b%C3%A9'],
    ['a?b=c#d', 'a%3Fb%3Dc%23d'],
    ['A%2Fb', 'a%252fb'],
    ['../type/fire', '..%2Ftype%2Ffire'],
  ])('pokeapi_get_ability sends %j as the single path segment %j', async (identifier, segment) => {
    const http = notFoundHttp();
    http.install();
    try {
      const result = await runToolContract(getAbility, { identifier });
      expect(http.calls.map((call) => call.request.url)).toEqual([`${BASE}/ability/${segment}`]);
      expectDeclared(
        result,
        JsonRpcErrorCode.NotFound,
        'not_found',
        recoveryOf(getAbility.errors, 'not_found'),
      );
    } finally {
      http.restore();
    }
  });

  it.each(LOOKUPS)(
    '$name rejects blank, dot, overlong, and unencodable identifiers without a request',
    async (lookup) => {
      const http = notFoundHttp();
      http.install();
      try {
        for (const identifier of REJECTED) {
          expectDeclared(
            await lookup.run(identifier),
            JsonRpcErrorCode.NotFound,
            'not_found',
            lookup.recovery,
          );
        }
        expect(http.calls).toHaveLength(0);
      } finally {
        http.restore();
      }
    },
  );

  it('rejects an empty identifier without a request where the identifier is required', async () => {
    const http = notFoundHttp();
    http.install();
    try {
      for (const lookup of LOOKUPS.slice(0, 4)) {
        expectDeclared(
          await lookup.run(''),
          JsonRpcErrorCode.NotFound,
          'not_found',
          lookup.recovery,
        );
      }
      expect(http.calls).toHaveLength(0);
    } finally {
      http.restore();
    }
  });

  it('returns a record for an identifier outside [a-z0-9-] that upstream accepts', async () => {
    const http = createFetchMock([
      {
        match: (request) => request.url === `${BASE}/nature/h%C3%A1rdy`,
        respond: () => Response.json({ id: 1, name: 'hardy' }),
      },
    ]);
    http.install();
    try {
      const result = await runToolContract(getNature, { identifier: ' Hárdy ' });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        isListAll: false,
        natures: [{ id: 1, name: 'hardy' }],
      });
      expect(textOf(result)).toContain('hardy');
      expect(http.calls).toHaveLength(1);
    } finally {
      http.restore();
    }
  });
});

describe('resources', () => {
  it.each(RESOURCES)('$name encodes the identifier once and fails as not_found', async (entry) => {
    const http = notFoundHttp();
    http.install();
    try {
      await expect(entry.read(' Missing/Type Value ')).rejects.toMatchObject({
        code: JsonRpcErrorCode.NotFound,
        data: { reason: 'not_found' },
      });
      expect(http.calls.map((call) => call.request.url)).toEqual(
        entry.paths.map((path) => `${BASE}/${path}/missing%2Ftype-value`),
      );
    } finally {
      http.restore();
    }
  });

  it.each(RESOURCES)(
    '$name rejects blank, dot, overlong, and unencodable identifiers without a request',
    async (entry) => {
      const http = notFoundHttp();
      http.install();
      try {
        for (const identifier of ['', ...REJECTED]) {
          await expect(entry.read(identifier)).rejects.toMatchObject({
            code: JsonRpcErrorCode.NotFound,
            data: { reason: 'not_found' },
          });
        }
        expect(http.calls).toHaveLength(0);
      } finally {
        http.restore();
      }
    },
  );
});

describe('upstream 400 for an identifier that needs encoding', () => {
  it.each(LOOKUPS)('$name returns not_found after one request per path', async (lookup) => {
    const http = badRequestHttp();
    http.install();
    try {
      const result = await lookup.run('a/b');
      expectDeclared(result, JsonRpcErrorCode.NotFound, 'not_found', lookup.recovery);
      expect(JSON.stringify(result)).not.toContain('Fetch failed');
      expect(http.calls.map((call) => call.request.url)).toEqual(
        lookup.paths.map((path) => `${BASE}/${path}/a%2Fb`),
      );
    } finally {
      http.restore();
    }
  });

  it.each(RESOURCES)('$name fails as not_found', async (entry) => {
    const http = badRequestHttp();
    http.install();
    try {
      await expect(entry.read('flabébé')).rejects.toMatchObject({
        code: JsonRpcErrorCode.NotFound,
        data: { reason: 'not_found' },
      });
      expect(http.calls.map((call) => call.request.url)).toEqual(
        entry.paths.map((path) => `${BASE}/${path}/flab%C3%A9b%C3%A9`),
      );
    } finally {
      http.restore();
    }
  });

  it.each([
    ['type', 'type'],
    ['generation', 'generation'],
    ['pokedex', 'pokedex'],
    ['egg_group', 'egg-group'],
  ] as const)(
    'pokeapi_find_pokemon returns invalid_filter for the %s filter',
    async (key, path) => {
      const http = badRequestHttp();
      http.install();
      try {
        expectDeclared(
          await runToolContract(findPokemon, { [key]: 'a/b' }),
          JsonRpcErrorCode.ValidationError,
          'invalid_filter',
          recoveryOf(findPokemon.errors, 'invalid_filter'),
        );
        expect(http.calls.map((call) => call.request.url)).toEqual([`${BASE}/${path}/a%2Fb`]);
      } finally {
        http.restore();
      }
    },
  );

  it('keeps a 400 for an identifier in PokéAPI’s own alphabet as an upstream failure', async () => {
    const http = createFetchMock([
      {
        match: `${BASE}/ability/levitate`,
        respond: () => new Response('Bad Request', { status: 400 }),
      },
    ]);
    http.install();
    try {
      const result = await runToolContract(getAbility, { identifier: 'levitate' });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.InvalidParams },
      });
      expect(result.structuredContent).not.toMatchObject({
        error: { data: { reason: 'not_found' } },
      });
    } finally {
      http.restore();
    }
  });
});

describe('pokeapi_find_pokemon category filters', () => {
  it.each(['type', 'generation', 'pokedex', 'egg_group'] as const)(
    'rejects a dot, overlong, or unencodable %s filter as invalid_filter without a request',
    async (key) => {
      const http = notFoundHttp();
      http.install();
      try {
        for (const value of ['.', '..', ' .. ', OVERLONG, UNENCODABLE]) {
          expectDeclared(
            await runToolContract(findPokemon, { [key]: value }),
            JsonRpcErrorCode.ValidationError,
            'invalid_filter',
            recoveryOf(findPokemon.errors, 'invalid_filter'),
          );
        }
        expect(http.calls).toHaveLength(0);
      } finally {
        http.restore();
      }
    },
  );

  it('fails the whole call on one rejected filter before fetching the valid ones after it', async () => {
    const http = notFoundHttp();
    http.install();
    try {
      expectDeclared(
        await runToolContract(findPokemon, { generation: '..', egg_group: 'monster' }),
        JsonRpcErrorCode.ValidationError,
        'invalid_filter',
        recoveryOf(findPokemon.errors, 'invalid_filter'),
      );
      expect(http.calls).toHaveLength(0);
    } finally {
      http.restore();
    }
  });
});
