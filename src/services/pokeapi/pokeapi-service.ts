/**
 * @fileoverview PokéAPI v2 service — fetches and normalizes Pokémon game data.
 * @module services/pokeapi/pokeapi-service
 */

import { type Context, z } from '@cyanheads/mcp-ts-core';
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
 * Longest normalized identifier sent upstream. The bound limits the request path and cache key.
 */
export const MAX_IDENTIFIER_LENGTH = 100;

/** PokéAPI's name and ID alphabet — the only identifiers safe to use as a storage key. */
const CANONICAL_IDENTIFIER = /^[a-z0-9-]+$/;

const filterCatalogPage = z.object({
  count: z.number().int().positive(),
  next: z.string().nullable(),
  results: z.array(z.object({ name: z.string().regex(CANONICAL_IDENTIFIER) })),
});

const versionGroupMetadata = z.object({
  name: z.string(),
  order: z.number().int(),
});

const MOVE_CHRONOLOGY_TIMEOUT_MS = 3_000;
const VERSION_GROUP_CONCURRENCY = 8;

/** The supplied group name matches no PokéAPI version group. */
export class UnknownVersionGroupError extends Error {}

type MoveMethods = Map<string, Map<string, Set<number>>>;

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

  /** Folds in-game spellings into PokéAPI's name and ID format before validation. */
  normalizeIdentifier(identifier: string | number): string {
    return String(identifier)
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/['’.:]/g, '')
      .replaceAll('♀', '-f')
      .replaceAll('♂', '-m')
      .trim()
      .replace(/\s+/g, '-');
  }

  private requireIdentifier(resource: string, identifier: string | number): string {
    const id = this.normalizeIdentifier(identifier);
    if (id.length > MAX_IDENTIFIER_LENGTH || !CANONICAL_IDENTIFIER.test(id)) {
      throw notFound(`No PokéAPI ${resource} record matches the identifier.`, { resource });
    }
    return id;
  }

  // ---------------------------------------------------------------------------
  // Core fetch with caching
  // ---------------------------------------------------------------------------

  /** Fetches `path` on a cache miss. */
  private async fetchRaw<T>(path: string, ctx: Context, cacheKey: string): Promise<T> {
    const cached = await ctx.state.get<T>(cacheKey);
    if (cached !== null) return cached;

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

    await ctx.state.set(cacheKey, result, { ttl: this.cacheTtlSeconds });
    return result;
  }

  /** Fetches and caches one record. Invalid identifiers fail before storage or network access. */
  private async fetchByIdentifier<T>(
    resource: string,
    identifier: string | number,
    ctx: Context,
  ): Promise<T> {
    const id = this.requireIdentifier(resource, identifier);
    return await this.fetchRaw<T>(`${resource}/${id}`, ctx, `pokeapi/${resource}/${id}`);
  }

  // ---------------------------------------------------------------------------
  // Resource-specific fetchers
  // ---------------------------------------------------------------------------

  /** Fetches the complete filter vocabulary on demand. Returns undefined if PokéAPI cannot supply it. */
  async getFilterNames(
    resource: 'generation' | 'type' | 'pokedex' | 'egg-group',
    ctx: Context,
  ): Promise<string[] | undefined> {
    // Recovery is supplementary. One deadline covers all pages and their response bodies.
    const deadline = AbortSignal.timeout(3_000);
    const signal = AbortSignal.any([ctx.signal, deadline]);
    const names: string[] = [];
    const pageUrl = new URL(`${this.baseUrl}/${resource}`);
    pageUrl.searchParams.set('limit', '100');

    try {
      while (!deadline.aborted) {
        ctx.signal.throwIfAborted();
        const response = await fetchWithTimeout(pageUrl.href, this.requestTimeoutMs, ctx, {
          signal,
          headers: { Accept: 'application/json' },
          expectedStatuses: [404],
        });
        const page = filterCatalogPage.safeParse(await response.json());
        ctx.signal.throwIfAborted();
        if (!page.success) return undefined;
        for (const { name } of page.data.results) names.push(name);
        if (page.data.next === null) return names.length === page.data.count ? names : undefined;
        if (page.data.results.length === 0) return undefined;
        // Stay on the configured endpoint when advancing PokéAPI's offset pagination.
        pageUrl.searchParams.set('offset', String(names.length));
      }
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.RequestCancelled) {
        throw err;
      }
      ctx.signal.throwIfAborted();
      if (!(err instanceof McpError || err instanceof SyntaxError)) throw err;
    }
    ctx.signal.throwIfAborted();
    return undefined;
  }

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
   * A verified species-name mapping skips the initial miss while its configured TTL lasts.
   * Otherwise the species lookup runs only after a Pokémon miss, never for a numeric ID:
   * every species ID is also a Pokémon-record ID, so a numeric miss is final.
   */
  async resolvePokemon(
    identifier: string | number,
    ctx: Context,
  ): Promise<{ pokemon: RawPokemon; resolvedFromSpecies: string | null }> {
    const id = this.requireIdentifier('pokemon', identifier);
    const isNumeric = /^\d+$/.test(id);
    const mappingKey = isNumeric ? null : `pokeapi/species-resolution/${id}`;
    if (mappingKey !== null) {
      const recordName = await ctx.state.get<string>(mappingKey);
      if (recordName !== null) {
        return { pokemon: await this.fetchPokemon(recordName, ctx), resolvedFromSpecies: id };
      }
    }
    try {
      return { pokemon: await this.fetchPokemon(id, ctx), resolvedFromSpecies: null };
    } catch (err) {
      const isMiss = err instanceof McpError && err.code === JsonRpcErrorCode.NotFound;
      if (!isMiss || isNumeric) throw err;
      const species = await this.fetchSpecies(id, ctx);
      const defaultVariety = species.varieties.find((variety) => variety.is_default);
      if (!defaultVariety) throw err;
      const pokemon = await this.fetchPokemon(defaultVariety.pokemon.name, ctx);
      if (mappingKey !== null && species.name === id) {
        await ctx.state.set(mappingKey, pokemon.name, { ttl: this.cacheTtlSeconds });
      }
      return {
        pokemon,
        resolvedFromSpecies: species.name,
      };
    }
  }

  /** Full denormalized Pokémon dossier, with optional version-group learnset selection. */
  async getPokemonDossier(
    identifier: string | number,
    includesMoves: boolean,
    gameVersion: string | undefined,
    ctx: Context,
    requestedVersionGroup?: string,
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

    const notices: string[] = [];
    const englishEntries = species.flavor_text_entries.filter(
      (entry) => entry.language.name === 'en',
    );
    const versionName = gameVersion?.toLowerCase().trim();
    const match = gameVersion
      ? englishEntries.find((entry) => entry.version.name === versionName)
      : undefined;
    const flavorEntry = match ?? englishEntries.at(-1);
    if (!flavorEntry) {
      notices.push(
        gameVersion
          ? `No English flavor text is available for ${gameVersion} or any other version.`
          : 'No English flavor text is available.',
      );
    } else if (gameVersion && !match) {
      notices.push(
        `No English flavor text is available for ${gameVersion}. Showing the entry from ${flavorEntry.version.name}.`,
      );
    }
    const shouldIncludeMoves = includesMoves || requestedVersionGroup !== undefined;
    const moves = shouldIncludeMoves
      ? await this.summarizeMoves(pokemon.moves, requestedVersionGroup, notices, ctx)
      : [];
    const moveCount = new Set(pokemon.moves.map(({ move }) => move.name)).size;
    if (!shouldIncludeMoves && moveCount > 0) {
      notices.push('Pass include_moves=true to include the full move summary.');
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
      speciesId: species.id,
      pokedexNumbers: species.pokedex_numbers.map(({ pokedex, entry_number }) => ({
        pokedex: pokedex.name,
        entryNumber: entry_number,
      })),
      hatchCounter: species.hatch_counter ?? null,
      baseHappiness: species.base_happiness ?? null,
      isBaby: species.is_baby,
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
      moveCount,
      notices,
      speciesFlavorText: flavorEntry?.flavor_text.replace(/[\f\n]/g, ' ') ?? null,
      flavorTextVersion: flavorEntry?.version.name ?? null,
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

  /** Filter by regional pokédex, preserving species IDs and regional entry numbers. */
  async getPokemonByPokedex(
    pokedex: string,
    ctx: Context,
  ): Promise<Array<PokemonListEntry & { entryNumber: number }>> {
    const raw = await this.fetchPokedex(pokedex, ctx);
    return raw.pokemon_entries.map((e) => {
      const idMatch = e.pokemon_species.url.match(/\/(\d+)\/?$/);
      return {
        id: idMatch ? Number(idMatch[1]) : 0,
        name: e.pokemon_species.name,
        entryNumber: e.entry_number,
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

  private async readVersionGroup(name: string, ctx: Context, signal: AbortSignal): Promise<number> {
    const key = `pokeapi/version-group-order/${name}`;
    signal.throwIfAborted();
    const cached = await ctx.state.get<number>(key);
    signal.throwIfAborted();
    if (cached !== null) return cached;

    const response = await fetchWithTimeout(
      `${this.baseUrl}/version-group/${name}`,
      this.requestTimeoutMs,
      ctx,
      {
        signal,
        headers: { Accept: 'application/json' },
        expectedStatuses: [404],
      },
    );
    const group = versionGroupMetadata.safeParse(await response.json());
    signal.throwIfAborted();
    if (!group.success || group.data.name !== name) {
      throw serviceUnavailable('PokéAPI returned invalid version-group metadata.');
    }
    await ctx.state.set(key, group.data.order, { ttl: this.cacheTtlSeconds });
    return group.data.order;
  }

  private async readMoveChronology(
    names: Set<string>,
    ctx: Context,
  ): Promise<Map<string, number> | undefined> {
    if (names.size === 0) return new Map();
    const deadline = AbortSignal.timeout(MOVE_CHRONOLOGY_TIMEOUT_MS);
    const signal = AbortSignal.any([ctx.signal, deadline]);
    const orders = new Map<string, number>();
    const groups = [...names];
    for (let i = 0; i < groups.length; i += VERSION_GROUP_CONCURRENCY) {
      const results = await Promise.allSettled(
        groups.slice(i, i + VERSION_GROUP_CONCURRENCY).map(async (name) => {
          if (!CANONICAL_IDENTIFIER.test(name) || name.length > MAX_IDENTIFIER_LENGTH) {
            throw serviceUnavailable('PokéAPI returned an invalid version-group name.');
          }
          orders.set(name, await this.readVersionGroup(name, ctx, signal));
        }),
      );
      ctx.signal.throwIfAborted();
      let unavailable = false;
      for (const result of results) {
        if (result.status === 'fulfilled') continue;
        const err: unknown = result.reason;
        if (
          err instanceof SyntaxError ||
          (err instanceof McpError &&
            (err.data?.errorSource === 'FetchHttpError' ||
              err.code === JsonRpcErrorCode.DatabaseError ||
              err.code === JsonRpcErrorCode.SerializationError ||
              err.code === JsonRpcErrorCode.ServiceUnavailable ||
              err.code === JsonRpcErrorCode.Timeout)) ||
          (deadline.aborted &&
            (err === deadline.reason ||
              (err instanceof McpError && err.code === JsonRpcErrorCode.RequestCancelled)))
        ) {
          unavailable = true;
        } else {
          throw err;
        }
      }
      if (unavailable) return undefined;
    }
    return orders;
  }

  private async summarizeMoves(
    moves: RawPokemon['moves'],
    requestedVersionGroup: string | undefined,
    notices: string[],
    ctx: Context,
  ): Promise<PokemonMoveSummary[]> {
    const scope =
      requestedVersionGroup === undefined
        ? undefined
        : this.normalizeIdentifier(requestedVersionGroup);
    if (
      scope !== undefined &&
      (scope.length > MAX_IDENTIFIER_LENGTH ||
        !CANONICAL_IDENTIFIER.test(scope) ||
        /^\d+$/.test(scope))
    ) {
      throw new UnknownVersionGroupError();
    }

    const byMove = new Map<string, MoveMethods>();
    for (const { move, version_group_details } of moves) {
      for (const detail of version_group_details) {
        const group = detail.version_group.name;
        if (scope !== undefined && group !== scope) continue;
        const method = detail.move_learn_method.name;
        const methods = byMove.get(move.name) ?? new Map();
        const groups = methods.get(method) ?? new Map<string, Set<number>>();
        const levels = groups.get(group) ?? new Set<number>();
        levels.add(detail.level_learned_at);
        // Preserve each group's last source position for the disclosed fallback.
        groups.delete(group);
        groups.set(group, levels);
        methods.set(method, groups);
        byMove.set(move.name, methods);
      }
    }

    if (scope !== undefined && byMove.size === 0) {
      try {
        await this.readVersionGroup(scope, ctx, ctx.signal);
      } catch (err) {
        if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
          throw new UnknownVersionGroupError();
        }
        throw err;
      }
      notices.push(`No learnable moves are listed for ${scope}.`);
    }

    const ambiguous = new Set<string>();
    for (const methods of byMove.values()) {
      for (const groups of methods.values()) {
        if (groups.size > 1) for (const group of groups.keys()) ambiguous.add(group);
      }
    }
    const orders = await this.readMoveChronology(ambiguous, ctx);
    if (!orders) {
      notices.push(
        'Version-group chronology could not be established. Each move and method uses its last group in PokéAPI source order.',
      );
    }

    const summaries: PokemonMoveSummary[] = [];
    for (const [name, methods] of byMove) {
      for (const [learnMethod, groups] of methods) {
        let versionGroup = '';
        let levels = new Set<number>();
        let latestOrder = -Infinity;
        for (const [group, groupLevels] of groups) {
          const order = orders?.get(group) ?? -Infinity;
          if (order < latestOrder) continue;
          versionGroup = group;
          levels = groupLevels;
          latestOrder = order;
        }
        for (const levelLearnedAt of levels) {
          summaries.push({ name, learnMethod, levelLearnedAt, versionGroup });
        }
      }
    }
    return summaries.sort((a, b) => a.name.localeCompare(b.name));
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
