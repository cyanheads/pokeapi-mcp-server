/**
 * @fileoverview Tests for pokeapi_get_move tool.
 * @module tests/tools/get-move.tool.test
 */

import { readFileSync } from 'node:fs';
import { McpError } from '@cyanheads/mcp-ts-core/errors';
import {
  createInMemoryStorage,
  createMockContext,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMove } from '@/mcp-server/tools/definitions/get-move.tool.js';
import { initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';
import { handlerHttp } from '../fixtures/handler-fixtures.js';

/** Moves without English effect prose, and the machine records Hard Press references, captured 2026-11-25. */
const captures = JSON.parse(
  readFileSync(new URL('../fixtures/effect-text-captures.json', import.meta.url), 'utf8'),
) as Record<'moves' | 'machines', Record<string, unknown>>;
const capturedMoves = Object.fromEntries([
  ...Object.entries(captures.moves).map(([name, record]) => [`move/${name}`, record]),
  ...Object.entries(captures.machines).map(([id, record]) => [`machine/${id}`, record]),
]);

const mockAppConfig = {} as Parameters<typeof initPokeApiService>[0];
const mockStorage = createInMemoryStorage();
let http: ReturnType<typeof handlerHttp>;
afterEach(() => http.restore());

describe('getMove', () => {
  beforeEach(() => {
    http = handlerHttp();
    http.install();
    initPokeApiService(mockAppConfig, mockStorage);
  });

  it('returns move details for a well-known move', async () => {
    const ctx = createMockContext({ errors: getMove.errors, tenantId: 'test-tenant' });
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
    const ctx = createMockContext({ errors: getMove.errors, tenantId: 'test-tenant' });
    const input = getMove.input.parse({ identifier: 'flamethrower', include_learners: true });
    const result = await getMove.handler(input, ctx);

    expect(result.learnedByPokemon.length).toBeGreaterThan(0);
    expect(typeof result.learnedByPokemon[0]).toBe('string');
  }, 15000);

  it('handles a status move with null power and accuracy', async () => {
    const ctx = createMockContext({ errors: getMove.errors, tenantId: 'test-tenant' });
    // Thunder Wave is a status move — power should be null
    const input = getMove.input.parse({ identifier: 'thunder-wave' });
    const result = await getMove.handler(input, ctx);

    expect(result.damageClass).toBe('status');
    expect(result.power).toBeNull();
  }, 15000);

  it('accepts numeric ID as string', async () => {
    const ctx = createMockContext({ errors: getMove.errors, tenantId: 'test-tenant' });
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
      effectTextVersionGroup: null,
      target: 'selected-pokemon',
      statChanges: [],
      learnedByPokemon: [],
      learnersIncluded: false,
      machines: [],
      notices: [],
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
      effectTextVersionGroup: null,
      target: 'selected-pokemon',
      statChanges: [],
      learnedByPokemon: [],
      learnersIncluded: false,
      machines: [],
      notices: [],
    });

    const blocks = getMove.format!(result);
    const text = (blocks[0] as { text: string }).text;
    expect(text).toContain('thunder-wave');
    expect(text).toContain('electric');
    // Null power renders as em-dash placeholder
    expect(text).toContain('—');
  });
});

describe('getMove machines', () => {
  const textOf = (result: Awaited<ReturnType<typeof runToolContract>>) =>
    result.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
  const paths = () => http.calls.map(({ request }) => new URL(request.url).pathname);

  beforeEach(() => {
    http = handlerHttp();
    http.install();
    initPokeApiService(mockAppConfig, createInMemoryStorage());
  });

  it('names Earthquake’s Scarlet and Violet TM after one machine read', async () => {
    const result = await runToolContract(getMove, {
      identifier: 'earthquake',
      version_group: 'scarlet-violet',
    });
    expect(result.structuredContent).toMatchObject({
      machines: [{ versionGroup: 'scarlet-violet', item: 'tm149' }],
      notices: [],
    });
    expect(textOf(result)).toContain(
      '| Version group | Item |\n| --- | --- |\n| scarlet-violet | tm149 |',
    );
    expect(paths()).toEqual(['/api/v2/move/earthquake', '/api/v2/machine/2047']);
  });

  it('lists every machine row of a move unscoped', async () => {
    const ctx = createMockContext({ errors: getMove.errors });
    const result = await getMove.handler(getMove.input.parse({ identifier: 'earthquake' }), ctx);
    expect(result.machines).toHaveLength(26);
    expect(result.machines).toEqual(
      expect.arrayContaining([
        { versionGroup: 'red-blue', item: 'tm26' },
        { versionGroup: 'sword-shield', item: 'tr10' },
        { versionGroup: 'scarlet-violet', item: 'tm149' },
      ]),
    );
    expect(result.notices).toEqual([]);
  });

  it('reports a known version group with no machine row', async () => {
    const result = await runToolContract(getMove, {
      identifier: 'earthquake',
      version_group: 'legends-arceus',
    });
    const notice = 'PokéAPI lists no TM, TR, or HM that teaches earthquake in legends-arceus.';
    expect(result.structuredContent).toMatchObject({ machines: [], notices: [notice] });
    expect(textOf(result)).toContain(
      `## Machines\nNo TM, TR, or HM listed.\n\n## Notices\n- ${notice}`,
    );
    expect(paths()).toEqual(['/api/v2/move/earthquake', '/api/v2/version-group/legends-arceus']);
  });

  it('nulls only the row whose machine record fails, on both surfaces', async () => {
    http.restore();
    http = handlerHttp({ 'machine/2047': new Response('Unavailable', { status: 503 }) });
    http.install();
    const result = await runToolContract(getMove, {
      identifier: 'earthquake',
      version_group: 'scarlet-violet',
    });
    const notice = 'Machine records could not be read for: scarlet-violet. Their item is null.';
    expect(result.structuredContent).toMatchObject({
      machines: [{ versionGroup: 'scarlet-violet', item: null }],
      notices: [notice],
    });
    expect(textOf(result)).toContain('| scarlet-violet | Unavailable |');
    expect(textOf(result)).toContain(`## Notices\n- ${notice}`);
  });

  it('stops reading machine records across calls once PokéAPI rate-limits one', async () => {
    http.restore();
    http = handlerHttp({
      'machine/2047': new Response('Too Many Requests', {
        status: 429,
        headers: { 'Retry-After': '60' },
      }),
    });
    http.install();
    const notice =
      'Machine records were not read for: scarlet-violet because PokéAPI is rate-limiting requests. Their item is null; call again later to read them.';
    for (const _call of [1, 2]) {
      const result = await runToolContract(getMove, {
        identifier: 'earthquake',
        version_group: 'scarlet-violet',
      });
      expect(result.structuredContent).toMatchObject({
        machines: [{ versionGroup: 'scarlet-violet', item: null }],
        notices: [notice],
      });
      expect(textOf(result)).toContain(`## Notices\n- ${notice}`);
    }
    expect(paths().filter((path) => path.startsWith('/api/v2/machine/'))).toEqual([
      '/api/v2/machine/2047',
    ]);
  });
});

describe('getMove effect text and unset values', () => {
  const textOf = (result: Awaited<ReturnType<typeof runToolContract>>) =>
    result.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
  const paths = () => http.calls.map(({ request }) => new URL(request.url).pathname);

  beforeEach(() => {
    http = handlerHttp(capturedMoves);
    http.install();
    initPokeApiService(mockAppConfig, createInMemoryStorage());
  });

  it('keeps PokéAPI effect prose and its summary on both surfaces from one read', async () => {
    const result = await runToolContract(getMove, { identifier: 'flamethrower' });
    expect(result.structuredContent).toMatchObject({
      effectText: 'Has a 10% chance to burn the target.',
      shortEffectText: 'May burn.',
      effectTextVersionGroup: null,
    });
    const text = textOf(result);
    expect(text).toContain('## Effect\nHas a 10% chance to burn the target.');
    expect(text).toContain('**Summary:** May burn.');
    expect(paths()).toEqual(['/api/v2/move/flamethrower']);
  });

  it.each([
    [
      'blood-moon',
      'scarlet-violet',
      'The user unleashes the full brunt of its spirit from a full moon that shines as red as blood. This move can’t be used twice in a row.',
    ],
    [
      'make-it-rain',
      'legends-za',
      'The user attacks by throwing out a mass of coins. This also lowers the user’s Sp. Atk stat for a short time. If a target is successfully struck, you will earn money.',
    ],
  ])(
    'falls back to the latest English flavor text of %s, named by its version group',
    async (name, versionGroup, flavorText) => {
      const result = await runToolContract(getMove, { identifier: name });
      expect(result.structuredContent).toMatchObject({
        effectText: flavorText,
        shortEffectText: null,
        effectTextVersionGroup: versionGroup,
      });
      const text = textOf(result);
      expect(text).toContain(`## Effect (${versionGroup} flavor text)\n${flavorText}`);
      expect(text).not.toContain('**Summary:**');
      expect(paths()).toEqual([`/api/v2/move/${name}`]);
    },
  );

  it('leaves the text of a move with neither effect prose nor flavor text null', async () => {
    const result = await runToolContract(getMove, { identifier: 'blazing-torque' });
    expect(result.structuredContent).toMatchObject({
      effectText: null,
      shortEffectText: null,
      effectTextVersionGroup: null,
    });
    expect(textOf(result)).toContain('## Effect\n*(Effect description not available.)*');
  });

  it.each([
    ['tachyon-cutter', { power: 50, accuracy: null }, '**Power:** 50 | **Accuracy:** — |'],
    ['shed-tail', { power: null, accuracy: null }, '**Power:** — | **Accuracy:** — |'],
    [
      'hard-press',
      { damageClass: 'physical', power: null, accuracy: 100 },
      '**Power:** — | **Accuracy:** 100% |',
    ],
  ])('reports the upstream zero placeholders of %s as null', async (name, values, line) => {
    const result = await runToolContract(getMove, { identifier: name });
    expect(result.structuredContent).toMatchObject(values);
    expect(textOf(result)).toContain(line);
  });

  it('lists a stat change without claiming which side it lands on', async () => {
    const result = await runToolContract(getMove, { identifier: 'make-it-rain' });
    expect(result.structuredContent).toMatchObject({
      statChanges: [{ stat: 'special-attack', change: -1 }],
    });
    const { statChanges, effectText, accuracy, power } = getMove.output.shape;
    expect(statChanges.description).toContain('user or the target');
    expect(statChanges.description).toContain('effectText');
    expect(effectText.description).toContain('effectTextVersionGroup');
    for (const field of [accuracy, power]) expect(field.description).toContain('placeholder');
  });
});
