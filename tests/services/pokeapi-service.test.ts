/**
 * @fileoverview PokeApiService identifier normalization, upstream encoding, and cache-key rules.
 * @module tests/services/pokeapi-service.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createFetchMock,
  createInMemoryStorage,
  createMockContext,
} from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getPokeApiService,
  initPokeApiService,
  MAX_IDENTIFIER_LENGTH,
} from '@/services/pokeapi/pokeapi-service.js';

const BASE = 'https://pokeapi.co/api/v2';
const FETCHERS = [
  ['fetchPokemon', 'pokemon'],
  ['fetchSpecies', 'pokemon-species'],
  ['fetchAbility', 'ability'],
  ['fetchType', 'type'],
  ['fetchMove', 'move'],
  ['fetchItem', 'item'],
  ['fetchNature', 'nature'],
  ['fetchGeneration', 'generation'],
  ['fetchPokedex', 'pokedex'],
  ['fetchEggGroup', 'egg-group'],
] as const;

function notFoundHttp() {
  return createFetchMock([
    {
      match: /^https:\/\/pokeapi\.co\/api\/v2\//,
      respond: () => new Response('Not Found', { status: 404 }),
    },
  ]);
}

function natureHttp(...paths: string[]) {
  return createFetchMock(
    paths.map((path) => ({
      match: (request: Request) => request.url === `${BASE}/nature/${path}`,
      respond: () => Response.json({ id: 1, name: 'hardy' }),
    })),
  );
}

beforeEach(() => {
  initPokeApiService({} as Parameters<typeof initPokeApiService>[0], createInMemoryStorage());
});

describe('normalizeIdentifier', () => {
  it.each([
    [' Mr  Mime ', 'mr-mime'],
    ['FIRE', 'fire'],
    ['Generation\tI', 'generation-i'],
    [25, '25'],
    ['', ''],
    ['   ', ''],
  ])('trims, lowercases, and hyphenates %j to %j', (input, expected) => {
    expect(getPokeApiService().normalizeIdentifier(input)).toBe(expected);
  });

  it.each([
    ['Missing/Type Value', 'missing/type-value'],
    ['Flabébé', 'flabébé'],
    ['a?b=c#d', 'a?b=c#d'],
    ['A%2Fb', 'a%2fb'],
    ['..', '..'],
  ])('leaves %j unencoded as %j and is idempotent', (input, expected) => {
    const svc = getPokeApiService();
    const once = svc.normalizeIdentifier(input);
    expect(once).toBe(expected);
    expect(svc.normalizeIdentifier(once)).toBe(expected);
  });
});

describe('upstream path and cache key', () => {
  it.each(FETCHERS)(
    '%s encodes the identifier exactly once in the request path',
    async (method, path) => {
      const http = notFoundHttp();
      http.install();
      try {
        const svc = getPokeApiService();
        await expect(
          svc[method](' Missing/Type Value ', createMockContext()),
        ).rejects.toMatchObject({
          code: JsonRpcErrorCode.NotFound,
        });
        expect(http.calls.map((call) => call.request.url)).toEqual([
          `${BASE}/${path}/missing%2Ftype-value`,
        ]);
      } finally {
        http.restore();
      }
    },
  );

  it.each(FETCHERS)(
    '%s rejects blank, dot, overlong, and unencodable identifiers without a request',
    async (method) => {
      const http = notFoundHttp();
      http.install();
      try {
        const svc = getPokeApiService();
        for (const identifier of [
          '',
          '   ',
          '.',
          '..',
          ' .. ',
          'a'.repeat(MAX_IDENTIFIER_LENGTH + 1),
          'é'.repeat(MAX_IDENTIFIER_LENGTH + 1),
          'pika\uD800chu',
        ]) {
          const failure = await svc[method](identifier, createMockContext()).catch((err) => err);
          expect(failure).toMatchObject({ code: JsonRpcErrorCode.NotFound });
          expect(JSON.stringify(failure.data ?? {})).not.toContain('pokeapi/');
        }
        expect(http.calls).toHaveLength(0);
      } finally {
        http.restore();
      }
    },
  );

  it('sends an identifier at the length bound and stops one character past it', async () => {
    const http = notFoundHttp();
    http.install();
    try {
      const svc = getPokeApiService();
      const atBound = 'a'.repeat(MAX_IDENTIFIER_LENGTH);
      await expect(svc.fetchNature(atBound, createMockContext())).rejects.toMatchObject({
        code: JsonRpcErrorCode.NotFound,
      });
      expect(http.calls.map((call) => call.request.url)).toEqual([`${BASE}/nature/${atBound}`]);
      await expect(svc.fetchNature(`${atBound}a`, createMockContext())).rejects.toMatchObject({
        code: JsonRpcErrorCode.NotFound,
      });
      expect(http.calls).toHaveLength(1);
    } finally {
      http.restore();
    }
  });

  it('caches a canonical identifier under its normalized name', async () => {
    const http = natureHttp('hardy');
    http.install();
    try {
      const svc = getPokeApiService();
      const ctx = createMockContext();
      const first = await svc.fetchNature('hardy', ctx);
      const second = await svc.fetchNature(' HARDY ', ctx);
      expect(second).toEqual(first);
      expect(http.calls.map((call) => call.request.url)).toEqual([`${BASE}/nature/hardy`]);
      expect(await ctx.state.get('pokeapi/nature/hardy')).toEqual({ id: 1, name: 'hardy' });
    } finally {
      http.restore();
    }
  });

  it.each([
    ['hárdy', 'h%C3%A1rdy'],
    ['har_dy', 'har_dy'],
    ['har.dy', 'har.dy'],
    ['har/dy', 'har%2Fdy'],
  ])(
    'fetches an accepted identifier outside [a-z0-9-] every time: %j',
    async (identifier, path) => {
      const http = natureHttp(path);
      http.install();
      try {
        const svc = getPokeApiService();
        const ctx = createMockContext();
        expect(await svc.fetchNature(identifier, ctx)).toEqual({ id: 1, name: 'hardy' });
        expect(await svc.fetchNature(identifier, ctx)).toEqual({ id: 1, name: 'hardy' });
        expect(http.calls.map((call) => call.request.url)).toEqual([
          `${BASE}/nature/${path}`,
          `${BASE}/nature/${path}`,
        ]);
        expect((await ctx.state.list('pokeapi/')).items).toEqual([]);
      } finally {
        http.restore();
      }
    },
  );
});
