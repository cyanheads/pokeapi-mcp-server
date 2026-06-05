/**
 * @fileoverview Tests for pokeapi_get_move tool.
 * @module tests/tools/get-move.tool.test
 */

import { McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { getMove } from '@/mcp-server/tools/definitions/get-move.tool.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

const mockAppConfig = {} as Parameters<typeof initPokeApiService>[0];
const mockStorage = {} as Parameters<typeof initPokeApiService>[1];

describe('getMove', () => {
  beforeEach(() => {
    initPokeApiService(mockAppConfig, mockStorage);
  });

  it('returns move details for a well-known move', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const input = getMove.input.parse({ identifier: 'flamethrower' });
    const result = await getMove.handler(input, ctx);

    expect(result.name).toBe('flamethrower');
    expect(result.type).toBe('fire');
    expect(result.damageClass).toBe('special');
    expect(result.power).toBe(90);
    expect(result.pp).toBe(15);
    expect(typeof result.priority).toBe('number');
    expect(result.target).toBeTruthy();
    expect(result.statChanges).toBeInstanceOf(Array);
    // include_learners defaults to false
    expect(result.learnedByPokemon).toHaveLength(0);
  }, 15000);

  it('returns learner list when include_learners is true', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const input = getMove.input.parse({ identifier: 'flamethrower', include_learners: true });
    const result = await getMove.handler(input, ctx);

    expect(result.learnedByPokemon.length).toBeGreaterThan(0);
    expect(typeof result.learnedByPokemon[0]).toBe('string');
  }, 15000);

  it('handles a status move with null power and accuracy', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    // Thunder Wave is a status move — power should be null
    const input = getMove.input.parse({ identifier: 'thunder-wave' });
    const result = await getMove.handler(input, ctx);

    expect(result.damageClass).toBe('status');
    expect(result.power).toBeNull();
  }, 15000);

  it('accepts numeric ID as string', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const input = getMove.input.parse({ identifier: '53' }); // flamethrower is ID 53
    const result = await getMove.handler(input, ctx);

    expect(result.name).toBe('flamethrower');
  }, 15000);

  it('throws not_found for unknown move', async () => {
    const ctx = createMockContext({ errors: getMove.errors, tenantId: 'test-tenant' });
    const input = getMove.input.parse({ identifier: 'fake-move-xyz-9999' });
    await expect(getMove.handler(input, ctx)).rejects.toThrow(McpError);
  }, 15000);

  it('formats output with key fields', () => {
    const result = getMove.output.parse({
      id: 53,
      name: 'flamethrower',
      type: 'fire',
      damageClass: 'special',
      power: 90,
      accuracy: 100,
      pp: 15,
      priority: 0,
      effectChance: 10,
      effectText: 'Has a 10% chance to burn the target.',
      shortEffectText: 'Has a 10% chance to burn.',
      target: 'selected-pokemon',
      statChanges: [],
      learnedByPokemon: [],
    });

    const blocks = getMove.format!(result);
    expect(blocks).toHaveLength(1);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('flamethrower');
    expect(text).toContain('fire');
    expect(text).toContain('special');
    expect(text).toContain('90');
    expect(text).toContain('100%');
    expect(text).toContain('10%');
  });

  it('formats output for status move with null power (sparse upstream fields)', () => {
    const result = getMove.output.parse({
      id: 86,
      name: 'thunder-wave',
      type: 'electric',
      damageClass: 'status',
      power: null,
      accuracy: 90,
      pp: 20,
      priority: 0,
      effectChance: null,
      effectText: null,
      shortEffectText: 'Paralyzes the target.',
      target: 'selected-pokemon',
      statChanges: [],
      learnedByPokemon: [],
    });

    const blocks = getMove.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('thunder-wave');
    expect(text).toContain('electric');
    // Null power renders as em-dash placeholder
    expect(text).toContain('—');
  });
});
