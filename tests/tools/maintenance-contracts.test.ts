/**
 * @fileoverview Contract checks for framework upgrades across the PokéAPI tool surface.
 * @module tests/tools/maintenance-contracts.test
 */

import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import {
  createFetchMock,
  createInMemoryStorage,
  createMockContext,
  runToolContract,
} from '@cyanheads/mcp-ts-core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { findPokemon } from '@/mcp-server/tools/definitions/find-pokemon.tool.js';
import { getAbility } from '@/mcp-server/tools/definitions/get-ability.tool.js';
import { getItem } from '@/mcp-server/tools/definitions/get-item.tool.js';
import { getMove } from '@/mcp-server/tools/definitions/get-move.tool.js';
import { getNature } from '@/mcp-server/tools/definitions/get-nature.tool.js';
import { getPokemon } from '@/mcp-server/tools/definitions/get-pokemon.tool.js';
import { getTypeMatchups } from '@/mcp-server/tools/definitions/get-type-matchups.tool.js';
import { getPokeApiService, initPokeApiService } from '@/services/pokeapi/pokeapi-service.js';

describe('framework error contracts', () => {
  beforeEach(() => {
    initPokeApiService({} as Parameters<typeof initPokeApiService>[0], createInMemoryStorage());
  });

  it('repairs an integer identifier and preserves the nature result on both surfaces', async () => {
    const http = createFetchMock([
      {
        match: 'https://pokeapi.co/api/v2/nature/1',
        respond: Response.json({ id: 1, name: 'hardy' }),
      },
    ]);
    http.install();
    try {
      // @ts-expect-error Wire clients can send an integer before framework input repair.
      const result = await runToolContract(getNature, { identifier: 1 });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        natures: [{ id: 1, name: 'hardy', increasedStat: null, decreasedStat: null }],
        isListAll: false,
      });
      expect(result.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('hardy (Nature #1)'),
          }),
        ]),
      );
      expect(http.calls).toHaveLength(1);
    } finally {
      http.restore();
    }
  });

  it('keeps a boolean identifier invalid without reaching the upstream', async () => {
    const http = createFetchMock();
    http.install();
    try {
      // @ts-expect-error Deliberately exercise rejection of a wrong-type wire argument.
      const result = await runToolContract(getNature, { identifier: true });
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.InvalidParams, data: { reason: 'invalid_arguments' } },
      });
      expect(result.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'text', text: expect.stringContaining('identifier') }),
        ]),
      );
      expect(http.calls).toHaveLength(0);
    } finally {
      http.restore();
    }
  });

  it('classifies malformed upstream-derived output as a server contract failure', async () => {
    const http = createFetchMock([
      {
        match: 'https://pokeapi.co/api/v2/nature/1',
        respond: Response.json({ id: true, name: 'hardy' }),
      },
    ]);
    http.install();
    try {
      const result = await runToolContract(getNature, { identifier: '1' });
      expect(result.structuredContent).toMatchObject({
        error: { code: JsonRpcErrorCode.InternalError },
      });
      expect(result.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'text', text: expect.stringContaining('output') }),
        ]),
      );
      expect(JSON.stringify(result.structuredContent)).not.toContain('issues');
    } finally {
      http.restore();
    }
  });

  it('keeps nested cached PokéAPI data independent of returned object mutations', async () => {
    const http = createFetchMock([
      {
        match: 'https://pokeapi.co/api/v2/nature/1',
        respond: Response.json({
          id: 1,
          name: 'hardy',
          names: [{ name: 'Hardy', language: { name: 'en' } }],
        }),
      },
    ]);
    http.install();
    try {
      const ctx = createMockContext();
      const first = await getPokeApiService().fetchNature('1', ctx);
      first.names[0]!.language.name = 'changed';
      const second = await getPokeApiService().fetchNature('1', ctx);
      expect(second.names[0]!.language.name).toBe('en');
      expect(second).not.toBe(first);
      expect(http.calls).toHaveLength(1);
    } finally {
      http.restore();
    }
  });

  for (const definition of [getAbility, getItem, getMove, getNature, getPokemon]) {
    it(`${definition.name} retains not-found recovery on both response surfaces`, async () => {
      const http = createFetchMock([
        {
          match: /^https:\/\/pokeapi.co\/api\/v2\//,
          respond: new Response('Not Found', { status: 404 }),
        },
      ]);
      http.install();
      try {
        const result = await runToolContract(definition, { identifier: 'missing' });
        const hint = definition.errors![0]!.recovery;
        expect(result.isError).toBe(true);
        expect(result.structuredContent).toMatchObject({
          error: {
            code: JsonRpcErrorCode.NotFound,
            data: { reason: 'not_found', recovery: { hint } },
          },
        });
        expect(result.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: 'text', text: expect.stringContaining(hint) }),
          ]),
        );
        // A Pokémon miss is followed by one species lookup before it is reported.
        expect(http.calls).toHaveLength(definition === getPokemon ? 2 : 1);
      } finally {
        http.restore();
      }
    });
  }

  it('retains invalid-filter recovery on both response surfaces', async () => {
    const http = createFetchMock([
      {
        match: 'https://pokeapi.co/api/v2/generation/missing',
        respond: new Response('Not Found', { status: 404 }),
      },
    ]);
    http.install();
    try {
      const result = await runToolContract(findPokemon, { generation: 'missing' });
      const hint = findPokemon.errors![0]!.recovery;
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.ValidationError,
          data: { reason: 'invalid_filter', recovery: { hint } },
        },
      });
      expect(result.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'text', text: expect.stringContaining(hint) }),
        ]),
      );
    } finally {
      http.restore();
    }
  });

  it.each([{}, { type: 'fire', pokemon: 'charizard' }])(
    'retains invalid-input recovery for %j',
    async (input) => {
      const result = await runToolContract(getTypeMatchups, input);
      const hint = getTypeMatchups.errors!.find(
        (entry) => entry.reason === 'invalid_input',
      )!.recovery;
      expect(result.structuredContent).toMatchObject({
        error: {
          code: JsonRpcErrorCode.ValidationError,
          data: { reason: 'invalid_input', recovery: { hint } },
        },
      });
      expect(result.content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: 'text', text: expect.stringContaining(hint) }),
        ]),
      );
    },
  );
});
