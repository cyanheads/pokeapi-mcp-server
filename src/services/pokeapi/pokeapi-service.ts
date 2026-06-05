/**
 * @fileoverview PokéAPI v2 service — fetches and normalizes Pokémon game data.
 * @module services/pokeapi/pokeapi-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import { notFound, serviceUnavailable } from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { withRetry } from '@cyanheads/mcp-ts-core/utils';
import { getServerConfig } from '../../config/server-config.js';
import type {
  AbilityDetails,
  EvolutionStep,
  ItemDetails,
  MoveDetails,
  NamedResource,
  NatureDetails,
  PokemonAbilityRef,
  PokemonDossier,
  PokemonListEntry,
  PokemonMoveSummary,
  PokemonStat,
  RawAbility,
  RawChainLink,
  RawEggGroup,
  RawEvolutionChain,
  RawGeneration,
  RawItem,
  RawMove,
  RawNature,
  RawPokedex,
  RawPokemon,
  RawPokemonSpecies,
  RawType,
  TypeMatchups,
} from './types.js';

export class PokeApiService {
  private readonly baseUrl: string;
  private readonly cacheTtlSeconds: number;
  private readonly requestTimeoutMs: number;

  // config and storage are accepted per the init/accessor pattern
  // but not used directly — state is accessed via ctx.state in handlers
  constructor(_config: AppConfig, _storage: StorageService) {
    const serverConfig = getServerConfig();
    this.baseUrl = serverConfig.baseUrl;
    this.cacheTtlSeconds = serverConfig.cacheTtlSeconds;
    this.requestTimeoutMs = serverConfig.requestTimeoutMs;
  }

  // ---------------------------------------------------------------------------
  // Identifier normalization
  // ---------------------------------------------------------------------------

  normalizeIdentifier(identifier: string | number): string {
    if (typeof identifier === 'number') return String(identifier);
    return identifier.trim().toLowerCase().replace(/\s+/g, '-');
  }

  // ---------------------------------------------------------------------------
  // Core fetch with caching
  // ---------------------------------------------------------------------------

  private async fetchRaw<T>(path: string, ctx: Context, cacheKey?: string): Promise<T> {
    const key = cacheKey ?? `pokeapi/${path}`;
    const cached = (await ctx.state.get(key)) as T | null;
    if (cached !== null) return cached;

    const timeoutMs = this.requestTimeoutMs;
    const baseUrl = this.baseUrl;
    const result = await withRetry(
      async () => {
        const url = path.startsWith('http') ? path : `${baseUrl}/${path}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        // Compose with the handler's abort signal (AbortSignal.any is available in Node 18+)
        const signal = AbortSignal.any([ctx.signal, controller.signal]);

        let response: Response;
        try {
          response = await fetch(url, {
            signal,
            headers: { Accept: 'application/json' },
          });
        } finally {
          clearTimeout(timer);
        }

        // PokéAPI 404 returns an empty body — check status before parsing
        if (response.status === 404) {
          throw notFound(`PokéAPI returned 404 for ${path}`, { path });
        }
        if (!response.ok) {
          throw serviceUnavailable(`PokéAPI returned HTTP ${response.status} for ${path}`, {
            status: response.status,
            path,
          });
        }

        const text = await response.text();
        if (/^\s*<(!DOCTYPE\s+html|html[\s>])/i.test(text)) {
          throw serviceUnavailable(
            'PokéAPI returned HTML instead of JSON — likely rate-limited or behind a proxy error page.',
            { path },
          );
        }

        return JSON.parse(text) as T;
      },
      {
        operation: `PokeApiService.fetch:${path}`,
        baseDelayMs: 500,
        signal: ctx.signal,
      },
    );

    await ctx.state.set(key, result, { ttl: this.cacheTtlSeconds });
    return result;
  }

  // ---------------------------------------------------------------------------
  // Resource-specific fetchers
  // ---------------------------------------------------------------------------

  async fetchPokemon(identifier: string | number, ctx: Context): Promise<RawPokemon> {
    const id = this.normalizeIdentifier(identifier);
    return this.fetchRaw<RawPokemon>(`pokemon/${id}`, ctx);
  }

  async fetchSpecies(identifier: string | number, ctx: Context): Promise<RawPokemonSpecies> {
    const id = this.normalizeIdentifier(identifier);
    return this.fetchRaw<RawPokemonSpecies>(`pokemon-species/${id}`, ctx);
  }

  async fetchEvolutionChain(url: string, ctx: Context): Promise<RawEvolutionChain> {
    // Derive a storage-safe cache key from the URL path (e.g. ".../evolution-chain/1/" → "pokeapi/evolution-chain/1")
    const pathPart = url
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/\/+$/, '')
      .replace(/^\//, '');
    const cacheKey = `pokeapi/${pathPart}`;
    return this.fetchRaw<RawEvolutionChain>(url, ctx, cacheKey);
  }

  async fetchAbility(identifier: string | number, ctx: Context): Promise<RawAbility> {
    const id = this.normalizeIdentifier(identifier);
    return this.fetchRaw<RawAbility>(`ability/${id}`, ctx);
  }

  async fetchType(identifier: string | number, ctx: Context): Promise<RawType> {
    const id = this.normalizeIdentifier(identifier);
    return this.fetchRaw<RawType>(`type/${id}`, ctx);
  }

  async fetchMove(identifier: string | number, ctx: Context): Promise<RawMove> {
    const id = this.normalizeIdentifier(identifier);
    return this.fetchRaw<RawMove>(`move/${id}`, ctx);
  }

  async fetchItem(identifier: string | number, ctx: Context): Promise<RawItem> {
    const id = this.normalizeIdentifier(identifier);
    return this.fetchRaw<RawItem>(`item/${id}`, ctx);
  }

  async fetchNature(identifier: string | number, ctx: Context): Promise<RawNature> {
    const id = this.normalizeIdentifier(identifier);
    return this.fetchRaw<RawNature>(`nature/${id}`, ctx);
  }

  async fetchAllNatures(ctx: Context): Promise<RawNature[]> {
    // There are exactly 25 natures; fetch list then each by name
    const list = await this.fetchRaw<{ count: number; results: NamedResource[] }>(
      'nature?limit=25',
      ctx,
      'pokeapi/nature/list',
    );
    const natures = await Promise.all(list.results.map((r) => this.fetchNature(r.name, ctx)));
    return natures;
  }

  async fetchGeneration(identifier: string | number, ctx: Context): Promise<RawGeneration> {
    const id = this.normalizeIdentifier(identifier);
    return this.fetchRaw<RawGeneration>(`generation/${id}`, ctx);
  }

  async fetchPokedex(identifier: string | number, ctx: Context): Promise<RawPokedex> {
    const id = this.normalizeIdentifier(identifier);
    return this.fetchRaw<RawPokedex>(`pokedex/${id}`, ctx);
  }

  async fetchEggGroup(identifier: string | number, ctx: Context): Promise<RawEggGroup> {
    const id = this.normalizeIdentifier(identifier);
    return this.fetchRaw<RawEggGroup>(`egg-group/${id}`, ctx);
  }

  // ---------------------------------------------------------------------------
  // Domain-level methods used by tools
  // ---------------------------------------------------------------------------

  /** Full denormalized Pokémon dossier — up to 3+N calls in two async tiers. */
  async getPokemonDossier(
    identifier: string | number,
    includesMoves: boolean,
    gameVersion: string | undefined,
    ctx: Context,
  ): Promise<PokemonDossier> {
    const id = this.normalizeIdentifier(identifier);

    // Tier 1: fetch pokemon + species in parallel
    const [pokemon, species] = await Promise.all([
      this.fetchPokemon(id, ctx),
      this.fetchSpecies(id, ctx),
    ]);

    // Tier 2: evolution chain + ability details in parallel
    const [evolutionChain, ...abilityDetails] = await Promise.all([
      this.fetchEvolutionChain(species.evolution_chain.url, ctx),
      ...pokemon.abilities.map((a) => this.fetchAbility(a.ability.name, ctx)),
    ]);

    // Resolve flavor text
    const flavorText = this.resolveFlavorText(species.flavor_text_entries, gameVersion);

    // Resolve genus
    const genusEntry = species.genera.find((g) => g.language.name === 'en');

    // Resolve abilities with effect text
    const abilities: PokemonAbilityRef[] = pokemon.abilities.map((a, i) => {
      const detail = abilityDetails[i];
      const en = detail?.effect_entries.find((e) => e.language.name === 'en');
      return {
        name: a.ability.name,
        isHidden: a.is_hidden,
        slot: a.slot,
        effectText: en?.effect ?? null,
        shortEffectText: en?.short_effect ?? null,
      };
    });

    // Resolve stats
    const stats: PokemonStat[] = pokemon.stats.map((s) => ({
      name: s.stat.name,
      baseStat: s.base_stat,
      effort: s.effort,
    }));

    // Resolve moves (summarized)
    let moves: PokemonMoveSummary[] = [];
    if (includesMoves) {
      moves = this.summarizeMoves(pokemon.moves);
    }

    // Walk evolution chain
    const evoChain = this.walkEvolutionChain(evolutionChain.chain);

    // Varieties
    const varieties = species.varieties.map((v) => ({
      name: v.pokemon.name,
      isDefault: v.is_default,
    }));

    return {
      id: pokemon.id,
      name: pokemon.name,
      heightDm: pokemon.height,
      weightHg: pokemon.weight,
      types: pokemon.types.sort((a, b) => a.slot - b.slot).map((t) => t.type.name),
      stats,
      abilities,
      sprites: {
        frontDefault: pokemon.sprites.front_default,
        frontShiny: pokemon.sprites.front_shiny,
        officialArtwork: pokemon.sprites.other?.['official-artwork']?.front_default ?? null,
      },
      moves,
      moveCount: pokemon.moves.length,
      speciesFlavorText: flavorText,
      genus: genusEntry?.genus ?? null,
      captureRate: species.capture_rate,
      growthRate: species.growth_rate.name,
      genderRate: species.gender_rate,
      isLegendary: species.is_legendary,
      isMythical: species.is_mythical,
      evolutionChain: evoChain,
      varieties,
      generation: species.generation.name,
      eggGroups: species.egg_groups.map((e) => e.name),
    };
  }

  /** Compute type matchups for a single type. */
  async getTypeMatchups(typeName: string, ctx: Context): Promise<TypeMatchups> {
    const raw = await this.fetchType(typeName, ctx);
    const dr = raw.damage_relations;
    return {
      typeName: raw.name,
      offensiveRelations: {
        superEffectiveTo: dr.double_damage_to.map((t) => t.name),
        notVeryEffectiveTo: dr.half_damage_to.map((t) => t.name),
        noEffectTo: dr.no_damage_to.map((t) => t.name),
      },
      defensiveRelations: {
        weakTo: dr.double_damage_from.map((t) => t.name),
        resists: dr.half_damage_from.map((t) => t.name),
        immuneTo: dr.no_damage_from.map((t) => t.name),
      },
    };
  }

  /**
   * Compute combined defensive matchups for a dual-type Pokémon.
   * Returns a map of attacking type → effective multiplier.
   */
  async getDualTypeDefensive(types: string[], ctx: Context): Promise<Record<string, number>> {
    const typeData = await Promise.all(types.map((t) => this.fetchType(t, ctx)));
    const multipliers: Record<string, number> = {};

    for (const rawType of typeData) {
      const dr = rawType.damage_relations;
      // Immunity always wins — set to 0 and don't overwrite
      for (const t of dr.no_damage_from) {
        multipliers[t.name] = 0;
      }
      for (const t of dr.half_damage_from) {
        if (multipliers[t.name] !== 0) {
          multipliers[t.name] = (multipliers[t.name] ?? 1) * 0.5;
        }
      }
      for (const t of dr.double_damage_from) {
        if (multipliers[t.name] !== 0) {
          multipliers[t.name] = (multipliers[t.name] ?? 1) * 2;
        }
      }
    }

    return multipliers;
  }

  /** Move details normalized. */
  async getMoveDetails(identifier: string | number, ctx: Context): Promise<MoveDetails> {
    const raw = await this.fetchMove(identifier, ctx);
    const en = raw.effect_entries.find((e) => e.language.name === 'en');
    return {
      id: raw.id,
      name: raw.name,
      type: raw.type.name,
      damageClass: raw.damage_class?.name ?? null,
      power: raw.power ?? null,
      accuracy: raw.accuracy ?? null,
      pp: raw.pp ?? null,
      priority: raw.priority,
      effectChance: raw.effect_chance ?? null,
      effectText: en?.effect ?? null,
      shortEffectText: en?.short_effect ?? null,
      target: raw.target.name,
      statChanges: raw.stat_changes.map((sc) => ({
        stat: sc.stat.name,
        change: sc.change,
      })),
      learnedByPokemon: raw.learned_by_pokemon.map((p) => p.name),
    };
  }

  /** Ability details normalized. */
  async getAbilityDetails(identifier: string | number, ctx: Context): Promise<AbilityDetails> {
    const raw = await this.fetchAbility(identifier, ctx);
    const en = raw.effect_entries.find((e) => e.language.name === 'en');
    return {
      id: raw.id,
      name: raw.name,
      effectText: en?.effect ?? null,
      shortEffectText: en?.short_effect ?? null,
      generation: raw.generation.name,
      pokemon: raw.pokemon.map((p) => ({
        name: p.pokemon.name,
        isHidden: p.is_hidden,
        slot: p.slot,
      })),
    };
  }

  /** Item details normalized. */
  async getItemDetails(identifier: string | number, ctx: Context): Promise<ItemDetails> {
    const raw = await this.fetchItem(identifier, ctx);
    const en = raw.effect_entries.find((e) => e.language.name === 'en');
    return {
      id: raw.id,
      name: raw.name,
      category: raw.category.name,
      cost: raw.cost,
      flingPower: raw.fling_power ?? null,
      effectText: en?.effect ?? null,
      shortEffectText: en?.short_effect ?? null,
      attributes: raw.attributes.map((a) => a.name),
      heldByPokemon: (raw.held_by_pokemon ?? []).map((h) => h.pokemon.name),
      spriteUrl: raw.sprites.default,
    };
  }

  /** Nature details normalized. */
  normalizeNature(raw: RawNature): NatureDetails {
    return {
      id: raw.id,
      name: raw.name,
      increasedStat: raw.increased_stat?.name ?? null,
      decreasedStat: raw.decreased_stat?.name ?? null,
      likesFlavor: raw.likes_flavor?.name ?? null,
      hatesFlavor: raw.hates_flavor?.name ?? null,
    };
  }

  async getNatureDetails(identifier: string | number, ctx: Context): Promise<NatureDetails> {
    const raw = await this.fetchNature(identifier, ctx);
    return this.normalizeNature(raw);
  }

  async getAllNatureDetails(ctx: Context): Promise<NatureDetails[]> {
    const raws = await this.fetchAllNatures(ctx);
    return raws.map((r) => this.normalizeNature(r)).sort((a, b) => a.id - b.id);
  }

  /** Filter Pokémon by generation. */
  async getPokemonByGeneration(generation: string, ctx: Context): Promise<PokemonListEntry[]> {
    const raw = await this.fetchGeneration(generation, ctx);
    return raw.pokemon_species.map((s) => {
      const idMatch = s.url.match(/\/(\d+)\/?$/);
      return {
        id: idMatch ? Number(idMatch[1]) : 0,
        name: s.name,
      };
    });
  }

  /** Filter Pokémon by type. */
  async getPokemonByType(typeName: string, ctx: Context): Promise<PokemonListEntry[]> {
    const raw = await this.fetchType(typeName, ctx);
    return raw.pokemon.map((p) => {
      const idMatch = p.pokemon.url.match(/\/(\d+)\/?$/);
      return {
        id: idMatch ? Number(idMatch[1]) : 0,
        name: p.pokemon.name,
      };
    });
  }

  /** Filter Pokémon by regional pokédex. */
  async getPokemonByPokedex(pokedex: string, ctx: Context): Promise<PokemonListEntry[]> {
    const raw = await this.fetchPokedex(pokedex, ctx);
    return raw.pokemon_entries.map((e) => {
      const idMatch = e.pokemon_species.url.match(/\/(\d+)\/?$/);
      return {
        id: idMatch ? Number(idMatch[1]) : 0,
        name: e.pokemon_species.name,
      };
    });
  }

  /** Filter Pokémon by egg group. */
  async getPokemonByEggGroup(eggGroup: string, ctx: Context): Promise<PokemonListEntry[]> {
    const raw = await this.fetchEggGroup(eggGroup, ctx);
    return raw.pokemon_species.map((s) => {
      const idMatch = s.url.match(/\/(\d+)\/?$/);
      return {
        id: idMatch ? Number(idMatch[1]) : 0,
        name: s.name,
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private resolveFlavorText(
    entries: RawPokemonSpecies['flavor_text_entries'],
    gameVersion: string | undefined,
  ): string | null {
    const enEntries = entries.filter((e) => e.language.name === 'en');
    if (enEntries.length === 0) return null;

    if (gameVersion) {
      const match = enEntries.find((e) => e.version.name === gameVersion.toLowerCase().trim());
      if (match) {
        return match.flavor_text.replace(/\f/g, ' ').replace(/\n/g, ' ');
      }
    }

    // Fall back to most recent available English entry
    const first = enEntries[enEntries.length - 1];
    if (!first) return null;
    return first.flavor_text.replace(/\f/g, ' ').replace(/\n/g, ' ');
  }

  private summarizeMoves(moves: RawPokemon['moves']): PokemonMoveSummary[] {
    // Deduplicate by move name, picking the most recent version group detail
    const seen = new Map<string, PokemonMoveSummary>();
    for (const m of moves) {
      const detail = m.version_group_details[m.version_group_details.length - 1];
      if (!detail) continue;
      seen.set(m.move.name, {
        name: m.move.name,
        learnMethod: detail.move_learn_method.name,
        levelLearnedAt: detail.level_learned_at,
      });
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  private walkEvolutionChain(link: RawChainLink): EvolutionStep {
    const detail = link.evolution_details[0];
    return {
      species: link.species.name,
      trigger: detail?.trigger?.name ?? 'base',
      minLevel: detail?.min_level ?? null,
      item: detail?.item?.name ?? null,
      condition: this.buildEvolutionCondition(detail),
      evolvesTo: link.evolves_to.map((l) => this.walkEvolutionChain(l)),
    };
  }

  private buildEvolutionCondition(
    detail: RawChainLink['evolution_details'][0] | undefined,
  ): string | null {
    if (!detail) return null;
    const parts: string[] = [];
    if (detail.min_level) parts.push(`level ${detail.min_level}+`);
    if (detail.min_happiness) parts.push(`happiness ${detail.min_happiness}+`);
    if (detail.item) parts.push(`use ${detail.item.name}`);
    if (detail.held_item) parts.push(`hold ${detail.held_item.name}`);
    if (detail.time_of_day) parts.push(`${detail.time_of_day} time`);
    if (detail.known_move) parts.push(`know ${detail.known_move.name}`);
    if (detail.location) parts.push(`at ${detail.location.name}`);
    return parts.length > 0 ? parts.join(', ') : null;
  }
}

// ---------------------------------------------------------------------------
// Init/accessor pattern
// ---------------------------------------------------------------------------

let _service: PokeApiService | undefined;

export function initPokeApiService(config: AppConfig, storage: StorageService): void {
  _service = new PokeApiService(config, storage);
}

export function getPokeApiService(): PokeApiService {
  if (!_service) {
    throw new Error('PokeApiService not initialized — call initPokeApiService() in setup()');
  }
  return _service;
}
