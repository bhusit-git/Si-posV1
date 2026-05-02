import { NextRequest, NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";

import type { DrizzleDB } from "@/db";
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
} from "@/lib/supply/request-engine";
import {
  badRequest,
  parseInteger,
  parseOptionalString,
  resolveSupplyReadContext,
  resolveSupplyWriteContext,
} from "@/lib/supply/route-helpers";

type SupplyRequestItemRow = typeof supplyRequestItems.$inferSelect;
type SupplyItemRow = typeof supplyItems.$inferSelect;
type SupplyRequestItemWithSupplyItem = SupplyRequestItemRow & {
  supplyItem: Pick<SupplyItemRow, "id" | "name" | "unit" | "packSize"> | null;
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

    return {
      ...requestRow,
      items: await attachSupplyItemDetails(db as DrizzleDB, items),
      createdByUser: null,
      approvedByUser: null,
    };
  }

  return db.query.supplyRequests.findFirst({
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

export const GET = withErrorHandler(async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  const context = resolveSupplyReadContext(request, auth.user);
  if ("error" in context) return context.error;

  const { id } = await params;
  const requestId = parseInteger(id);
  if (!requestId) return badRequest("รหัสใบเบิกไม่ถูกต้อง");

  const detail = await loadDetail(context.db as never, requestId);
  if (!detail || detail.factoryKey !== context.factoryKey) {
    return NextResponse.json({ error: "ไม่พบใบเบิก" }, { status: 404 });
  }

  const requestRef = await loadRequestRef(context.db, context.factoryKey, detail.id);
  return NextResponse.json({ ...detail, requestRef });
});

export const POST = withErrorHandler(async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  const context = resolveSupplyWriteContext(request, auth.user);
  if ("error" in context) return context.error;

  const { id } = await params;
  const requestId = parseInteger(id);
  if (!requestId) return badRequest("รหัสใบเบิกไม่ถูกต้อง");

  const body = await request.json();
  const action = typeof body?.action === "string" ? body.action : null;
  if (!action) return badRequest("กรุณาระบุ action");

  const findFirst = context.db.query?.supplyRequests?.findFirst;
  const existing = findFirst
    ? await findFirst({
        where: eq(supplyRequests.id, requestId),
      })
    : (
        await context.db
          .select()
          .from(supplyRequests)
          .where(eq(supplyRequests.id, requestId))
          .limit(1)
      )[0];
  if (!existing || existing.factoryKey !== context.factoryKey) {
    return NextResponse.json({ error: "ไม่พบใบเบิก" }, { status: 404 });
  }

  let result;
  if (action === "submit") {
    result = await submitRequest(context.db, requestId, auth.user);
  } else if (action === "approve") {
    const signature = parseOptionalString(body?.signature) || "";
    if (!signature) return badRequest("กรุณาระบุลายเซ็นผู้อนุมัติ");
    result = await approveRequest(
      context.db,
      requestId,
      auth.user,
      normalizeApprovedQtys(body?.approvedQtys),
      signature
    );
  } else if (action === "reject") {
    result = await rejectRequest(
      context.db,
      requestId,
      auth.user,
      parseOptionalString(body?.note) || ""
    );
  } else if (action === "fulfil") {
    result = await fulfillRequest(context.db, requestId, auth.user);
  } else if (action === "cancel") {
    result = await cancelRequest(context.db, requestId, auth.user);
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
        factoryKey: context.factoryKey,
        status: result.status,
        signature: action === "approve" ? parseOptionalString(body?.signature) : null,
        note: parseOptionalString(body?.note),
      },
    },
    context.db
  );

  const detail = await loadDetail(context.db as never, requestId);
  const requestRef = detail
    ? await loadRequestRef(context.db, context.factoryKey, detail.id)
    : null;
  return NextResponse.json(detail ? { ...detail, requestRef } : null);
});
