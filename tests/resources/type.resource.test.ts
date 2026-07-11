/**
 * @fileoverview Tests for pokeapi://type/{typeName} resource.
 * @module tests/resources/type.resource.test
 */

import { McpError } from '@cyanheads/mcp-ts-core/errors';
import { createMockContext } from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { typeResource } from '@/mcp-server/resources/definitions/type.resource.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

const mockAppConfig = {} as Parameters<typeof initPokeApiService>[0];
const mockStorage = {} as Parameters<typeof initPokeApiService>[1];

describe('typeResource', () => {
  beforeEach(() => {
    initPokeApiService(mockAppConfig, mockStorage);
  });

  it('returns type matchup data for a valid type', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = typeResource.params.parse({ typeName: 'water' });
    const result = await typeResource.handler(params, ctx);

    const r = result as Record<string, unknown>;
    expect(r).toHaveProperty('typeName', 'water');
    expect(r).toHaveProperty('offensiveRelations');
    expect(r).toHaveProperty('defensiveRelations');
    const defensive = r.defensiveRelations as Record<string, unknown>;
    expect(defensive).toHaveProperty('weakTo');
    expect(defensive).toHaveProperty('resists');
    expect(defensive).toHaveProperty('immuneTo');
  }, 15000);

  it('water type is weak to electric', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = typeResource.params.parse({ typeName: 'water' });
    const result = await typeResource.handler(params, ctx);

    const defensive = (result as Record<string, Record<string, string[]>>).defensiveRelations!;
    expect(defensive.weakTo).toContain('electric');
  }, 15000);

  it('normal type is immune to ghost', async () => {
    const ctx = createMockContext({ tenantId: 'test-tenant' });
    const params = typeResource.params.parse({ typeName: 'normal' });
    const result = await typeResource.handler(params, ctx);

    const defensive = (result as Record<string, Record<string, string[]>>).defensiveRelations!;
    expect(defensive.immuneTo).toContain('ghost');
  }, 15000);

  it('throws McpError for an unknown type name', async () => {
    const ctx = createMockContext({ errors: typeResource.errors, tenantId: 'test-tenant' });
    const params = typeResource.params.parse({ typeName: 'faketype-xyz-999' });
    await expect(typeResource.handler(params, ctx)).rejects.toThrow(McpError);
  }, 15000);

  it('lists all 18 standard type resources', async () => {
    const listing = await typeResource.list!();
    expect(listing.resources).toBeInstanceOf(Array);
    expect(listing.resources.length).toBe(18);
    for (const r of listing.resources) {
      expect(r).toHaveProperty('uri');
      expect(r).toHaveProperty('name');
      expect((r.uri as string).startsWith('pokeapi://type/')).toBe(true);
    }
    // Verify fire is in the list
    const uris = listing.resources.map((r) => r.uri);
    expect(uris).toContain('pokeapi://type/fire');
    expect(uris).toContain('pokeapi://type/fairy');
  });
});
