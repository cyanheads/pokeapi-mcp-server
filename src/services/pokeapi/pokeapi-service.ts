/**
 * @fileoverview PokéAPI v2 service — fetches and normalizes Pokémon game data.
 * @module services/pokeapi/pokeapi-service
 */

import type { Context } from '@cyanheads/mcp-ts-core';
import type { AppConfig } from '@cyanheads/mcp-ts-core/config';
import {
  JsonRpcErrorCode,
  McpError,
  notFound,
  serviceUnavailable,
} from '@cyanheads/mcp-ts-core/errors';
import type { StorageService } from '@cyanheads/mcp-ts-core/storage';
import { fetchWithTimeout, withRetry } from '@cyanheads/mcp-ts-core/utils';
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

/**
 * Longest normalized identifier sent upstream. The longest name in the PokéAPI lists this
 * service reads is 32 characters. The bound caps the request URL for identifiers that
 * skip the cache, where the storage layer's 1024-character key limit never applies.
 */
export const MAX_IDENTIFIER_LENGTH = 100;

/** PokéAPI's name and ID alphabet — the only identifiers safe to use as a storage key. */
const CANONICAL_IDENTIFIER = /^[a-z0-9-]+$/;

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

  /**
   * Trims, lowercases, and hyphenates whitespace. The result is not URL-encoded, so
   * normalizing an already-normalized identifier returns it unchanged.
   */
  normalizeIdentifier(identifier: string | number): string {
    return String(identifier).trim().toLowerCase().replace(/\s+/g, '-');
  }

  // ---------------------------------------------------------------------------
  // Core fetch with caching
  // ---------------------------------------------------------------------------

  /** Fetches `path`, reading and writing the cache only when `cacheKey` is a string. */
  private async fetchRaw<T>(path: string, ctx: Context, cacheKey: string | null): Promise<T> {
    if (cacheKey !== null) {
      const cached = (await ctx.state.get(cacheKey)) as T | null;
      if (cached !== null) return cached;
    }

    const timeoutMs = this.requestTimeoutMs;
    const baseUrl = this.baseUrl;
    const result = await withRetry(
      async () => {
        const url = path.startsWith('http') ? path : `${baseUrl}/${path}`;
        const response = await fetchWithTimeout(url, timeoutMs, ctx, {
          signal: ctx.signal,
          headers: { Accept: 'application/json' },
          expectedStatuses: [400, 404],
        });

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
        context: ctx,
        signal: ctx.signal,
      },
    );

    if (cacheKey !== null) await ctx.state.set(cacheKey, result, { ttl: this.cacheTtlSeconds });
    return result;
  }

  /**
   * Fetches one record of `resource` by name or ID. The identifier is URL-encoded here and
   * nowhere else. An identifier that cannot name a record fails as NotFound without a
   * request: blank, `.`, and `..` address the list endpoint or its parent once the URL is
   * resolved, a lone surrogate has no URL encoding, and an overlong one exceeds any name.
   * Only identifiers in PokéAPI's own alphabet are cached. For any other identifier, a 400
   * is also NotFound: PokéAPI answers 400, not 404, to a path segment that needed encoding.
   */
  private async fetchByIdentifier<T>(
    resource: string,
    identifier: string | number,
    ctx: Context,
  ): Promise<T> {
    const id = this.normalizeIdentifier(identifier);
    const miss = () =>
      notFound(`No PokéAPI ${resource} record matches the identifier.`, { resource });
    if (
      id === '' ||
      id === '.' ||
      id === '..' ||
      id.length > MAX_IDENTIFIER_LENGTH ||
      !id.isWellFormed()
    ) {
      throw miss();
    }
    if (CANONICAL_IDENTIFIER.test(id)) {
      return this.fetchRaw<T>(`${resource}/${id}`, ctx, `pokeapi/${resource}/${id}`);
    }
    try {
      return await this.fetchRaw<T>(`${resource}/${encodeURIComponent(id)}`, ctx, null);
    } catch (err) {
      if (err instanceof McpError && err.data?.status === 400) throw miss();
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Resource-specific fetchers
  // ---------------------------------------------------------------------------

  fetchPokemon(identifier: string | number, ctx: Context): Promise<RawPokemon> {
    return this.fetchByIdentifier<RawPokemon>('pokemon', identifier, ctx);
  }

  fetchSpecies(identifier: string | number, ctx: Context): Promise<RawPokemonSpecies> {
    return this.fetchByIdentifier<RawPokemonSpecies>('pokemon-species', identifier, ctx);
  }

  fetchEvolutionChain(url: string, ctx: Context): Promise<RawEvolutionChain> {
    // Derive a storage-safe cache key from the URL path (e.g. ".../evolution-chain/1/" → "pokeapi/evolution-chain/1")
    const pathPart = url
      .replace(/^https?:\/\/[^/]+/, '')
      .replace(/\/+$/, '')
      .replace(/^\//, '');
    const cacheKey = `pokeapi/${pathPart}`;
    return this.fetchRaw<RawEvolutionChain>(url, ctx, cacheKey);
  }

  fetchAbility(identifier: string | number, ctx: Context): Promise<RawAbility> {
    return this.fetchByIdentifier<RawAbility>('ability', identifier, ctx);
  }

  fetchType(identifier: string | number, ctx: Context): Promise<RawType> {
    return this.fetchByIdentifier<RawType>('type', identifier, ctx);
  }

  fetchMove(identifier: string | number, ctx: Context): Promise<RawMove> {
    return this.fetchByIdentifier<RawMove>('move', identifier, ctx);
  }

  fetchItem(identifier: string | number, ctx: Context): Promise<RawItem> {
    return this.fetchByIdentifier<RawItem>('item', identifier, ctx);
  }

  fetchNature(identifier: string | number, ctx: Context): Promise<RawNature> {
    return this.fetchByIdentifier<RawNature>('nature', identifier, ctx);
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

  fetchGeneration(identifier: string | number, ctx: Context): Promise<RawGeneration> {
    return this.fetchByIdentifier<RawGeneration>('generation', identifier, ctx);
  }

  fetchPokedex(identifier: string | number, ctx: Context): Promise<RawPokedex> {
    return this.fetchByIdentifier<RawPokedex>('pokedex', identifier, ctx);
  }

  fetchEggGroup(identifier: string | number, ctx: Context): Promise<RawEggGroup> {
    return this.fetchByIdentifier<RawEggGroup>('egg-group', identifier, ctx);
  }

  // ---------------------------------------------------------------------------
  // Domain-level methods used by tools
  // ---------------------------------------------------------------------------

  /**
   * Pokémon record for a name or ID. A name with no Pokémon record of its own that names a
   * species (e.g. "deoxys") resolves to that species' default variety ("deoxys-normal").
   * The species lookup runs only after the Pokémon lookup misses, and never for a numeric
   * ID: every species ID is also a Pokémon-record ID, so a numeric miss is final.
   */
  private async resolvePokemon(
    identifier: string | number,
    ctx: Context,
  ): Promise<{ pokemon: RawPokemon; resolvedFromSpecies: string | null }> {
    try {
      return { pokemon: await this.fetchPokemon(identifier, ctx), resolvedFromSpecies: null };
    } catch (err) {
      const isMiss = err instanceof McpError && err.code === JsonRpcErrorCode.NotFound;
      if (!isMiss || /^\d+$/.test(this.normalizeIdentifier(identifier))) throw err;
      const species = await this.fetchSpecies(identifier, ctx);
      const defaultVariety = species.varieties.find((variety) => variety.is_default);
      if (!defaultVariety) throw err;
      return {
        pokemon: await this.fetchPokemon(defaultVariety.pokemon.name, ctx),
        resolvedFromSpecies: species.name,
      };
    }
  }

  /** Full denormalized Pokémon dossier — up to 3+N calls in two async tiers. */
  async getPokemonDossier(
    identifier: string | number,
    includesMoves: boolean,
    gameVersion: string | undefined,
    ctx: Context,
  ): Promise<PokemonDossier> {
    // Tier 1: fetch the pokemon entry first to resolve the canonical species name.
    // For variant forms (e.g. "pikachu-rock-star"), pokemon.species.name is the base
    // species ("pikachu") while pokemon-species/{form} returns 404. Fetch species by
    // the name the pokemon endpoint itself reports to handle both base species and
    // variant forms correctly.
    const { pokemon, resolvedFromSpecies } = await this.resolvePokemon(identifier, ctx);
    const species = await this.fetchSpecies(pokemon.species.name, ctx);

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
      resolvedFromSpecies,
      heightDm: pokemon.height,
      weightHg: pokemon.weight,
      types: pokemon.types.toSorted((a, b) => a.slot - b.slot).map((t) => t.type.name),
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
      cost: raw.cost ?? null,
      prices: (raw.prices ?? []).map((price) => ({
        versionGroup: price.version_group.name,
        currency: price.currency.name,
        purchasePrice: price.purchase_price,
        sellPrice: price.sell_price,
      })),
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

  /** Filter by generation, preserving species IDs. */
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

  /** Filter by type, preserving Pokémon-record IDs, including forms. */
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

  /** Filter by regional pokédex, preserving species IDs rather than regional entry numbers. */
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

  /** Filter by egg group, preserving species IDs. */
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
      evolutionDetails: link.evolution_details.map((method) => ({
        versionGroup: method.version_group?.name ?? null,
        isDefault: method.is_default ?? null,
        item: method.item?.name ?? null,
        trigger: method.trigger.name,
        gender: method.gender ?? null,
        heldItem: method.held_item?.name ?? null,
        knownMove: method.known_move?.name ?? null,
        knownMoveType: method.known_move_type?.name ?? null,
        location: method.location?.name ?? null,
        minLevel: method.min_level ?? null,
        minHappiness: method.min_happiness ?? null,
        minBeauty: method.min_beauty ?? null,
        minAffection: method.min_affection ?? null,
        nearSpecialRock: method.near_special_rock ?? null,
        needsMultiplayer: method.needs_multiplayer ?? null,
        needsOverworldRain: method.needs_overworld_rain ?? null,
        partySpecies: method.party_species?.name ?? null,
        partyType: method.party_type?.name ?? null,
        relativePhysicalStats: method.relative_physical_stats ?? null,
        timeOfDay: method.time_of_day ?? null,
        tradeSpecies: method.trade_species?.name ?? null,
        turnUpsideDown: method.turn_upside_down ?? null,
        region: method.region?.name ?? null,
        requiredPokemonForm: method.required_pokemon_form?.name ?? null,
        evolvedPokemonForm: method.evolved_pokemon_form?.name ?? null,
        usedMove: method.used_move?.name ?? null,
        minMoveCount: method.min_move_count ?? null,
        minSteps: method.min_steps ?? null,
        minDamageTaken: method.min_damage_taken ?? null,
        allowedNatures: method.allowed_natures?.map((nature) => nature.name) ?? null,
        conditionExpression: method.condition_expression
          ? {
              expression: method.condition_expression.expression,
              percentageChance: method.condition_expression.percentage_chance,
              variables: method.condition_expression.variables.map((variable) => variable.name),
            }
          : null,
      })),
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
