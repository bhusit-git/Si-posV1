import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";

import type { DrizzleDB } from "@/db";
import { supplyItems } from "@/db/schema";
import { extractPostgresError } from "@/lib/api-error-diagnostics";
import { requireAdmin } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import {
  badRequest,
  ensureSupplyItemDetailColumns,
  normalizeSupplyItemType,
  parseInteger,
  parseOptionalString,
  resolveSupplyWriteContext,
} from "@/lib/supply/route-helpers";

function isSupplyItemsSchemaDriftError(error: unknown): boolean {
  const pg = extractPostgresError(error);
  if (pg?.code === "42703") return true;

  let current: unknown = error;
  let depth = 0;
  while (current && depth < 6) {
    const message = current instanceof Error ? current.message : String(current ?? "");
    if (message.includes("42703")) return true;
    if (message.includes("column") && message.includes("does not exist")) return true;

    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause?: unknown }).cause
        : null;
    depth += 1;
  }

  return false;
}

interface SupplyItemRouteRow {
  id: number;
  name: string;
  unit: string;
  category: string | null;
  itemCode: string | null;
  imageUrl: string | null;
  itemType: string | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  barcode: string | null;
  details: string | null;
  purchasedAt: string | null;
  warrantyExpiresAt: string | null;
  packSize: number;
  borrowLimit: number;
  linkedProductTypeId: number | null;
  lowStockThreshold: number;
  isActive: boolean;
}

async function findSupplyItemById(
  db: DrizzleDB,
  supplyItemId: number
): Promise<SupplyItemRouteRow | undefined> {
  try {
    const findFirst = db.query?.supplyItems?.findFirst;
    if (findFirst) {
      return (await findFirst({
        where: eq(supplyItems.id, supplyItemId),
      })) as SupplyItemRouteRow | undefined;
    }

    return (
      await db
        .select()
        .from(supplyItems)
        .where(eq(supplyItems.id, supplyItemId))
        .limit(1)
    )[0] as SupplyItemRouteRow | undefined;
  } catch (error) {
    if (!isSupplyItemsSchemaDriftError(error)) throw error;

    const rows = await db.execute(sql`
      SELECT
        id,
        name,
        unit,
        category,
        item_code AS "itemCode",
        NULL::text AS "imageUrl",
        NULL::text AS "itemType",
        NULL::text AS "brand",
        NULL::text AS "model",
        NULL::text AS "serialNumber",
        NULL::text AS "barcode",
        NULL::text AS "details",
        NULL::text AS "purchasedAt",
        NULL::text AS "warrantyExpiresAt",
        1::int AS "packSize",
        0::int AS "borrowLimit",
        linked_product_type_id AS "linkedProductTypeId",
        low_stock_threshold AS "lowStockThreshold",
        is_active AS "isActive"
      FROM supply_items
      WHERE id = ${supplyItemId}
      LIMIT 1
    `);

    return Array.from(rows)[0] as unknown as SupplyItemRouteRow | undefined;
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
  const itemType =
    body?.itemType === undefined ? normalizeSupplyItemType(existing.itemType) : normalizeSupplyItemType(body.itemType);
  const brand = body?.brand === undefined ? existing.brand : parseOptionalString(body.brand);
  const model = body?.model === undefined ? existing.model : parseOptionalString(body.model);
  const serialNumber =
    body?.serialNumber === undefined ? existing.serialNumber : parseOptionalString(body.serialNumber);
  const barcode = body?.barcode === undefined ? existing.barcode : parseOptionalString(body.barcode);
  const details = body?.details === undefined ? existing.details : parseOptionalString(body.details);
  const purchasedAt =
    body?.purchasedAt === undefined ? existing.purchasedAt : parseOptionalString(body.purchasedAt);
  const warrantyExpiresAt =
    body?.warrantyExpiresAt === undefined
      ? existing.warrantyExpiresAt
      : parseOptionalString(body.warrantyExpiresAt);
  const packSize =
    body?.packSize === undefined ? existing.packSize ?? 1 : Math.max(1, parseInteger(body.packSize) ?? 1);
  const borrowLimit =
    body?.borrowLimit === undefined
      ? existing.borrowLimit ?? 0
      : Math.max(0, parseInteger(body.borrowLimit) ?? 0);
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
    itemType,
    brand,
    model,
    serialNumber,
    barcode,
    details,
    purchasedAt,
    warrantyExpiresAt,
    packSize,
    borrowLimit,
    linkedProductTypeId,
    lowStockThreshold,
    isActive,
    updatedAt: new Date(),
  };

  let updated: SupplyItemRouteRow;
  try {
    [updated] = (await context.db
      .update(supplyItems)
      .set(baseValues)
      .where(eq(supplyItems.id, supplyItemId))
      .returning()) as SupplyItemRouteRow[];
  } catch (error) {
    if (!isSupplyItemsSchemaDriftError(error)) throw error;
    await ensureSupplyItemDetailColumns(context.db);
    [updated] = (await context.db
      .update(supplyItems)
      .set(baseValues)
      .where(eq(supplyItems.id, supplyItemId))
      .returning()) as SupplyItemRouteRow[];
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
        itemType,
        brand,
        model,
        serialNumber,
        barcode,
        details,
        purchasedAt,
        warrantyExpiresAt,
        packSize,
        borrowLimit,
        linkedProductTypeId,
        lowStockThreshold,
        isActive,
      },
    },
    context.db
  );

  return NextResponse.json(updated);
});
