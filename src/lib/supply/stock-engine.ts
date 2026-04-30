import { and, asc, eq, inArray, sql } from "drizzle-orm";

import {
  supplyItems,
  supplyStockLedger,
  supplyStockThresholds,
} from "@/db/schema";
import type { DrizzleDb } from "@/shared/db/runtime";

export type SupplyItemRow = typeof supplyItems.$inferSelect;
export type SupplyStockLedgerRow = typeof supplyStockLedger.$inferSelect;

export interface NewStockLedgerEntry {
  factoryKey: string;
  supplyItemId: number;
  type: SupplyStockLedgerRow["type"];
  quantity: number;
  referenceId?: number | null;
  referenceType?: string | null;
  note?: string | null;
  createdBy?: number | null;
  createdAt?: Date;
}

export interface StockBalanceRow {
  item: SupplyItemRow;
  balance: number;
  threshold: number;
  isLow: boolean;
  lastMovementAt: Date | null;
}

export interface StockShortfallRow {
  supplyItemId: number;
  available: number;
  requested: number;
}

export interface StockSufficiencyResult {
  sufficient: boolean;
  shortfalls: StockShortfallRow[];
}

function toSafeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function normalizeRequestedItems(items: { supplyItemId: number; quantity: number }[]) {
  const requestedByItem = new Map<number, number>();

  for (const item of items) {
    if (!Number.isFinite(item.supplyItemId) || item.supplyItemId <= 0) continue;
    const quantity = toSafeNumber(item.quantity);
    requestedByItem.set(
      item.supplyItemId,
      (requestedByItem.get(item.supplyItemId) || 0) + quantity
    );
  }

  return requestedByItem;
}

export async function getStockBalance(
  db: Pick<DrizzleDb, "select">,
  factoryKey: string,
  supplyItemId: number
): Promise<number> {
  const rows = await db
    .select({
      balance: sql<number>`COALESCE(SUM(${supplyStockLedger.quantity}), 0)::int`,
    })
    .from(supplyStockLedger)
    .where(
      and(
        eq(supplyStockLedger.factoryKey, factoryKey),
        eq(supplyStockLedger.supplyItemId, supplyItemId)
      )
    );

  return toSafeNumber(rows[0]?.balance);
}

export async function getStockBalances(
  db: Pick<DrizzleDb, "select">,
  factoryKey: string
): Promise<StockBalanceRow[]> {
  const rows = await db
    .select({
      itemId: supplyItems.id,
      itemName: supplyItems.name,
      itemUnit: supplyItems.unit,
      itemCategory: supplyItems.category,
      itemLinkedProductTypeId: supplyItems.linkedProductTypeId,
      itemLowStockThreshold: supplyItems.lowStockThreshold,
      itemIsActive: supplyItems.isActive,
      itemCreatedBy: supplyItems.createdBy,
      itemCreatedAt: supplyItems.createdAt,
      itemUpdatedAt: supplyItems.updatedAt,
      balance: sql<number>`COALESCE(SUM(${supplyStockLedger.quantity}), 0)::int`,
      threshold:
        sql<number>`COALESCE(${supplyStockThresholds.threshold}, ${supplyItems.lowStockThreshold})::int`,
      lastMovementAt: sql<Date | null>`MAX(${supplyStockLedger.createdAt})`,
    })
    .from(supplyItems)
    .leftJoin(
      supplyStockThresholds,
      and(
        eq(supplyStockThresholds.supplyItemId, supplyItems.id),
        eq(supplyStockThresholds.factoryKey, factoryKey)
      )
    )
    .leftJoin(
      supplyStockLedger,
      and(
        eq(supplyStockLedger.supplyItemId, supplyItems.id),
        eq(supplyStockLedger.factoryKey, factoryKey)
      )
    )
    .where(eq(supplyItems.isActive, true))
    .groupBy(supplyItems.id, supplyStockThresholds.threshold)
    .orderBy(asc(supplyItems.name), asc(supplyItems.id));

  return rows.map((row) => {
    const balance = toSafeNumber(row.balance);
    const threshold = toSafeNumber(row.threshold);

    return {
      item: {
        id: row.itemId,
        name: row.itemName,
        unit: row.itemUnit,
        category: row.itemCategory,
        linkedProductTypeId: row.itemLinkedProductTypeId,
        lowStockThreshold: row.itemLowStockThreshold,
        isActive: row.itemIsActive,
        createdBy: row.itemCreatedBy,
        createdAt: row.itemCreatedAt,
        updatedAt: row.itemUpdatedAt,
      },
      balance,
      threshold,
      isLow: balance <= threshold,
      lastMovementAt: row.lastMovementAt ?? null,
    };
  });
}

export async function writeStockLedger(
  db: Pick<DrizzleDb, "insert">,
  entry: NewStockLedgerEntry
): Promise<SupplyStockLedgerRow> {
  const inserted = await db
    .insert(supplyStockLedger)
    .values({
      factoryKey: entry.factoryKey,
      supplyItemId: entry.supplyItemId,
      type: entry.type,
      quantity: entry.quantity,
      referenceId: entry.referenceId ?? null,
      referenceType: entry.referenceType ?? null,
      note: entry.note ?? null,
      createdBy: entry.createdBy ?? null,
      createdAt: entry.createdAt ?? new Date(),
    })
    .returning();

  return inserted[0];
}

export async function checkStockSufficiency(
  db: Pick<DrizzleDb, "select">,
  factoryKey: string,
  items: { supplyItemId: number; quantity: number }[]
): Promise<StockSufficiencyResult> {
  const requestedByItem = normalizeRequestedItems(items);
  const supplyItemIds = Array.from(requestedByItem.keys());

  if (supplyItemIds.length === 0) {
    return {
      sufficient: true,
      shortfalls: [],
    };
  }

  const balanceRows = await db
    .select({
      supplyItemId: supplyStockLedger.supplyItemId,
      balance: sql<number>`COALESCE(SUM(${supplyStockLedger.quantity}), 0)::int`,
    })
    .from(supplyStockLedger)
    .where(
      and(
        eq(supplyStockLedger.factoryKey, factoryKey),
        inArray(supplyStockLedger.supplyItemId, supplyItemIds)
      )
    )
    .groupBy(supplyStockLedger.supplyItemId);

  const balances = new Map<number, number>();
  for (const row of balanceRows) {
    balances.set(row.supplyItemId, toSafeNumber(row.balance));
  }

  const shortfalls: StockShortfallRow[] = [];
  for (const [supplyItemId, requested] of requestedByItem.entries()) {
    const safeRequested = toSafeNumber(requested);
    const available = balances.get(supplyItemId) ?? 0;
    if (safeRequested > available) {
      shortfalls.push({
        supplyItemId,
        available,
        requested: safeRequested,
      });
    }
  }

  shortfalls.sort((left, right) => left.supplyItemId - right.supplyItemId);

  return {
    sufficient: shortfalls.length === 0,
    shortfalls,
  };
}
