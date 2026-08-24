/**
 * @fileoverview Tests for pokeapi_get_ability tool.
 * @module tests/tools/get-ability.tool.test
 */

import { McpError } from '@cyanheads/mcp-ts-core/errors';
import { createInMemoryStorage, createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { getAbility } from '@/mcp-server/tools/definitions/get-ability.tool.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

const mockAppConfig = {} as Parameters<typeof initPokeApiService>[0];
const mockStorage = createInMemoryStorage();

describe('getAbility', () => {
  beforeEach(() => {
    initPokeApiService(mockAppConfig, mockStorage);
  });

  it('returns ability details by name', async () => {
    const ctx = createMockContext({ errors: getAbility.errors, tenantId: 'test-tenant' });
    const input = getAbility.input.parse({ identifier: 'overgrow' });
    const result = await getAbility.handler(input, ctx);

    expect(result.name).toBe('overgrow');
    expect(typeof result.id).toBe('number');
    expect(typeof result.generation).toBe('string');
    expect(result.pokemon).toBeInstanceOf(Array);
    expect(result.pokemon.length).toBeGreaterThan(0);
    // overgrow is available on some Pokémon
    const hasHiddenField = result.pokemon.every((p) => typeof p.isHidden === 'boolean');
    expect(hasHiddenField).toBe(true);
  }, 15000);

  it('returns ability by numeric ID string', async () => {
    const ctx = createMockContext({ errors: getAbility.errors, tenantId: 'test-tenant' });
    const input = getAbility.input.parse({ identifier: '65' }); // overgrow is ID 65
    const result = await getAbility.handler(input, ctx);

    expect(result.name).toBe('overgrow');
  }, 15000);

  it('includes effect text for a well-documented ability', async () => {
    const ctx = createMockContext({ errors: getAbility.errors, tenantId: 'test-tenant' });
    const input = getAbility.input.parse({ identifier: 'speed-boost' });
    const result = await getAbility.handler(input, ctx);

    // speed-boost has English effect text
    expect(result.effectText).not.toBeNull();
    expect(typeof result.effectText).toBe('string');
  }, 15000);

  it('throws not_found for unknown ability', async () => {
    const ctx = createMockContext({ errors: getAbility.errors, tenantId: 'test-tenant' });
    const input = getAbility.input.parse({ identifier: 'fake-ability-xyz-9999' });
    await expect(getAbility.handler(input, ctx)).rejects.toThrow(McpError);
  }, 15000);

  it('formats output with name, id, and effect', () => {
    const result = getAbility.output.parse({
      id: 65,
      name: 'overgrow',
      effectText:
        'When this Pokémon has 1/3 or less of its HP remaining, its grass-type moves inflict 1.5× as much regular damage.',
      shortEffectText: 'Strengthens grass moves to inflict 1.5× damage at 1/3 max HP or less.',
      generation: 'generation-iii',
      pokemon: [
        { name: 'bulbasaur', isHidden: false, slot: 1 },
        { name: 'meganium', isHidden: false, slot: 1 },
      ],
    });

    const blocks = getAbility.format!(result);
    expect(blocks).toHaveLength(1);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('overgrow');
    expect(text).toContain('#65');
    expect(text).toContain('generation-iii');
    expect(text).toContain('bulbasaur');
    expect(text).toContain('meganium');
  });

  it('formats output when effect text is null (sparse upstream)', () => {
    const result = getAbility.output.parse({
      id: 1,
      name: 'stench',
      effectText: null,
      shortEffectText: null,
      generation: 'generation-iii',
      pokemon: [],
    });

    const blocks = getAbility.format!(result);
    const text = (blocks[0] as { text: string }).text;
    // Should not crash, should render a placeholder
    expect(text).toContain('stench');
    expect(text).toContain('not available');
  });
});
