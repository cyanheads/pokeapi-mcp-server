/**
 * @fileoverview Shared Pokémon resolver wiring and identity on matchup response surfaces.
 * @module tests/tools/species-matchup-contracts.test
 */
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createInMemoryStorage,
  createMockContext,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pokemonResource } from '@/mcp-server/resources/definitions/pokemon.resource.js';
import { getPokemon } from '@/mcp-server/tools/definitions/get-pokemon.tool.js';
import { getTypeMatchups } from '@/mcp-server/tools/definitions/get-type-matchups.tool.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';
import { handlerHttp } from '../fixtures/handler-fixtures.js';

let http: ReturnType<typeof handlerHttp>;
beforeEach(() =>
  initPokeApiService({} as Parameters<typeof initPokeApiService>[0], createInMemoryStorage()),
);
afterEach(() => {
  http.restore();
  vi.useRealTimers();
});
const textOf = (result: Awaited<ReturnType<typeof runToolContract>>) =>
  result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

describe('species-aware matchups', () => {
  it('characterizes direct form multipliers and lightweight request count', async () => {
    http = handlerHttp();
    http.install();
    const result = await runToolContract(getTypeMatchups, { pokemon: 'wormadam-trash' });
    expect(result.structuredContent).toMatchObject({
      resolvedTypes: ['bug', 'steel'],
      composedMultipliers: { fire: 4, poison: 0 },
    });
    expect(textOf(result)).toContain('**fire:** 4×');
    expect(http.calls).toHaveLength(3);
  });

  it.each([
    ['deoxys', 386, 'deoxys-normal', ['psychic'], 'deoxys', 4],
    ['wormadam', 413, 'wormadam-plant', ['bug', 'grass'], 'wormadam', 5],
    ['wormadam-trash', 10005, 'wormadam-trash', ['bug', 'steel'], null, 3],
    ['386', 386, 'deoxys-normal', ['psychic'], null, 2],
  ] as const)(
    'reports the resolved record and species fallback for %s on both surfaces',
    async (pokemon, id, name, resolvedTypes, resolvedFromSpecies, count) => {
      http = handlerHttp();
      http.install();
      const result = await runToolContract(getTypeMatchups, { pokemon });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        queryType: 'pokemon',
        resolvedPokemon: { id, name },
        resolvedTypes,
        resolvedFromSpecies,
      });
      expect(textOf(result)).toContain(`**Resolved Pokémon:** ${name} (PokéAPI ID: ${id})`);
      if (resolvedFromSpecies)
        expect(textOf(result)).toContain(
          `**Resolved from species:** ${resolvedFromSpecies} (default variety: ${name})`,
        );
      else expect(textOf(result)).not.toContain('Resolved from species');
      expect(http.calls).toHaveLength(count);
      expect(http.calls.some((call) => /evolution-chain|ability/.test(call.request.url))).toBe(
        false,
      );
    },
  );

  it('returns null record identity for direct type queries', async () => {
    http = handlerHttp();
    http.install();
    const result = await runToolContract(getTypeMatchups, { type: 'fire' });
    expect(result.structuredContent).toMatchObject({
      resolvedPokemon: null,
      resolvedFromSpecies: null,
      resolvedTypes: ['fire'],
    });
    expect(textOf(result)).not.toContain('Resolved Pokémon');
    expect(http.calls).toHaveLength(1);
  });

  it('shares the positive species mapping and record cache with dossiers and resources', async () => {
    http = handlerHttp();
    http.install();
    const ctx = createMockContext({ errors: getTypeMatchups.errors });
    const dossier = await getPokemon.handler(getPokemon.input.parse({ identifier: 'deoxys' }), ctx);
    expect(dossier.resolvedFromSpecies).toBe('deoxys');
    expect(getPokemon.format!(dossier)[0]).toMatchObject({
      text: expect.stringContaining('Resolved from species'),
    });
    const resource = await pokemonResource.handler({ identifier: ' DEOXYS ' }, ctx);
    expect(resource).toEqual(dossier);
    expect(http.calls).toHaveLength(5);
    const matchup = await getTypeMatchups.handler({ pokemon: 'deoxys' }, ctx);
    expect(matchup).toMatchObject({
      resolvedPokemon: { id: 386, name: 'deoxys-normal' },
      resolvedFromSpecies: 'deoxys',
    });
    expect(http.calls).toHaveLength(6);
    expect(await getTypeMatchups.handler({ pokemon: ' DEOXYS ' }, ctx)).toEqual(matchup);
    expect(http.calls).toHaveLength(6);
  });

  it.each([
    ['99999', 1],
    ['missingno', 2],
  ] as const)('preserves final not_found and recovery for %s', async (pokemon, count) => {
    http = handlerHttp({
      [`pokemon/${pokemon}`]: new Response('', { status: 404 }),
      [`pokemon-species/${pokemon}`]: new Response('', { status: 404 }),
    });
    http.install();
    const result = await runToolContract(getTypeMatchups, { pokemon });
    const hint = getTypeMatchups.errors![0]!.recovery;
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.NotFound, data: { reason: 'not_found', recovery: { hint } } },
    });
    expect(textOf(result)).toContain(hint);
    expect(http.calls).toHaveLength(count);
  });

  it('propagates operational errors after real retries without trying species', async () => {
    vi.useFakeTimers();
    http = handlerHttp({ 'pokemon/deoxys': new Response('Unavailable', { status: 503 }) });
    http.install();
    const pending = runToolContract(getTypeMatchups, { pokemon: 'deoxys' });
    await vi.runAllTimersAsync();
    const result = await pending;
    expect(result.structuredContent).toMatchObject({
      error: { code: JsonRpcErrorCode.ServiceUnavailable },
    });
    expect(textOf(result)).toContain('503');
    expect(http.calls).toHaveLength(4);
    expect(http.calls.every((call) => call.request.url.endsWith('/pokemon/deoxys'))).toBe(true);
  });

  it.each([{}, { type: 'fire', pokemon: 'deoxys' }])(
    'retains invalid_input on both surfaces: %j',
    async (input) => {
      http = handlerHttp();
      http.install();
      const result = await runToolContract(getTypeMatchups, input);
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.ValidationError, data: { reason: 'invalid_input' } },
      });
      expect(textOf(result)).toContain(getTypeMatchups.errors![1]!.recovery);
      expect(http.calls).toHaveLength(0);
    },
  );
});
