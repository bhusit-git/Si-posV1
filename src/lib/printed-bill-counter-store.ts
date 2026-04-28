export type PrintedBillCounterSourcePage = "sale" | "returns";

interface CachedBillCounterState {
  nextBillNumber: number;
  updatedAt: string;
}

interface PendingBillCounterUpdate {
  nextBillNumber: number;
  sourcePage: PrintedBillCounterSourcePage;
  queuedAt: string;
}

const BILL_COUNTER_CACHE_PREFIX = "superice-printed-bill-counter";
const BILL_COUNTER_PENDING_PREFIX = "superice-printed-bill-counter-pending";

function cacheKey(factoryKey: string) {
  return `${BILL_COUNTER_CACHE_PREFIX}:${factoryKey}`;
}

function pendingKey(factoryKey: string) {
  return `${BILL_COUNTER_PENDING_PREFIX}:${factoryKey}`;
}

export function readCachedPrintedBillCounter(factoryKey: string): number | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(cacheKey(factoryKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedBillCounterState;
    return Number.isInteger(parsed?.nextBillNumber) ? parsed.nextBillNumber : null;
  } catch {
    return null;
  }
}

export function writeCachedPrintedBillCounter(factoryKey: string, nextBillNumber: number): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(
      cacheKey(factoryKey),
      JSON.stringify({
        nextBillNumber,
        updatedAt: new Date().toISOString(),
      } satisfies CachedBillCounterState)
    );
  } catch (error) {
    console.warn("[printed-bill-counter] failed to cache next bill number", error);
  }
}

export function readPendingPrintedBillCounterUpdate(
  factoryKey: string
): PendingBillCounterUpdate | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(pendingKey(factoryKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingBillCounterUpdate;
    if (!Number.isInteger(parsed?.nextBillNumber)) return null;
    if (parsed?.sourcePage !== "sale" && parsed?.sourcePage !== "returns") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function queuePendingPrintedBillCounterUpdate(
  factoryKey: string,
  nextBillNumber: number,
  sourcePage: PrintedBillCounterSourcePage
): void {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(
      pendingKey(factoryKey),
      JSON.stringify({
        nextBillNumber,
        sourcePage,
        queuedAt: new Date().toISOString(),
      } satisfies PendingBillCounterUpdate)
    );
  } catch (error) {
    console.warn("[printed-bill-counter] failed to queue pending update", error);
  }
}

export function clearPendingPrintedBillCounterUpdate(factoryKey: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(pendingKey(factoryKey));
  } catch (error) {
    console.warn("[printed-bill-counter] failed to clear pending update", error);
  }
}
