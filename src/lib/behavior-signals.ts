export interface BehaviorTxRow {
  customerId: number | null;
  totalAmount: number | null;
  status: string | null;
}

export interface BehaviorActionCountRow {
  action: string;
  count: number;
}

export interface BehaviorSignalsResponse {
  range: { startDate: string; endDate: string };
  kpis: {
    totalSales: number;
    avgOrderValue: number;
    unpaidSales: number;
    unpaidRatePct: number;
    returnEvents: number;
    returnRatePct: number;
    offlineSyncedSales: number;
    offlineSyncRatePct: number;
    priceChanges: number;
    bagAdjustments: number;
    syncFailures: number;
  };
  customerMix: {
    uniqueCustomers: number;
    repeatCustomers: number;
    oneTimeCustomers: number;
    repeatRatePct: number;
  };
  actionCounts: Record<string, number>;
}

export const TRACKED_BEHAVIOR_ACTIONS = [
  "transaction.create",
  "transaction.payment",
  "transaction.void",
  "return.create",
  "price.change",
  "bag.adjust",
  "bag.clear",
  "sync.queued",
  "sync.sync_started",
  "sync.sale_synced",
  "sync.sale_failed",
  "sync.sync_finished",
] as const;

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toNonNegativeInt(value: unknown): number {
  const n = Math.floor(toFiniteNumber(value, 0));
  return n > 0 ? n : 0;
}

function toPct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

export function buildBehaviorSignalsResponse(params: {
  startDate: string;
  endDate: string;
  txRows: BehaviorTxRow[];
  actionRows: BehaviorActionCountRow[];
  offlineSyncedSales: number;
}): BehaviorSignalsResponse {
  const { startDate, endDate, txRows, actionRows } = params;
  const customerCounts = new Map<number, number>();

  let totalSales = 0;
  let totalAmount = 0;
  let unpaidSales = 0;

  for (const tx of txRows) {
    const status = (tx.status || "").toLowerCase();
    if (status === "voided") continue;

    totalSales++;
    totalAmount += toFiniteNumber(tx.totalAmount, 0);
    if (status !== "paid") unpaidSales++;

    const cid = toFiniteNumber(tx.customerId, NaN);
    if (Number.isInteger(cid) && cid > 0) {
      customerCounts.set(cid, (customerCounts.get(cid) || 0) + 1);
    }
  }

  const uniqueCustomers = customerCounts.size;
  const repeatCustomers = Array.from(customerCounts.values()).filter(
    (count) => count >= 2
  ).length;

  const actionCountsMap = new Map<string, number>();
  for (const row of actionRows) {
    const count = toNonNegativeInt(row.count);
    actionCountsMap.set(row.action, (actionCountsMap.get(row.action) || 0) + count);
  }

  const actionCounts = Object.fromEntries(
    Array.from(actionCountsMap.entries()).sort(([a], [b]) => a.localeCompare(b))
  );

  const salesFromAudit = actionCountsMap.get("transaction.create") || 0;
  const returnsFromAudit = actionCountsMap.get("return.create") || 0;
  const bagAdjustments =
    (actionCountsMap.get("bag.adjust") || 0) + (actionCountsMap.get("bag.clear") || 0);
  const offlineSyncedSales = toNonNegativeInt(params.offlineSyncedSales);

  return {
    range: { startDate, endDate },
    kpis: {
      totalSales,
      avgOrderValue: totalSales > 0 ? totalAmount / totalSales : 0,
      unpaidSales,
      unpaidRatePct: toPct(unpaidSales, totalSales),
      returnEvents: returnsFromAudit,
      returnRatePct: toPct(returnsFromAudit, salesFromAudit),
      offlineSyncedSales,
      offlineSyncRatePct: toPct(offlineSyncedSales, salesFromAudit),
      priceChanges: actionCountsMap.get("price.change") || 0,
      bagAdjustments,
      syncFailures: actionCountsMap.get("sync.sale_failed") || 0,
    },
    customerMix: {
      uniqueCustomers,
      repeatCustomers,
      oneTimeCustomers: Math.max(0, uniqueCustomers - repeatCustomers),
      repeatRatePct: toPct(repeatCustomers, uniqueCustomers),
    },
    actionCounts,
  };
}
