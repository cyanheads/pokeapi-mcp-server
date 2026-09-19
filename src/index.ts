#!/usr/bin/env node
/**
 * @fileoverview pokeapi-mcp-server MCP server entry point.
 * @module index
 */

import { createApp } from '@cyanheads/mcp-ts-core';
import { pokemonResource } from './mcp-server/resources/definitions/pokemon.resource.js';
import { typeResource } from './mcp-server/resources/definitions/type.resource.js';
import { findPokemon } from './mcp-server/tools/definitions/find-pokemon.tool.js';
import { getAbility } from './mcp-server/tools/definitions/get-ability.tool.js';
import { getItem } from './mcp-server/tools/definitions/get-item.tool.js';
import { getMove } from './mcp-server/tools/definitions/get-move.tool.js';
import { getNature } from './mcp-server/tools/definitions/get-nature.tool.js';
import { getPokemon } from './mcp-server/tools/definitions/get-pokemon.tool.js';
import { getTypeMatchups } from './mcp-server/tools/definitions/get-type-matchups.tool.js';
import { initPokeApiService } from './services/pokeapi/pokeapi-service.js';

await createApp({
  name: 'pokeapi-mcp-server',
  title: 'pokeapi-mcp-server',
  sessionMode: 'stateless',
  tools: [getPokemon, getTypeMatchups, getMove, getAbility, getItem, getNature, findPokemon],
  resources: [pokemonResource, typeResource],
  prompts: [],
  instructions:
    'Start with pokeapi_get_pokemon for a Pokémon profile with stats, abilities, evolution, and sprites. Use pokeapi_get_type_matchups for type effectiveness and pokeapi_find_pokemon to filter by generation, type, pokédex, or egg group. Read pokeapi://pokemon/{identifier} or pokeapi://type/{typeName} for injectable Pokémon or type context.',
  setup(core) {
    initPokeApiService(core.config, core.storage);
  },
});
