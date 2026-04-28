import {
  clearSaleContinuitySession,
  markSaleContinuitySession,
  readSaleContinuitySession,
  readSaleContinuitySessionUser,
  SALE_CONTINUITY_STORAGE_KEY,
  type SaleContinuitySession,
} from "@/lib/sale-continuity";

export type OfflineCapableSession = SaleContinuitySession;

export const OFFLINE_SESSION_STORAGE_KEY = SALE_CONTINUITY_STORAGE_KEY;

export function markOfflineCapableSession(input: {
  username: string;
  role: string;
  factoryKey: string | null;
  at?: string;
}): void {
  markSaleContinuitySession({
    username: input.username,
    role: input.role,
    factoryKey: input.factoryKey,
    lastValidatedAt: input.at,
    continuityEnabled: true,
  });
}

export function readOfflineCapableSession(): OfflineCapableSession | null {
  return readSaleContinuitySession();
}

export function clearOfflineCapableSession(): void {
  clearSaleContinuitySession();
}

export function readOfflineCapableSessionUser() {
  return readSaleContinuitySessionUser();
}
