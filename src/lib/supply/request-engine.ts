import { asc, eq } from "drizzle-orm";

import { supplyRequestItems, supplyRequests } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import {
  checkStockSufficiency,
  writeStockLedger,
} from "@/lib/supply/stock-engine";
import type { DrizzleDb } from "@/shared/db/runtime";

export type SupplyRequestRow = typeof supplyRequests.$inferSelect;
export type SupplyRequestItemRow = typeof supplyRequestItems.$inferSelect;

type RequestDb = Pick<DrizzleDb, "select" | "update" | "transaction">;

function resolveStockFactoryKey(request: SupplyRequestRow): string {
  return request.requestType === "cross_factory"
    ? request.targetFactoryKey || ""
    : request.factoryKey;
}

function trimSignature(signature: string): string {
  return signature.trim();
}

function mergeNote(existingNote: string | null, nextNote: string): string {
  const existing = (existingNote || "").trim();
  const incoming = nextNote.trim();
  if (!existing) return incoming;
  if (!incoming) return existing;
  return `${existing}\n${incoming}`;
}

async function loadRequest(
  db: Pick<DrizzleDb, "select">,
  requestId: number
): Promise<SupplyRequestRow> {
  const rows = await db
    .select()
    .from(supplyRequests)
    .where(eq(supplyRequests.id, requestId))
    .limit(1);

  const request = rows[0];
  if (!request) {
    throw new Error(`Supply request ${requestId} not found`);
  }

  return request;
}

async function loadRequestItems(
  db: Pick<DrizzleDb, "select">,
  requestId: number
): Promise<SupplyRequestItemRow[]> {
  return db
    .select()
    .from(supplyRequestItems)
    .where(eq(supplyRequestItems.requestId, requestId))
    .orderBy(asc(supplyRequestItems.id));
}

function requireStatus(
  request: SupplyRequestRow,
  expected: SupplyRequestRow["status"] | SupplyRequestRow["status"][]
) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  if (!allowed.includes(request.status)) {
    throw new Error(
      `Supply request ${request.id} must be ${allowed.join(" or ")} (received ${request.status})`
    );
  }
}

function buildApprovedQuantityMap(
  requestItems: SupplyRequestItemRow[],
  approvedQtys: { requestItemId: number; quantity: number }[]
) {
  const inputByItemId = new Map(approvedQtys.map((item) => [item.requestItemId, item.quantity]));

  return requestItems.map((item) => {
    const provided = inputByItemId.get(item.id);
    const quantityApproved =
      provided == null ? item.quantityRequested : Math.max(0, Math.trunc(provided));

    if (quantityApproved > item.quantityRequested) {
      throw new Error(
        `Approved quantity for request item ${item.id} exceeds requested quantity`
      );
    }

    return {
      requestItemId: item.id,
      supplyItemId: item.supplyItemId,
      quantityApproved,
    };
  });
}

export async function submitRequest(
  db: RequestDb,
  requestId: number,
  user: Pick<SessionUser, "id">
): Promise<SupplyRequestRow> {
  void user;
  return db.transaction(async (tx) => {
    const request = await loadRequest(tx, requestId);
    requireStatus(request, "draft");

    const [updated] = await tx
      .update(supplyRequests)
      .set({
        status: "pending",
        updatedAt: new Date(),
      })
      .where(eq(supplyRequests.id, requestId))
      .returning();

    return updated;
  });
}

export async function approveRequest(
  db: RequestDb,
  requestId: number,
  approver: Pick<SessionUser, "id">,
  approvedQtys: { requestItemId: number; quantity: number }[],
  signature: string
): Promise<SupplyRequestRow> {
  const approverSignature = trimSignature(signature);
  if (!approverSignature) {
    throw new Error("Approver signature is required");
  }

  return db.transaction(async (tx) => {
    const request = await loadRequest(tx, requestId);
    requireStatus(request, "pending");

    const requestItems = await loadRequestItems(tx, requestId);
    if (requestItems.length === 0) {
      throw new Error(`Supply request ${requestId} has no items`);
    }

    const itemApprovals = buildApprovedQuantityMap(requestItems, approvedQtys);
    const stockFactoryKey = resolveStockFactoryKey(request);
    if (!stockFactoryKey) {
      throw new Error("Cross-factory request is missing target factory");
    }

    const stockCheck = await checkStockSufficiency(
      tx,
      stockFactoryKey,
      itemApprovals
        .filter((item) => item.quantityApproved > 0)
        .map((item) => ({
          supplyItemId: item.supplyItemId,
          quantity: item.quantityApproved,
        }))
    );

    if (!stockCheck.sufficient) {
      throw new Error("Insufficient supply stock for approval");
    }

    for (const item of itemApprovals) {
      await tx
        .update(supplyRequestItems)
        .set({
          quantityApproved: item.quantityApproved,
        })
        .where(eq(supplyRequestItems.id, item.requestItemId));
    }

    const [updated] = await tx
      .update(supplyRequests)
      .set({
        status: "approved",
        approvedBy: approver.id,
        approverSignature,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(supplyRequests.id, requestId))
      .returning();

    return updated;
  });
}

export async function rejectRequest(
  db: RequestDb,
  requestId: number,
  _approver: Pick<SessionUser, "id">,
  note: string
): Promise<SupplyRequestRow> {
  return db.transaction(async (tx) => {
    const request = await loadRequest(tx, requestId);
    requireStatus(request, "pending");

    const [updated] = await tx
      .update(supplyRequests)
      .set({
        status: "rejected",
        note: note.trim() ? mergeNote(request.note, note) : request.note,
        updatedAt: new Date(),
      })
      .where(eq(supplyRequests.id, requestId))
      .returning();

    return updated;
  });
}

export async function fulfillRequest(
  db: RequestDb,
  requestId: number,
  user: Pick<SessionUser, "id">
): Promise<SupplyRequestRow> {
  return db.transaction(async (tx) => {
    const request = await loadRequest(tx, requestId);
    requireStatus(request, "approved");
    if (request.requestType !== "internal_factory") {
      throw new Error("Cross-factory request cannot be fulfilled directly");
    }

    const requestItems = await loadRequestItems(tx, requestId);
    if (requestItems.length === 0) {
      throw new Error(`Supply request ${requestId} has no items`);
    }

    const fulfilItems = requestItems
      .map((item) => ({
        supplyItemId: item.supplyItemId,
        quantity: item.quantityApproved ?? item.quantityRequested,
      }))
      .filter((item) => item.quantity > 0);

    const stockCheck = await checkStockSufficiency(tx, request.factoryKey, fulfilItems);
    if (!stockCheck.sufficient) {
      throw new Error("Insufficient supply stock for fulfilment");
    }

    for (const item of fulfilItems) {
      await writeStockLedger(tx, {
        factoryKey: request.factoryKey,
        supplyItemId: item.supplyItemId,
        type: "internal_use",
        quantity: -item.quantity,
        referenceId: request.id,
        referenceType: "request",
        note: request.note,
        createdBy: user.id,
      });
    }

    const [updated] = await tx
      .update(supplyRequests)
      .set({
        status: "fulfilled",
        fulfilledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(supplyRequests.id, requestId))
      .returning();

    return updated;
  });
}

export async function cancelRequest(
  db: RequestDb,
  requestId: number,
  user: Pick<SessionUser, "id">
): Promise<SupplyRequestRow> {
  void user;
  return db.transaction(async (tx) => {
    const request = await loadRequest(tx, requestId);
    requireStatus(request, ["draft", "pending"]);

    const [updated] = await tx
      .update(supplyRequests)
      .set({
        status: "cancelled",
        updatedAt: new Date(),
      })
      .where(eq(supplyRequests.id, requestId))
      .returning();

    return updated;
  });
}
