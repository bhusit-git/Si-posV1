import { asc, eq, inArray } from "drizzle-orm";

import { supplyItems, supplyRequestItems, supplyRequests } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import { validateSupplyRequestTargetFactoryKey } from "@/lib/supply/route-helpers";
import {
  checkStockSufficiency,
  writeStockLedger,
} from "@/lib/supply/stock-engine";
import type { DrizzleDb } from "@/shared/db/runtime";

export type SupplyRequestRow = typeof supplyRequests.$inferSelect;
export type SupplyRequestItemRow = typeof supplyRequestItems.$inferSelect;

type RequestDb = Pick<DrizzleDb, "delete" | "insert" | "select" | "update" | "transaction">;
type StockCheckDb = Pick<DrizzleDb, "select">;

type DraftRequestItemInput = {
  supplyItemId: number;
  quantityRequested: number;
  note: string | null;
};

type UpdateDraftRequestInput = {
  requestType: SupplyRequestRow["requestType"];
  targetFactoryKey: string | null;
  requesterName: string | null;
  note: string | null;
  items: DraftRequestItemInput[];
};

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

export class SupplyRequestValidationError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SupplyRequestValidationError";
    this.status = status;
  }
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

type SupplyItemConstraintRow = Pick<
  typeof supplyItems.$inferSelect,
  "id" | "name" | "unit" | "borrowLimit"
>;

async function loadSupplyItemConstraints(
  db: Pick<DrizzleDb, "select">,
  supplyItemIds: number[]
): Promise<Map<number, SupplyItemConstraintRow>> {
  if (supplyItemIds.length === 0) return new Map();

  const rows = await db
    .select({
      id: supplyItems.id,
      name: supplyItems.name,
      unit: supplyItems.unit,
      borrowLimit: supplyItems.borrowLimit,
    })
    .from(supplyItems)
    .where(inArray(supplyItems.id, supplyItemIds));

  return new Map(rows.map((row) => [row.id, row]));
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

function hasNonEmptyValue(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validateDraftForSubmit(
  request: SupplyRequestRow,
  requestItems: SupplyRequestItemRow[]
) {
  if (!hasNonEmptyValue(request.requesterName)) {
    throw new Error("กรุณาระบุผู้ขอใช้จริงก่อนส่งอนุมัติ");
  }

  const targetFactoryValidation = validateSupplyRequestTargetFactoryKey(
    request.requestType,
    request.targetFactoryKey,
    { allowEmpty: false }
  );
  if (targetFactoryValidation.error) {
    throw new Error(targetFactoryValidation.error);
  }

  if (requestItems.length === 0) {
    throw new Error("กรุณาเพิ่มรายการเบิกอย่างน้อย 1 รายการก่อนส่งอนุมัติ");
  }
}

function formatBorrowLimitError(item: {
  supplyItemId: number;
  quantity: number;
  supplyItem?: SupplyItemConstraintRow | null;
}): string {
  const label = item.supplyItem?.name || `รายการ #${item.supplyItemId}`;
  const unit = item.supplyItem?.unit || "หน่วย";
  const limit = item.supplyItem?.borrowLimit || 0;
  return `${label} ขอเกินวงเงินเบิก: ขอ ${item.quantity} ${unit} แต่จำกัดไม่เกิน ${limit} ${unit}`;
}

function assertBorrowLimit(
  itemRows: { supplyItemId: number; quantity: number }[],
  constraintsById: Map<number, SupplyItemConstraintRow>
) {
  for (const item of itemRows) {
    const supplyItem = constraintsById.get(item.supplyItemId);
    const borrowLimit = supplyItem?.borrowLimit ?? 0;
    if (borrowLimit > 0 && item.quantity > borrowLimit) {
      throw new SupplyRequestValidationError(
        formatBorrowLimitError({ ...item, supplyItem })
      );
    }
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
    const requestItems = await loadRequestItems(tx, requestId);
    validateDraftForSubmit(request, requestItems);
    const supplyItemIds = Array.from(new Set(requestItems.map((item) => item.supplyItemId)));
    const constraintsById = await loadSupplyItemConstraints(tx, supplyItemIds);
    assertBorrowLimit(
      requestItems.map((item) => ({
        supplyItemId: item.supplyItemId,
        quantity: item.quantityRequested,
      })),
      constraintsById
    );

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

export async function updateDraftRequest(
  db: RequestDb,
  requestId: number,
  input: UpdateDraftRequestInput
): Promise<SupplyRequestRow> {
  return db.transaction(async (tx) => {
    const request = await loadRequest(tx, requestId);
    requireStatus(request, "draft");
    const targetFactoryValidation = validateSupplyRequestTargetFactoryKey(
      input.requestType,
      input.targetFactoryKey,
      { allowEmpty: true }
    );
    if (targetFactoryValidation.error) {
      throw new Error(targetFactoryValidation.error);
    }

    await tx.delete(supplyRequestItems).where(eq(supplyRequestItems.requestId, requestId));

    if (input.items.length > 0) {
      await tx.insert(supplyRequestItems).values(
        input.items.map((item) => ({
          requestId,
          supplyItemId: item.supplyItemId,
          quantityRequested: item.quantityRequested,
          quantityApproved: null,
          note: item.note,
        }))
      );
    }

    const [updated] = await tx
      .update(supplyRequests)
      .set({
        requestType: input.requestType,
        targetFactoryKey: targetFactoryValidation.targetFactoryKey,
        requesterName: input.requesterName,
        note: input.note,
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
  signature: string,
  options: { stockDb?: StockCheckDb } = {}
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
    const supplyItemIds = Array.from(new Set(itemApprovals.map((item) => item.supplyItemId)));
    const constraintsById = await loadSupplyItemConstraints(tx, supplyItemIds);
    assertBorrowLimit(
      itemApprovals.map((item) => ({
        supplyItemId: item.supplyItemId,
        quantity: item.quantityApproved,
      })),
      constraintsById
    );
    const stockFactoryKey = resolveStockFactoryKey(request);
    if (!stockFactoryKey) {
      throw new Error("Cross-factory request is missing target factory");
    }

    const stockCheck = await checkStockSufficiency(
      options.stockDb || tx,
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
