import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../schema";
import { FACTORY_CONFIGS, type FactoryInfo } from "./factories";
import type {
  CreateDrizzleDbOptions,
  CreatePgClientOptions,
  DrizzleDb,
  FactoryRegistry,
  FactoryRegistryConfig,
  GetMainDbOptions,
} from "./types";

interface FactoryRegistryState {
  signature: string;
  factoryList: FactoryInfo[];
  pools: Map<string, DrizzleDb>;
  defaultDb: DrizzleDb | null;
}

interface FactoryEntry {
  factory: FactoryInfo;
  connectionString: string | null;
}

const globalCache = globalThis as typeof globalThis & {
  __sharedDrizzleDbCache?: Map<string, DrizzleDb>;
  __sharedFactoryRegistryCache?: Map<string, FactoryRegistryState>;
};

function getDbCache() {
  if (!globalCache.__sharedDrizzleDbCache) {
    globalCache.__sharedDrizzleDbCache = new Map<string, DrizzleDb>();
  }
  return globalCache.__sharedDrizzleDbCache;
}

function getRegistryCache() {
  if (!globalCache.__sharedFactoryRegistryCache) {
    globalCache.__sharedFactoryRegistryCache = new Map<string, FactoryRegistryState>();
  }
  return globalCache.__sharedFactoryRegistryCache;
}

export function createPgClient(url: string, options: CreatePgClientOptions) {
  return postgres(url, {
    max: options.max ?? 5,
    idle_timeout: 20,
    connect_timeout: 10,
    onnotice: options.onnotice,
    debug: options.debugSql
      ? (_connection, query, parameters) => {
          console.log(`[db:${options.poolName}]`, { query, parameters });
        }
      : undefined,
  });
}

export function createDrizzleDb(url: string, options: CreateDrizzleDbOptions): DrizzleDb {
  const client = createPgClient(url, options);
  return drizzle(client, {
    schema,
    logger: options.logger ?? false,
  });
}

export function getMainDb(connectionString: string, options: GetMainDbOptions): DrizzleDb {
  const cacheKey = `main:${options.cacheKey}`;
  const cache = getDbCache();

  if (!cache.has(cacheKey)) {
    cache.set(
      cacheKey,
      createDrizzleDb(connectionString, {
        poolName: options.poolName ?? options.cacheKey,
        max: options.max,
        debugSql: options.debugSql,
        logger: options.logger,
      })
    );
  }

  return cache.get(cacheKey)!;
}

function resolveFactoryEntries(config: FactoryRegistryConfig): FactoryEntry[] {
  const factories = config.factories ?? FACTORY_CONFIGS;
  return factories.map((factory) => ({
    factory,
    connectionString: config.resolveConnectionString(factory) || null,
  }));
}

function getRegistrySignature(
  config: FactoryRegistryConfig,
  factoryEntries: readonly FactoryEntry[]
): string {
  return [
    ...factoryEntries.map(
      ({ factory, connectionString }) => `${factory.key}:${factory.name}:${connectionString || ""}`
    ),
    `fallback:${config.fallbackFactory?.key || ""}:${config.fallbackConnectionString || ""}`,
    `max:${config.max ?? 5}`,
    `debug:${config.debugSql ? "1" : "0"}`,
    `logger:${config.logger === false ? "0" : "1"}`,
  ].join("|");
}

function resolveRegistryState(
  config: FactoryRegistryConfig,
  factoryEntries: readonly FactoryEntry[],
  signature: string
): FactoryRegistryState {
  const pools = new Map<string, DrizzleDb>();
  const factoryList: FactoryInfo[] = [];

  for (const { factory, connectionString } of factoryEntries) {
    if (!connectionString) continue;
    const db = createDrizzleDb(connectionString, {
      poolName: `${config.poolNamePrefix || config.cacheKey}:${factory.key}`,
      max: config.max,
      debugSql: config.debugSql,
      logger: config.logger,
    });
    pools.set(factory.key, db);
    factoryList.push(factory);
  }

  let defaultDb: DrizzleDb | null = factoryList[0]
    ? pools.get(factoryList[0].key) || null
    : null;

  if (!defaultDb && config.fallbackConnectionString) {
    const fallbackFactory = config.fallbackFactory || FACTORY_CONFIGS[0];
    defaultDb = createDrizzleDb(config.fallbackConnectionString, {
      poolName: `${config.poolNamePrefix || config.cacheKey}:${fallbackFactory.key}`,
      max: config.max,
      debugSql: config.debugSql,
      logger: config.logger,
    });
    factoryList.push(fallbackFactory);
  }

  return {
    signature,
    factoryList,
    pools,
    defaultDb,
  };
}

export function createFactoryRegistry(config: FactoryRegistryConfig): FactoryRegistry {
  const cache = getRegistryCache();

  const getState = (): FactoryRegistryState => {
    const factoryEntries = resolveFactoryEntries(config);
    const signature = getRegistrySignature(config, factoryEntries);
    const cached = cache.get(config.cacheKey);

    if (!cached || cached.signature !== signature) {
      const nextState = resolveRegistryState(config, factoryEntries, signature);
      cache.set(config.cacheKey, nextState);
      return nextState;
    }

    return cached;
  };

  return {
    getFactories() {
      return getState().factoryList;
    },
    getFactoryDb(factoryKey: string) {
      const state = getState();
      return state.pools.get(factoryKey) || state.defaultDb;
    },
    getDefaultDb() {
      return getState().defaultDb;
    },
  };
}
