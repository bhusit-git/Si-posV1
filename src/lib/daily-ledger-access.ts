import type { SessionUser } from "@/lib/auth";

type DailyLedgerAccessIdentity =
  | Pick<SessionUser, "role" | "factoryKey">
  | null
  | undefined;

export interface DailyLedgerRecentWindow {
  yesterday: string;
  today: string;
}

function normalizeRole(role: string | null | undefined): string {
  return String(role || "").toLowerCase();
}

function normalizeFactoryKey(factoryKey: string | null | undefined): string {
  return String(factoryKey || "").toLowerCase();
}

export function getBangkokTodayISO(referenceDate: Date = new Date()): string {
  return referenceDate.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

export function addDaysISO(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function getDailyLedgerRecentWindow(
  referenceDate: Date = new Date()
): DailyLedgerRecentWindow {
  const today = getBangkokTodayISO(referenceDate);
  return {
    yesterday: addDaysISO(today, -1),
    today,
  };
}

export function isBearingManagerDailyLedgerUser(
  identity: DailyLedgerAccessIdentity
): boolean {
  return (
    normalizeRole(identity?.role) === "manager" &&
    normalizeFactoryKey(identity?.factoryKey) === "bearing"
  );
}

export function canAccessDailyLedger(identity: DailyLedgerAccessIdentity): boolean {
  const role = normalizeRole(identity?.role);
  if (role === "admin" || role === "office") return true;
  return isBearingManagerDailyLedgerUser(identity);
}

export function usesRestrictedDailyLedgerRecentWindow(
  identity: DailyLedgerAccessIdentity
): boolean {
  return isBearingManagerDailyLedgerUser(identity);
}

export function clampDailyLedgerDateForAccess(
  dateIso: string,
  identity: DailyLedgerAccessIdentity,
  referenceDate: Date = new Date()
): string {
  if (!usesRestrictedDailyLedgerRecentWindow(identity)) return dateIso;

  const { yesterday, today } = getDailyLedgerRecentWindow(referenceDate);
  if (!dateIso) return today;
  if (dateIso < yesterday) return yesterday;
  if (dateIso > today) return today;
  return dateIso;
}
