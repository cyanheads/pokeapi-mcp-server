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
import { effectTextOf, foldFlavorText } from './effect-text.js';
import { walkEvolutionChain } from './evolution-chain.js';
import {
  MachineReadPause,
  type MachineReadSettings,
  type MachineRow,
  readMachineRows,
} from './machine-reads.js';
import { readCache, writeCache } from './state-cache.js';
import {
  buildGenerationScope,
  type GenerationScope,
  generationIdOf,
  matchupsOf,
  NotInGenerationError,
  offenseOf,
  pokemonTypes,
  typeNamesBySlot,
  UnknownTypeError,
} from './type-matchups.js';
import type {
  AbilityDetails,
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
  RawEggGroup,
  RawEvolutionChain,
  RawGeneration,
  RawItem,
  RawMachineRef,
  RawMove,
  RawNature,
  RawPokedex,
  RawPokemon,
  RawPokemonForm,
  RawPokemonSpecies,
  RawType,
  TypeMatchups,
  TypeSetMatchups,
} from './types.js';
import { isUpstreamUnavailable } from './upstream-failure.js';

/**
 * Longest normalized identifier sent upstream. The bound limits the request path and cache key.
 */
export const MAX_IDENTIFIER_LENGTH = 100;

/** PokéAPI's name and ID alphabet — the only identifiers safe to use as a storage key. */
const CANONICAL_IDENTIFIER = /^[a-z0-9-]+$/;

/** A 404 on a record PokéAPI itself listed is an upstream gap, never the caller's miss. */
function upstreamGap(what: string) {
  return (err: unknown): never => {
    if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
      throw serviceUnavailable(`PokéAPI lists ${what} but serves no record for it.`, undefined, {
        cause: err,
      });
    }
    throw err;
  };
}

/** Trailing numeric ID of a PokéAPI resource URL; 0 when the URL carries none. */
function trailingId(url: string): number {
  const match = /\/(\d+)\/?$/.exec(url);
  return match ? Number(match[1]) : 0;
}

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

/** No PokéAPI generation matches the supplied name or ID. */
export class UnknownGenerationError extends Error {
  /** PokéAPI's generation names, when it could list them. */
  readonly validNames: string[] | undefined;
  constructor(validNames: string[] | undefined, options?: ErrorOptions) {
    super('No PokéAPI generation matches the supplied name or ID.', options);
    this.validNames = validNames;
  }
}

type MoveMethods = Map<string, Map<string, Set<number>>>;

export class PokeApiService {
  private readonly baseUrl: string;
  private readonly cacheTtlSeconds: number;
  /** One per service: its rate-limit pause outlives each call. */
  private readonly machineSettings: MachineReadSettings;
  private readonly requestTimeoutMs: number;

  // config and storage are accepted per the init/accessor pattern but not used directly:
  // cached state goes through ctx.state via state-cache.ts
  constructor(_config: AppConfig, _storage: StorageService) {
    const serverConfig = getServerConfig();
    this.baseUrl = serverConfig.baseUrl;
    this.cacheTtlSeconds = serverConfig.cacheTtlSeconds;
    this.requestTimeoutMs = serverConfig.requestTimeoutMs;
    this.machineSettings = {
      baseUrl: this.baseUrl,
      cacheTtlSeconds: this.cacheTtlSeconds,
      pause: new MachineReadPause(),
      requestTimeoutMs: this.requestTimeoutMs,
    };
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

  /** Fetches `path` on a cache miss; a cache the storage provider fails only costs the request. */
  private async fetchRaw<T>(path: string, ctx: Context, cacheKey: string): Promise<T> {
    const cached = await readCache<T>(ctx, cacheKey);
    if (cached !== null) return cached;

    const timeoutMs = this.requestTimeoutMs;
    const baseUrl = this.baseUrl;
    const result = await withRetry(
      async () => {
        const response = await fetchWithTimeout(`${baseUrl}/${path}`, timeoutMs, ctx, {
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

        try {
          return JSON.parse(text) as T;
        } catch (err) {
          throw serviceUnavailable(
            'PokéAPI returned a response that is not JSON.',
            { path },
            { cause: err },
          );
        }
      },
      {
        operation: 'PokéAPI request',
        baseDelayMs: 500,
        context: ctx,
        signal: ctx.signal,
      },
    );

    await writeCache(ctx, cacheKey, result, this.cacheTtlSeconds);
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

  /** Reads the chain a species record names, by its ID, from the configured base URL. */
  fetchEvolutionChain(url: string, ctx: Context): Promise<RawEvolutionChain> {
    const id = /\/evolution-chain\/(\d+)\/?$/.exec(url)?.[1];
    if (id === undefined) {
      throw serviceUnavailable('PokéAPI named an evolution chain without an ID.', { url });
    }
    return this.fetchRaw<RawEvolutionChain>(
      `evolution-chain/${id}`,
      ctx,
      `pokeapi/evolution-chain/${id}`,
    );
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
      // Outside the `pokeapi/nature/{identifier}` namespace, so no identifier can read the catalog.
      'pokeapi/nature-catalog',
    );
    const natures = await Promise.all(list.results.map((r) => this.fetchNature(r.name, ctx)));
    return natures;
  }

  fetchGeneration(identifier: string | number, ctx: Context): Promise<RawGeneration> {
    return this.fetchByIdentifier<RawGeneration>('generation', identifier, ctx);
  }

  fetchPokemonForm(identifier: string | number, ctx: Context): Promise<RawPokemonForm> {
    return this.fetchByIdentifier<RawPokemonForm>('pokemon-form', identifier, ctx);
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
   * every species ID is also a Pokémon-record ID, so a numeric miss is final. The Pokémon is
   * missing only when neither record nor species exists; a 404 on the default variety a species
   * names is an upstream gap.
   */
  async resolvePokemon(
    identifier: string | number,
    ctx: Context,
  ): Promise<{ pokemon: RawPokemon; resolvedFromSpecies: string | null }> {
    const id = this.requireIdentifier('pokemon', identifier);
    const isNumeric = /^\d+$/.test(id);
    const mappingKey = isNumeric ? null : `pokeapi/species-resolution/${id}`;
    if (mappingKey !== null) {
      const recordName = await readCache<string>(ctx, mappingKey);
      if (recordName !== null) {
        const pokemon = await this.fetchPokemon(recordName, ctx).catch(
          upstreamGap(`Pokémon ${recordName} as the default variety of ${id}`),
        );
        return { pokemon, resolvedFromSpecies: id };
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
      const pokemon = await this.fetchPokemon(defaultVariety.pokemon.name, ctx).catch(
        upstreamGap(
          `Pokémon ${defaultVariety.pokemon.name} as the default variety of ${species.name}`,
        ),
      );
      if (mappingKey !== null && species.name === id) {
        await writeCache(ctx, mappingKey, pokemon.name, this.cacheTtlSeconds);
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
    // Only resolvePokemon decides that the Pokémon is missing; a 404 on a record its own
    // data names is an upstream gap.
    const { pokemon, resolvedFromSpecies } = await this.resolvePokemon(identifier, ctx);
    const species = await this.fetchSpecies(pokemon.species.name, ctx).catch(
      upstreamGap(`species ${pokemon.species.name}`),
    );

    // Tier 2: evolution chain + ability details in parallel
    const [evolutionChain, ...abilityDetails] = await Promise.all([
      this.fetchEvolutionChain(species.evolution_chain.url, ctx).catch(
        upstreamGap(`the evolution chain of ${species.name}`),
      ),
      ...pokemon.abilities.map((a) =>
        this.fetchAbility(a.ability.name, ctx).catch(upstreamGap(`ability ${a.ability.name}`)),
      ),
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

    const toStat = (s: RawPokemon['stats'][number]): PokemonStat => ({
      name: s.stat.name,
      baseStat: s.base_stat,
      effort: s.effort,
    });

    const notices: string[] = [];
    const englishEntries = species.flavor_text_entries.filter(
      (entry) => entry.language.name === 'en',
    );
    // Game versions match by key, so "Let's Go, Pikachu!" selects lets-go-pikachu; blank asks for none.
    const versionKey = (version: string) =>
      this.normalizeIdentifier(version).replace(/[^a-z0-9]/g, '');
    const requestedVersion = gameVersion?.trim() || undefined;
    const requestedKey = requestedVersion && versionKey(requestedVersion);
    const match = requestedKey
      ? englishEntries.find((entry) => versionKey(entry.version.name) === requestedKey)
      : undefined;
    const flavorEntry = match ?? englishEntries.at(-1);
    if (!flavorEntry) {
      notices.push(
        requestedVersion
          ? `No English flavor text is available for ${requestedVersion} or any other version.`
          : 'No English flavor text is available.',
      );
    } else if (requestedVersion && !match) {
      notices.push(
        `No English flavor text matches ${requestedVersion}. Showing the entry from ${flavorEntry.version.name}.`,
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
      types: typeNamesBySlot(pokemon.types),
      stats: pokemon.stats.map(toStat),
      abilities,
      pastTypes: pokemon.past_types.map((entry) => ({
        throughGeneration: entry.generation.name,
        types: typeNamesBySlot(entry.types),
      })),
      pastAbilities: pokemon.past_abilities.map((entry) => ({
        throughGeneration: entry.generation.name,
        abilities: entry.abilities.map((a) => ({
          name: a.ability?.name ?? null,
          isHidden: a.is_hidden,
          slot: a.slot,
        })),
      })),
      pastStats: pokemon.past_stats.map((entry) => ({
        throughGeneration: entry.generation.name,
        stats: entry.stats.map(toStat),
      })),
      sprites: {
        frontDefault: pokemon.sprites.front_default,
        frontShiny: pokemon.sprites.front_shiny,
        officialArtwork: pokemon.sprites.other?.['official-artwork']?.front_default ?? null,
      },
      moves,
      moveCount,
      notices,
      speciesFlavorText: flavorEntry ? foldFlavorText(flavorEntry.flavor_text) : null,
      flavorTextVersion: flavorEntry?.version.name ?? null,
      genus: genusEntry?.genus ?? null,
      captureRate: species.capture_rate,
      growthRate: species.growth_rate.name,
      genderRate: species.gender_rate,
      isLegendary: species.is_legendary,
      isMythical: species.is_mythical,
      evolutionChain: walkEvolutionChain(evolutionChain.chain),
      varieties,
      generation: species.generation.name,
      eggGroups: species.egg_groups.map((e) => e.name),
    };
  }

  /** Current matchups for a single type. */
  async getTypeMatchups(typeName: string, ctx: Context): Promise<TypeMatchups> {
    const raw = await this.fetchType(typeName, ctx);
    const dr = raw.damage_relations;
    return {
      typeName: raw.name,
      offensiveRelations: offenseOf(dr),
      defensiveRelations: {
        weakTo: dr.double_damage_from.map((t) => t.name),
        resists: dr.half_damage_from.map((t) => t.name),
        immuneTo: dr.no_damage_from.map((t) => t.name),
      },
    };
  }

  /**
   * Generation for a PokéAPI name ("generation-v"), in-game spelling ("Generation V"), or ID ("5").
   * A miss throws UnknownGenerationError carrying PokéAPI's generation names.
   */
  async resolveGeneration(supplied: string, ctx: Context): Promise<RawGeneration> {
    try {
      return await this.fetchGeneration(supplied, ctx);
    } catch (err) {
      if (!(err instanceof McpError) || err.code !== JsonRpcErrorCode.NotFound) throw err;
      throw new UnknownGenerationError(await this.getFilterNames('generation', ctx), {
        cause: err,
      });
    }
  }

  /**
   * Scope for a generation name, in-game spelling, or ID: the generation plus what each later
   * generation introduced. The catalog and every later generation are read through the cache.
   */
  async getGenerationScope(supplied: string, ctx: Context): Promise<GenerationScope> {
    const generation = await this.resolveGeneration(supplied, ctx);
    const catalog = await this.fetchRaw<{ results: NamedResource[] }>(
      'generation?limit=100',
      ctx,
      // Outside the per-record `pokeapi/generation/{id}` keys a caller's identifier can reach.
      'pokeapi/generation-catalog',
    ).catch(upstreamGap('a generation catalog'));
    const later = await Promise.all(
      catalog.results
        .filter((ref) => generationIdOf(ref) > generation.id)
        .map((ref) => this.fetchGeneration(ref.name, ctx).catch(upstreamGap(ref.name))),
    );
    return buildGenerationScope(generation, later);
  }

  /**
   * Matchups for one or two type names from one read of each type record; names of the same
   * record count once. With a scope, relations are as of its generation, and a type it did not
   * have throws NotInGenerationError. Throws UnknownTypeError naming every name with no record.
   */
  async getTypeSetMatchups(
    types: string[],
    ctx: Context,
    scope?: GenerationScope,
  ): Promise<TypeSetMatchups> {
    const reads = await Promise.allSettled(types.map((type) => this.fetchType(type, ctx)));
    const failure = reads.find(
      (read): read is PromiseRejectedResult =>
        read.status === 'rejected' &&
        !(read.reason instanceof McpError && read.reason.code === JsonRpcErrorCode.NotFound),
    );
    if (failure) throw failure.reason;
    const missing = types.filter((_, index) => reads[index]?.status === 'rejected');
    if (missing.length > 0) throw new UnknownTypeError(missing);
    const records = reads.flatMap((read) => (read.status === 'fulfilled' ? [read.value] : []));
    return matchupsOf([...new Map(records.map((r) => [r.name, r])).values()], scope);
  }

  /**
   * A Pokémon record's typing in slot order: current, or as it stood in the scope's generation.
   * A scope reads the record's form and throws NotInGenerationError when that form came from a
   * version group released after the generation; without one, nothing is read.
   */
  async getPokemonTypes(
    pokemon: RawPokemon,
    ctx: Context,
    scope?: GenerationScope,
  ): Promise<string[]> {
    if (scope) {
      const [form] = pokemon.forms;
      if (!form) throw serviceUnavailable(`PokéAPI lists no form for Pokémon ${pokemon.name}.`);
      const { version_group } = await this.fetchPokemonForm(form.name, ctx).catch(
        upstreamGap(`form ${form.name}`),
      );
      const introducedIn = scope.laterVersionGroups.get(version_group.name);
      if (introducedIn) {
        throw new NotInGenerationError('pokemon', pokemon.name, introducedIn, scope);
      }
    }
    return pokemonTypes(pokemon, scope);
  }

  /**
   * Move details normalized, with the TM, TR, or HM that teaches it in each version group.
   * A supplied `versionGroup` limits those rows; an unknown one throws UnknownVersionGroupError.
   */
  async getMoveDetails(
    identifier: string | number,
    ctx: Context,
    versionGroup?: string,
  ): Promise<MoveDetails> {
    const scope = versionGroup === undefined ? undefined : this.parseVersionGroup(versionGroup);
    const raw = await this.fetchMove(identifier, ctx);
    const { rows, notices } = await this.readMachines(raw.name, 'item', raw.machines, scope, ctx);
    return {
      id: raw.id,
      name: raw.name,
      type: raw.type.name,
      damageClass: raw.damage_class?.name ?? null,
      // PokéAPI lists 0 for some moves with no base power or accuracy check; no move has either at 0.
      power: raw.power || null,
      accuracy: raw.accuracy || null,
      pp: raw.pp ?? null,
      priority: raw.priority,
      effectChance: raw.effect_chance ?? null,
      ...effectTextOf(raw.effect_entries, raw.flavor_text_entries),
      target: raw.target.name,
      statChanges: raw.stat_changes.map((sc) => ({
        stat: sc.stat.name,
        change: sc.change,
      })),
      learnedByPokemon: raw.learned_by_pokemon.map((p) => p.name),
      machines: rows.map(({ versionGroup, name }) => ({ versionGroup, item: name })),
      notices,
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

  /**
   * Item details normalized, with the move a TM, TR, or HM teaches in each version group.
   * A supplied `versionGroup` limits those rows; an unknown one throws UnknownVersionGroupError.
   */
  async getItemDetails(
    identifier: string | number,
    ctx: Context,
    versionGroup?: string,
  ): Promise<ItemDetails> {
    const scope = versionGroup === undefined ? undefined : this.parseVersionGroup(versionGroup);
    const raw = await this.fetchItem(identifier, ctx);
    const { rows, notices } = await this.readMachines(raw.name, 'move', raw.machines, scope, ctx);
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
      ...effectTextOf(raw.effect_entries, raw.flavor_text_entries),
      attributes: raw.attributes.map((a) => a.name),
      heldByPokemon: (raw.held_by_pokemon ?? []).map((h) => h.pokemon.name),
      spriteUrl: raw.sprites.default,
      machines: rows.map(({ versionGroup, name }) => ({ versionGroup, move: name })),
      notices,
    };
  }

  /**
   * Machine rows of an item or move, limited to `scope` when one is given. A scope no row names
   * costs one existence read: an unknown group throws UnknownVersionGroupError, a known one
   * returns no rows and a notice.
   */
  private async readMachines(
    owner: string,
    report: 'item' | 'move',
    refs: RawMachineRef[],
    scope: string | undefined,
    ctx: Context,
  ): Promise<{ notices: string[]; rows: MachineRow[] }> {
    const selected =
      scope === undefined ? refs : refs.filter((ref) => ref.version_group.name === scope);
    if (scope !== undefined && selected.length === 0) {
      await this.requireVersionGroup(scope, ctx);
      const absent =
        report === 'move'
          ? `PokéAPI lists no move taught by ${owner} in ${scope}.`
          : `PokéAPI lists no TM, TR, or HM that teaches ${owner} in ${scope}.`;
      return { rows: [], notices: [absent] };
    }
    return await readMachineRows(selected, { owner, report }, this.machineSettings, ctx);
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

  /** Filter by generation, preserving species IDs. A miss throws UnknownGenerationError. */
  async getPokemonByGeneration(generation: string, ctx: Context): Promise<PokemonListEntry[]> {
    const raw = await this.resolveGeneration(generation, ctx);
    return raw.pokemon_species.map((s) => ({ id: trailingId(s.url), name: s.name }));
  }

  /** Filter by type, preserving Pokémon-record IDs, including forms. */
  async getPokemonByType(typeName: string, ctx: Context): Promise<PokemonListEntry[]> {
    const raw = await this.fetchType(typeName, ctx);
    return raw.pokemon.map((p) => ({ id: trailingId(p.pokemon.url), name: p.pokemon.name }));
  }

  /** Filter by regional pokédex, preserving species IDs and regional entry numbers. */
  async getPokemonByPokedex(
    pokedex: string,
    ctx: Context,
  ): Promise<Array<PokemonListEntry & { entryNumber: number }>> {
    const raw = await this.fetchPokedex(pokedex, ctx);
    return raw.pokemon_entries.map((e) => ({
      id: trailingId(e.pokemon_species.url),
      name: e.pokemon_species.name,
      entryNumber: e.entry_number,
    }));
  }

  /** Filter by egg group, preserving species IDs. */
  async getPokemonByEggGroup(eggGroup: string, ctx: Context): Promise<PokemonListEntry[]> {
    const raw = await this.fetchEggGroup(eggGroup, ctx);
    return raw.pokemon_species.map((s) => ({ id: trailingId(s.url), name: s.name }));
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async readVersionGroup(name: string, ctx: Context, signal: AbortSignal): Promise<number> {
    const key = `pokeapi/version-group-order/${name}`;
    signal.throwIfAborted();
    const cached = await readCache<number>(ctx, key);
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
    // A body that is not JSON fails the schema below as invalid metadata, never as caller input.
    const body: unknown = await response.json().catch((err: unknown) => {
      if (err instanceof SyntaxError) return;
      throw err;
    });
    const group = versionGroupMetadata.safeParse(body);
    signal.throwIfAborted();
    if (!group.success || group.data.name !== name) {
      throw serviceUnavailable('PokéAPI returned invalid version-group metadata.');
    }
    await writeCache(ctx, key, group.data.order, this.cacheTtlSeconds);
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
          isUpstreamUnavailable(err) ||
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

  /**
   * Canonical version-group name for a caller's `version_group`. A name no PokéAPI version group
   * can carry (noncanonical, overlong, or a bare ID) throws UnknownVersionGroupError unrequested.
   */
  private parseVersionGroup(requested: string): string {
    const scope = this.normalizeIdentifier(requested);
    if (
      scope.length > MAX_IDENTIFIER_LENGTH ||
      !CANONICAL_IDENTIFIER.test(scope) ||
      /^\d+$/.test(scope)
    ) {
      throw new UnknownVersionGroupError();
    }
    return scope;
  }

  /**
   * Throws UnknownVersionGroupError unless PokéAPI lists `scope`. Callers read it only when no
   * record row names the group, so a represented group costs no request.
   */
  private async requireVersionGroup(scope: string, ctx: Context): Promise<void> {
    try {
      await this.readVersionGroup(scope, ctx, ctx.signal);
    } catch (err) {
      if (err instanceof McpError && err.code === JsonRpcErrorCode.NotFound) {
        throw new UnknownVersionGroupError();
      }
      throw err;
    }
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
        : this.parseVersionGroup(requestedVersionGroup);

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
      await this.requireVersionGroup(scope, ctx);
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
