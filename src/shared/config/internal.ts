import {
  FACTORY_CONFIGS,
  getFactoryInfo,
  type FactoryDbKey,
} from "../db/runtime/factories";

export type FactoryDatabaseUrls = Record<FactoryDbKey, string | null>;

export function readOptionalEnv(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value || fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseIntegerInRange(
  value: string | null,
  fallback: number,
  min: number,
  max: number,
  envName: string
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed < min || parsed > max) {
    throw new Error(`${envName} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

export function parseCsv(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function requireInProduction(
  envName: string,
  value: string | null,
  developmentFallback: string
): string {
  if (!value && isProduction()) {
    throw new Error(`${envName} is required in production`);
  }

  return value || developmentFallback;
}

export function getCanonicalFactoryDatabaseUrls(): FactoryDatabaseUrls {
  return {
    si: readOptionalEnv("DATABASE_URL_SI"),
    bearing: readOptionalEnv("DATABASE_URL_BEARING"),
    ktk: readOptionalEnv("DATABASE_URL_KTK"),
  };
}

export function getFactoryEnvVarName(factoryKey: string): string | null {
  const info = getFactoryInfo(factoryKey);
  if (info) {
    return info.envVar;
  }

  const normalized = String(factoryKey || "").trim().toUpperCase();
  return normalized ? `DATABASE_URL_${normalized}` : null;
}

export function getFallbackFactoryDatabaseUrl(factoryKey: string): string | null {
  const envVarName = getFactoryEnvVarName(factoryKey);
  return envVarName ? readOptionalEnv(envVarName) : null;
}

export function normalizePrefix(prefix: string | null | undefined): string {
  if (!prefix) return "";
  return prefix.replace(/^\/+/, "").replace(/\/+$/, "");
}

export function getFactoryEnvReference() {
  return FACTORY_CONFIGS.map((factory) => ({
    key: factory.key,
    name: factory.name,
    envVar: factory.envVar,
  }));
}
