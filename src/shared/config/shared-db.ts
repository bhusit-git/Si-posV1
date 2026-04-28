import type { FactoryDbKey } from "../db/runtime/factories";
import {
  getCanonicalFactoryDatabaseUrls,
  getFallbackFactoryDatabaseUrl,
  getFactoryEnvVarName,
  isProduction,
  readOptionalEnv,
  type FactoryDatabaseUrls,
} from "./internal";

export type { FactoryDatabaseUrls } from "./internal";

export function getSharedDbEnv(): {
  isProduction: boolean;
  dbDebugSql: boolean;
  mainDatabaseUrl: string | null;
  factoryDatabaseUrls: FactoryDatabaseUrls;
  getFactoryDatabaseUrl(factoryKey: string): string | null;
  getFactoryEnvVarName(factoryKey: string): string | null;
} {
  const factoryDatabaseUrls = getCanonicalFactoryDatabaseUrls();

  return {
    isProduction: isProduction(),
    dbDebugSql: readOptionalEnv("DB_DEBUG_SQL") === "1",
    mainDatabaseUrl: readOptionalEnv("DATABASE_URL"),
    factoryDatabaseUrls,
    getFactoryDatabaseUrl(factoryKey: string): string | null {
      const envVarName = getFactoryEnvVarName(factoryKey);
      if (!envVarName) return null;

      const normalizedFactoryKey = factoryKey.toLowerCase() as FactoryDbKey;
      if (normalizedFactoryKey in factoryDatabaseUrls) {
        return factoryDatabaseUrls[normalizedFactoryKey] || null;
      }

      return getFallbackFactoryDatabaseUrl(factoryKey);
    },
    getFactoryEnvVarName,
  };
}
