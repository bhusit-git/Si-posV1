import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { customers, customerPrices, productTypes } from "@/db/schema";
import { eq, and, ilike, inArray } from "drizzle-orm";
import { requireManagerUp, requireAdmin } from "@/lib/api-auth";
import { logAudit, withBehaviorDetails } from "@/lib/audit";
import { withErrorHandler } from "@/lib/api-utils";
import { parseCustomerQuery } from "@/lib/filter-utils";
import { requireFactoryWriteContext } from "@/lib/factory-context";

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;
  const rawSearch =
    request.nextUrl.searchParams.get("search") ||
    request.nextUrl.searchParams.get("customerQuery") ||
    "";
  const parsedSearch = parseCustomerQuery(rawSearch);

  const db = await getDb();
  const activeProducts = await db.query.productTypes.findMany({
    where: eq(productTypes.isActive, true),
    orderBy: [productTypes.sortOrder],
  });

  const allCustomers = await db.query.customers.findMany({
    where:
      parsedSearch.customerIds.length > 0
        ? inArray(customers.id, parsedSearch.customerIds)
        : parsedSearch.customerNameQuery
          ? ilike(customers.name, `%${parsedSearch.customerNameQuery}%`)
          : undefined,
    with: {
      prices: {
        with: { productType: true },
      },
    },
    orderBy: [customers.name],
  });

  const matrix = allCustomers.map((c) => {
    const priceMap: Record<number, number> = {};
    for (const p of c.prices) {
      priceMap[p.productTypeId] = p.unitPrice;
    }
    return {
      customerId: c.id,
      customerName: c.name,
      prices: priceMap,
    };
  });

  return NextResponse.json({
    products: activeProducts.map((p) => ({ id: p.id, name: p.name })),
    matrix,
  });
});

export const PUT = withErrorHandler(async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = await request.json();
  const { changes } = body;

  if (!changes || !Array.isArray(changes)) {
    return NextResponse.json({ error: "ไม่มีข้อมูลการเปลี่ยนแปลง" }, { status: 400 });
  }

  const factoryContext = requireFactoryWriteContext(request, auth.user);
  if ("error" in factoryContext) return factoryContext.error;
  const { db } = factoryContext;
  let updated = 0;
  await db.transaction(async (tx) => {
    for (const change of changes) {
      const [existing] = await tx
        .select()
        .from(customerPrices)
        .where(
          and(
            eq(customerPrices.customerId, change.customerId),
            eq(customerPrices.productTypeId, change.productTypeId)
          )
        )
        .limit(1);

      const oldPrice = existing?.unitPrice ?? null;
      const newPrice = change.unitPrice || 0;
      const absoluteDiff =
        typeof oldPrice === "number" ? Math.abs(newPrice - oldPrice) : null;
      const pctDiff =
        typeof oldPrice === "number" && oldPrice !== 0
          ? Math.round(((newPrice - oldPrice) / oldPrice) * 1000) / 10
          : null;

      if (existing) {
        await tx
          .update(customerPrices)
          .set({ unitPrice: newPrice })
          .where(eq(customerPrices.id, existing.id));
      } else {
        await tx.insert(customerPrices).values({
          customerId: change.customerId,
          productTypeId: change.productTypeId,
          unitPrice: newPrice,
          bagDeposit: 0,
        });
      }

      await logAudit({
        userId: auth.user.id,
        username: auth.user.username,
        action: "price.change",
        entity: "customer_price",
        entityId: existing?.id ?? null,
        details: withBehaviorDetails(
          {
            customerId: change.customerId,
            productTypeId: change.productTypeId,
            oldPrice,
            newPrice,
            absoluteDiff,
            pctDiff,
          },
          {
            event: "price.changed",
            source: "backoffice",
            customerId: change.customerId,
            amount: newPrice,
            reasonCode: existing ? "edit" : "create",
            tags:
              typeof pctDiff === "number" && Math.abs(pctDiff) >= 20
                ? ["large_price_change"]
                : undefined,
            extra: { productTypeId: change.productTypeId },
          }
        ),
      }, tx);

      updated++;
    }
  });

  return NextResponse.json({ success: true, updated });
});
