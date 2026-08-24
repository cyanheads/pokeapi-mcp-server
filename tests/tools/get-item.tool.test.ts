/**
 * @fileoverview Tests for pokeapi_get_item tool.
 * @module tests/tools/get-item.tool.test
 */

import { McpError } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { getItem } from '@/mcp-server/tools/definitions/get-item.tool.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

const mockAppConfig = {} as Parameters<typeof initPokeApiService>[0];
const mockStorage = createInMemoryStorage();

describe('getItem', () => {
  beforeEach(() => {
    initPokeApiService(mockAppConfig, mockStorage);
  });

  it('returns item details for a well-known held item', async () => {
    const ctx = createMockContext({ errors: getItem.errors, tenantId: 'test-tenant' });
    const input = getItem.input.parse({ identifier: 'leftovers' });
    const result = await getItem.handler(input, ctx);

    expect(result.name).toBe('leftovers');
    expect(typeof result.id).toBe('number');
    expect(typeof result.category).toBe('string');
    expect(typeof result.cost).toBe('number');
    expect(result.attributes).toBeInstanceOf(Array);
    expect(result.heldByPokemon).toBeInstanceOf(Array);
  }, 15000);

  it('returns item by numeric ID string', async () => {
    const ctx = createMockContext({ errors: getItem.errors, tenantId: 'test-tenant' });
    // Poke Ball is item ID 4
    const input = getItem.input.parse({ identifier: '4' });
    const result = await getItem.handler(input, ctx);

    expect(typeof result.name).toBe('string');
    expect(result.id).toBe(4);
  }, 15000);

  it('returns choice-specs with correct category', async () => {
    const ctx = createMockContext({ errors: getItem.errors, tenantId: 'test-tenant' });
    const input = getItem.input.parse({ identifier: 'choice-specs' });
    const result = await getItem.handler(input, ctx);

    expect(result.name).toBe('choice-specs');
    expect(typeof result.category).toBe('string'); // "choice" category in PokéAPI
  }, 15000);

  it('throws not_found for unknown item', async () => {
    const ctx = createMockContext({ errors: getItem.errors, tenantId: 'test-tenant' });
    const input = getItem.input.parse({ identifier: 'fake-item-xyz-9999' });
    await expect(getItem.handler(input, ctx)).rejects.toThrow(McpError);
  }, 15000);

  it('formats output with key fields', () => {
    const result = getItem.output.parse({
      id: 245,
      name: 'leftovers',
      category: 'held-items',
      cost: 9800,
      flingPower: 10,
      effectText: 'Restores 1/16 of max HP each turn.',
      shortEffectText: 'Restores 1/16 max HP each turn.',
      attributes: ['holdable', 'holdable-passive'],
      heldByPokemon: ['snorlax', 'munchlax'],
      spriteUrl: 'http://example.com/leftovers.png',
    });

    const blocks = getItem.format!(result);
    expect(blocks).toHaveLength(1);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('leftovers');
    expect(text).toContain('#245');
    expect(text).toContain('held-items');
    expect(text).toContain('snorlax');
    expect(text).toContain('munchlax');
    expect(text).toContain('₽9800');
  });

  it('formats item not sold in shops (cost=0)', () => {
    const result = getItem.output.parse({
      id: 1,
      name: 'master-ball',
      category: 'pokeballs',
      cost: 0,
      flingPower: 30,
      effectText: 'Catches any wild Pokémon without fail.',
      shortEffectText: 'Catches any Pokémon.',
      attributes: ['countable'],
      heldByPokemon: [],
      spriteUrl: null,
    });

    const blocks = getItem.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('Not sold');
  });

  it('formats item with null effect text (sparse upstream)', () => {
    const result = getItem.output.parse({
      id: 99,
      name: 'some-item',
      category: 'miscellaneous',
      cost: 0,
      flingPower: null,
      effectText: null,
      shortEffectText: null,
      attributes: [],
      heldByPokemon: [],
      spriteUrl: null,
    });

    const blocks = getItem.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('not available');
  });
});
