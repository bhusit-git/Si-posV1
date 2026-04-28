import { cookies } from "next/headers";
import { getSharedDbEnv } from "@/lib/shared/db-runtime";
import {
  FACTORY_CONFIGS,
  createFactoryRegistry,
  getMainDb as getSharedMainDb,
  type DrizzleDb,
  type FactoryInfo,
} from "@/lib/shared/db-runtime";
import * as schema from "./schema";
import { getSession } from "@/lib/auth";
import { DiagnosticError } from "@/lib/diagnostic-error";
import { logDiagnosticEvent } from "@/lib/error-logging";

const FACTORY_COOKIE = "superice_factory";
export type DrizzleDB = DrizzleDb;

function requireDb(db: DrizzleDB | null, message: string): DrizzleDB {
  if (!db) {
    throw new DiagnosticError(message, {
      code: "SRV-CONFIG-DB-1001",
      category: "server.config",
      source: "database.runtime",
      operation: "resolve-connection",
      title: "Database connection is not configured",
      hint: "ตรวจสอบ DATABASE_URL หรือค่าฐานข้อมูลของ factory นี้",
      retryable: false,
    });
  }
  return db;
}

let sharedDbEnvCache: ReturnType<typeof getSharedDbEnv> | null = null;
let registryCache: ReturnType<typeof createFactoryRegistry> | null = null;
let mainDbCache: DrizzleDB | null = null;

function getDbEnv() {
  if (!sharedDbEnvCache) {
    sharedDbEnvCache = getSharedDbEnv();
  }
  return sharedDbEnvCache;
}

function getDbDebugSql(): boolean {
  return getDbEnv().dbDebugSql;
}

function getRegistry() {
  if (!registryCache) {
    const sharedDbEnv = getDbEnv();
    registryCache = createFactoryRegistry({
      cacheKey: "superice-pos:factory",
      factories: FACTORY_CONFIGS,
      resolveConnectionString: (factory) => sharedDbEnv.getFactoryDatabaseUrl(factory.key),
      fallbackConnectionString: sharedDbEnv.mainDatabaseUrl,
      fallbackFactory: { key: "default", name: "Default" },
      max: 10,
      debugSql: getDbDebugSql(),
      logger: false,
      poolNamePrefix: "superice-pos",
    });
  }

  return registryCache;
}

function getFactoryList(): FactoryInfo[] {
  return getRegistry().getFactories();
}

function getDefaultKey(): string {
  return getFactoryList()[0]?.key || "default";
}

function getDefaultDb(): DrizzleDB {
  return requireDb(
    getRegistry().getDefaultDb(),
    "DATABASE_URL environment variable is required. Set it to your PostgreSQL connection string."
  );
}

// ---------------------------------------------------------------------------
// Main (central) database – always DATABASE_URL.
// Used for user management / auth which is NOT per-factory.
// ---------------------------------------------------------------------------
function getCachedMainDb(): DrizzleDB {
  if (!mainDbCache) {
    const sharedDbEnv = getDbEnv();
    const mainConnectionString = sharedDbEnv.mainDatabaseUrl;
    mainDbCache = mainConnectionString
      ? getSharedMainDb(mainConnectionString, {
          cacheKey: "superice-pos:main",
          poolName: "superice-pos:main",
          max: 5,
          debugSql: getDbDebugSql(),
          logger: false,
        })
      : getDefaultDb();
  }

  return mainDbCache;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Returns the list of available factories (empty-ish when single-DB). */
export function getFactories(): FactoryInfo[] {
  return getFactoryList();
}

/** Whether multi-factory mode is active. */
export function isMultiFactory(): boolean {
  return getFactoryList().length > 1;
}

/** The cookie name used to track the active factory. */
export { FACTORY_COOKIE };

/**
 * Returns the main/central database connection (DATABASE_URL).
 * Used for all user management and auth queries -- never switches per-factory.
 */
export function getMainDb(): DrizzleDB {
  return getCachedMainDb();
}

/**
 * Returns a database connection for a specific factory key.
 * Falls back to default when key is unknown.
 */
export function getDbForFactory(factoryKey: string): DrizzleDB {
  return getRegistry().getFactoryDb(factoryKey) || getDefaultDb();
}

/**
 * Async – reads the factory cookie and returns the matching drizzle instance.
 * Must be called inside a Next.js request context (route handler, server action, etc.).
 *
 * Do not use this for critical factory-scoped writes. It falls back to the
 * default DB when request context is unavailable; write routes should resolve
 * an explicit factory context and call getDbForFactory(factoryKey).
 */
export async function getDb(): Promise<DrizzleDB> {
  if (getFactoryList().length <= 1) return getDefaultDb();

  try {
    const cookieStore = await cookies();
    const session = await getSession();
    // Locked users are always pinned to their assigned factory.
    const factoryKey =
      session?.factoryKey ||
      cookieStore.get(FACTORY_COOKIE)?.value ||
      getDefaultKey();
    return getRegistry().getFactoryDb(factoryKey) || getDefaultDb();
  } catch (error) {
    // Outside request context (e.g. build time) – fall back to default
    if (getDbDebugSql()) {
      logDiagnosticEvent({
        level: "warn",
        message: "[DB] getDb fallback to default (no request context)",
        error,
        source: "database.runtime",
        operation: "resolve-request-db",
        context: {
          fallback: "default-db",
        },
      });
    }
    return getDefaultDb();
  }
}

// Backward-compat: default pool for code that hasn't migrated yet
export const db = new Proxy({} as DrizzleDB, {
  get(_target, property, receiver) {
    return Reflect.get(getDefaultDb(), property, receiver);
  },
});
export { schema };
