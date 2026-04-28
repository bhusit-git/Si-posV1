/**
 * Offline sale queue & sync engine.
 *
 * When the Sale page can't reach the server, sales are saved to IndexedDB.
 * The engine auto-syncs when the browser comes back online and on a periodic
 * interval (30 s).
 */
import { get, set, del, keys } from "idb-keyval";
import {
  markSaleContinuitySession,
  resolveClientSaleFactoryKey,
  writeLastConfirmedSaleFactoryKey,
} from "@/lib/sale-continuity";

// ---- Types ----

export interface QueuedSale {
  /** Client-generated unique ID */
  clientId: string;
  /** Full POST body that would go to /api/transactions */
  payload: Record<string, unknown>;
  /** ISO timestamp when the sale was queued */
  queuedAt: string;
  /** Customer name for display purposes */
  customerName: string;
  /** Grand total for display purposes */
  total: number;
  /** Locked factory for this queued sale */
  factoryKey: string | null;
}

export interface SyncResult {
  success: number;
  failed: number;
  pending: number;
  errors: string[];
}

export interface SyncAvailability {
  canSyncNow: boolean;
  activeFactoryKey: string | null;
  reason: "ok" | "login_required";
}

// ---- Key helpers ----

const QUEUE_PREFIX = "sale-queue:";

function queueKey(clientId: string): string {
  return `${QUEUE_PREFIX}${clientId}`;
}

type SyncTelemetryEvent =
  | "queued"
  | "sync_started"
  | "sale_synced"
  | "sale_failed"
  | "sync_finished";

interface SyncTelemetryPayload {
  event: SyncTelemetryEvent;
  clientId?: string;
  customerId?: number;
  transactionId?: number;
  amount?: number;
  pendingCount?: number;
  successCount?: number;
  failedCount?: number;
  queuedAt?: string;
  error?: string;
}

const SYNC_LOGIN_REQUIRED_MESSAGE = "กรุณาเข้าสู่ระบบออนไลน์ก่อนซิงก์รายการออฟไลน์";

function getCustomerIdFromPayload(payload: Record<string, unknown>): number | undefined {
  const raw = payload.customerId;
  if (typeof raw === "number" && Number.isInteger(raw)) return raw;
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isInteger(parsed)) return parsed;
  }
  return undefined;
}

async function sendSyncTelemetry(payload: SyncTelemetryPayload): Promise<void> {
  try {
    await fetch("/api/telemetry/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Best-effort logging only. Do not block sync flow.
  }
}

export async function getSyncAvailability(): Promise<SyncAvailability> {
  try {
    const response = await fetch("/api/auth", {
      method: "GET",
      cache: "no-store",
    });
    if (!response.ok) {
      return {
        canSyncNow: false,
        activeFactoryKey: resolveClientSaleFactoryKey(),
        reason: "login_required",
      };
    }
    const data = (await response.json()) as {
      username?: string;
      role?: string;
      factoryKey?: string | null;
    };
    const activeFactoryKey =
      typeof data?.factoryKey === "string" && data.factoryKey.length > 0
        ? data.factoryKey
        : resolveClientSaleFactoryKey();
    if (typeof data?.username === "string" && typeof data?.role === "string") {
      markSaleContinuitySession({
        username: data.username,
        role: data.role,
        factoryKey: activeFactoryKey,
      });
    }
    writeLastConfirmedSaleFactoryKey(activeFactoryKey);
    return {
      canSyncNow: true,
      activeFactoryKey,
      reason: "ok",
    };
  } catch {
    return {
      canSyncNow: false,
      activeFactoryKey: resolveClientSaleFactoryKey(),
      reason: "login_required",
    };
  }
}

// ---- Public API ----

/** Generate a client-side unique ID for a queued sale */
export function generateClientId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Save a sale to the offline queue */
export async function queueSale(
  sale: Omit<QueuedSale, "clientId" | "queuedAt" | "factoryKey"> & {
    factoryKey?: string | null;
  }
): Promise<QueuedSale> {
  const entry: QueuedSale = {
    clientId: generateClientId(),
    payload: sale.payload,
    customerName: sale.customerName,
    total: sale.total,
    queuedAt: new Date().toISOString(),
    factoryKey: sale.factoryKey ?? resolveClientSaleFactoryKey(),
  };
  await set(queueKey(entry.clientId), entry);
  const pendingCount = await getPendingCount();
  void sendSyncTelemetry({
    event: "queued",
    clientId: entry.clientId,
    customerId: getCustomerIdFromPayload(entry.payload),
    amount: entry.total,
    pendingCount,
    queuedAt: entry.queuedAt,
  });
  return entry;
}

/** Get all pending (unsynced) sales, oldest first */
export async function getPendingSales(): Promise<QueuedSale[]> {
  const allKeys = await keys();
  const saleKeys = allKeys.filter(
    (k) => typeof k === "string" && k.startsWith(QUEUE_PREFIX)
  ) as string[];

  const sales: QueuedSale[] = [];
  for (const k of saleKeys) {
    const entry = await get<QueuedSale>(k);
    if (entry) sales.push(entry);
  }

  // Sort oldest first
  sales.sort((a, b) => new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime());
  return sales;
}

/** Get count of unsynced sales */
export async function getPendingCount(): Promise<number> {
  const allKeys = await keys();
  return allKeys.filter(
    (k) => typeof k === "string" && k.startsWith(QUEUE_PREFIX)
  ).length;
}

/** Remove a single queued sale (e.g. user deletes a mistake) */
export async function removeQueuedSale(clientId: string): Promise<void> {
  await del(queueKey(clientId));
}

/**
 * Attempt to sync all pending sales to the server.
 * Processes oldest-first; stops early if one fails (server may be down).
 */
export async function syncAll(): Promise<SyncResult> {
  const pending = await getPendingSales();
  const result: SyncResult = {
    success: 0,
    failed: 0,
    pending: pending.length,
    errors: [],
  };

  if (pending.length === 0) return result;
  const syncAvailability = await getSyncAvailability();
  if (!syncAvailability.canSyncNow) {
    result.errors.push(SYNC_LOGIN_REQUIRED_MESSAGE);
    return result;
  }

  void sendSyncTelemetry({
    event: "sync_started",
    pendingCount: pending.length,
  });

  for (const sale of pending) {
    const customerId = getCustomerIdFromPayload(sale.payload);
    if (
      sale.factoryKey &&
      syncAvailability.activeFactoryKey &&
      sale.factoryKey !== syncAvailability.activeFactoryKey
    ) {
      result.failed++;
      result.errors.push(
        `${sale.customerName}: รายการนี้อยู่โรงงาน ${sale.factoryKey} ต้องกลับไปซิงก์ในโรงงานเดิม`
      );
      void sendSyncTelemetry({
        event: "sale_failed",
        clientId: sale.clientId,
        customerId,
        amount: sale.total,
        pendingCount: result.pending,
        queuedAt: sale.queuedAt,
        error: "factory_mismatch",
      });
      continue;
    }
    try {
      const res = await fetch("/api/transactions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-sync-source": "offline-queue",
          "x-queued-at": sale.queuedAt,
        },
        body: JSON.stringify(sale.payload),
      });

      if (res.ok) {
        let transactionId: number | undefined;
        try {
          const data = (await res.json()) as { id?: unknown };
          transactionId =
            typeof data?.id === "number" && Number.isInteger(data.id)
              ? data.id
              : undefined;
        } catch {
          // Ignore response parse errors for telemetry.
        }

        await del(queueKey(sale.clientId));
        result.success++;
        result.pending--;
        void sendSyncTelemetry({
          event: "sale_synced",
          clientId: sale.clientId,
          customerId,
          transactionId,
          amount: sale.total,
          pendingCount: result.pending,
          queuedAt: sale.queuedAt,
        });
      } else {
        // Server returned an error (4xx/5xx) -- don't retry this one automatically
        let errMsg = `Server error ${res.status}`;
        try {
          const errData = await res.json();
          if (errData.error) errMsg = errData.error;
        } catch {
          // Response body may be empty
        }
        result.failed++;
        result.errors.push(`${sale.customerName}: ${errMsg}`);
        void sendSyncTelemetry({
          event: "sale_failed",
          clientId: sale.clientId,
          customerId,
          amount: sale.total,
          pendingCount: result.pending,
          queuedAt: sale.queuedAt,
          error: errMsg,
        });
        // Don't break -- try the next one, the error might be sale-specific
      }
    } catch {
      // Network error -- server is unreachable, stop trying
      result.failed++;
      result.errors.push(`${sale.customerName}: ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์`);
      void sendSyncTelemetry({
        event: "sale_failed",
        clientId: sale.clientId,
        customerId,
        amount: sale.total,
        pendingCount: result.pending,
        queuedAt: sale.queuedAt,
        error: "network_unreachable",
      });
      break;
    }
  }

  void sendSyncTelemetry({
    event: "sync_finished",
    pendingCount: result.pending,
    successCount: result.success,
    failedCount: result.failed,
  });

  return result;
}

// ---- Auto-sync lifecycle ----

let intervalId: ReturnType<typeof setInterval> | null = null;
let listeners: Array<(count: number) => void> = [];

/** Subscribe to pending count changes */
export function onPendingCountChange(cb: (count: number) => void): () => void {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

async function notifyListeners() {
  const count = await getPendingCount();
  for (const cb of listeners) cb(count);
}

async function handleOnline() {
  const result = await syncAll();
  if (result.success > 0) {
    await notifyListeners();
  }
  return result;
}

/** Start the auto-sync loop (call once on page mount) */
export function startAutoSync(): () => void {
  // Listen for online event
  window.addEventListener("online", handleOnline);

  // Periodic check every 30 seconds
  intervalId = setInterval(async () => {
    if (navigator.onLine) {
      const count = await getPendingCount();
      if (count > 0) {
        await syncAll();
        await notifyListeners();
      }
    }
  }, 30_000);

  // Cleanup function
  return () => {
    window.removeEventListener("online", handleOnline);
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}
