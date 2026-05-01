import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";

import { getDbForFactory, type DrizzleDB } from "@/db";
import { supplyTransferItems, supplyTransfers } from "@/db/schema";
import { requireManagerUp } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import { receiveTransfer, rejectTransfer } from "@/lib/supply/transfer-engine";
import {
  badRequest,
  parseInteger,
  parseOptionalString,
  resolveSupplyReadContext,
  resolveSupplyWriteContext,
} from "@/lib/supply/route-helpers";

function normalizeReceivedQtys(input: unknown) {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      const transferItemId = parseInteger((item as { transferItemId?: unknown }).transferItemId);
      const quantity = parseInteger((item as { quantity?: unknown }).quantity);
      if (!transferItemId || quantity == null) return null;
      return { transferItemId, quantity };
    })
    .filter((item): item is { transferItemId: number; quantity: number } => item !== null);
}

async function loadDetail(db: DrizzleDB, transferId: number) {
  const findFirst = db.query?.supplyTransfers?.findFirst;
  if (!findFirst) {
    const [transfer] = await db
      .select()
      .from(supplyTransfers)
      .where(eq(supplyTransfers.id, transferId))
      .limit(1);
    if (!transfer) return null;

    const items = await db
      .select()
      .from(supplyTransferItems)
      .where(eq(supplyTransferItems.transferId, transferId))
      .orderBy(asc(supplyTransferItems.id));

    return {
      ...transfer,
      items,
      request: null,
      createdByUser: null,
      receivedByUser: null,
    };
  }

  return findFirst({
    where: eq(supplyTransfers.id, transferId),
    with: {
      items: {
        orderBy: [asc(supplyTransferItems.id)],
      },
      request: true,
      createdByUser: true,
      receivedByUser: true,
    },
  });
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
  const transferId = parseInteger(id);
  if (!transferId) return badRequest("รหัส transfer ไม่ถูกต้อง");

  const detail = await loadDetail(context.db, transferId);
  if (!detail) {
    return NextResponse.json({ error: "ไม่พบ transfer" }, { status: 404 });
  }
  if (detail.fromFactoryKey !== context.factoryKey && detail.toFactoryKey !== context.factoryKey) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ดู transfer นี้" }, { status: 403 });
  }

  return NextResponse.json(detail);
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
  const transferId = parseInteger(id);
  if (!transferId) return badRequest("รหัส transfer ไม่ถูกต้อง");

  const body = await request.json();
  const action = typeof body?.action === "string" ? body.action : null;
  if (!action) return badRequest("กรุณาระบุ action");

  const findFirst = context.db.query?.supplyTransfers?.findFirst;
  const transfer = findFirst
    ? await findFirst({
        where: eq(supplyTransfers.id, transferId),
      })
    : (
        await context.db
          .select()
          .from(supplyTransfers)
          .where(eq(supplyTransfers.id, transferId))
          .limit(1)
      )[0];
  if (!transfer) {
    return NextResponse.json({ error: "ไม่พบ transfer" }, { status: 404 });
  }

  const remoteFactoryKey =
    transfer.toFactoryKey === context.factoryKey ? transfer.fromFactoryKey : transfer.toFactoryKey;
  const remoteDb = getDbForFactory(remoteFactoryKey);

  if (action === "receive") {
    await receiveTransfer(
      remoteDb,
      context.db,
      transferId,
      auth.user,
      normalizeReceivedQtys(body?.receivedQtys)
    );
  } else if (action === "reject") {
    await rejectTransfer(
      remoteDb,
      context.db,
      transferId,
      auth.user,
      parseOptionalString(body?.note) || ""
    );
  } else {
    return badRequest("action ไม่ถูกต้อง");
  }

  await logAudit(
    {
      userId: auth.user.id,
      username: auth.user.username,
      action: `supply.transfer.${action}`,
      entity: "supply_transfer",
      entityId: transferId,
      details: {
        factoryKey: context.factoryKey,
        remoteFactoryKey,
        note: parseOptionalString(body?.note),
      },
    },
    context.db
  );

  const detail = await loadDetail(context.db, transferId);
  return NextResponse.json(detail);
});
