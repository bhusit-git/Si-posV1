import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

import type { DrizzleDB } from "@/db";
import { supplyItems } from "@/db/schema";
import { requireAdmin } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import { writeStockLedger } from "@/lib/supply/stock-engine";
import {
  badRequest,
  parseInteger,
  parseOptionalString,
  resolveSupplyWriteContext,
} from "@/lib/supply/route-helpers";
import {
  convertToBaseQuantity,
  parseQuantityUnit,
  parseWholeQuantity,
} from "@/lib/supply/unit-conversion";

const ALLOWED_TYPES = new Set(["purchase_in", "adjustment", "bag_return_manual"]);
const POSITIVE_ONLY_TYPES = new Set(["purchase_in", "bag_return_manual"]);

async function loadSupplyItemById(
  db: DrizzleDB,
  supplyItemId: number
) {
  const findFirst = db.query?.supplyItems?.findFirst as unknown as
    | ((args: { where: unknown }) => Promise<{ id: number; name: string; packSize: number } | null | undefined>)
    | undefined;
  if (findFirst) {
    return (await findFirst({
      where: eq(supplyItems.id, supplyItemId),
    })) || null;
  }

  if (typeof db.select === "function") {
    const rows = await db
      .select()
      .from(supplyItems)
      .where(eq(supplyItems.id, supplyItemId))
      .limit(1);
    return rows[0] || null;
  }

  return null;
}

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const context = resolveSupplyWriteContext(request, auth.user);
  if ("error" in context) return context.error;

  const body = await request.json();
  const supplyItemId = parseInteger(body?.supplyItemId);
  const quantity = parseWholeQuantity(body?.quantity);
  const type = typeof body?.type === "string" ? body.type : null;
  const note = parseOptionalString(body?.note);
  const quantityUnit = parseQuantityUnit(body?.quantityUnit);

  if (!supplyItemId) return badRequest("กรุณาระบุของใช้");
  if (quantity == null) return badRequest("กรุณาระบุจำนวนเต็มที่ถูกต้อง");
  if (quantity === 0) return badRequest("กรุณาระบุจำนวนที่ไม่เป็นศูนย์");
  if (!type || !ALLOWED_TYPES.has(type)) return badRequest("ประเภทการปรับยอดไม่ถูกต้อง");
  if (!quantityUnit) return badRequest("หน่วยจำนวนไม่ถูกต้อง");
  if (POSITIVE_ONLY_TYPES.has(type) && quantity < 0) {
    return badRequest("จำนวนต้องมากกว่า 0 สำหรับประเภทนี้");
  }

  const item = await loadSupplyItemById(context.db, supplyItemId);
  if (!item) {
    return NextResponse.json({ error: "ไม่พบของใช้" }, { status: 404 });
  }

  const normalizedQuantity = convertToBaseQuantity(quantity, quantityUnit, item.packSize);
  if (normalizedQuantity === 0) {
    return badRequest("กรุณาระบุจำนวนที่ไม่เป็นศูนย์");
  }
  if (POSITIVE_ONLY_TYPES.has(type) && normalizedQuantity < 0) {
    return badRequest("จำนวนต้องมากกว่า 0 สำหรับประเภทนี้");
  }

  const entry = await writeStockLedger(context.db, {
    factoryKey: context.factoryKey,
    supplyItemId,
    type: type as "purchase_in" | "adjustment" | "bag_return_manual",
    quantity: normalizedQuantity,
    note,
    createdBy: auth.user.id,
  });

  await logAudit(
    {
      userId: auth.user.id,
      username: auth.user.username,
      action: "supply.stock.adjust",
      entity: "supply_stock_ledger",
      entityId: entry.id,
      details: {
        factoryKey: context.factoryKey,
        supplyItemId,
        type,
        quantityRequested: quantity,
        quantityUnit,
        quantityBase: normalizedQuantity,
        note,
      },
    },
    context.db
  );

  return NextResponse.json(entry, { status: 201 });
});
