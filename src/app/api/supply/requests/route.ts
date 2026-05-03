import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";

import { getDbForFactory, getFactories, type DrizzleDB } from "@/db";
import { supplyItems, supplyRequestItems, supplyRequests } from "@/db/schema";
import { requireManagerUp } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import { buildSupplyRequestRefMap } from "@/lib/supply/request-ref";
import {
  badRequest,
  parseInteger,
  parseOptionalString,
  resolveSupplyReadContext,
  resolveSupplyWriteContext,
  validateSupplyRequestTargetFactoryKey,
} from "@/lib/supply/route-helpers";
import {
  convertToBaseQuantity,
  parseQuantityUnit,
  parseWholeQuantity,
} from "@/lib/supply/unit-conversion";

const REQUEST_TYPES = new Set(["internal_factory", "cross_factory"]);
const REQUEST_STATUSES = new Set(["draft", "pending"]);
type SupplyRequestRow = typeof supplyRequests.$inferSelect;
type SupplyRequestItemRow = typeof supplyRequestItems.$inferSelect;
type SupplyItemRow = typeof supplyItems.$inferSelect;

type SupplyRequestInputItem = {
  supplyItemId: number;
  quantity: number;
  quantityUnit: "base" | "pack";
  note: string | null;
};

type SupplyRequestItemWithSupplyItem = SupplyRequestItemRow & {
  supplyItem: Pick<SupplyItemRow, "id" | "name" | "unit" | "packSize"> | null;
};

function isMissingSupplyRequestTableError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const rec = error as { code?: unknown; cause?: unknown; message?: unknown };
  if (rec.code === "42P01") return true;
  if (
    typeof rec.message === "string" &&
    (rec.message.includes(`"supply_requests"`) ||
      rec.message.includes(`"supply_request_items"`))
  ) {
    return true;
  }
  return isMissingSupplyRequestTableError(rec.cause);
}

function isMissingUsersRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const rec = error as { cause?: unknown; message?: unknown };
  if (typeof rec.message === "string" && rec.message.includes(`"users"`)) {
    return true;
  }
  return isMissingUsersRelationError(rec.cause);
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

function appendItems(
  requests: SupplyRequestRow[],
  items: SupplyRequestItemRow[]
) {
  const itemsByRequest = new Map<number, SupplyRequestItemRow[]>();
  for (const item of items) {
    const current = itemsByRequest.get(item.requestId) || [];
    current.push(item);
    itemsByRequest.set(item.requestId, current);
  }

  return requests.map((row) => ({
    ...row,
    items: itemsByRequest.get(row.id) || [],
  }));
}

async function loadRequestsWithSelect(
  db: DrizzleDB,
  factoryKey: string,
  status: string | null
) {
  const where = status
    ? and(eq(supplyRequests.factoryKey, factoryKey), eq(supplyRequests.status, status as never))
    : eq(supplyRequests.factoryKey, factoryKey);

  const rows = await db
    .select()
    .from(supplyRequests)
    .where(where)
    .orderBy(desc(supplyRequests.updatedAt), desc(supplyRequests.id));

  if (rows.length === 0) return [];

  const items = await db
    .select()
    .from(supplyRequestItems)
    .where(inArray(supplyRequestItems.requestId, rows.map((row) => row.id)))
    .orderBy(asc(supplyRequestItems.id));

  return appendItems(rows, await attachSupplyItemDetails(db, items));
}

async function loadRequests(db: DrizzleDB, factoryKey: string, status: string | null) {
  const findMany = db.query?.supplyRequests?.findMany;
  if (!findMany) {
    return loadRequestsWithSelect(db, factoryKey, status);
  }

  return findMany({
    where: status ? and(eq(supplyRequests.factoryKey, factoryKey), eq(supplyRequests.status, status as never)) : eq(supplyRequests.factoryKey, factoryKey),
    with: {
      items: true,
    },
    orderBy: [desc(supplyRequests.updatedAt), desc(supplyRequests.id)],
  });
}

async function loadIncomingCrossFactoryRequests(
  db: DrizzleDB,
  requesterFactoryKey: string,
  sourceFactoryKey: string,
  status: string | null
) {
  if (status === "draft") {
    return [];
  }

  const filters = [
    eq(supplyRequests.factoryKey, requesterFactoryKey),
    eq(supplyRequests.requestType, "cross_factory"),
    eq(supplyRequests.targetFactoryKey, sourceFactoryKey),
  ];
  if (status) {
    filters.push(eq(supplyRequests.status, status as never));
  } else {
    filters.push(eq(supplyRequests.status, "pending"));
  }
  const where = filters.length === 1 ? filters[0] : and(...filters);

  const findMany = db.query?.supplyRequests?.findMany;
  if (!findMany) {
    const rows = await db
      .select()
      .from(supplyRequests)
      .where(where)
      .orderBy(desc(supplyRequests.updatedAt), desc(supplyRequests.id));
    if (rows.length === 0) return [];

    const items = await db
      .select()
      .from(supplyRequestItems)
      .where(inArray(supplyRequestItems.requestId, rows.map((row) => row.id)))
      .orderBy(asc(supplyRequestItems.id));

    return appendItems(rows, await attachSupplyItemDetails(db, items));
  }

  return findMany({
    where,
    with: {
      items: true,
    },
    orderBy: [desc(supplyRequests.updatedAt), desc(supplyRequests.id)],
  });
}

async function loadRequestDetail(db: DrizzleDB, requestId: number) {
  const findFirst = db.query?.supplyRequests?.findFirst;
  if (!findFirst) {
    const [requestRow] = await db
      .select()
      .from(supplyRequests)
      .where(eq(supplyRequests.id, requestId))
      .limit(1);
    if (!requestRow) return null;

    const items = await db
      .select()
      .from(supplyRequestItems)
      .where(eq(supplyRequestItems.requestId, requestId))
      .orderBy(asc(supplyRequestItems.id));

    return {
      ...requestRow,
      items: await attachSupplyItemDetails(db, items),
      createdByUser: null,
      approvedByUser: null,
    };
  }

  try {
    return await findFirst({
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
  } catch (error) {
    if (!isMissingUsersRelationError(error)) throw error;

    const [requestRow] = await db
      .select()
      .from(supplyRequests)
      .where(eq(supplyRequests.id, requestId))
      .limit(1);
    if (!requestRow) return null;

    const items = await db
      .select()
      .from(supplyRequestItems)
      .where(eq(supplyRequestItems.requestId, requestId))
      .orderBy(asc(supplyRequestItems.id));

    return {
      ...requestRow,
      items: await attachSupplyItemDetails(db, items),
      createdByUser: null,
      approvedByUser: null,
    };
  }
}

async function loadRequestRefMap(db: DrizzleDB, factoryKey: string) {
  const rows = await db
    .select({
      id: supplyRequests.id,
      createdAt: supplyRequests.createdAt,
    })
    .from(supplyRequests)
    .where(eq(supplyRequests.factoryKey, factoryKey))
    .orderBy(asc(supplyRequests.createdAt), asc(supplyRequests.id));

  return buildSupplyRequestRefMap(rows);
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  const context = resolveSupplyReadContext(request, auth.user);
  if ("error" in context) return context.error;

  const status = request.nextUrl.searchParams.get("status")?.trim() || null;
  let rows;
  try {
    rows = await loadRequests(context.db, context.factoryKey, status);
  } catch (error) {
    if (isMissingSupplyRequestTableError(error)) {
      return NextResponse.json([]);
    }
    throw error;
  }

  const requestRefs = await loadRequestRefMap(context.db, context.factoryKey);
  const externalRows = [];
  const externalRequestRefs = new Map<string, string | null>();

  for (const factory of getFactories().filter((factory) => factory.key !== context.factoryKey)) {
    const factoryDb = getDbForFactory(factory.key);
    try {
      const incomingRows = await loadIncomingCrossFactoryRequests(
        factoryDb,
        factory.key,
        context.factoryKey,
        status
      );
      if (incomingRows.length === 0) continue;

      const refs = await loadRequestRefMap(factoryDb, factory.key);
      for (const row of incomingRows) {
        externalRequestRefs.set(`${row.factoryKey}:${row.id}`, refs.get(row.id) || null);
      }
      externalRows.push(...incomingRows);
    } catch (error) {
      if (!isMissingSupplyRequestTableError(error)) throw error;
    }
  }

  return NextResponse.json(
    [
      ...rows.map((row) => ({
        ...row,
        requestRef: requestRefs.get(row.id) || null,
      })),
      ...externalRows.map((row) => ({
        ...row,
        requestRef: externalRequestRefs.get(`${row.factoryKey}:${row.id}`) || null,
      })),
    ]
  );
});

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  const context = resolveSupplyWriteContext(request, auth.user);
  if ("error" in context) return context.error;

  const body = await request.json();
  const requestType = typeof body?.requestType === "string" ? body.requestType : "internal_factory";
  const requestedStatus = typeof body?.status === "string" ? body.status : "draft";
  const targetFactoryKey = parseOptionalString(body?.targetFactoryKey);
  const requesterName = parseOptionalString(body?.requesterName);
  const note = parseOptionalString(body?.note);
  const normalizedRequestItems = normalizeRequestItems(body?.items);
  const items = normalizedRequestItems.items;
  const isDraft = requestedStatus === "draft";

  if (!REQUEST_TYPES.has(requestType)) return badRequest("ประเภทใบเบิกไม่ถูกต้อง");
  if (!REQUEST_STATUSES.has(requestedStatus)) {
    return badRequest("สถานะใบเบิกเริ่มต้นไม่ถูกต้อง");
  }
  const targetFactoryValidation = validateSupplyRequestTargetFactoryKey(
    requestType,
    targetFactoryKey,
    { allowEmpty: isDraft }
  );
  if (targetFactoryValidation.error) {
    return badRequest(targetFactoryValidation.error);
  }
  if (requestType === "cross_factory" && targetFactoryValidation.targetFactoryKey === context.factoryKey) {
    return badRequest("โรงงานต้นทางและโรงงานผู้ขอต้องไม่ซ้ำกัน");
  }
  if (normalizedRequestItems.error) {
    return badRequest(normalizedRequestItems.error);
  }
  if (!isDraft && items.length === 0) return badRequest("กรุณาระบุรายการเบิกอย่างน้อย 1 รายการ");
  if (!isDraft && !requesterName) return badRequest("กรุณาระบุผู้ขอใช้จริง");

  const supplyItemIds = Array.from(new Set(items.map((item) => item.supplyItemId)));
  const supplyItemRows = await loadSupplyItemsByIds(context.db, supplyItemIds);
  const supplyItemById = new Map(supplyItemRows.map((item) => [item.id, item]));
  if (supplyItemById.size !== supplyItemIds.length) {
    return badRequest("พบรายการของใช้ที่ไม่ถูกต้อง");
  }

  const normalizedItems = items.map((item) => {
    const supplyItem = supplyItemById.get(item.supplyItemId);
    if (!supplyItem) {
      throw new Error(`Supply item ${item.supplyItemId} not found`);
    }

    return {
      ...item,
      quantityBase: convertToBaseQuantity(
        item.quantity,
        item.quantityUnit,
        supplyItem.packSize
      ),
    };
  });

  const created = await context.db.transaction(async (tx) => {
    const [requestRow] = await tx
      .insert(supplyRequests)
      .values({
        factoryKey: context.factoryKey,
        requestType: requestType as "internal_factory" | "cross_factory",
        targetFactoryKey: targetFactoryValidation.targetFactoryKey,
        requesterName,
        createdBy: auth.user.id,
        status: requestedStatus,
        note,
        updatedAt: new Date(),
      })
      .returning();

    if (normalizedItems.length > 0) {
      await tx.insert(supplyRequestItems).values(
        normalizedItems.map((item) => ({
          requestId: requestRow.id,
          supplyItemId: item.supplyItemId,
          quantityRequested: item.quantityBase,
          quantityApproved: null,
          note: item.note,
        }))
      );
    }

    return requestRow;
  });

  await logAudit(
    {
      userId: auth.user.id,
      username: auth.user.username,
      action: "supply.request.create",
      entity: "supply_request",
      entityId: created.id,
      details: {
        factoryKey: context.factoryKey,
        requestType,
        status: requestedStatus,
        targetFactoryKey: targetFactoryValidation.targetFactoryKey,
        requesterName,
        note,
        itemCount: normalizedItems.length,
        items: normalizedItems.map((item) => ({
          supplyItemId: item.supplyItemId,
          quantityRequested: item.quantity,
          quantityUnit: item.quantityUnit,
          quantityBase: item.quantityBase,
        })),
      },
    },
    context.db
  );

  const detail = await loadRequestDetail(context.db, created.id);
  const requestRefs = await loadRequestRefMap(context.db, context.factoryKey);

  return NextResponse.json(
    detail
      ? {
          ...detail,
          requestRef: requestRefs.get(detail.id) || null,
        }
      : null,
    { status: 201 }
  );
});
