/**
 * @fileoverview Characterize the existing app registration independently of prompt additions.
 * @module tests/prompts/team-builder-registration
 */
import type { CreateAppOptions } from '@cyanheads/mcp-ts-core';
import { expect, it, vi } from 'vitest';

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
