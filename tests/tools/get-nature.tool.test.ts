/**
 * @fileoverview Tests for pokeapi_get_nature tool.
 * @module tests/tools/get-nature.tool.test
 */

import { McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { getNature } from '@/mcp-server/tools/definitions/get-nature.tool.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

const mockAppConfig = {} as Parameters<typeof initPokeApiService>[0];
const mockStorage = {} as Parameters<typeof initPokeApiService>[1];

describe('getNature', () => {
  beforeEach(() => {
    initPokeApiService(mockAppConfig, mockStorage);
  });

  it('returns details for a specific nature by name', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const input = getNature.input.parse({ identifier: 'modest' });
    const result = await getNature.handler(input, ctx);

    expect(result.isListAll).toBe(false);
    expect(result.natures).toHaveLength(1);
    const modest = result.natures[0]!;
    expect(modest.name).toBe('modest');
    expect(modest.increasedStat).toBe('special-attack');
    expect(modest.decreasedStat).toBe('attack');
    expect(modest.likesFlavor).not.toBeNull();
    expect(modest.hatesFlavor).not.toBeNull();
  }, 15000);

  it('returns all 25 natures when identifier is omitted', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const input = getNature.input.parse({});
    const result = await getNature.handler(input, ctx);

    expect(result.isListAll).toBe(true);
    expect(result.natures).toHaveLength(25);
    // Each nature should have required fields
    for (const n of result.natures) {
      expect(typeof n.id).toBe('number');
      expect(typeof n.name).toBe('string');
    }
  }, 15000);

  it('returns neutral nature with null stat modifiers', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    // Hardy is a neutral nature (ID 1)
    const input = getNature.input.parse({ identifier: 'hardy' });
    const result = await getNature.handler(input, ctx);

    const hardy = result.natures[0]!;
    expect(hardy.name).toBe('hardy');
    expect(hardy.increasedStat).toBeNull();
    expect(hardy.decreasedStat).toBeNull();
    expect(hardy.likesFlavor).toBeNull();
    expect(hardy.hatesFlavor).toBeNull();
  }, 15000);

  it('accepts numeric ID string', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    // Hardy is ID 1 in PokéAPI (verified)
    const input = getNature.input.parse({ identifier: '1' });
    const result = await getNature.handler(input, ctx);

    expect(result.natures[0]!.name).toBe('hardy');
  }, 15000);

  it('throws not_found for unknown nature', async () => {
    const ctx = createMockContext({ errors: getNature.errors, tenantId: 'test-tenant' });
    const input = getNature.input.parse({ identifier: 'fake-nature-xyz' });
    await expect(getNature.handler(input, ctx)).rejects.toThrow(McpError);
  }, 15000);

  it('formats single nature with stat info', () => {
    const result = getNature.output.parse({
      natures: [
        {
          id: 5,
          name: 'modest',
          increasedStat: 'special-attack',
          decreasedStat: 'attack',
          likesFlavor: 'dry',
          hatesFlavor: 'spicy',
        },
      ],
      isListAll: false,
    });

    const blocks = getNature.format!(result);
    expect(blocks).toHaveLength(1);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('modest');
    expect(text).toContain('special-attack');
    expect(text).toContain('attack');
    expect(text).toContain('dry');
    expect(text).toContain('spicy');
  });

  it('formats list-all with table containing all natures', () => {
    const natures = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      name: `nature-${i + 1}`,
      increasedStat: i % 5 !== 0 ? 'attack' : null,
      decreasedStat: i % 5 !== 0 ? 'defense' : null,
      likesFlavor: i % 5 !== 0 ? 'spicy' : null,
      hatesFlavor: i % 5 !== 0 ? 'dry' : null,
    }));

    const result = getNature.output.parse({ natures, isListAll: true });
    const blocks = getNature.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('All Natures');
    // Table rows: should contain all 25 names
    expect(text).toContain('nature-1');
    expect(text).toContain('nature-25');
  });
});
