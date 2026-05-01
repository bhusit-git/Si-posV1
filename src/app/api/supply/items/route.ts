import { NextRequest, NextResponse } from "next/server";
import { asc, eq, sql } from "drizzle-orm";

import type { DrizzleDB } from "@/db";
import { supplyItems } from "@/db/schema";
import { requireAdmin, requireManagerUp } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import {
  badRequest,
  parseInteger,
  parseOptionalString,
  resolveSupplyReadContext,
  resolveSupplyWriteContext,
} from "@/lib/supply/route-helpers";

function isSupplyItemsSchemaDriftError(error: unknown): boolean {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "42703"
  ) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.includes("42703") || (message.includes("column") && message.includes("does not exist"));
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
    return loadSupplyItemsWithoutImageUrl(db);
  }
}

async function findSupplyItemByName(db: DrizzleDB, name: string) {
  try {
    const findFirst = db.query?.supplyItems?.findFirst;
    if (findFirst) {
      return await findFirst({
        where: eq(supplyItems.name, name),
      });
    }

    return (
      await db
        .select()
        .from(supplyItems)
        .where(eq(supplyItems.name, name))
        .limit(1)
    )[0];
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
        linked_product_type_id AS "linkedProductTypeId",
        low_stock_threshold AS "lowStockThreshold",
        is_active AS "isActive"
      FROM supply_items
      WHERE name = ${name}
      LIMIT 1
    `);

    return Array.from(rows)[0];
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
    linkedProductTypeId,
    lowStockThreshold,
    isActive: true,
    createdBy: auth.user.id,
    updatedAt: new Date(),
  };

  let created;
  try {
    [created] = await context.db.insert(supplyItems).values(baseValues).returning();
  } catch (error) {
    if (!isSupplyItemsSchemaDriftError(error)) throw error;

    [created] = await context.db
      .insert(supplyItems)
      .values({
        ...baseValues,
        imageUrl: undefined,
      })
      .returning();
    created = { ...created, imageUrl: null };
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
        linkedProductTypeId,
        lowStockThreshold,
      },
    },
    context.db
  );

  return NextResponse.json(created, { status: 201 });
});
