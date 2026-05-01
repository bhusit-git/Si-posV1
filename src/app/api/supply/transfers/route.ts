import { NextRequest, NextResponse } from "next/server";
import { and, asc, desc, eq, inArray, or, type SQL } from "drizzle-orm";

import { getDbForFactory, type DrizzleDB } from "@/db";
import {
  supplyRequestItems,
  supplyTransferItems,
  supplyTransfers,
  supplyRequests,
} from "@/db/schema";
import { requireManagerUp } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import { createTransfer } from "@/lib/supply/transfer-engine";
import {
  badRequest,
  ensureFactoryKey,
  parseInteger,
  parseOptionalString,
  resolveSupplyReadContext,
  resolveSupplyWriteContext,
} from "@/lib/supply/route-helpers";

type SupplyTransferRow = typeof supplyTransfers.$inferSelect;
type SupplyTransferItemRow = typeof supplyTransferItems.$inferSelect;

function normalizeTransferItems(items: unknown) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const normalized = items
    .map((item) => {
      const supplyItemId = parseInteger((item as { supplyItemId?: unknown }).supplyItemId);
      const quantity = parseInteger((item as { quantity?: unknown }).quantity);
      const note = parseOptionalString((item as { note?: unknown }).note);
      if (!supplyItemId || !quantity || quantity <= 0) return null;
      return { supplyItemId, quantity, note };
    })
    .filter((item): item is { supplyItemId: number; quantity: number; note: string | null } => item !== null);

  return normalized.length > 0 ? normalized : null;
}

function appendItems(rows: SupplyTransferRow[], items: SupplyTransferItemRow[]) {
  const itemsByTransfer = new Map<number, SupplyTransferItemRow[]>();
  for (const item of items) {
    const current = itemsByTransfer.get(item.transferId) || [];
    current.push(item);
    itemsByTransfer.set(item.transferId, current);
  }

  return rows.map((row) => ({
    ...row,
    items: itemsByTransfer.get(row.id) || [],
    request: null,
    createdByUser: null,
    receivedByUser: null,
  }));
}

async function loadTransfers(db: DrizzleDB, whereClause: SQL<unknown>) {
  const findMany = db.query?.supplyTransfers?.findMany;
  if (findMany) {
    return findMany({
      where: whereClause,
      with: {
        items: {
          orderBy: [asc(supplyTransferItems.id)],
        },
        request: true,
        createdByUser: true,
        receivedByUser: true,
      },
      orderBy: [desc(supplyTransfers.updatedAt), desc(supplyTransfers.id)],
    });
  }

  const rows = await db
    .select()
    .from(supplyTransfers)
    .where(whereClause)
    .orderBy(desc(supplyTransfers.updatedAt), desc(supplyTransfers.id));
  if (rows.length === 0) return [];

  const items = await db
    .select()
    .from(supplyTransferItems)
    .where(inArray(supplyTransferItems.transferId, rows.map((row) => row.id)))
    .orderBy(asc(supplyTransferItems.id));

  return appendItems(rows, items);
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  const context = resolveSupplyReadContext(request, auth.user);
  if ("error" in context) return context.error;

  const status = request.nextUrl.searchParams.get("status")?.trim() || null;
  const direction = request.nextUrl.searchParams.get("direction")?.trim() || "all";

  const filters = [];
  if (status) filters.push(eq(supplyTransfers.status, status as never));
  if (direction === "incoming") {
    filters.push(eq(supplyTransfers.toFactoryKey, context.factoryKey));
  } else if (direction === "outgoing") {
    filters.push(eq(supplyTransfers.fromFactoryKey, context.factoryKey));
  } else {
    filters.push(
      or(
        eq(supplyTransfers.fromFactoryKey, context.factoryKey),
        eq(supplyTransfers.toFactoryKey, context.factoryKey)
      )!
    );
  }

  const whereClause = (filters.length === 1 ? filters[0] : and(...filters)) as SQL<unknown>;
  const rows = await loadTransfers(context.db, whereClause);

  return NextResponse.json(rows);
});

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  const context = resolveSupplyWriteContext(request, auth.user);
  if ("error" in context) return context.error;

  const body = await request.json();
  const requestId = parseInteger(body?.requestId);
  const toFactoryKey = parseOptionalString(body?.toFactoryKey);
  const note = parseOptionalString(body?.note);
  const items = normalizeTransferItems(body?.items);

  if (!toFactoryKey) return badRequest("กรุณาระบุโรงงานปลายทาง");
  const validToFactoryKey = ensureFactoryKey(toFactoryKey);
  if (!validToFactoryKey) return badRequest("โรงงานปลายทางไม่ถูกต้อง");
  if (validToFactoryKey === context.factoryKey) {
    return badRequest("โรงงานต้นทางและปลายทางต้องไม่ซ้ำกัน");
  }

  const toDb = getDbForFactory(validToFactoryKey);
  let requestRecord = null;
  if (requestId) {
    requestRecord = await toDb.query.supplyRequests.findFirst({
      where: eq(supplyRequests.id, requestId),
    });

    if (!requestRecord) {
      return NextResponse.json({ error: "ไม่พบใบเบิกปลายทาง" }, { status: 404 });
    }
    if (requestRecord.requestType !== "cross_factory") {
      return badRequest("ใบเบิกนี้ไม่ใช่การเบิกข้ามโรงงาน");
    }
    if (requestRecord.status !== "approved") {
      return badRequest("ใบเบิกต้องได้รับอนุมัติก่อนสร้าง transfer");
    }
    if (requestRecord.targetFactoryKey !== context.factoryKey) {
      return badRequest("ใบเบิกนี้ไม่ได้ขอของจากโรงงานปัจจุบัน");
    }
  }

  const finalItems = items ||
    (requestRecord
      ? (await toDb.query.supplyRequestItems.findMany({
          where: eq(supplyRequestItems.requestId, requestRecord.id),
          orderBy: [asc(supplyRequestItems.id)],
        })).map((item) => ({
          supplyItemId: item.supplyItemId,
          quantity: item.quantityApproved ?? item.quantityRequested,
          note: item.note,
        }))
      : null);

  if (!finalItems || finalItems.length === 0) {
    return badRequest("กรุณาระบุรายการโอนอย่างน้อย 1 รายการ");
  }

  const result = await createTransfer(
    context.db,
    toDb,
    {
      requestId,
      fromFactoryKey: context.factoryKey,
      toFactoryKey: validToFactoryKey,
      note,
      items: finalItems,
    },
    auth.user
  );

  await logAudit(
    {
      userId: auth.user.id,
      username: auth.user.username,
      action: "supply.transfer.create",
      entity: "supply_transfer",
      entityId: result.fromRecord.id,
      details: {
        fromFactoryKey: context.factoryKey,
        toFactoryKey: validToFactoryKey,
        requestId,
        transferRef: result.fromRecord.transferRef,
        itemCount: finalItems.length,
      },
    },
    context.db
  );

  return NextResponse.json(result, { status: 201 });
});
