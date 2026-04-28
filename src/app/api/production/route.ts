import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { productionLogs, productTypes, transactionItems, transactions } from "@/db/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { requireOfficeUp } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-utils";
import { createProductionSchema, validateBody } from "@/lib/validations";
import { requireFactoryWriteContext } from "@/lib/factory-context";

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireOfficeUp();
  if (auth.error) return auth.error;
  const type = request.nextUrl.searchParams.get("type") || "logs";
  const startDate = request.nextUrl.searchParams.get("startDate");
  const endDate = request.nextUrl.searchParams.get("endDate");

  const db = await getDb();
  if (type === "stock") {
    // Calculate current stock for each product:
    // stock = total produced - total sold
    const produced = await db
      .select({
        productTypeId: productionLogs.productTypeId,
        totalProduced: sql<number>`COALESCE(SUM(${productionLogs.quantity}), 0)`,
      })
      .from(productionLogs)
      .groupBy(productionLogs.productTypeId);

    const sold = await db
      .select({
        productTypeId: transactionItems.productTypeId,
        totalSold: sql<number>`COALESCE(SUM(CASE WHEN ${transactionItems.quantity} > 0 THEN ${transactionItems.quantity} ELSE 0 END), 0)`,
        totalReturned: sql<number>`COALESCE(SUM(CASE WHEN ${transactionItems.quantity} < 0 THEN ABS(${transactionItems.quantity}) ELSE 0 END), 0)`,
      })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
      .where(sql`${transactions.status} != 'voided'`)
      .groupBy(transactionItems.productTypeId);

    const allProducts = await db.query.productTypes.findMany({
      where: eq(productTypes.isActive, true),
      orderBy: [productTypes.sortOrder],
    });

    const producedMap = new Map(produced.map((p) => [p.productTypeId, p.totalProduced]));
    const soldMap = new Map(sold.map((s) => [s.productTypeId, { sold: s.totalSold, returned: s.totalReturned }]));

    const stockData = allProducts.map((pt) => {
      const salesData = soldMap.get(pt.id) || { sold: 0, returned: 0 };
      const netSold = salesData.sold - salesData.returned;
      return {
        productTypeId: pt.id,
        productName: pt.name,
        totalProduced: producedMap.get(pt.id) || 0,
        totalSold: salesData.sold,
        totalReturned: salesData.returned,
        netSold,
        currentStock: (producedMap.get(pt.id) || 0) - netSold,
      };
    });

    return NextResponse.json(stockData);
  }

  // Recent production logs
  const conditions = [];
  if (startDate) conditions.push(gte(productionLogs.createdAt, new Date(startDate)));
  if (endDate) conditions.push(lte(productionLogs.createdAt, new Date(endDate + "T23:59:59")));

  const logs = await db.query.productionLogs.findMany({
    where: conditions.length > 0 ? and(...conditions) : undefined,
    with: { productType: true },
    orderBy: [desc(productionLogs.createdAt)],
    limit: 100,
  });

  return NextResponse.json(logs);
});

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const auth = await requireOfficeUp();
  if (auth.error) return auth.error;
  const body = await request.json();

  const validated = validateBody(createProductionSchema, body);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const { productTypeId, quantity, note } = validated.data;

  const factoryContext = requireFactoryWriteContext(request, auth.user);
  if ("error" in factoryContext) return factoryContext.error;
  const { db } = factoryContext;
  const result = await db
    .insert(productionLogs)
    .values({
      productTypeId,
      quantity,
      note: note || null,
      createdBy: auth.user.id,
      createdAt: new Date(),
    })
    .returning();

  await logAudit({
    userId: auth.user.id,
    username: auth.user.username,
    action: "production.create",
    entity: "production_log",
    entityId: result[0].id,
    details: { productTypeId, quantity },
  }, db);

  return NextResponse.json(result[0], { status: 201 });
});
