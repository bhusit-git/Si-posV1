"use client";

import type { SessionUser } from "@/lib/auth";

export interface SaleContinuitySession {
  username: string;
  role: string;
  factoryKey: string | null;
  lastValidatedAt: string;
  continuityEnabled: boolean;
}

export interface SaleContinuityStatus {
  canSellLocally: boolean;
  canSyncNow: boolean;
  factoryKey: string | null;
  hasContinuitySession: boolean;
  hasReferenceCache: boolean;
  lastPreparedAt: string | null;
}

export const SALE_CONTINUITY_STORAGE_KEY = "superice-offline-capable-session";
export const SALE_CONTINUITY_FACTORY_KEY = "superice-sale-last-factory";

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function isValidSaleContinuitySession(value: unknown): value is SaleContinuitySession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.username === "string" &&
    candidate.username.length > 0 &&
    typeof candidate.role === "string" &&
    candidate.role.length > 0 &&
    typeof candidate.lastValidatedAt === "string" &&
    typeof candidate.continuityEnabled === "boolean" &&
    (candidate.factoryKey == null || typeof candidate.factoryKey === "string")
  );
}

function normalizeLegacySession(value: unknown): SaleContinuitySession | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.username !== "string" ||
    candidate.username.length === 0 ||
    typeof candidate.role !== "string" ||
    candidate.role.length === 0
  ) {
    return null;
  }

  const legacyTimestamp =
    typeof candidate.lastValidatedAt === "string"
      ? candidate.lastValidatedAt
      : typeof candidate.at === "string"
        ? candidate.at
        : null;
  if (!legacyTimestamp) return null;

  return {
    username: candidate.username,
    role: candidate.role,
    factoryKey: typeof candidate.factoryKey === "string" ? candidate.factoryKey : null,
    lastValidatedAt: legacyTimestamp,
    continuityEnabled:
      typeof candidate.continuityEnabled === "boolean" ? candidate.continuityEnabled : true,
  };
}

function readJson<T>(key: string): T | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Best effort only.
  }
}

export function markSaleContinuitySession(input: {
  username: string;
  role: string;
  factoryKey: string | null;
  lastValidatedAt?: string;
  continuityEnabled?: boolean;
}): void {
  if (!canUseStorage()) return;
  const value: SaleContinuitySession = {
    username: input.username,
    role: input.role,
    factoryKey: input.factoryKey ?? null,
    lastValidatedAt: input.lastValidatedAt ?? new Date().toISOString(),
    continuityEnabled: input.continuityEnabled ?? true,
  };
  writeJson(SALE_CONTINUITY_STORAGE_KEY, value);
  writeLastConfirmedSaleFactoryKey(value.factoryKey);
}

export function readSaleContinuitySession(): SaleContinuitySession | null {
  const parsed = readJson<unknown>(SALE_CONTINUITY_STORAGE_KEY);
  if (isValidSaleContinuitySession(parsed)) return parsed;
  return normalizeLegacySession(parsed);
}

export function clearSaleContinuitySession(): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.removeItem(SALE_CONTINUITY_STORAGE_KEY);
    window.localStorage.removeItem(SALE_CONTINUITY_FACTORY_KEY);
  } catch {
    // Best effort only.
  }
}

export function writeLastConfirmedSaleFactoryKey(factoryKey: string | null): void {
  if (!canUseStorage()) return;
  try {
    if (factoryKey) {
      window.localStorage.setItem(SALE_CONTINUITY_FACTORY_KEY, factoryKey);
    } else {
      window.localStorage.removeItem(SALE_CONTINUITY_FACTORY_KEY);
    }
  } catch {
    // Best effort only.
  }
}

export function readLastConfirmedSaleFactoryKey(): string | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(SALE_CONTINUITY_FACTORY_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function readSaleContinuitySessionUser(): SessionUser | null {
  const session = readSaleContinuitySession();
  if (!session || !session.continuityEnabled) return null;
  if (
    session.role !== "admin" &&
    session.role !== "office" &&
    session.role !== "manager" &&
    session.role !== "factory"
  ) {
    return null;
  }
  return {
    id: 0,
    username: session.username,
    role: session.role,
    factoryKey: session.factoryKey,
  };
}

export function readFactoryKeyFromCookie(): string | null {
  if (typeof document === "undefined") return null;
  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith("superice_factory="));
  const value = cookie?.split("=")[1];
  return value ? decodeURIComponent(value) : null;
}

export function resolveClientSaleFactoryKey(): string | null {
  const continuityFactory = readSaleContinuitySession()?.factoryKey ?? null;
  if (continuityFactory) return continuityFactory;
  const confirmedFactory = readLastConfirmedSaleFactoryKey();
  if (confirmedFactory) return confirmedFactory;
  return readFactoryKeyFromCookie();
}

