/**
 * @fileoverview Positive species resolution caching through the service and fetch seam.
 * @module tests/services/pokemon-resolution.test
 */
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createFetchMock,
  createInMemoryStorage,
  createMockContext,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getServerConfig } from '@/config/server-config.js';
import { getPokeApiService, initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';
import { handlerHttp, resolutionCaptures } from '../fixtures/handler-fixtures.js';

let http: ReturnType<typeof handlerHttp>;
beforeEach(() =>
  initPokeApiService({} as Parameters<typeof initPokeApiService>[0], createInMemoryStorage()),
);
afterEach(() => {
  http.restore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const dossier = (identifier: string, ctx = createMockContext()) =>
  getPokeApiService().getPokemonDossier(identifier, false, undefined, ctx);

describe('species resolution cache', () => {
  it('characterizes direct numeric and form identity before species resolution', async () => {
    http = handlerHttp();
    http.install();
    for (const identifier of ['386', 'deoxys-normal', 'wormadam-trash']) {
      const result = await dossier(identifier);
      expect(result.resolvedFromSpecies).toBeNull();
      expect(result.name).toBe(identifier === '386' ? 'deoxys-normal' : identifier);
    }
    expect(http.calls.filter((call) => call.request.url.endsWith('/pokemon/deoxys'))).toHaveLength(
      0,
    );
  });

  it.each([
    ['deoxys', 'deoxys-normal', 5],
    ['wormadam', 'wormadam-plant', 6],
  ] as const)(
    'makes zero warm requests for normalized species %s',
    async (identifier, name, coldCount) => {
      http = handlerHttp();
      http.install();
      const ctx = createMockContext();
      const cold = await dossier(identifier, ctx);
      expect(cold).toMatchObject({ name, resolvedFromSpecies: identifier });
      expect(http.calls).toHaveLength(coldCount);
      expect(await dossier(` ${identifier.toUpperCase()} `, ctx)).toEqual(cold);
      expect(http.calls).toHaveLength(coldCount);
    },
  );

  it('expires positive mappings with the configured response TTL', async () => {
    vi.useFakeTimers();
    http = handlerHttp();
    http.install();
    const ctx = createMockContext();
    await dossier('deoxys', ctx);
    const coldCount = http.calls.length;
    vi.setSystemTime(Date.now() + getServerConfig().cacheTtlSeconds * 1000 + 1);
    expect(await dossier(' DEOXYS ', ctx)).toMatchObject({ resolvedFromSpecies: 'deoxys' });
    expect(http.calls).toHaveLength(coldCount * 2);
    await dossier('deoxys', ctx);
    expect(http.calls).toHaveLength(coldCount * 2);
  });

  it('isolates resolution between tenants sharing one real storage backend', async () => {
    http = handlerHttp();
    http.install();
    const storage = createInMemoryStorage();
    const contexts = ['tenant-a', 'tenant-b'].map((tenantId) => {
      const ctx = createMockContext({ tenantId });
      const state: typeof ctx.state = {
        ...ctx.state,
        get: <T>(key: string) => storage.get<T>(key, ctx),
        set: (key, value, options) => storage.set(key, value, ctx, options),
      };
      return { ...ctx, state };
    });
    for (const ctx of contexts) {
      expect(await dossier('deoxys', ctx)).toMatchObject({ resolvedFromSpecies: 'deoxys' });
      await dossier(' DEOXYS ', ctx);
    }
    expect(http.calls.filter((call) => call.request.url.endsWith('/pokemon/deoxys'))).toHaveLength(
      2,
    );
    expect(http.calls).toHaveLength(10);
  });

  it('never caches unknown names or numeric misses', async () => {
    http = handlerHttp({
      'pokemon/missingno': new Response('', { status: 404 }),
      'pokemon-species/missingno': new Response('', { status: 404 }),
      'pokemon/99999': new Response('', { status: 404 }),
    });
    http.install();
    const ctx = createMockContext();
    const writes = vi.spyOn(ctx.state, 'set');
    for (let i = 0; i < 2; i++) {
      await expect(dossier('missingno', ctx)).rejects.toMatchObject({
        code: JsonRpcErrorCode.NotFound,
      });
      await expect(dossier('99999', ctx)).rejects.toMatchObject({
        code: JsonRpcErrorCode.NotFound,
      });
    }
    expect(http.calls).toHaveLength(6);
    expect(writes).not.toHaveBeenCalled();
  });

  it.each(['', ' ', '.', '..', 'x'.repeat(101), '\ud800', 'deoxys/normal', 'deoxys?x=1'])(
    'does not consult or write resolution state for unsafe identifier %j',
    async (identifier) => {
      http = createFetchMock(
        ['pokemon', 'pokemon-species'].map((resource) => ({
          match: `https://pokeapi.co/api/v2/${resource}/${encodeURIComponent(identifier.toWellFormed())}`,
          respond: () => new Response('', { status: 400 }),
        })),
      );
      http.install();
      const ctx = createMockContext();
      const reads = vi.spyOn(ctx.state, 'get');
      const writes = vi.spyOn(ctx.state, 'set');
      await expect(dossier(identifier, ctx)).rejects.toMatchObject({
        code: JsonRpcErrorCode.NotFound,
      });
      expect(reads).not.toHaveBeenCalled();
      expect(writes).not.toHaveBeenCalled();
      expect(http.calls).toHaveLength(identifier.includes('/') || identifier.includes('?') ? 2 : 0);
    },
  );

  it.each([
    ['missing default record', { 'pokemon/deoxys-normal': new Response('', { status: 404 }) }, 5],
    [
      'no default variety',
      {
        'pokemon-species/deoxys': {
          ...(resolutionCaptures['pokemon-species/deoxys'] as object),
          varieties: [],
        },
      },
      3,
    ],
  ] as const)('does not cache a resolution with %s', async (_case, overrides, requests) => {
    http = handlerHttp(overrides);
    http.install();
    const ctx = createMockContext();
    const writes = vi.spyOn(ctx.state, 'set');
    for (let i = 0; i < 2; i++)
      await expect(dossier('deoxys', ctx)).rejects.toMatchObject({
        code: JsonRpcErrorCode.NotFound,
      });
    expect(http.calls).toHaveLength(requests);
    expect(writes.mock.calls.map(([key]) => key)).not.toContain(
      'pokeapi/species-resolution/deoxys',
    );
  });

  it('runs real retry attempts and propagates an operational failure without fallback or caching', async () => {
    vi.useFakeTimers();
    http = createFetchMock([
      {
        match: 'https://pokeapi.co/api/v2/pokemon/deoxys',
        respond: () => new Response('Unavailable', { status: 503 }),
      },
    ]);
    http.install();
    const ctx = createMockContext();
    const writes = vi.spyOn(ctx.state, 'set');
    const failed = expect(dossier('deoxys', ctx)).rejects.toMatchObject({
      code: JsonRpcErrorCode.ServiceUnavailable,
    });
    await vi.runAllTimersAsync();
    await failed;
    expect(http.calls).toHaveLength(4);
    expect(writes).not.toHaveBeenCalled();
  });

  it.each([
    ['pokemon-species/deoxys', 10],
    ['pokemon/deoxys-normal', 11],
  ] as const)('never caches a failed fallback at %s after real retries', async (path, requests) => {
    vi.useFakeTimers();
    http = handlerHttp({ [path]: new Response('Unavailable', { status: 503 }) });
    http.install();
    const ctx = createMockContext();
    const writes = vi.spyOn(ctx.state, 'set');
    for (let i = 0; i < 2; i++) {
      const failed = expect(dossier('deoxys', ctx)).rejects.toMatchObject({
        code: JsonRpcErrorCode.ServiceUnavailable,
      });
      await vi.runAllTimersAsync();
      await failed;
    }
    expect(http.calls).toHaveLength(requests);
    expect(writes.mock.calls.map(([key]) => key)).not.toContain(
      'pokeapi/species-resolution/deoxys',
    );
  });
});
