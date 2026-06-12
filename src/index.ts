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
  tools: [getPokemon, getTypeMatchups, getMove, getAbility, getItem, getNature, findPokemon],
  resources: [pokemonResource, typeResource],
  prompts: [],
  instructions:
    'PokéAPI MCP Server — keyless, read-only access to Pokémon game data through Generation IX.\n' +
    'Start with pokeapi_get_pokemon for a complete Pokémon profile (stats, abilities, evolution, sprites).\n' +
    'Use pokeapi_get_type_matchups to compute offensive/defensive effectiveness for a type or Pokémon.\n' +
    'Use pokeapi_find_pokemon to filter by generation, type, pokédex, or egg group.\n' +
    'Resources: pokeapi://pokemon/{name} and pokeapi://type/{typeName} for injectable context.',
  setup(core) {
    initPokeApiService(core.config, core.storage);
  },
});
