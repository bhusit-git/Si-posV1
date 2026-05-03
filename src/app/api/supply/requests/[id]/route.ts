import { NextRequest, NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";

import { getDbForFactory, type DrizzleDB } from "@/db";
import { supplyItems, supplyRequestItems, supplyRequests } from "@/db/schema";
import { requireManagerUp } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import { buildSupplyRequestRefMap } from "@/lib/supply/request-ref";
import {
  approveRequest,
  cancelRequest,
  fulfillRequest,
  rejectRequest,
  submitRequest,
  updateDraftRequest,
} from "@/lib/supply/request-engine";
import {
  badRequest,
  ensureFactoryKey,
  parseInteger,
  parseOptionalString,
  resolveSupplyWriteContext,
  validateSupplyRequestTargetFactoryKey,
} from "@/lib/supply/route-helpers";
import {
  convertToBaseQuantity,
  parseQuantityUnit,
  parseWholeQuantity,
} from "@/lib/supply/unit-conversion";

type SupplyRequestItemRow = typeof supplyRequestItems.$inferSelect;
type SupplyItemRow = typeof supplyItems.$inferSelect;
type SupplyRequestItemWithSupplyItem = SupplyRequestItemRow & {
  supplyItem: Pick<SupplyItemRow, "id" | "name" | "unit" | "packSize"> | null;
};

type FallbackUser = {
  id: number;
  username: string;
  role: string | null;
  factoryKey: string | null;
  isFallback: true;
};

const REQUEST_TYPES = new Set(["internal_factory", "cross_factory"]);
const APPROVER_ACTIONS = new Set(["approve", "reject"]);

type SupplyRequestInputItem = {
  supplyItemId: number;
  quantity: number;
  quantityUnit: "base" | "pack";
  note: string | null;
};

function normalizeApprovedQtys(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      const requestItemId = parseInteger((item as { requestItemId?: unknown }).requestItemId);
      const quantity = parseInteger((item as { quantity?: unknown }).quantity);
      if (!requestItemId || quantity == null) return null;
      return { requestItemId, quantity };
    })
    .filter((item): item is { requestItemId: number; quantity: number } => item !== null);
}

function normalizeRequestItems(items: unknown) {
  if (!Array.isArray(items) || items.length === 0) {
    return { items: [] as SupplyRequestInputItem[], error: null as string | null };
  }

  const normalized: SupplyRequestInputItem[] = [];
  for (const rawItem of items) {
    const supplyItemId = parseInteger((rawItem as { supplyItemId?: unknown }).supplyItemId);
    const quantity = parseWholeQuantity((rawItem as { quantity?: unknown }).quantity);
    const note = parseOptionalString((rawItem as { note?: unknown }).note);
    const quantityUnit = parseQuantityUnit((rawItem as { quantityUnit?: unknown }).quantityUnit);

    if (!supplyItemId) continue;
    if (quantity == null) {
      return { items: [] as SupplyRequestInputItem[], error: "กรุณาระบุจำนวนเต็มที่ถูกต้อง" };
    }
    if (!quantityUnit) {
      return { items: [] as SupplyRequestInputItem[], error: "หน่วยจำนวนไม่ถูกต้อง" };
    }
    if (quantity <= 0) continue;

    normalized.push({ supplyItemId, quantity, quantityUnit, note });
  }

  return { items: normalized, error: null as string | null };
}

function isMissingUsersRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const rec = error as { cause?: unknown; message?: unknown };
  if (typeof rec.message === "string" && rec.message.includes(`"users"`)) {
    return true;
  }
  return isMissingUsersRelationError(rec.cause);
}

function buildFallbackUser(
  userId: number | null | undefined,
  factoryKey: string | null,
  label: "creator" | "approver"
): FallbackUser | null {
  if (!userId) return null;

  return {
    id: userId,
    username: `[missing ${label} #${userId}]`,
    role: null,
    factoryKey,
    isFallback: true,
  };
}

function attachFallbackUsers<T extends {
  createdBy: number | null;
  approvedBy: number | null;
  factoryKey: string;
  createdByUser?: unknown;
  approvedByUser?: unknown;
}>(detail: T) {
  return {
    ...detail,
    createdByUser:
      detail.createdByUser ??
      buildFallbackUser(detail.createdBy, detail.factoryKey, "creator"),
    approvedByUser:
      detail.approvedByUser ??
      buildFallbackUser(detail.approvedBy, detail.factoryKey, "approver"),
  };
}

async function loadSupplyItemsByIds(db: DrizzleDB, ids: number[]) {
  if (ids.length === 0) return [];

  const findMany = db.query?.supplyItems?.findMany;
  if (findMany) {
    return findMany({
      where: inArray(supplyItems.id, ids),
    });
  }

  return db.select().from(supplyItems).where(inArray(supplyItems.id, ids));
}

async function attachSupplyItemDetails(
  db: DrizzleDB,
  items: SupplyRequestItemRow[]
): Promise<SupplyRequestItemWithSupplyItem[]> {
  const supplyItemIds = Array.from(new Set(items.map((item) => item.supplyItemId)));
  const supplyItemRows = await loadSupplyItemsByIds(db, supplyItemIds);
  const supplyItemById = new Map(
    supplyItemRows.map((item) => [
      item.id,
      {
        id: item.id,
        name: item.name,
        unit: item.unit,
        packSize: item.packSize,
      },
    ])
  );

  return items.map((item) => ({
    ...item,
    supplyItem: supplyItemById.get(item.supplyItemId) || null,
  }));
}

async function loadDetail(db: typeof import("@/db").db, requestId: number) {
  const findFirst = db.query?.supplyRequests?.findFirst;
  if (!findFirst) {
    const [requestRow] = await (db as DrizzleDB)
      .select()
      .from(supplyRequests)
      .where(eq(supplyRequests.id, requestId))
      .limit(1);
    if (!requestRow) return null;

    const items = await (db as DrizzleDB)
      .select()
      .from(supplyRequestItems)
      .where(eq(supplyRequestItems.requestId, requestId))
      .orderBy(asc(supplyRequestItems.id));

    return attachFallbackUsers({
      ...requestRow,
      items: await attachSupplyItemDetails(db as DrizzleDB, items),
      createdByUser: null,
      approvedByUser: null,
    });
  }

  try {
    const detail = await db.query.supplyRequests.findFirst({
      where: eq(supplyRequests.id, requestId),
      with: {
        items: {
          orderBy: [asc(supplyRequestItems.id)],
          with: {
            supplyItem: true,
          },
        },
        createdByUser: true,
        approvedByUser: true,
      },
    });

    return detail ? attachFallbackUsers(detail) : null;
  } catch (error) {
    if (!isMissingUsersRelationError(error)) throw error;

    const [requestRow] = await (db as DrizzleDB)
      .select()
      .from(supplyRequests)
      .where(eq(supplyRequests.id, requestId))
      .limit(1);
    if (!requestRow) return null;

    const items = await (db as DrizzleDB)
      .select()
      .from(supplyRequestItems)
      .where(eq(supplyRequestItems.requestId, requestId))
      .orderBy(asc(supplyRequestItems.id));

    return attachFallbackUsers({
      ...requestRow,
      items: await attachSupplyItemDetails(db as DrizzleDB, items),
      createdByUser: null,
      approvedByUser: null,
    });
  }
}

async function loadRequestRef(db: DrizzleDB, factoryKey: string, requestId: number) {
  if (typeof db.select !== "function") {
    return null;
  }

  const rows = await db
    .select({
      id: supplyRequests.id,
      createdAt: supplyRequests.createdAt,
    })
    .from(supplyRequests)
    .where(eq(supplyRequests.factoryKey, factoryKey))
    .orderBy(asc(supplyRequests.createdAt), asc(supplyRequests.id));

  return buildSupplyRequestRefMap(rows).get(requestId) || null;
}

function resolveRequestDbContext(request: NextRequest, actorContext: { factoryKey: string; db: DrizzleDB }) {
  const requestedFactoryKey = request.nextUrl.searchParams.get("factoryKey")?.trim() || actorContext.factoryKey;
  if (requestedFactoryKey === actorContext.factoryKey) return actorContext;

  const validFactoryKey = ensureFactoryKey(requestedFactoryKey);
  if (!validFactoryKey) {
    return {
      error: NextResponse.json({ error: "โรงงานที่เลือกไม่ถูกต้อง" }, { status: 400 }),
    };
  }

  return {
    factoryKey: validFactoryKey,
    db: getDbForFactory(validFactoryKey),
  };
}

function getApprovalFactoryKey(detail: { factoryKey: string; requestType: string; targetFactoryKey: string | null }) {
  return detail.requestType === "cross_factory" ? detail.targetFactoryKey : detail.factoryKey;
}

function canReadRequest(detail: { factoryKey: string; requestType: string; targetFactoryKey: string | null }, actorFactoryKey: string) {
  return detail.factoryKey === actorFactoryKey || getApprovalFactoryKey(detail) === actorFactoryKey;
}

function getActionFactoryKey(
  action: string,
  detail: { factoryKey: string; requestType: string; targetFactoryKey: string | null }
) {
  if (APPROVER_ACTIONS.has(action)) return getApprovalFactoryKey(detail);
  return detail.factoryKey;
}

export const GET = withErrorHandler(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  const actorContext = resolveSupplyWriteContext(request, auth.user);
  if ("error" in actorContext) return actorContext.error;
  const requestContext = resolveRequestDbContext(request, actorContext);
  if ("error" in requestContext) return requestContext.error;

  const { id } = await params;
  const requestId = parseInteger(id);
  if (!requestId) return badRequest("รหัสใบเบิกไม่ถูกต้อง");

  const detail = await loadDetail(requestContext.db as never, requestId);
  if (!detail || !canReadRequest(detail, actorContext.factoryKey)) {
    return NextResponse.json({ error: "ไม่พบใบเบิก" }, { status: 404 });
  }

  const normalizedDetail = attachFallbackUsers(detail);
  const requestRef = await loadRequestRef(requestContext.db, normalizedDetail.factoryKey, normalizedDetail.id);
  return NextResponse.json({ ...normalizedDetail, requestRef });
});

export const POST = withErrorHandler(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  const actorContext = resolveSupplyWriteContext(request, auth.user);
  if ("error" in actorContext) return actorContext.error;
  const requestContext = resolveRequestDbContext(request, actorContext);
  if ("error" in requestContext) return requestContext.error;

  const { id } = await params;
  const requestId = parseInteger(id);
  if (!requestId) return badRequest("รหัสใบเบิกไม่ถูกต้อง");

  const body = await request.json();
  const action = typeof body?.action === "string" ? body.action : null;
  if (!action) return badRequest("กรุณาระบุ action");

  const findFirst = requestContext.db.query?.supplyRequests?.findFirst;
  const existing = findFirst
    ? await findFirst({
        where: eq(supplyRequests.id, requestId),
      })
    : (
        await requestContext.db
          .select()
          .from(supplyRequests)
          .where(eq(supplyRequests.id, requestId))
          .limit(1)
      )[0];
  if (!existing || !canReadRequest(existing, actorContext.factoryKey)) {
    return NextResponse.json({ error: "ไม่พบใบเบิก" }, { status: 404 });
  }

  const actionFactoryKey = getActionFactoryKey(action, existing);
  if (!actionFactoryKey || actionFactoryKey !== actorContext.factoryKey) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ทำรายการนี้จากโรงงานปัจจุบัน" }, { status: 403 });
  }

  let result;
  if (action === "submit") {
    result = await submitRequest(requestContext.db, requestId, auth.user);
  } else if (action === "approve") {
    const signature = parseOptionalString(body?.signature) || "";
    if (!signature) return badRequest("กรุณาระบุลายเซ็นผู้อนุมัติ");
    result = await approveRequest(
      requestContext.db,
      requestId,
      auth.user,
      normalizeApprovedQtys(body?.approvedQtys),
      signature,
      {
        stockDb: existing.requestType === "cross_factory" && existing.targetFactoryKey
          ? getDbForFactory(existing.targetFactoryKey)
          : undefined,
      }
    );
  } else if (action === "reject") {
    result = await rejectRequest(
      requestContext.db,
      requestId,
      auth.user,
      parseOptionalString(body?.note) || ""
    );
  } else if (action === "fulfil") {
    result = await fulfillRequest(requestContext.db, requestId, auth.user);
  } else if (action === "cancel") {
    result = await cancelRequest(requestContext.db, requestId, auth.user);
  } else {
    return badRequest("action ไม่ถูกต้อง");
  }

  await logAudit(
    {
      userId: auth.user.id,
      username: auth.user.username,
      action: `supply.request.${action === "fulfil" ? "fulfil" : action}`,
      entity: "supply_request",
      entityId: requestId,
      details: {
        factoryKey: requestContext.factoryKey,
        actorFactoryKey: actorContext.factoryKey,
        approvalFactoryKey: actionFactoryKey,
        status: result.status,
        note: parseOptionalString(body?.note),
      },
    },
    requestContext.db
  );

  const detail = await loadDetail(requestContext.db as never, requestId);
  const normalizedDetail = detail ? attachFallbackUsers(detail) : null;
  const requestRef = normalizedDetail
    ? await loadRequestRef(requestContext.db, normalizedDetail.factoryKey, normalizedDetail.id)
    : null;
  return NextResponse.json(normalizedDetail ? { ...normalizedDetail, requestRef } : null);
});

export const PUT = withErrorHandler(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  const actorContext = resolveSupplyWriteContext(request, auth.user);
  if ("error" in actorContext) return actorContext.error;
  const requestContext = resolveRequestDbContext(request, actorContext);
  if ("error" in requestContext) return requestContext.error;

  const { id } = await params;
  const requestId = parseInteger(id);
  if (!requestId) return badRequest("รหัสใบเบิกไม่ถูกต้อง");

  const body = await request.json();
  const requestType = typeof body?.requestType === "string" ? body.requestType : "internal_factory";
  const targetFactoryKey = parseOptionalString(body?.targetFactoryKey);
  const requesterName = parseOptionalString(body?.requesterName);
  const note = parseOptionalString(body?.note);
  const normalizedRequestItems = normalizeRequestItems(body?.items);

  if (!REQUEST_TYPES.has(requestType)) return badRequest("ประเภทใบเบิกไม่ถูกต้อง");
  const targetFactoryValidation = validateSupplyRequestTargetFactoryKey(
    requestType,
    targetFactoryKey,
    { allowEmpty: true }
  );
  if (targetFactoryValidation.error) return badRequest(targetFactoryValidation.error);
  if (requestType === "cross_factory" && targetFactoryValidation.targetFactoryKey === requestContext.factoryKey) {
    return badRequest("โรงงานต้นทางและโรงงานผู้ขอต้องไม่ซ้ำกัน");
  }
  if (normalizedRequestItems.error) return badRequest(normalizedRequestItems.error);

  const existing = await loadDetail(requestContext.db as never, requestId);
  if (!existing || existing.factoryKey !== actorContext.factoryKey) {
    return NextResponse.json({ error: "ไม่พบใบเบิก" }, { status: 404 });
  }
  if (existing.status !== "draft") {
    return badRequest("แก้ไขได้เฉพาะใบเบิกสถานะ draft", 409);
  }

  const items = normalizedRequestItems.items;
  const supplyItemIds = Array.from(new Set(items.map((item) => item.supplyItemId)));
  const supplyItemRows = await loadSupplyItemsByIds(requestContext.db, supplyItemIds);
  const supplyItemById = new Map(supplyItemRows.map((item) => [item.id, item]));
  if (supplyItemIds.length !== supplyItemById.size) {
    return badRequest("พบรายการของใช้ที่ไม่ถูกต้อง");
  }

  const normalizedItems = items.map((item) => {
    const supplyItem = supplyItemById.get(item.supplyItemId);
    if (!supplyItem) {
      throw new Error(`Supply item ${item.supplyItemId} not found`);
    }

    return {
      supplyItemId: item.supplyItemId,
      quantityRequested: convertToBaseQuantity(
        item.quantity,
        item.quantityUnit,
        supplyItem.packSize
      ),
      note: item.note,
    };
  });

  const updated = await updateDraftRequest(requestContext.db, requestId, {
    requestType: requestType as "internal_factory" | "cross_factory",
    targetFactoryKey: targetFactoryValidation.targetFactoryKey,
    requesterName,
    note,
    items: normalizedItems,
  });

  await logAudit(
    {
      userId: auth.user.id,
      username: auth.user.username,
      action: "supply.request.update_draft",
      entity: "supply_request",
      entityId: requestId,
      details: {
        factoryKey: requestContext.factoryKey,
        actorFactoryKey: actorContext.factoryKey,
        requestType,
        targetFactoryKey: targetFactoryValidation.targetFactoryKey,
        requesterName,
        note,
        status: updated.status,
        itemCount: normalizedItems.length,
      },
    },
    requestContext.db
  );

  const detail = await loadDetail(requestContext.db as never, requestId);
  const normalizedDetail = detail ? attachFallbackUsers(detail) : null;
  const requestRef = normalizedDetail
    ? await loadRequestRef(requestContext.db, normalizedDetail.factoryKey, normalizedDetail.id)
    : null;
  return NextResponse.json(normalizedDetail ? { ...normalizedDetail, requestRef } : null);
});
