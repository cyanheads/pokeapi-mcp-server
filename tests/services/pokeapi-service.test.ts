/**
 * @fileoverview PokéAPI identifier normalization, rejection, and cache-key rules.
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
    ['Poké Ball', 'poke-ball'],
    ["Farfetch'd", 'farfetchd'],
    ['Farfetch’d', 'farfetchd'],
    ['Mr. Mime', 'mr-mime'],
    ['Type: Null', 'type-null'],
    ['Nidoran♀', 'nidoran-f'],
    ['Nidoran♂', 'nidoran-m'],
    ['Flabe\u0301be\u0301', 'flabebe'],
    ["King's Shield", 'kings-shield'],
    ['0010100', '0010100'],
    [25, '25'],
    ['', ''],
    ['   ', ''],
  ])('trims, lowercases, and hyphenates %j to %j', (input, expected) => {
    expect(getPokeApiService().normalizeIdentifier(input)).toBe(expected);
  });

  it.each([
    ['Missing/Type Value', 'missing/type-value'],
    ['Flabébé', 'flabebe'],
    ['a?b=c#d', 'a?b=c#d'],
    ['A%2Fb', 'a%2fb'],
    ['..', ''],
  ])('leaves %j unencoded as %j and is idempotent', (input, expected) => {
    const svc = getPokeApiService();
    const once = svc.normalizeIdentifier(input);
    expect(once).toBe(expected);
    expect(svc.normalizeIdentifier(once)).toBe(expected);
  });

  it('scales linearly on caller-sized text', () => {
    const svc = getPokeApiService();
    const measure = (input: string, repeats: number) => {
      const start = process.threadCpuUsage();
      for (let i = 0; i < repeats; i++) svc.normalizeIdentifier(input);
      const { user, system } = process.threadCpuUsage(start);
      return (user + system) / repeats;
    };
    const baseline = '8'.repeat(1_250);
    for (let size = 2_500; size <= 80_000; size *= 2) {
      const input = '8'.repeat(size);
      const pairs = Array.from({ length: 5 }, () => {
        const small = measure(baseline, 64);
        const large = measure(input, 1);
        return { growth: large / Math.max(small, 1), large };
      });
      expect(Math.min(...pairs.map(({ growth }) => growth))).toBeLessThan(256);
      expect(Math.min(...pairs.map(({ large }) => large))).toBeLessThan(100_000);
    }
    for (const size of [5_000, 20_000, 80_000]) {
      for (const input of [
        '('.repeat(size),
        '((a'.repeat(size / 3),
        'a'.repeat(size) + '\n',
        'a\n'.repeat(size / 2),
        'e\u0301'.repeat(size / 2),
      ]) {
        expect(measure(input, 1)).toBeLessThan(100_000);
      }
    }
  });
});

describe('upstream path and cache key', () => {
  it.each(FETCHERS)(
    '%s rejects a path separator before storage and upstream I/O',
    async (method) => {
      const http = notFoundHttp();
      http.install();
      try {
        const svc = getPokeApiService();
        await expect(
          svc[method](' Missing/Type Value ', createMockContext()),
        ).rejects.toMatchObject({
          code: JsonRpcErrorCode.NotFound,
        });
        expect(http.calls).toHaveLength(0);
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

  it.each(['hárdy', 'har.dy'])(
    'caches a display spelling under the canonical key: %j',
    async (identifier) => {
      const http = natureHttp('hardy');
      http.install();
      try {
        const svc = getPokeApiService();
        const ctx = createMockContext();
        expect(await svc.fetchNature(identifier, ctx)).toEqual({ id: 1, name: 'hardy' });
        expect(await svc.fetchNature(identifier, ctx)).toEqual({ id: 1, name: 'hardy' });
        expect(http.calls.map((call) => call.request.url)).toEqual([`${BASE}/nature/hardy`]);
        expect(await ctx.state.get('pokeapi/nature/hardy')).toEqual({ id: 1, name: 'hardy' });
      } finally {
        http.restore();
      }
    },
  );
});
