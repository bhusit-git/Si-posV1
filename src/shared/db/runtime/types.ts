import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "../schema";
import type { FactoryInfo } from "./factories";

export type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

export interface NoticeLike {
  severity?: string;
  code?: string;
  message?: string;
  where?: string;
}

export interface CreatePgClientOptions {
  poolName: string;
  max?: number;
  debugSql?: boolean;
  onnotice?: (notice: NoticeLike) => void;
}

export interface CreateDrizzleDbOptions extends CreatePgClientOptions {
  logger?: boolean;
}

export interface GetMainDbOptions {
  cacheKey: string;
  poolName?: string;
  max?: number;
  debugSql?: boolean;
  logger?: boolean;
}

export interface FactoryRegistryConfig {
  cacheKey: string;
  factories?: readonly FactoryInfo[];
  resolveConnectionString: (factory: FactoryInfo) => string | null | undefined;
  fallbackConnectionString?: string | null | undefined;
  fallbackFactory?: FactoryInfo;
  max?: number;
  debugSql?: boolean;
  logger?: boolean;
  poolNamePrefix?: string;
}

export interface FactoryRegistry {
  getFactories(): FactoryInfo[];
  getFactoryDb(factoryKey: string): DrizzleDb | null;
  getDefaultDb(): DrizzleDb | null;
}
