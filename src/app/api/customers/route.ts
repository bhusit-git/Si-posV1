import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { customers, customerPrices, productTypes, bagLedger } from "@/db/schema";
import { eq, ilike, sql, and, inArray } from "drizzle-orm";
import { requireManagerUp, requireOfficeUp } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { parseCustomerQuery } from "@/lib/filter-utils";
import { createCustomerSchema, updateCustomerSchema, validateBody } from "@/lib/validations";
import { logAudit, withBehaviorDetails } from "@/lib/audit";
import { getPostHogClient } from "@/lib/posthog-server";
import { requireFactoryWriteContext } from "@/lib/factory-context";
import {
  buildAuthenticatedDistinctId,
  buildCustomerCreatedProperties,
  CUSTOMER_CREATED_EVENT,
} from "@/lib/posthog-events";

function parseBoundedLimit(raw: string | null): number | null {
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.trunc(parsed);
  if (rounded <= 0) return null;
  return Math.min(rounded, 100);
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;
  const rawSearch =
    request.nextUrl.searchParams.get("search") ||
    request.nextUrl.searchParams.get("customerQuery") ||
    "";
  const parsedSearch = parseCustomerQuery(rawSearch);
  const id = request.nextUrl.searchParams.get("id");
  const includeBagBalance = request.nextUrl.searchParams.get("includeBagBalance") !== "0";
  const limit = parseBoundedLimit(request.nextUrl.searchParams.get("limit"));

  const db = await getDb();
  if (id) {
    const customer = await db.query.customers.findFirst({
      where: eq(customers.id, parseInt(id)),
      with: {
        prices: {
          with: { productType: true },
        },
      },
    });
    if (!customer) {
      return NextResponse.json({ error: "ไม่พบลูกค้า" }, { status: 404 });
    }
    const [bagBalanceRow] = await db
      .select({
        bagBalance: sql<number>`COALESCE(SUM(CASE
          WHEN ${bagLedger.type} = 'out' THEN ${bagLedger.quantity}
          WHEN ${bagLedger.type} = 'return' THEN -${bagLedger.quantity}
          WHEN ${bagLedger.type} = 'adjust' THEN ${bagLedger.quantity}
          ELSE 0 END), 0)`,
      })
      .from(bagLedger)
      .where(eq(bagLedger.customerId, customer.id));

    return NextResponse.json({
      ...customer,
      bagBalance: Number(bagBalanceRow?.bagBalance ?? 0),
    });
  }

  const customerWhere =
    parsedSearch.customerIds.length > 0
      ? inArray(customers.id, parsedSearch.customerIds)
      : parsedSearch.customerNameQuery
        ? ilike(customers.name, `%${parsedSearch.customerNameQuery}%`)
        : undefined;

  const customerQuery = includeBagBalance
    ? db
        .select({
          id: customers.id,
          name: customers.name,
          phone: customers.phone,
          credit: customers.credit,
          transferCustomer: customers.transferCustomer,
          createdAt: customers.createdAt,
          bagBalance: sql<number>`COALESCE((
            SELECT SUM(CASE
              WHEN bl.type = 'out' THEN bl.quantity
              WHEN bl.type = 'return' THEN -bl.quantity
              WHEN bl.type = 'adjust' THEN bl.quantity
              ELSE 0 END)
            FROM bag_ledger bl WHERE bl.customer_id = ${customers.id}
          ), 0)`.as("bag_balance"),
        })
        .from(customers)
        .where(customerWhere)
        .orderBy(customers.name)
    : db
        .select({
          id: customers.id,
          name: customers.name,
          phone: customers.phone,
          credit: customers.credit,
          transferCustomer: customers.transferCustomer,
          createdAt: customers.createdAt,
        })
        .from(customers)
        .where(customerWhere)
        .orderBy(customers.name);

  const allCustomers = limit ? await customerQuery.limit(limit) : await customerQuery;

  return NextResponse.json(allCustomers);
});

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const auth = await requireOfficeUp();
  if (auth.error) return auth.error;
  const body = await request.json();

  const validated = validateBody(createCustomerSchema, body);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const { name, phone, credit, transferCustomer, prices } = validated.data;
  const normalizedName = name.trim();
  const normalizedPhone = phone || null;
  const normalizedCredit = credit || false;
  const normalizedTransferCustomer = transferCustomer || false;
  const factoryContext = requireFactoryWriteContext(request, auth.user);
  if ("error" in factoryContext) return factoryContext.error;
  const { db, factoryKey } = factoryContext;
  // Wrap customer + prices creation in a transaction
  const newCustomer = await db.transaction(async (tx) => {
    const [result] = await tx
      .insert(customers)
      .values({
        name: normalizedName,
        phone: normalizedPhone,
        credit: normalizedCredit,
        transferCustomer: normalizedTransferCustomer,
        createdAt: new Date(),
      })
      .returning();

    const priceAuditRows: Array<{
      productTypeId: number;
      oldUnitPrice: number | null;
      newUnitPrice: number;
      oldBagDeposit: number | null;
      newBagDeposit: number;
    }> = [];
    let createdPriceRowCount = 0;

    // Insert prices if provided
    if (prices && Array.isArray(prices)) {
      for (const p of prices) {
        const newUnitPrice = p.unitPrice || 0;
        const newBagDeposit = p.bagDeposit || 0;
        await tx.insert(customerPrices).values({
          customerId: result.id,
          productTypeId: p.productTypeId,
          unitPrice: newUnitPrice,
          bagDeposit: newBagDeposit,
        });
        priceAuditRows.push({
          productTypeId: p.productTypeId,
          oldUnitPrice: null,
          newUnitPrice,
          oldBagDeposit: null,
          newBagDeposit,
        });
        createdPriceRowCount += 1;
      }
    } else {
      // Auto-create prices for all active product types with 0
      const activeProducts = await tx.query.productTypes.findMany({
        where: eq(productTypes.isActive, true),
      });
      for (const pt of activeProducts) {
        await tx.insert(customerPrices).values({
          customerId: result.id,
          productTypeId: pt.id,
          unitPrice: 0,
          bagDeposit: 0,
        });
      }
      createdPriceRowCount = activeProducts.length;
    }

    await logAudit(
      {
        userId: auth.user.id,
        username: auth.user.username,
        action: "customer.create",
        entity: "customer",
        entityId: result.id,
        details: {
          name: normalizedName,
          phone: normalizedPhone,
          credit: normalizedCredit,
          transferCustomer: normalizedTransferCustomer,
          pricesCount: priceAuditRows.length,
        },
      },
      tx
    );

    for (const row of priceAuditRows) {
      await logAudit(
        {
          userId: auth.user.id,
          username: auth.user.username,
          action: "price.change",
          entity: "customer_price",
          entityId: null,
          details: withBehaviorDetails(
            {
              customerId: result.id,
              productTypeId: row.productTypeId,
              oldPrice: row.oldUnitPrice,
              newPrice: row.newUnitPrice,
              oldBagDeposit: row.oldBagDeposit,
              newBagDeposit: row.newBagDeposit,
              absoluteDiff:
                typeof row.oldUnitPrice === "number"
                  ? Math.abs(row.newUnitPrice - row.oldUnitPrice)
                  : null,
              reason: "customer_create",
            },
            {
              event: "price.changed",
              source: "backoffice",
              customerId: result.id,
              amount: row.newUnitPrice,
              reasonCode: "create",
              extra: { productTypeId: row.productTypeId },
            }
          ),
        },
        tx
      );
    }

    return {
      ...result,
      analytics: {
        customerId: result.id,
        creditEnabled: normalizedCredit,
        transferCustomer: normalizedTransferCustomer,
        priceRowsCount: createdPriceRowCount,
        pricedProductCount: priceAuditRows.filter((row) => row.newUnitPrice > 0).length,
      },
    };
  });

  const { analytics, ...responsePayload } = newCustomer;
  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: buildAuthenticatedDistinctId(auth.user.id),
    event: CUSTOMER_CREATED_EVENT,
    properties: buildCustomerCreatedProperties({
      actorUserId: auth.user.id,
      actorRole: auth.user.role,
      factoryKey,
      ...analytics,
    }),
  });

  return NextResponse.json(responsePayload, { status: 201 });
});

export const PUT = withErrorHandler(async function PUT(request: NextRequest) {
  const auth = await requireOfficeUp();
  if (auth.error) return auth.error;
  const body = await request.json();

  const validated = validateBody(updateCustomerSchema, body);
  if ("error" in validated) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const { id, name, phone, credit, transferCustomer, prices } = validated.data;

  const factoryContext = requireFactoryWriteContext(request, auth.user);
  if ("error" in factoryContext) return factoryContext.error;
  const { db } = factoryContext;
  const existingCustomer = await db.query.customers.findFirst({
    where: eq(customers.id, id),
  });
  if (!existingCustomer) {
    return NextResponse.json({ error: "ไม่พบลูกค้า" }, { status: 404 });
  }

  const normalizedName = name;
  const normalizedPhone = phone || null;
  const normalizedCredit = credit ?? existingCustomer.credit;
  const normalizedTransferCustomer =
    transferCustomer ?? existingCustomer.transferCustomer;

  await db.transaction(async (tx) => {
    await tx
      .update(customers)
      .set({
        name: normalizedName,
        phone: normalizedPhone,
        credit: normalizedCredit,
        transferCustomer: normalizedTransferCustomer,
      })
      .where(eq(customers.id, id));

    const customerChanges: Record<string, { from: unknown; to: unknown }> = {};
    if (existingCustomer.name !== normalizedName) {
      customerChanges.name = { from: existingCustomer.name, to: normalizedName };
    }
    if ((existingCustomer.phone || null) !== normalizedPhone) {
      customerChanges.phone = { from: existingCustomer.phone || null, to: normalizedPhone };
    }
    if (existingCustomer.credit !== normalizedCredit) {
      customerChanges.credit = { from: existingCustomer.credit, to: normalizedCredit };
    }
    if (existingCustomer.transferCustomer !== normalizedTransferCustomer) {
      customerChanges.transferCustomer = {
        from: existingCustomer.transferCustomer,
        to: normalizedTransferCustomer,
      };
    }

    if (Object.keys(customerChanges).length > 0) {
      await logAudit(
        {
          userId: auth.user.id,
          username: auth.user.username,
          action: "customer.update",
          entity: "customer",
          entityId: id,
          details: {
            changes: customerChanges,
          },
        },
        tx
      );
    }

    // Update prices
    if (prices && Array.isArray(prices)) {
      for (const p of prices) {
        const [existing] = await tx
          .select()
          .from(customerPrices)
          .where(
            and(
              eq(customerPrices.customerId, id),
              eq(customerPrices.productTypeId, p.productTypeId)
            )
          )
          .limit(1);

        const newUnitPrice = p.unitPrice || 0;
        const newBagDeposit = p.bagDeposit || 0;
        const oldUnitPrice = existing?.unitPrice ?? null;
        const oldBagDeposit = existing?.bagDeposit ?? null;
        const unitPriceChanged = oldUnitPrice !== newUnitPrice;
        const bagDepositChanged = oldBagDeposit !== newBagDeposit;
        const hasAnyPriceChange = !existing || unitPriceChanged || bagDepositChanged;

        if (existing) {
          if (hasAnyPriceChange) {
            await tx
              .update(customerPrices)
              .set({ unitPrice: newUnitPrice, bagDeposit: newBagDeposit })
              .where(eq(customerPrices.id, existing.id));
          }
        } else {
          await tx.insert(customerPrices).values({
            customerId: id,
            productTypeId: p.productTypeId,
            unitPrice: newUnitPrice,
            bagDeposit: newBagDeposit,
          });
        }

        if (hasAnyPriceChange) {
          const pctDiff =
            typeof oldUnitPrice === "number" && oldUnitPrice !== 0
              ? Math.round(((newUnitPrice - oldUnitPrice) / oldUnitPrice) * 1000) / 10
              : null;
          await logAudit(
            {
              userId: auth.user.id,
              username: auth.user.username,
              action: "price.change",
              entity: "customer_price",
              entityId: existing?.id ?? null,
              details: withBehaviorDetails(
                {
                  customerId: id,
                  productTypeId: p.productTypeId,
                  oldPrice: oldUnitPrice,
                  newPrice: newUnitPrice,
                  oldBagDeposit,
                  newBagDeposit,
                  absoluteDiff:
                    typeof oldUnitPrice === "number"
                      ? Math.abs(newUnitPrice - oldUnitPrice)
                      : null,
                  pctDiff,
                  reason: "customer_update",
                },
                {
                  event: "price.changed",
                  source: "backoffice",
                  customerId: id,
                  amount: newUnitPrice,
                  reasonCode: existing ? "edit" : "create",
                  tags:
                    typeof pctDiff === "number" && Math.abs(pctDiff) >= 20
                      ? ["large_price_change"]
                      : undefined,
                  extra: { productTypeId: p.productTypeId },
                }
              ),
            },
            tx
          );
        }
      }
    }
  });

  return NextResponse.json({ success: true });
});
