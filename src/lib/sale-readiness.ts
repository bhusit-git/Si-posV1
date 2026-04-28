const STORAGE_KEYS = {
  loginSubmitStartedAt: "superice-sale-readiness:login-submit-started-at",
  loginResponseReceivedAt: "superice-sale-readiness:login-response-received-at",
  saleRouteMountedAt: "superice-sale-readiness:sale-route-mounted-at",
  referenceReadyAt: "superice-sale-readiness:reference-ready-at",
  saleInteractiveAt: "superice-sale-readiness:sale-interactive-at",
} as const;

export interface SaleReadinessTimeline {
  loginSubmitStartedAt: number | null;
  loginResponseReceivedAt: number | null;
  saleRouteMountedAt: number | null;
  referenceReadyAt: number | null;
  saleInteractiveAt: number | null;
}

export interface SaleReadinessMetrics {
  authMs: number | null;
  navigationMs: number | null;
  saleReferenceReadyMs: number | null;
  saleBootstrapMs: number | null;
  loginToSaleInteractiveMs: number | null;
}

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage;
}

function readTimestamp(key: string): number | null {
  const storage = getStorage();
  if (!storage) return null;
  const value = storage.getItem(key);
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function writeTimestamp(key: string, at: number): void {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(key, String(at));
}

function clearTimestamp(key: string): void {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(key);
}

function duration(start: number | null, end: number | null): number | null {
  if (start == null || end == null) return null;
  if (end < start) return null;
  return end - start;
}

export function computeSaleReadinessMetrics(
  timeline: SaleReadinessTimeline
): SaleReadinessMetrics {
  return {
    authMs: duration(timeline.loginSubmitStartedAt, timeline.loginResponseReceivedAt),
    navigationMs: duration(timeline.loginResponseReceivedAt, timeline.saleRouteMountedAt),
    saleReferenceReadyMs: duration(timeline.saleRouteMountedAt, timeline.referenceReadyAt),
    saleBootstrapMs: duration(timeline.saleRouteMountedAt, timeline.saleInteractiveAt),
    loginToSaleInteractiveMs: duration(
      timeline.loginSubmitStartedAt,
      timeline.saleInteractiveAt
    ),
  };
}

export function getSaleReadinessTimeline(): SaleReadinessTimeline {
  return {
    loginSubmitStartedAt: readTimestamp(STORAGE_KEYS.loginSubmitStartedAt),
    loginResponseReceivedAt: readTimestamp(STORAGE_KEYS.loginResponseReceivedAt),
    saleRouteMountedAt: readTimestamp(STORAGE_KEYS.saleRouteMountedAt),
    referenceReadyAt: readTimestamp(STORAGE_KEYS.referenceReadyAt),
    saleInteractiveAt: readTimestamp(STORAGE_KEYS.saleInteractiveAt),
  };
}

export function clearSaleReadinessTimeline(): void {
  clearTimestamp(STORAGE_KEYS.loginSubmitStartedAt);
  clearTimestamp(STORAGE_KEYS.loginResponseReceivedAt);
  clearTimestamp(STORAGE_KEYS.saleRouteMountedAt);
  clearTimestamp(STORAGE_KEYS.referenceReadyAt);
  clearTimestamp(STORAGE_KEYS.saleInteractiveAt);
}

export function markLoginSubmitStarted(at = Date.now()): void {
  clearSaleReadinessTimeline();
  writeTimestamp(STORAGE_KEYS.loginSubmitStartedAt, at);
}

export function markLoginResponseReceived(at = Date.now()): SaleReadinessMetrics {
  writeTimestamp(STORAGE_KEYS.loginResponseReceivedAt, at);
  return computeSaleReadinessMetrics(getSaleReadinessTimeline());
}

export function markSaleRouteMounted(at = Date.now()): SaleReadinessMetrics {
  writeTimestamp(STORAGE_KEYS.saleRouteMountedAt, at);
  return computeSaleReadinessMetrics(getSaleReadinessTimeline());
}

export function markSaleReferenceReady(at = Date.now()): SaleReadinessMetrics {
  writeTimestamp(STORAGE_KEYS.referenceReadyAt, at);
  return computeSaleReadinessMetrics(getSaleReadinessTimeline());
}

export function markSaleInteractive(at = Date.now()): SaleReadinessMetrics {
  writeTimestamp(STORAGE_KEYS.saleInteractiveAt, at);
  return computeSaleReadinessMetrics(getSaleReadinessTimeline());
}
