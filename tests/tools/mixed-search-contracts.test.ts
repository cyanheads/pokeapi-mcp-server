/**
 * @fileoverview Default-record ID intersections, species provenance, and paging contracts.
 * @module tests/tools/mixed-search-contracts.test
 */
import { createInMemoryStorage, runToolContract } from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findPokemon } from '@/mcp-server/tools/definitions/find-pokemon.tool.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';
import { handlerHttp } from '../fixtures/handler-fixtures.js';

let http: ReturnType<typeof handlerHttp>;
beforeEach(() =>
  initPokeApiService({} as Parameters<typeof initPokeApiService>[0], createInMemoryStorage()),
);
afterEach(() => http.restore());
const textOf = (result: Awaited<ReturnType<typeof runToolContract>>) =>
  result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
const ref = (name: string, kind: string, id: number) => ({
  name,
  url: `https://pokeapi.co/api/v2/${kind}/${id}/`,
});
const species = [ref('deoxys', 'pokemon-species', 386), ref('wormadam', 'pokemon-species', 413)];
const filters = { generation: 'generation-iii', pokedex: 'fixture-dex', egg_group: 'fixture-egg' };

describe('mixed-filter search', () => {
  it('characterizes type-only record names, IDs, tokens, and re-sliced pages', async () => {
    http = handlerHttp();
    http.install();
    const result = await runToolContract(findPokemon, {
      type: 'psychic',
      query: 'deoxys',
      limit: 2,
      offset: 1,
    });
    expect(result.structuredContent).toMatchObject({
      pokemon: [
        { id: 10001, name: 'deoxys-attack' },
        { id: 10002, name: 'deoxys-defense' },
      ],
      totalCount: 4,
      shown: 2,
    });
    expect(textOf(result)).toContain('| 10001 | deoxys-attack |');
    expect(http.calls).toHaveLength(1);
  });

  it('returns all 20 captured Psychic/Generation III default species with two requests', async () => {
    http = handlerHttp();
    http.install();
    const result = await runToolContract(findPokemon, {
      type: 'psychic',
      generation: 'generation-iii',
      limit: 100,
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      totalCount: 20,
      shown: 20,
      pokemon: expect.arrayContaining([{ id: 386, name: 'deoxys' }]),
    });
    expect(textOf(result)).toContain('| 386 | deoxys |');
    expect(http.calls).toHaveLength(2);
  });

  it.each([
    ['generation'],
    ['pokedex'],
    ['egg_group'],
    ['generation', 'pokedex'],
    ['generation', 'egg_group'],
    ['pokedex', 'egg_group'],
    ['generation', 'pokedex', 'egg_group'],
  ] as const)('intersects default IDs and returns species rows for %j', async (...keys) => {
    http = handlerHttp({
      'generation/generation-iii': { pokemon_species: species },
      'pokedex/fixture-dex': {
        pokemon_entries: species.map((pokemon_species, index) => ({
          entry_number: index + 1,
          pokemon_species,
        })),
      },
      'egg-group/fixture-egg': { pokemon_species: species },
      'type/psychic': {
        pokemon: [
          ref('deoxys-normal', 'pokemon', 386),
          ref('deoxys-attack', 'pokemon', 10001),
          ref('wormadam-trash', 'pokemon', 10005),
        ].map((pokemon) => ({ pokemon })),
      },
    });
    http.install();
    const categories = Object.fromEntries(keys.map((key) => [key, filters[key]]));
    const result = await runToolContract(findPokemon, {
      type: 'psychic',
      ...categories,
      query: ' DEO XYS ',
      limit: 1,
    });
    expect(result.structuredContent).toMatchObject({
      pokemon: [{ id: 386, name: 'deoxys' }],
      totalCount: 1,
      shown: 1,
    });
    expect(textOf(result)).toContain('| 386 | deoxys |');
    expect(http.calls).toHaveLength(keys.length + 1);
  });

  it('excludes alternate-only type membership, preserves empty and past-end notices', async () => {
    http = handlerHttp({ 'generation/generation-iv': { pokemon_species: [species[1]] } });
    http.install();
    const alternate = await runToolContract(findPokemon, {
      type: 'steel',
      generation: 'generation-iv',
      query: 'wormadam',
    });
    expect(alternate.structuredContent).toMatchObject({
      pokemon: [],
      totalCount: 0,
      notice: expect.stringContaining('relaxing'),
    });
    expect(textOf(alternate)).toContain('No results');
    const past = await runToolContract(findPokemon, {
      type: 'psychic',
      generation: 'generation-iii',
      query: 'deoxys',
      offset: 1,
    });
    expect(past.structuredContent).toMatchObject({
      pokemon: [],
      totalCount: 1,
      shown: 0,
      notice: expect.stringContaining('Offset 1'),
    });
    expect(textOf(past)).toContain('No entries on this page');
  });
});
