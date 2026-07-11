/**
 * @fileoverview Tests for pokeapi_get_type_matchups tool.
 * @module tests/tools/get-type-matchups.tool.test
 */

import { McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { getTypeMatchups } from '@/mcp-server/tools/definitions/get-type-matchups.tool.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

const mockAppConfig = {} as Parameters<typeof initPokeApiService>[0];
const mockStorage = {} as Parameters<typeof initPokeApiService>[1];

describe('getTypeMatchups', () => {
  beforeEach(() => {
    initPokeApiService(mockAppConfig, mockStorage);
  });

  it('returns offensive and defensive matchups for a single type', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const input = getTypeMatchups.input.parse({ type: 'fire' });
    const result = await getTypeMatchups.handler(input, ctx);

    expect(result.queryType).toBe('type');
    expect(result.resolvedTypes).toContain('fire');
    expect(result.offensiveRelations).not.toBeNull();
    expect(result.offensiveRelations!.superEffectiveTo).toBeInstanceOf(Array);
    expect(result.defensiveMatchups).toHaveProperty('weakTo');
    expect(result.defensiveMatchups).toHaveProperty('resists');
    expect(result.defensiveMatchups).toHaveProperty('immuneTo');
    expect(result.composedMultipliers).toBeTypeOf('object');
  }, 15000);

  it('fire type is super effective against grass', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const input = getTypeMatchups.input.parse({ type: 'fire' });
    const result = await getTypeMatchups.handler(input, ctx);

    expect(result.offensiveRelations!.superEffectiveTo).toContain('grass');
  }, 15000);

  it('fire type is weak to water defensively', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const input = getTypeMatchups.input.parse({ type: 'fire' });
    const result = await getTypeMatchups.handler(input, ctx);

    expect(result.defensiveMatchups.weakTo).toContain('water');
  }, 15000);

  it('resolves matchups for a Pokémon identifier', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    // Charizard is Fire/Flying
    const input = getTypeMatchups.input.parse({ pokemon: 'charizard' });
    const result = await getTypeMatchups.handler(input, ctx);

    expect(result.queryType).toBe('pokemon');
    expect(result.resolvedTypes).toContain('fire');
    expect(result.resolvedTypes).toContain('flying');
    // Dual-type offensive relations should be null
    expect(result.offensiveRelations).toBeNull();
  }, 15000);

  it('computes 4× weakness for dual-type Pokémon (Charizard vs Rock)', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const input = getTypeMatchups.input.parse({ pokemon: 'charizard' });
    const result = await getTypeMatchups.handler(input, ctx);

    // Fire and Flying are both weak to Rock — should compose to 4×
    expect(result.composedMultipliers.rock).toBe(4);
  }, 15000);

  it('keeps net-neutral 1× cancellations in composedMultipliers (Charizard vs Ice) (#5)', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const input = getTypeMatchups.input.parse({ pokemon: 'charizard' });
    const result = await getTypeMatchups.handler(input, ctx);

    // Fire resists Ice (0.5×), Flying is weak to Ice (2×) → composes to exactly 1×. The entry
    // is kept, not filtered, so "touched but canceled to neutral" stays distinct from "absent".
    expect(result.composedMultipliers.ice).toBe(1);
  }, 15000);

  it('throws invalid_input when neither type nor pokemon provided', async () => {
    const ctx = createMockContext({ errors: getTypeMatchups.errors, tenantId: 'test-tenant' });
    const input = getTypeMatchups.input.parse({});
    await expect(getTypeMatchups.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_input' },
    });
  });

  it('throws invalid_input when both type and pokemon are provided', async () => {
    const ctx = createMockContext({ errors: getTypeMatchups.errors, tenantId: 'test-tenant' });
    const input = getTypeMatchups.input.parse({ type: 'fire', pokemon: 'charizard' });
    await expect(getTypeMatchups.handler(input, ctx)).rejects.toMatchObject({
      data: { reason: 'invalid_input' },
    });
  });

  it('throws not_found for an unrecognized type', async () => {
    const ctx = createMockContext({ errors: getTypeMatchups.errors, tenantId: 'test-tenant' });
    const input = getTypeMatchups.input.parse({ type: 'faketype-xyz-999' });
    await expect(getTypeMatchups.handler(input, ctx)).rejects.toThrow(McpError);
  }, 15000);

  it('formats output with resolved types and matchups', () => {
    const result = getTypeMatchups.output.parse({
      queryType: 'type',
      resolvedTypes: ['fire'],
      offensiveRelations: {
        superEffectiveTo: ['grass', 'ice', 'bug', 'steel'],
        notVeryEffectiveTo: ['fire', 'water', 'rock', 'dragon'],
        noEffectTo: [],
      },
      defensiveMatchups: {
        weakTo: ['water', 'ground', 'rock'],
        resists: ['fire', 'grass', 'ice', 'bug', 'steel', 'fairy'],
        immuneTo: [],
      },
      composedMultipliers: { water: 2, rock: 2, grass: 0.5 },
    });

    const blocks = getTypeMatchups.format!(result);
    expect(blocks).toHaveLength(1);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('fire');
    expect(text).toContain('grass');
    expect(text).toContain('water');
  });
});
