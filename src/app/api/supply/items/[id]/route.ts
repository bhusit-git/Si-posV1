import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import type { DrizzleDB } from "@/db";
import { supplyItems } from "@/db/schema";
import { requireAdmin } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import {
  badRequest,
  parseInteger,
  parseOptionalString,
  resolveSupplyWriteContext,
} from "@/lib/supply/route-helpers";

function isMissingImageUrlColumnError(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42703"
  ) {
    const column = "column" in error ? (error as { column?: unknown }).column : undefined;
    return column === "image_url" || column === "imageUrl";
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("image_url") && message.includes("does not exist");
}

async function findSupplyItemById(db: DrizzleDB, supplyItemId: number) {
  try {
    const findFirst = db.query?.supplyItems?.findFirst;
    if (findFirst) {
      return await findFirst({
        where: eq(supplyItems.id, supplyItemId),
      });
    }

    return (
      await db
        .select()
        .from(supplyItems)
        .where(eq(supplyItems.id, supplyItemId))
        .limit(1)
    )[0];
  } catch (error) {
    if (!isMissingImageUrlColumnError(error)) throw error;

    const rows = await db.execute(sql`
      SELECT
        id,
        name,
        unit,
        category,
        item_code AS "itemCode",
        NULL::text AS "imageUrl",
        linked_product_type_id AS "linkedProductTypeId",
        low_stock_threshold AS "lowStockThreshold",
        is_active AS "isActive"
      FROM supply_items
      WHERE id = ${supplyItemId}
      LIMIT 1
    `);

    return Array.from(rows)[0];
  }
}

export const PUT = withErrorHandler(async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const context = resolveSupplyWriteContext(request, auth.user);
  if ("error" in context) return context.error;

  const { id } = await params;
  const supplyItemId = parseInteger(id);
  if (!supplyItemId) return badRequest("รหัสของใช้ไม่ถูกต้อง");

  const existing = await findSupplyItemById(context.db, supplyItemId);
  if (!existing) {
    return NextResponse.json({ error: "ไม่พบของใช้" }, { status: 404 });
  }

  const body = await request.json();
  const name = body?.name === undefined ? existing.name : parseOptionalString(body.name);
  const unit = body?.unit === undefined ? existing.unit : parseOptionalString(body.unit);
  const category = body?.category === undefined ? existing.category : parseOptionalString(body.category);
  const itemCode = body?.itemCode === undefined ? existing.itemCode : parseOptionalString(body.itemCode);
  const imageUrl = body?.imageUrl === undefined ? existing.imageUrl : parseOptionalString(body.imageUrl);
  const linkedProductTypeId =
    body?.linkedProductTypeId === undefined
      ? existing.linkedProductTypeId
      : parseInteger(body.linkedProductTypeId);
  const lowStockThreshold =
    body?.lowStockThreshold === undefined
      ? existing.lowStockThreshold
      : Math.max(0, parseInteger(body.lowStockThreshold) ?? 0);
  const isActive = body?.isActive === undefined ? existing.isActive : Boolean(body.isActive);

  if (!name) return badRequest("กรุณาระบุชื่อของใช้");
  if (!unit) return badRequest("กรุณาระบุหน่วยนับ");

  const baseValues = {
    name,
    unit,
    category,
    itemCode,
    imageUrl,
    linkedProductTypeId,
    lowStockThreshold,
    isActive,
    updatedAt: new Date(),
  };

  let updated;
  try {
    [updated] = await context.db
      .update(supplyItems)
      .set(baseValues)
      .where(eq(supplyItems.id, supplyItemId))
      .returning();
  } catch (error) {
    if (!isMissingImageUrlColumnError(error)) throw error;

    [updated] = await context.db
      .update(supplyItems)
      .set({
        ...baseValues,
        imageUrl: undefined,
      })
      .where(eq(supplyItems.id, supplyItemId))
      .returning();
    updated = { ...updated, imageUrl: null };
  }

  await logAudit(
    {
      userId: auth.user.id,
      username: auth.user.username,
      action: "supply.item.update",
      entity: "supply_item",
      entityId: updated.id,
      details: {
        factoryKey: context.factoryKey,
        name,
        unit,
        category,
        itemCode,
        imageUrl,
        linkedProductTypeId,
        lowStockThreshold,
        isActive,
      },
    },
    context.db
  );

  return NextResponse.json(updated);
});
