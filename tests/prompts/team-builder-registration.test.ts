/**
 * @fileoverview Characterize the existing app registration independently of prompt additions.
 * @module tests/prompts/team-builder-registration
 */
import type { CreateAppOptions } from '@cyanheads/mcp-ts-core';
import { JsonRpcErrorCode } from '@cyanheads/mcp-ts-core/errors';
import { createWorkerHandler } from '@cyanheads/mcp-ts-core/worker';
import { expect, it, vi } from 'vitest';
import { handlerHttp } from '../fixtures/handler-fixtures.js';

const { registration } = vi.hoisted(() => ({
  registration: { options: undefined as CreateAppOptions | undefined },
}));
vi.mock('@cyanheads/mcp-ts-core', async (original) => ({
  ...(await original<typeof import('@cyanheads/mcp-ts-core')>()),
  createApp: (options: CreateAppOptions) => {
    registration.options = options;
  },
}));

await import('../../src/index.js');

it('preserves the existing tools and resources when registering the app', () => {
  const options = registration.options!;
  expect(options.tools?.map((tool) => tool.name)).toEqual([
    'pokeapi_get_pokemon',
    'pokeapi_get_type_matchups',
    'pokeapi_get_move',
    'pokeapi_get_ability',
    'pokeapi_get_item',
    'pokeapi_get_nature',
    'pokeapi_find_pokemon',
  ]);
  expect(options.resources).toHaveLength(2);
  expect(options.skills).toBe('skills');
  expect(options.prompts?.map((prompt) => prompt.name)).toEqual(['pokeapi_team_builder']);
});

it('decodes both registered URI templates once at the MCP read boundary', async () => {
  const { skills: _skills, teardown: _teardown, ...options } = registration.options!;
  const app = createWorkerHandler(options);
  const http = handlerHttp();
  const executionContext = { waitUntil() {}, passThroughOnException() {}, props: {} };
  const read = async (uri: string) => {
    const response = await app.fetch(
      new Request('http://localhost/mcp', {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri } }),
      }),
      { MCP_AUTH_MODE: 'none', LOG_LEVEL: 'error' },
      executionContext,
    );
    const body = await response.text();
    const message = body.startsWith('event:') ? body.match(/^data: (.+)$/m)![1]! : body;
    return JSON.parse(message);
  };
  const payload = (message: { result: { contents: { text: string }[] }; error?: unknown }) => {
    expect(message.error).toBeUndefined();
    return JSON.parse(message.result.contents[0]!.text);
  };
  http.install();
  try {
    expect(payload(await read('pokeapi://pokemon/mr-mime'))).toMatchObject({ id: 122 });
    expect(payload(await read('pokeapi://pokemon/Mr%20Mime'))).toMatchObject({ id: 122 });
    expect(payload(await read('pokeapi://type/fire'))).toMatchObject({ typeName: 'fire' });
    expect(payload(await read('pokeapi://type/%66ire'))).toMatchObject({ typeName: 'fire' });
    const beforeInvalidReads = http.calls.length;
    for (const [resource, variable] of [
      ['pokemon', 'identifier'],
      ['type', 'typeName'],
    ]) {
      expect(await read(`pokeapi://${resource}/%E0%A4%A`)).toMatchObject({
        error: { code: JsonRpcErrorCode.ValidationError, data: { issues: [{ path: [variable] }] } },
      });
    }
    expect(await read('pokeapi://type/%2566ire')).toMatchObject({
      error: { code: JsonRpcErrorCode.NotFound, data: { reason: 'not_found' } },
    });
    expect(await read('pokeapi://pokemon/Mr%2520Mime')).toMatchObject({
      error: { code: JsonRpcErrorCode.NotFound, data: { reason: 'not_found' } },
    });
    expect(http.calls).toHaveLength(beforeInvalidReads);
  } finally {
    http.restore();
  }
});
