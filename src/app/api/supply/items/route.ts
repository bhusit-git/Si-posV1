import { NextRequest, NextResponse } from "next/server";
import { asc, eq, sql } from "drizzle-orm";

import type { DrizzleDB } from "@/db";
import { supplyItems } from "@/db/schema";
import { extractPostgresError } from "@/lib/api-error-diagnostics";
import { requireAdmin, requireManagerUp } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import {
  badRequest,
  ensureSupplyItemDetailColumns,
  normalizeSupplyItemType,
  parseInteger,
  parseOptionalString,
  resolveSupplyReadContext,
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

async function loadSupplyItemsWithoutImageUrl(db: DrizzleDB) {
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
    ORDER BY name ASC, id ASC
  `);

  return Array.from(rows);
}

async function loadSupplyItems(db: DrizzleDB) {
  try {
    const findMany = db.query?.supplyItems?.findMany;
    if (findMany) {
      return await findMany({
        orderBy: [asc(supplyItems.name), asc(supplyItems.id)],
      });
    }

    return await db
      .select()
      .from(supplyItems)
      .orderBy(asc(supplyItems.name), asc(supplyItems.id));
  } catch (error) {
    if (!isSupplyItemsSchemaDriftError(error)) throw error;
    try {
      await ensureSupplyItemDetailColumns(db);

      const findMany = db.query?.supplyItems?.findMany;
      if (findMany) {
        return await findMany({
          orderBy: [asc(supplyItems.name), asc(supplyItems.id)],
        });
      }

      return await db
        .select()
        .from(supplyItems)
        .orderBy(asc(supplyItems.name), asc(supplyItems.id));
    } catch (retryError) {
      if (!isSupplyItemsSchemaDriftError(retryError)) throw retryError;
    }

    return loadSupplyItemsWithoutImageUrl(db);
  }
}

async function findSupplyItemByName(db: DrizzleDB, name: string): Promise<SupplyItemRouteRow | undefined> {
  try {
    const findFirst = db.query?.supplyItems?.findFirst;
    if (findFirst) {
      return (await findFirst({
        where: eq(supplyItems.name, name),
      })) as SupplyItemRouteRow | undefined;
    }

    return (
      await db
        .select()
        .from(supplyItems)
        .where(eq(supplyItems.name, name))
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
      WHERE name = ${name}
      LIMIT 1
    `);

    return Array.from(rows)[0] as unknown as SupplyItemRouteRow | undefined;
  }
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  const context = resolveSupplyReadContext(request, auth.user);
  if ("error" in context) return context.error;

  const rows = await loadSupplyItems(context.db);

  return NextResponse.json(rows);
});

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const context = resolveSupplyWriteContext(request, auth.user);
  if ("error" in context) return context.error;

  const body = await request.json();
  const name = parseOptionalString(body?.name);
  const unit = parseOptionalString(body?.unit);
  const category = parseOptionalString(body?.category);
  const itemCode = parseOptionalString(body?.itemCode);
  const imageUrl = parseOptionalString(body?.imageUrl);
  const itemType = normalizeSupplyItemType(body?.itemType);
  const brand = parseOptionalString(body?.brand);
  const model = parseOptionalString(body?.model);
  const serialNumber = parseOptionalString(body?.serialNumber);
  const barcode = parseOptionalString(body?.barcode);
  const details = parseOptionalString(body?.details);
  const purchasedAt = parseOptionalString(body?.purchasedAt);
  const warrantyExpiresAt = parseOptionalString(body?.warrantyExpiresAt);
  const packSize = Math.max(1, parseInteger(body?.packSize) ?? 1);
  const borrowLimit = Math.max(0, parseInteger(body?.borrowLimit) ?? 0);
  const linkedProductTypeId = parseInteger(body?.linkedProductTypeId);
  const lowStockThreshold = Math.max(0, parseInteger(body?.lowStockThreshold) ?? 0);

  if (!name) return badRequest("กรุณาระบุชื่อของใช้");
  if (!unit) return badRequest("กรุณาระบุหน่วยนับ");

  const existing = await findSupplyItemByName(context.db, name);
  if (existing) {
    return badRequest("ชื่อของใช้นี้ถูกใช้งานแล้ว", 409);
  }

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
    isActive: true,
    createdBy: auth.user.id,
    updatedAt: new Date(),
  };

  let created: SupplyItemRouteRow;
  try {
    [created] = (await context.db.insert(supplyItems).values(baseValues).returning()) as SupplyItemRouteRow[];
  } catch (error) {
    if (!isSupplyItemsSchemaDriftError(error)) throw error;
    await ensureSupplyItemDetailColumns(context.db);
    [created] = (await context.db.insert(supplyItems).values(baseValues).returning()) as SupplyItemRouteRow[];
  }

  await logAudit(
    {
      userId: auth.user.id,
      username: auth.user.username,
      action: "supply.item.create",
      entity: "supply_item",
      entityId: created.id,
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
      },
    },
    context.db
  );

  return NextResponse.json(created, { status: 201 });
});
