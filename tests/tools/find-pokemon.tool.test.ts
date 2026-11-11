/**
 * @fileoverview Tests for pokeapi_find_pokemon tool.
 * @module tests/tools/find-pokemon.tool.test
 */

import { JsonRpcErrorCode, McpError } from '@cyanheads/mcp-ts-core/errors';
import {
  createFetchMock,
  createInMemoryStorage,
  createMockContext,
  getEnrichment,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { findPokemon } from '@/mcp-server/tools/definitions/find-pokemon.tool.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';
import { handlerHttp } from '../fixtures/handler-fixtures.js';

const mockAppConfig = {} as Parameters<typeof initPokeApiService>[0];
const mockStorage = createInMemoryStorage();
let http: ReturnType<typeof handlerHttp>;
afterEach(() => http.restore());

describe('findPokemon', () => {
  beforeEach(() => {
    http = handlerHttp();
    http.install();
    initPokeApiService(mockAppConfig, mockStorage);
  });

  it('filters Pokémon by generation', async () => {
    const ctx = createMockContext({ errors: findPokemon.errors, tenantId: 'test-tenant' });
    const input = findPokemon.input.parse({ generation: 'generation-i' });
    const result = await findPokemon.handler(input, ctx);

    expect(result.totalCount).toBeGreaterThan(0);
    expect(result.shown).toBeLessThanOrEqual(50);
    expect(result.pokemon.length).toBeGreaterThan(0);
    // Generation I should include Bulbasaur (#1)
    const names = result.pokemon.map((p) => p.name);
    expect(names).toContain('bulbasaur');
  }, 20000);

  it('filters Pokémon by type', async () => {
    const ctx = createMockContext({ errors: findPokemon.errors, tenantId: 'test-tenant' });
    const input = findPokemon.input.parse({ type: 'dragon', limit: 20 });
    const result = await findPokemon.handler(input, ctx);

    expect(result.totalCount).toBeGreaterThan(0);
    expect(result.pokemon.length).toBeGreaterThan(0);
  }, 20000);

  it('applies query filter within a generation', async () => {
    const ctx = createMockContext({ errors: findPokemon.errors, tenantId: 'test-tenant' });
    // "chu" should match pikachu and raichu within generation-i
    const input = findPokemon.input.parse({ generation: 'generation-i', query: 'chu' });
    const result = await findPokemon.handler(input, ctx);

    expect(result.totalCount).toBeGreaterThan(0);
    // All results should contain "chu" in the name
    for (const p of result.pokemon) {
      expect(p.name).toContain('chu');
    }
  }, 20000);

  it('returns empty results with enrichment notice when no category filter and query only', async () => {
    const ctx = createMockContext({ errors: findPokemon.errors, tenantId: 'test-tenant' });
    // query without any category filter — should return empty with enrichment notice
    const input = findPokemon.input.parse({ query: 'pikachu' });
    const result = await findPokemon.handler(input, ctx);

    expect(result.pokemon).toHaveLength(0);
    expect(result.totalCount).toBe(0);
    expect(result.shown).toBe(0);

    // The query-only path enriches a category-filter-required notice. The framework appends
    // any populated enrichment field to content[] as a trailer, so content-only clients get
    // it too (#6). Assert the notice text carries the query-only-specific guidance.
    const enrichment = getEnrichment(ctx);
    expect(enrichment.notice).toContain('No category filters were provided');
  });

  it('applies pagination with offset and limit', async () => {
    const ctx = createMockContext({ errors: findPokemon.errors, tenantId: 'test-tenant' });
    const inputPage1 = findPokemon.input.parse({ generation: 'generation-i', limit: 5, offset: 0 });
    const inputPage2 = findPokemon.input.parse({ generation: 'generation-i', limit: 5, offset: 5 });

    const page1 = await findPokemon.handler(inputPage1, ctx);
    const page2 = await findPokemon.handler(inputPage2, ctx);

    expect(page1.shown).toBe(5);
    expect(page2.shown).toBe(5);
    // Pages should not overlap
    const page1Names = new Set(page1.pokemon.map((p) => p.name));
    const page2Names = page2.pokemon.map((p) => p.name);
    for (const name of page2Names) {
      expect(page1Names.has(name)).toBe(false);
    }
  }, 20000);

  it('rejects a negative limit at input validation (#7)', () => {
    // limit must be a positive integer — negatives previously reached Array.slice and
    // returned misleading successes. A Zod failure on the input schema surfaces to the
    // client as InvalidParams (-32602) before the handler runs.
    expect(() => findPokemon.input.parse({ generation: 'generation-i', limit: -5 })).toThrow();
  });

  it('rejects a negative offset at input validation (#7)', () => {
    // offset must be a non-negative integer — negatives previously reached Array.slice.
    expect(() => findPokemon.input.parse({ generation: 'generation-i', offset: -5 })).toThrow();
  });

  it('throws McpError for an invalid generation name', async () => {
    const ctx = createMockContext({ errors: findPokemon.errors, tenantId: 'test-tenant' });
    const input = findPokemon.input.parse({ generation: 'fake-generation-xyz' });
    await expect(findPokemon.handler(input, ctx)).rejects.toThrow(McpError);
  }, 15000);

  it.each([
    ['Field', 'ground'],
    ['Water 1', 'water1'],
    ['Water 2', 'water2'],
    ['Water 3', 'water3'],
    ['Grass', 'plant'],
    ['Human-Like', 'humanshape'],
    ['Amorphous', 'indeterminate'],
    ['Undiscovered', 'no-eggs'],
  ])('applies the egg-group alias %s as %s', async (alias, canonical) => {
    http.restore();
    http = handlerHttp({
      [`egg-group/${canonical}`]: {
        pokemon_species: [{ name: 'eevee', url: 'https://pokeapi.co/api/v2/pokemon-species/133/' }],
      },
      [`egg-group/${alias.toLowerCase().replace(' ', '-')}`]: new Response('', { status: 404 }),
    });
    http.install();
    const result = await runToolContract(findPokemon, { egg_group: alias, limit: 1 });
    expect(result.structuredContent).toMatchObject({
      pokemon: [{ id: 133, name: 'eevee' }],
      appliedFilters: { egg_group: canonical },
      totalCount: 1,
    });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('| 133 | eevee |') });
    expect(result.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.stringContaining(canonical) }),
      ]),
    );
    expect(http.calls).toHaveLength(1);
  });

  it('names the failing filter and includes the complete paginated catalog on both surfaces', async () => {
    http.restore();
    http = handlerHttp({
      'generation/generation-i': { pokemon_species: [] },
      'pokedex/sinnoh': new Response('', { status: 404 }),
      'pokedex?limit=100': {
        count: 3,
        next: 'https://pokeapi.co/api/v2/pokedex/?offset=1&limit=1',
        results: [{ name: 'original-sinnoh' }],
      },
      'pokedex?limit=100&offset=1': {
        count: 3,
        next: 'https://pokeapi.co/api/v2/pokedex/?offset=2&limit=1',
        results: [{ name: 'extended-sinnoh' }],
      },
      'pokedex?limit=100&offset=2': {
        count: 3,
        next: null,
        results: [{ name: 'paldea' }],
      },
    });
    http.install();
    const result = await runToolContract(findPokemon, {
      generation: 'generation-i',
      type: 'fire',
      pokedex: 'Sinnoh',
    });
    const message =
      'Unrecognized pokedex filter "Sinnoh". Valid names: original-sinnoh, extended-sinnoh, paldea.';
    expect(result.structuredContent).toMatchObject({
      error: {
        code: JsonRpcErrorCode.ValidationError,
        message,
        data: { reason: 'invalid_filter' },
      },
    });
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining(message) });
    expect(http.calls.map(({ request }) => new URL(request.url).pathname)).toEqual([
      '/api/v2/generation/generation-i',
      '/api/v2/pokedex/sinnoh',
      '/api/v2/pokedex',
      '/api/v2/pokedex',
      '/api/v2/pokedex',
    ]);
  });

  it('includes all 15 current egg groups for a mixed-filter miss', async () => {
    const names = [
      'monster',
      'water1',
      'bug',
      'flying',
      'ground',
      'fairy',
      'plant',
      'humanshape',
      'water3',
      'mineral',
      'indeterminate',
      'water2',
      'ditto',
      'dragon',
      'no-eggs',
    ];
    http.restore();
    http = handlerHttp({
      'egg-group/feild': new Response('', { status: 404 }),
      'egg-group?limit=100': { count: 15, next: null, results: names.map((name) => ({ name })) },
    });
    http.install();
    const result = await runToolContract(findPokemon, { type: 'fire', egg_group: 'feild' });
    const message = `Unrecognized egg_group filter "feild". Valid names: ${names.join(', ')}.`;
    expect(result.structuredContent).toMatchObject({
      error: { message, data: { reason: 'invalid_filter' } },
    });
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining(message),
    });
    expect(http.calls).toHaveLength(2);
  });

  it.each([
    ['HTTP 503', () => new Response('', { status: 503 })],
    ['malformed JSON', () => new Response('{')],
    ['malformed page', () => Response.json({ count: 1, next: null, results: [{}] })],
    ['incomplete page', () => Response.json({ count: 1, next: null, results: [] })],
  ])('keeps contextual recovery when the catalog returns %s', async (_label, respond) => {
    http.restore();
    http = handlerHttp({
      'egg-group/feild': new Response('', { status: 404 }),
      'egg-group?limit=100': respond(),
    });
    http.install();
    const result = await runToolContract(findPokemon, { type: 'fire', egg_group: 'feild' });
    expect(result.structuredContent).toMatchObject({
      error: {
        message:
          'Unrecognized egg_group filter "feild". The list of valid names could not be retrieved.',
        data: { reason: 'invalid_filter' },
      },
    });
    expect(result.content[0]).toMatchObject({
      text: expect.stringContaining('could not be retrieved'),
    });
    expect(http.calls).toHaveLength(2);
  });

  it.each([400, 403])(
    'preserves canonical upstream HTTP %d without a recovery lookup',
    async (status) => {
      http.restore();
      http = handlerHttp({ 'type/fire': new Response('', { status }) });
      http.install();
      const result = await runToolContract(findPokemon, { type: 'fire' });
      expect(result.structuredContent).toMatchObject({ error: { data: { status } } });
      expect(result.structuredContent).not.toMatchObject({
        error: { data: { reason: 'invalid_filter' } },
      });
      expect(http.calls).toHaveLength(1);
    },
  );

  it.each(['caller abort', 'catalog deadline', 'network failure'])(
    'settles correctly when the catalog read ends in %s',
    async (failure) => {
      http.restore();
      const caller = new AbortController();
      const deadline = new AbortController();
      const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
      http = createFetchMock([
        {
          match: 'https://pokeapi.co/api/v2/egg-group/feild',
          respond: new Response('', { status: 404 }),
        },
        {
          match: 'https://pokeapi.co/api/v2/egg-group?limit=100',
          respond: () =>
            Response.json({ count: 2, next: '?offset=1', results: [{ name: 'ground' }] }),
        },
        {
          match: 'https://pokeapi.co/api/v2/egg-group?limit=100&offset=1',
          respond: ({ signal }) => {
            if (failure === 'caller abort') caller.abort();
            if (failure === 'catalog deadline')
              deadline.abort(new DOMException('Deadline elapsed', 'TimeoutError'));
            signal.throwIfAborted();
            throw new TypeError('Connection closed');
          },
        },
      ]);
      http.install();
      const ctx = createMockContext({ errors: findPokemon.errors, signal: caller.signal });
      const input = findPokemon.input.parse({ egg_group: 'feild' });
      try {
        await expect(findPokemon.handler(input, ctx)).rejects.toMatchObject(
          failure === 'caller abort'
            ? { code: JsonRpcErrorCode.RequestCancelled }
            : {
                message:
                  'Unrecognized egg_group filter "feild". The list of valid names could not be retrieved.',
                data: { reason: 'invalid_filter' },
              },
        );
        expect(timeout).toHaveBeenCalledExactlyOnceWith(3_000);
        expect(http.calls).toHaveLength(3);
      } finally {
        timeout.mockRestore();
      }
    },
  );

  it('returns empty results with notice for valid filters that yield no matches (AND intersection)', async () => {
    const ctx = createMockContext({ errors: findPokemon.errors, tenantId: 'test-tenant' });
    // Generation-i + ice type — unlikely to have many, test intersection
    const input = findPokemon.input.parse({
      generation: 'generation-i',
      type: 'ice',
      query: 'zzz-no-match-xyz',
    });
    const result = await findPokemon.handler(input, ctx);

    expect(result.pokemon).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  }, 20000);

  it('formats results with count and table', () => {
    const result = findPokemon.output.parse({
      pokemon: [
        { id: 1, name: 'bulbasaur' },
        { id: 4, name: 'charmander' },
        { id: 7, name: 'squirtle' },
      ],
      totalCount: 151,
      shown: 3,
    });

    const blocks = findPokemon.format!(result);
    expect(blocks).toHaveLength(1);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('151');
    expect(text).toContain('3');
    expect(text).toContain('bulbasaur');
    expect(text).toContain('charmander');
    expect(text).toContain('squirtle');
  });

  it('formats empty results without duplicating enrichment guidance', () => {
    const result = findPokemon.output.parse({ pokemon: [], totalCount: 0, shown: 0 });

    const blocks = findPokemon.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('No results');
    // The framework appends the handler's guidance once in the enrichment trailer.
    expect(text).not.toContain('relaxing');
  });
});
