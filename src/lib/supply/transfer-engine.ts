import { asc, eq, sql } from "drizzle-orm";

import { supplyTransferItems, supplyTransfers } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import {
  allocateTransferRef,
  TRANSFER_REF_REGEX,
} from "@/lib/transfer-utils";
import {
  checkStockSufficiency,
  writeStockLedger,
} from "@/lib/supply/stock-engine";
import type { DrizzleDb } from "@/shared/db/runtime";

export type SupplyTransferRow = typeof supplyTransfers.$inferSelect;
export type SupplyTransferItemRow = typeof supplyTransferItems.$inferSelect;

type TransferDb = Pick<
  DrizzleDb,
  "select" | "insert" | "update" | "transaction" | "execute"
>;

export interface CreateTransferPayload {
  requestId?: number | null;
  fromFactoryKey: string;
  toFactoryKey: string;
  note?: string | null;
  transferRef?: string | null;
  items: Array<{
    supplyItemId: number;
    quantity: number;
    note?: string | null;
  }>;
}

function dateIsoForRef(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function normalizeTransferItems(items: CreateTransferPayload["items"]) {
  const normalized = items
    .map((item) => ({
      supplyItemId: item.supplyItemId,
      quantity: Math.max(0, Math.trunc(item.quantity)),
      note: item.note?.trim() || null,
    }))
    .filter((item) => item.quantity > 0);

  if (normalized.length === 0) {
    throw new Error("Transfer requires at least one positive item quantity");
  }

  return normalized;
}

function mergeNote(existingNote: string | null, nextNote: string): string {
  const existing = (existingNote || "").trim();
  const incoming = nextNote.trim();
  if (!existing) return incoming;
  if (!incoming) return existing;
  return `${existing}\n${incoming}`;
}

async function loadTransferById(
  db: Pick<DrizzleDb, "select">,
  transferId: number
): Promise<SupplyTransferRow> {
  const rows = await db
    .select()
    .from(supplyTransfers)
    .where(eq(supplyTransfers.id, transferId))
    .limit(1);

  const transfer = rows[0];
  if (!transfer) {
    throw new Error(`Supply transfer ${transferId} not found`);
  }

  return transfer;
}

async function loadTransferByRef(
  db: Pick<DrizzleDb, "select">,
  transferRef: string
): Promise<SupplyTransferRow> {
  const rows = await db
    .select()
    .from(supplyTransfers)
    .where(eq(supplyTransfers.transferRef, transferRef))
    .limit(1);

  const transfer = rows[0];
  if (!transfer) {
    throw new Error(`Supply transfer ref ${transferRef} not found`);
  }

  return transfer;
}

async function loadTransferItems(
  db: Pick<DrizzleDb, "select">,
  transferId: number
): Promise<SupplyTransferItemRow[]> {
  return db
    .select()
    .from(supplyTransferItems)
    .where(eq(supplyTransferItems.transferId, transferId))
    .orderBy(asc(supplyTransferItems.id));
}

function requireTransferStatus(
  transfer: SupplyTransferRow,
  expected: SupplyTransferRow["status"] | SupplyTransferRow["status"][]
) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(transfer.status)) {
    throw new Error(
      `Supply transfer ${transfer.id} must be ${allowed.join(" or ")} (received ${transfer.status})`
    );
  }
}

async function allocateSupplyTransferRef(
  db: Pick<DrizzleDb, "select">,
  preferredRef?: string | null
): Promise<string> {
  const saleDateISO = dateIsoForRef();
  const ym = saleDateISO.replace(/-/g, "").slice(0, 6);
  const existingRows = await db
    .select({
      transferRef: supplyTransfers.transferRef,
    })
    .from(supplyTransfers)
    .where(
      sql`(${supplyTransfers.transferRef} LIKE ${`TRF-${ym}__-%`} OR ${supplyTransfers.transferRef} LIKE ${`XFER-${ym}__-%`})`
    );

  const transferRef = allocateTransferRef(
    saleDateISO,
    existingRows.map((row) => row.transferRef),
    preferredRef
  );

  if (!transferRef || !TRANSFER_REF_REGEX.test(transferRef)) {
    throw new Error("Unable to allocate supply transfer reference");
  }

  return transferRef;
}

function buildReceivedQuantityMap(
  transferItems: SupplyTransferItemRow[],
  receivedQtys: { transferItemId: number; quantity: number }[]
) {
  const inputById = new Map(receivedQtys.map((item) => [item.transferItemId, item.quantity]));

  return transferItems.map((item) => {
    const provided = inputById.get(item.id);
    const quantityReceived =
      provided == null ? item.quantityShipped : Math.max(0, Math.trunc(provided));

    if (quantityReceived > item.quantityShipped) {
      throw new Error(
        `Received quantity for transfer item ${item.id} exceeds shipped quantity`
      );
    }

    return {
      transferItemId: item.id,
      supplyItemId: item.supplyItemId,
      quantityShipped: item.quantityShipped,
      quantityReceived,
      note: item.note,
    };
  });
}

export async function createTransfer(
  fromDb: TransferDb,
  toDb: TransferDb,
  payload: CreateTransferPayload,
  user: Pick<SessionUser, "id">
): Promise<{ fromRecord: SupplyTransferRow; toRecord: SupplyTransferRow }> {
  if (payload.fromFactoryKey === payload.toFactoryKey) {
    throw new Error("Transfer source and destination must be different factories");
  }

  const items = normalizeTransferItems(payload.items);
  const transferRef = await allocateSupplyTransferRef(fromDb, payload.transferRef);
  const stockCheck = await checkStockSufficiency(
    fromDb,
    payload.fromFactoryKey,
    items.map((item) => ({
      supplyItemId: item.supplyItemId,
      quantity: item.quantity,
    }))
  );

  if (!stockCheck.sufficient) {
    throw new Error("Insufficient supply stock for transfer");
  }

  const now = new Date();

  const fromRecord = await fromDb.transaction(async (tx) => {
    const [created] = await tx
      .insert(supplyTransfers)
      .values({
        requestId: payload.requestId ?? null,
        transferRef,
        fromFactoryKey: payload.fromFactoryKey,
        toFactoryKey: payload.toFactoryKey,
        status: "sending",
        note: payload.note?.trim() || null,
        createdBy: user.id,
        sentAt: null,
        receivedBy: null,
        receivedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    await tx.insert(supplyTransferItems).values(
      items.map((item) => ({
        transferId: created.id,
        supplyItemId: item.supplyItemId,
        quantityShipped: item.quantity,
        quantityReceived: null,
        note: item.note,
      }))
    );

    return created;
  });

  let toRecord: SupplyTransferRow;
  try {
    toRecord = await toDb.transaction(async (tx) => {
      const [created] = await tx
        .insert(supplyTransfers)
        .values({
          requestId: payload.requestId ?? null,
          transferRef,
          fromFactoryKey: payload.fromFactoryKey,
          toFactoryKey: payload.toFactoryKey,
          status: "pending_receive",
          note: payload.note?.trim() || null,
          createdBy: user.id,
          sentAt: now,
          receivedBy: null,
          receivedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await tx.insert(supplyTransferItems).values(
        items.map((item) => ({
          transferId: created.id,
          supplyItemId: item.supplyItemId,
          quantityShipped: item.quantity,
          quantityReceived: null,
          note: item.note,
        }))
      );

      return created;
    });
  } catch (error) {
    await fromDb.transaction(async (tx) => {
      await tx
        .update(supplyTransfers)
        .set({
          status: "cancelled",
          updatedAt: new Date(),
        })
        .where(eq(supplyTransfers.id, fromRecord.id));
    });
    throw error;
  }

  const finalFromRecord = await fromDb.transaction(async (tx) => {
    for (const item of items) {
      await writeStockLedger(tx, {
        factoryKey: payload.fromFactoryKey,
        supplyItemId: item.supplyItemId,
        type: "transfer_out",
        quantity: -item.quantity,
        referenceId: fromRecord.id,
        referenceType: "transfer",
        note: payload.note,
        createdBy: user.id,
      });
    }

    const [updated] = await tx
      .update(supplyTransfers)
      .set({
        status: "sent",
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(supplyTransfers.id, fromRecord.id))
      .returning();

    return updated;
  });

  return {
    fromRecord: finalFromRecord,
    toRecord,
  };
}

export async function receiveTransfer(
  fromDb: TransferDb,
  toDb: TransferDb,
  transferId: number,
  receiver: Pick<SessionUser, "id">,
  receivedQtys: { transferItemId: number; quantity: number }[]
): Promise<void> {
  const toTransfer = await loadTransferById(toDb, transferId);
  requireTransferStatus(toTransfer, "pending_receive");

  const fromTransfer = await loadTransferByRef(fromDb, toTransfer.transferRef);
  requireTransferStatus(fromTransfer, "sent");

  const transferItems = await loadTransferItems(toDb, toTransfer.id);
  const receivedItems = buildReceivedQuantityMap(transferItems, receivedQtys);

  await toDb.transaction(async (tx) => {
    for (const item of receivedItems) {
      await tx
        .update(supplyTransferItems)
        .set({
          quantityReceived: item.quantityReceived,
        })
        .where(eq(supplyTransferItems.id, item.transferItemId));
    }

    const [updated] = await tx
      .update(supplyTransfers)
      .set({
        status: "received",
        receivedBy: receiver.id,
        receivedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(supplyTransfers.id, toTransfer.id))
      .returning();

    if (updated.requestId) {
      await tx.execute(
        sql`UPDATE supply_requests
            SET status = 'fulfilled',
                fulfilled_at = NOW(),
                updated_at = NOW()
            WHERE id = ${updated.requestId}
              AND status = 'approved'`
      );
    }

    for (const item of receivedItems) {
      if (item.quantityReceived <= 0) continue;
      await writeStockLedger(tx, {
        factoryKey: updated.toFactoryKey,
        supplyItemId: item.supplyItemId,
        type: "transfer_in",
        quantity: item.quantityReceived,
        referenceId: updated.id,
        referenceType: "transfer",
        note: updated.note,
        createdBy: receiver.id,
      });
    }
  });

  await fromDb.transaction(async (tx) => {
    await tx
      .update(supplyTransfers)
      .set({
        status: "confirmed",
        updatedAt: new Date(),
      })
      .where(eq(supplyTransfers.transferRef, toTransfer.transferRef));
  });
}

export async function rejectTransfer(
  fromDb: TransferDb,
  toDb: TransferDb,
  transferId: number,
  receiver: Pick<SessionUser, "id">,
  note: string
): Promise<void> {
  const toTransfer = await loadTransferById(toDb, transferId);
  requireTransferStatus(toTransfer, "pending_receive");

  const fromTransfer = await loadTransferByRef(fromDb, toTransfer.transferRef);
  requireTransferStatus(fromTransfer, "sent");

  const fromItems = await loadTransferItems(fromDb, fromTransfer.id);
  const rejectionNote = note.trim();

  await toDb.transaction(async (tx) => {
    await tx
      .update(supplyTransfers)
      .set({
        status: "rejected",
        receivedBy: receiver.id,
        receivedAt: new Date(),
        note: rejectionNote ? mergeNote(toTransfer.note, rejectionNote) : toTransfer.note,
        updatedAt: new Date(),
      })
      .where(eq(supplyTransfers.id, toTransfer.id));
  });

  await fromDb.transaction(async (tx) => {
    for (const item of fromItems) {
      await writeStockLedger(tx, {
        factoryKey: fromTransfer.fromFactoryKey,
        supplyItemId: item.supplyItemId,
        type: "transfer_in",
        quantity: item.quantityShipped,
        referenceId: fromTransfer.id,
        referenceType: "transfer",
        note: rejectionNote || fromTransfer.note,
        createdBy: receiver.id,
      });
    }

    await tx
      .update(supplyTransfers)
      .set({
        status: "rejected",
        note: rejectionNote ? mergeNote(fromTransfer.note, rejectionNote) : fromTransfer.note,
        updatedAt: new Date(),
      })
      .where(eq(supplyTransfers.id, fromTransfer.id));
  });
}
