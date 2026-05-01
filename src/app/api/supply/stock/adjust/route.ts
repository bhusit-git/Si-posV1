import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";

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

const ALLOWED_TYPES = new Set(["purchase_in", "adjustment", "bag_return_manual"]);
const POSITIVE_ONLY_TYPES = new Set(["purchase_in", "bag_return_manual"]);

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const context = resolveSupplyWriteContext(request, auth.user);
  if ("error" in context) return context.error;

  const body = await request.json();
  const supplyItemId = parseInteger(body?.supplyItemId);
  const quantity = parseInteger(body?.quantity);
  const type = typeof body?.type === "string" ? body.type : null;
  const note = parseOptionalString(body?.note);

  if (!supplyItemId) return badRequest("กรุณาระบุของใช้");
  if (!quantity || quantity === 0) return badRequest("กรุณาระบุจำนวนที่ไม่เป็นศูนย์");
  if (!type || !ALLOWED_TYPES.has(type)) return badRequest("ประเภทการปรับยอดไม่ถูกต้อง");
  if (POSITIVE_ONLY_TYPES.has(type) && quantity < 0) {
    return badRequest("จำนวนต้องมากกว่า 0 สำหรับประเภทนี้");
  }

  const item = await context.db.query.supplyItems.findFirst({
    where: eq(supplyItems.id, supplyItemId),
  });
  if (!item) {
    return NextResponse.json({ error: "ไม่พบของใช้" }, { status: 404 });
  }

  const entry = await writeStockLedger(context.db, {
    factoryKey: context.factoryKey,
    supplyItemId,
    type: type as "purchase_in" | "adjustment" | "bag_return_manual",
    quantity,
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
        quantity,
        note,
      },
    },
    context.db
  );

  return NextResponse.json(entry, { status: 201 });
});
