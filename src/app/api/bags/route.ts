import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { bagLedger, customers, productTypes } from "@/db/schema";
import { and, desc, eq, gte, ilike, inArray, lte, sql } from "drizzle-orm";
import { requireManagerUp, requireAdmin } from "@/lib/api-auth";
import { logAudit, withBehaviorDetails } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-utils";
import { createBagAdjustmentSchema, validateBody } from "@/lib/validations";
import { parseCustomerQuery } from "@/lib/filter-utils";
import { requireFactoryWriteContext } from "@/lib/factory-context";

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;
  const customerId = request.nextUrl.searchParams.get("customerId");
  const from = request.nextUrl.searchParams.get("from");
  const to = request.nextUrl.searchParams.get("to");
  const customerQuery = request.nextUrl.searchParams.get("customerQuery");

  const db = await getDb();
  if (customerId) {
    const conditions = [eq(bagLedger.customerId, parseInt(customerId, 10))];
    if (from) conditions.push(gte(bagLedger.createdAt, new Date(`${from}T00:00:00.000Z`)));
    if (to) conditions.push(lte(bagLedger.createdAt, new Date(`${to}T23:59:59.999Z`)));
    const entries = await db.query.bagLedger.findMany({
      where: and(...conditions),
      with: {
        productType: true,
        transaction: true,
      },
      orderBy: [desc(bagLedger.createdAt)],
    });

    return NextResponse.json(entries);
  }

  // Get all customers with bag balances (total)
  const parsedCustomer = parseCustomerQuery(customerQuery);
  const customerFilter =
    parsedCustomer.customerIds.length > 0
      ? inArray(customers.id, parsedCustomer.customerIds)
      : parsedCustomer.customerNameQuery
        ? ilike(customers.name, `%${parsedCustomer.customerNameQuery}%`)
        : undefined;

  const balances = await db
    .select({
      customerId: customers.id,
      customerName: customers.name,
      phone: customers.phone,
      totalOut: sql<number>`COALESCE(SUM(CASE WHEN ${bagLedger.type} = 'out' THEN ${bagLedger.quantity} ELSE 0 END), 0)`,
      totalReturn: sql<number>`COALESCE(SUM(CASE WHEN ${bagLedger.type} = 'return' THEN ${bagLedger.quantity} ELSE 0 END), 0)`,
      totalAdjust: sql<number>`COALESCE(SUM(CASE WHEN ${bagLedger.type} = 'adjust' THEN ${bagLedger.quantity} ELSE 0 END), 0)`,
      balance: sql<number>`COALESCE(SUM(CASE
        WHEN ${bagLedger.type} = 'out' THEN ${bagLedger.quantity}
        WHEN ${bagLedger.type} = 'return' THEN -${bagLedger.quantity}
        WHEN ${bagLedger.type} = 'adjust' THEN ${bagLedger.quantity}
        ELSE 0 END), 0)`,
    })
    .from(customers)
    .leftJoin(bagLedger, eq(customers.id, bagLedger.customerId))
    .where(customerFilter)
    .groupBy(customers.id, customers.name, customers.phone)
    .having(sql`COUNT(${bagLedger.id}) > 0`)
    .orderBy(desc(sql`COALESCE(SUM(CASE
      WHEN ${bagLedger.type} = 'out' THEN ${bagLedger.quantity}
      WHEN ${bagLedger.type} = 'return' THEN -${bagLedger.quantity}
      WHEN ${bagLedger.type} = 'adjust' THEN ${bagLedger.quantity}
      ELSE 0 END), 0)`));

  return NextResponse.json(balances);
});

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = await request.json();

  const validated = validateBody(createBagAdjustmentSchema, body);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const { customerId, type: bagType, quantity, note } = validated.data;

  const factoryContext = requireFactoryWriteContext(request, auth.user);
  if ("error" in factoryContext) return factoryContext.error;
  const { db } = factoryContext;

  // Auto-resolve canonical bag product type
  const allPts = await db.select().from(productTypes);
  const canonicalBagPt = allPts.find((p) => p.hasBag);
  if (!canonicalBagPt) {
    return NextResponse.json({ error: "ไม่พบสินค้าที่มีถุง" }, { status: 400 });
  }

  const result = await db
    .insert(bagLedger)
    .values({
      customerId,
      productTypeId: canonicalBagPt.id,
      type: bagType,
      quantity: Math.abs(quantity),
      transactionId: null,
      note: note || "ปรับปรุงยอดโดยผู้ดูแลระบบ",
      createdBy: auth.user.id,
      createdAt: new Date(),
    })
    .returning();

  await logAudit({
    userId: auth.user.id,
    username: auth.user.username,
    action: "bag.adjust",
    entity: "bag_ledger",
    entityId: result[0].id,
    details: withBehaviorDetails(
      {
        customerId,
        productTypeId: canonicalBagPt.id,
        type: bagType,
        quantity: Math.abs(quantity),
      },
      {
        event: "bag.adjusted",
        source: "backoffice",
        customerId,
        quantity: Math.abs(quantity),
        reasonCode: bagType,
        tags: ["manual_adjustment"],
      }
    ),
  }, db);

  return NextResponse.json(result[0], { status: 201 });
});

export const DELETE = withErrorHandler(async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const body = await request.json();
  const { customerId } = body;

  if (!customerId || typeof customerId !== "number") {
    return NextResponse.json({ error: "ต้องระบุรหัสลูกค้า" }, { status: 400 });
  }

  const factoryContext = requireFactoryWriteContext(request, auth.user);
  if ("error" in factoryContext) return factoryContext.error;
  const { db } = factoryContext;

  const existing = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(bagLedger)
    .where(eq(bagLedger.customerId, customerId));

  const count = existing[0]?.count || 0;
  if (count === 0) {
    return NextResponse.json({ error: "ไม่มีรายการถุงของลูกค้ารายนี้" }, { status: 404 });
  }

  await db.delete(bagLedger).where(eq(bagLedger.customerId, customerId));

  await logAudit({
    userId: auth.user.id,
    username: auth.user.username,
    action: "bag.clear",
    entity: "bag_ledger",
    entityId: customerId,
    details: withBehaviorDetails(
      { customerId, deletedEntries: count },
      {
        event: "bag.cleared",
        source: "backoffice",
        customerId,
        quantity: count,
        reasonCode: "manual_clear",
      }
    ),
  }, db);

  return NextResponse.json({ success: true, deleted: count });
});
