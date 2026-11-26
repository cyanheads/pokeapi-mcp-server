/**
 * @fileoverview Tests for pokeapi_get_item tool.
 * @module tests/tools/get-item.tool.test
 */

import { readFileSync } from 'node:fs';
import { McpError } from '@cyanheads/mcp-ts-core/errors';
import {
  createInMemoryStorage,
  createMockContext,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getItem } from '@/mcp-server/tools/definitions/get-item.tool.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';
import { handlerHttp } from '../fixtures/handler-fixtures.js';

/** Items without English effect prose, and the machine records TM101 references, captured 2026-11-25. */
const captures = JSON.parse(
  readFileSync(new URL('../fixtures/effect-text-captures.json', import.meta.url), 'utf8'),
) as Record<'items' | 'machines', Record<string, unknown>>;
const capturedItems = Object.fromEntries([
  ...Object.entries(captures.items).map(([name, record]) => [`item/${name}`, record]),
  ...Object.entries(captures.machines).map(([id, record]) => [`machine/${id}`, record]),
]);

const mockAppConfig = {} as Parameters<typeof initPokeApiService>[0];
const mockStorage = createInMemoryStorage();
let http: ReturnType<typeof handlerHttp>;
afterEach(() => http.restore());

describe('getItem', () => {
  beforeEach(() => {
    http = handlerHttp();
    http.install();
    initPokeApiService(mockAppConfig, mockStorage);
  });

  it('returns item details for a well-known held item', async () => {
    const ctx = createMockContext({ errors: getItem.errors, tenantId: 'test-tenant' });
    const input = getItem.input.parse({ identifier: 'leftovers' });
    const result = await getItem.handler(input, ctx);

    expect(result.name).toBe('leftovers');
    expect(typeof result.id).toBe('number');
    expect(typeof result.category).toBe('string');
    expect(result.cost).toBeNull();
    expect(result.prices).toBeInstanceOf(Array);
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
      prices: [],
      flingPower: 10,
      effectText: 'Restores 1/16 of max HP each turn.',
      shortEffectText: 'Restores 1/16 max HP each turn.',
      effectTextVersionGroup: null,
      attributes: ['holdable', 'holdable-passive'],
      heldByPokemon: ['snorlax', 'munchlax'],
      spriteUrl: 'http://example.com/leftovers.png',
      machines: [],
      notices: [],
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

  it('formats a zero legacy cost literally', () => {
    const result = getItem.output.parse({
      id: 1,
      name: 'master-ball',
      category: 'pokeballs',
      cost: 0,
      prices: [],
      flingPower: 30,
      effectText: 'Catches any wild Pokémon without fail.',
      shortEffectText: 'Catches any Pokémon.',
      effectTextVersionGroup: null,
      attributes: ['countable'],
      heldByPokemon: [],
      spriteUrl: null,
      machines: [],
      notices: [],
    });

    const blocks = getItem.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('**Legacy cost:** ₽0');
    expect(text).toContain('No price records available');
  });

  it('formats item with null effect text (sparse upstream)', () => {
    const result = getItem.output.parse({
      id: 99,
      name: 'some-item',
      category: 'miscellaneous',
      cost: 0,
      prices: [],
      flingPower: null,
      effectText: null,
      shortEffectText: null,
      effectTextVersionGroup: null,
      attributes: [],
      heldByPokemon: [],
      spriteUrl: null,
      machines: [],
      notices: [],
    });

    const blocks = getItem.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('not available');
  });
});

describe('getItem machines', () => {
  const textOf = (result: Awaited<ReturnType<typeof runToolContract>>) =>
    result.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
  const paths = () => http.calls.map(({ request }) => new URL(request.url).pathname);

  beforeEach(() => {
    http = handlerHttp();
    http.install();
    initPokeApiService(mockAppConfig, createInMemoryStorage());
  });

  it('lists the move TM25 teaches in each of its 25 version groups on both surfaces', async () => {
    const result = await runToolContract(getItem, { identifier: 'tm25' });
    const { machines, notices } = result.structuredContent as {
      machines: Array<{ versionGroup: string; move: string | null }>;
      notices: string[];
    };
    expect(machines).toHaveLength(25);
    expect(machines[0]).toEqual({ versionGroup: 'red-blue', move: 'thunder' });
    expect(machines).toEqual(
      expect.arrayContaining([
        { versionGroup: 'lets-go-pikachu-lets-go-eevee', move: 'waterfall' },
        { versionGroup: 'sword-shield', move: 'protect' },
        { versionGroup: 'scarlet-violet', move: 'facade' },
        { versionGroup: 'legends-za', move: 'crunch' },
      ]),
    );
    expect(notices).toEqual([]);
    const text = textOf(result);
    expect(text).toContain("## Effect (PokéAPI's unversioned description)\nTeaches Thunder");
    for (const row of machines) expect(text).toContain(`| ${row.versionGroup} | ${row.move} |`);
    expect(text).not.toContain('## Notices');
  });

  it('serves a repeat call without requests', async () => {
    const ctx = createMockContext({ errors: getItem.errors });
    const input = getItem.input.parse({ identifier: 'tm25' });
    const first = await getItem.handler(input, ctx);
    expect(paths()).toHaveLength(26);
    expect(await getItem.handler(input, ctx)).toEqual(first);
    expect(paths()).toHaveLength(26);
  });

  it('reads one machine record for a represented version group', async () => {
    const ctx = createMockContext({ errors: getItem.errors });
    const result = await getItem.handler(
      getItem.input.parse({ identifier: 'tm25', version_group: 'Sword Shield' }),
      ctx,
    );
    expect(result.machines).toEqual([{ versionGroup: 'sword-shield', move: 'protect' }]);
    expect(result.notices).toEqual([]);
    expect(paths()).toEqual(['/api/v2/item/tm25', '/api/v2/machine/549']);
  });

  it('reports a known version group with no machine row', async () => {
    const result = await runToolContract(getItem, {
      identifier: 'leftovers',
      version_group: 'scarlet-violet',
    });
    const notice = 'PokéAPI lists no move taught by leftovers in scarlet-violet.';
    expect(result.structuredContent).toMatchObject({ machines: [], notices: [notice] });
    expect(textOf(result)).toContain(`## Notices\n- ${notice}`);
    expect(textOf(result)).not.toContain('## Machines');
    expect(paths()).toEqual(['/api/v2/item/leftovers', '/api/v2/version-group/scarlet-violet']);
  });

  it('nulls only the row whose machine record fails, on both surfaces', async () => {
    http.restore();
    http = handlerHttp({ 'machine/530': new Response('Unavailable', { status: 503 }) });
    http.install();
    const result = await runToolContract(getItem, { identifier: 'tm25' });
    const { machines, notices } = result.structuredContent as {
      machines: Array<{ versionGroup: string; move: string | null }>;
      notices: string[];
    };
    expect(machines.filter((row) => row.move === null)).toEqual([
      { versionGroup: 'red-blue', move: null },
    ]);
    expect(notices).toEqual([
      'Machine records could not be read for: red-blue. Their move is null.',
    ]);
    expect(textOf(result)).toContain('| red-blue | Unavailable |');
    expect(textOf(result)).toContain(`## Notices\n- ${notices[0]}`);
  });

  it.each([
    ['all-machines', [], null, "## Effect (PokéAPI's unversioned description)"],
    ['all-machines', [], 'legends-za', '## Effect (legends-za flavor text)\nTeaches Thunder'],
    ['held-items', [], null, '## Effect\n'],
    ['held-items', [{ versionGroup: 'red-blue', move: null }], null, '| red-blue | Unavailable |'],
  ])(
    'labels the effect and machine rows of a %s item',
    (category, machines, effectTextVersionGroup, expected) => {
      const result = getItem.output.parse({
        id: 329,
        name: 'tm25',
        category,
        cost: null,
        prices: [],
        flingPower: null,
        effectText: 'Teaches Thunder to a compatible Pokémon.',
        shortEffectText: null,
        effectTextVersionGroup,
        attributes: [],
        heldByPokemon: [],
        spriteUrl: null,
        machines,
        notices: [],
      });
      const text = (getItem.format!(result)[0] as { text: string }).text;
      expect(text).toContain(expected);
      expect(text.includes('## Machines')).toBe(machines.length > 0);
      const isMachine = category === 'all-machines' || machines.length > 0;
      expect(text.includes('unversioned')).toBe(isMachine && effectTextVersionGroup === null);
    },
  );
});

describe('getItem effect text', () => {
  const textOf = (result: Awaited<ReturnType<typeof runToolContract>>) =>
    result.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
  const paths = () => http.calls.map(({ request }) => new URL(request.url).pathname);

  beforeEach(() => {
    http = handlerHttp(capturedItems);
    http.install();
    initPokeApiService(mockAppConfig, createInMemoryStorage());
  });

  it('keeps PokéAPI effect prose and its summary on both surfaces from one read', async () => {
    const result = await runToolContract(getItem, { identifier: 'leftovers' });
    expect(result.structuredContent).toMatchObject({
      effectText: 'Held: Heals the holder by 1/16 its max HP at the end of each turn.',
      shortEffectText: 'Held: Restores 1/16 (6.25%) holder’s max HP at the end of each turn.',
      effectTextVersionGroup: null,
    });
    const text = textOf(result);
    expect(text).toContain('## Effect\nHeld: Heals the holder by 1/16 its max HP');
    expect(text).toContain('**Summary:** Held: Restores 1/16 (6.25%)');
    expect(paths()).toEqual(['/api/v2/item/leftovers']);
  });

  it('falls back to the latest English flavor text, named by its version group', async () => {
    const result = await runToolContract(getItem, { identifier: 'autograph' });
    const flavorText =
      'The autograph you got from the Vermilion City Gym Leader, Lt. Surge. He wrote, “Good luck!”';
    expect(result.structuredContent).toMatchObject({
      effectText: flavorText,
      shortEffectText: null,
      effectTextVersionGroup: 'legends-za',
    });
    expect(textOf(result)).toContain(`## Effect (legends-za flavor text)\n${flavorText}`);
    expect(paths()).toEqual(['/api/v2/item/autograph']);
  });

  it('leaves a machine whose only flavor text is the N/A placeholder without text or label', async () => {
    const result = await runToolContract(getItem, { identifier: 'tm101' });
    expect(result.structuredContent).toMatchObject({
      effectText: null,
      shortEffectText: null,
      effectTextVersionGroup: null,
      machines: [
        { versionGroup: 'scarlet-violet', move: 'power-gem' },
        { versionGroup: 'legends-za', move: 'electroweb' },
      ],
    });
    const text = textOf(result);
    expect(text).toContain('## Effect\n*(Effect description not available.)*');
    expect(text).not.toContain('N/A');
    expect(text).not.toContain('unversioned');
  });

  it('describes where effectText comes from on every surface that names it', () => {
    const { effectText, effectTextVersionGroup, machines } = getItem.output.shape;
    expect(effectText.description).toContain('effectTextVersionGroup');
    expect(effectTextVersionGroup.description).toContain('flavor text');
    expect(machines.description).toContain('effectTextVersionGroup');
  });
});
