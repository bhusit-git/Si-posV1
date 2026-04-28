import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { getSession } from "@/lib/auth";
import {
  transactions,
  transactionItems,
  customers,
  productTypes,
} from "@/db/schema";
import { eq, and, asc, ne, inArray, sql } from "drizzle-orm";
import { withErrorHandler } from "@/lib/api-utils";
import { getSupericeDisplayEnv } from "@/lib/config/env";

// GET is public (factory kiosks/TVs). POST requires API key or auth session.
const FACTORY_BAY_COUNT = 6;

interface PendingOrderRow {
  id: number;
  customerId: number;
  customerName: string;
  totalAmount: number;
  paid: number;
  status: string;
  pool: number | null;
  row: number | null;
  col: number | null;
  fulfillment: string | null;
  saleDate: string;
  saleTime: string;
  note: string | null;
  createdAt: Date | string;
}

interface PendingItemRow {
  id: number;
  transactionId: number;
  productTypeId: number;
  productName: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  loadedQty: number;
}

interface PendingOrderWithItems extends PendingOrderRow {
  items: PendingItemRow[];
}

interface BayOrderSummary {
  id: number;
  customerName: string;
  saleTime: string;
  totalOrderedQty: number;
  totalLoadedQty: number;
  totalRemainingQty: number;
}

interface BayItemSummary {
  productTypeId: number;
  productName: string;
  totalOrderedQty: number;
  totalLoadedQty: number;
  totalRemainingQty: number;
}

interface BayBucketSummary {
  bay: number | null;
  orderCount: number;
  totalOrderedQty: number;
  totalLoadedQty: number;
  totalRemainingQty: number;
  orders: BayOrderSummary[];
  items: BayItemSummary[];
}

async function checkDisplayMutationAuth(request: NextRequest): Promise<{
  ok: boolean;
  status?: number;
  message?: string;
}> {
  const displayEnv = getSupericeDisplayEnv();
  const providedKey = request.headers.get("x-api-key");

  if (displayEnv.displayApiKey && providedKey === displayEnv.displayApiKey) {
    return { ok: true };
  }

  const session = await getSession();
  if (session) {
    return { ok: true };
  }

  if (displayEnv.isProduction && !displayEnv.displayApiKey) {
    return {
      ok: false,
      status: 503,
      message:
        "DISPLAY_API_KEY is not configured in production. Configure DISPLAY_API_KEY or use an authenticated session.",
    };
  }

  if (!displayEnv.displayApiKey && !displayEnv.isProduction) {
    // Dev fallback: allow POST without key/session for local kiosk testing.
    return { ok: true };
  }

  return { ok: false, status: 401, message: "Invalid or missing API key" };
}

function toPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

async function fetchPendingOrdersWithItems(
  db: Awaited<ReturnType<typeof getDb>>
): Promise<PendingOrderWithItems[]> {
  const orders = await db
    .select({
      id: transactions.id,
      customerId: transactions.customerId,
      customerName: customers.name,
      totalAmount: transactions.totalAmount,
      paid: transactions.paid,
      status: transactions.status,
      pool: transactions.pool,
      row: transactions.row,
      col: transactions.col,
      fulfillment: transactions.fulfillment,
      saleDate: transactions.saleDate,
      saleTime: transactions.saleTime,
      note: transactions.note,
      createdAt: transactions.createdAt,
    })
    .from(transactions)
    .innerJoin(customers, eq(transactions.customerId, customers.id))
    .where(and(eq(transactions.fulfillment, "pending"), ne(transactions.status, "voided")))
    .orderBy(asc(transactions.createdAt));

  if (orders.length === 0) {
    return [];
  }

  const orderIds = orders.map((order) => order.id);
  const allItems = await db
    .select({
      id: transactionItems.id,
      transactionId: transactionItems.transactionId,
      productTypeId: transactionItems.productTypeId,
      productName: productTypes.name,
      quantity: transactionItems.quantity,
      unitPrice: transactionItems.unitPrice,
      subtotal: transactionItems.subtotal,
      loadedQty: transactionItems.loadedQty,
    })
    .from(transactionItems)
    .innerJoin(productTypes, eq(transactionItems.productTypeId, productTypes.id))
    .where(inArray(transactionItems.transactionId, orderIds));

  const itemsByTx = new Map<number, PendingItemRow[]>();
  for (const item of allItems) {
    const list = itemsByTx.get(item.transactionId) || [];
    list.push(item);
    itemsByTx.set(item.transactionId, list);
  }

  return orders.map((order) => ({
    ...order,
    items: itemsByTx.get(order.id) || [],
  }));
}

function createBayBucket(bay: number | null): BayBucketSummary {
  return {
    bay,
    orderCount: 0,
    totalOrderedQty: 0,
    totalLoadedQty: 0,
    totalRemainingQty: 0,
    orders: [],
    items: [],
  };
}

function normalizeBay(value: number | null): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 1 || value > FACTORY_BAY_COUNT) return null;
  return value;
}

function summarizeByBays(orders: PendingOrderWithItems[]) {
  const buckets = new Map<number, BayBucketSummary>();
  for (let bay = 1; bay <= FACTORY_BAY_COUNT; bay += 1) {
    buckets.set(bay, createBayBucket(bay));
  }
  const unassigned = createBayBucket(null);

  const itemMaps = new Map<number | null, Map<number, BayItemSummary>>();
  for (let bay = 1; bay <= FACTORY_BAY_COUNT; bay += 1) {
    itemMaps.set(bay, new Map<number, BayItemSummary>());
  }
  itemMaps.set(null, new Map<number, BayItemSummary>());

  for (const order of orders) {
    const bay = normalizeBay(order.row);
    const bucket = bay !== null ? buckets.get(bay)! : unassigned;
    const itemMap = itemMaps.get(bay !== null ? bay : null)!;

    let orderTotalOrderedQty = 0;
    let orderTotalLoadedQty = 0;
    let orderTotalRemainingQty = 0;

    for (const item of order.items) {
      const itemOrdered = Number(item.quantity || 0);
      const itemLoaded = Math.max(0, Math.min(itemOrdered, Number(item.loadedQty || 0)));
      const itemRemaining = Math.max(0, itemOrdered - itemLoaded);

      orderTotalOrderedQty += itemOrdered;
      orderTotalLoadedQty += itemLoaded;
      orderTotalRemainingQty += itemRemaining;

      const existing = itemMap.get(item.productTypeId);
      if (existing) {
        existing.totalOrderedQty += itemOrdered;
        existing.totalLoadedQty += itemLoaded;
        existing.totalRemainingQty += itemRemaining;
      } else {
        itemMap.set(item.productTypeId, {
          productTypeId: item.productTypeId,
          productName: item.productName,
          totalOrderedQty: itemOrdered,
          totalLoadedQty: itemLoaded,
          totalRemainingQty: itemRemaining,
        });
      }
    }

    bucket.orderCount += 1;
    bucket.totalOrderedQty += orderTotalOrderedQty;
    bucket.totalLoadedQty += orderTotalLoadedQty;
    bucket.totalRemainingQty += orderTotalRemainingQty;
    bucket.orders.push({
      id: order.id,
      customerName: order.customerName,
      saleTime: order.saleTime,
      totalOrderedQty: orderTotalOrderedQty,
      totalLoadedQty: orderTotalLoadedQty,
      totalRemainingQty: orderTotalRemainingQty,
    });
  }

  for (const bucket of buckets.values()) {
    const itemMap = itemMaps.get(bucket.bay)!;
    bucket.items = [...itemMap.values()].sort((a, b) => {
      if (b.totalRemainingQty !== a.totalRemainingQty) {
        return b.totalRemainingQty - a.totalRemainingQty;
      }
      return a.productName.localeCompare(b.productName, "th");
    });
  }

  const unassignedMap = itemMaps.get(null)!;
  unassigned.items = [...unassignedMap.values()].sort((a, b) => {
    if (b.totalRemainingQty !== a.totalRemainingQty) {
      return b.totalRemainingQty - a.totalRemainingQty;
    }
    return a.productName.localeCompare(b.productName, "th");
  });

  return {
    bays: Array.from(buckets.values()),
    unassigned,
    updatedAt: new Date().toISOString(),
  };
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("mode") || "current";
  const db = await getDb();
  if (mode === "current") {
      // Return the oldest pending order (FIFO)
      const [order] = await db
        .select({
          id: transactions.id,
          customerId: transactions.customerId,
          customerName: customers.name,
          totalAmount: transactions.totalAmount,
          paid: transactions.paid,
          status: transactions.status,
          pool: transactions.pool,
          row: transactions.row,
          col: transactions.col,
          fulfillment: transactions.fulfillment,
          saleDate: transactions.saleDate,
          saleTime: transactions.saleTime,
          note: transactions.note,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        .innerJoin(customers, eq(transactions.customerId, customers.id))
        .where(and(eq(transactions.fulfillment, "pending"), ne(transactions.status, "voided")))
        .orderBy(asc(transactions.createdAt))
        .limit(1);

      if (!order) {
        return NextResponse.json({ order: null });
      }

      // Fetch items for this order
      const items = await db
        .select({
          id: transactionItems.id,
          productTypeId: transactionItems.productTypeId,
          productName: productTypes.name,
          quantity: transactionItems.quantity,
          unitPrice: transactionItems.unitPrice,
          subtotal: transactionItems.subtotal,
          loadedQty: transactionItems.loadedQty,
        })
        .from(transactionItems)
        .innerJoin(productTypes, eq(transactionItems.productTypeId, productTypes.id))
        .where(eq(transactionItems.transactionId, order.id));

      return NextResponse.json({ order: { ...order, items } });
    }

    if (mode === "queue") {
      const orders = await fetchPendingOrdersWithItems(db);
      return NextResponse.json({ orders });
    }

    if (mode === "bays") {
      const orders = await fetchPendingOrdersWithItems(db);
      const summary = summarizeByBays(orders);
      return NextResponse.json(summary);
    }

    if (mode === "summary") {
      // Today's date in local timezone (server time)
      const now = new Date();
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

      // Count orders by fulfillment status for today
      const statusCounts = await db
        .select({
          fulfillment: transactions.fulfillment,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(transactions)
        .where(
          and(
            eq(transactions.saleDate, today),
            ne(transactions.status, "voided")
          )
        )
        .groupBy(transactions.fulfillment);

      let loadedOrders = 0;
      let pendingOrders = 0;
      let otherOrders = 0;
      for (const row of statusCounts) {
        if (row.fulfillment === "loaded") loadedOrders = row.count;
        else if (row.fulfillment === "pending") pendingOrders = row.count;
        else otherOrders = row.count;
      }
      const totalOrders = loadedOrders + pendingOrders + otherOrders;
      const tracked = loadedOrders + pendingOrders;
      const completionPct = tracked > 0 ? Math.round((loadedOrders / tracked) * 100) : 100;

      // Get pending orders with item summary
      const pendingList = await db
        .select({
          id: transactions.id,
          customerName: customers.name,
          saleTime: transactions.saleTime,
          createdAt: transactions.createdAt,
        })
        .from(transactions)
        .innerJoin(customers, eq(transactions.customerId, customers.id))
        .where(
          and(
            eq(transactions.saleDate, today),
            eq(transactions.fulfillment, "pending"),
            ne(transactions.status, "voided")
          )
        )
        .orderBy(asc(transactions.createdAt));

      // Fetch item totals for pending orders
      let pendingWithItems: {
        id: number;
        customerName: string;
        saleTime: string;
        itemCount: number;
        totalQty: number;
        loadedQty: number;
      }[] = [];

      if (pendingList.length > 0) {
        const pendingIds = pendingList.map((o) => o.id);
        const itemSums = await db
          .select({
            transactionId: transactionItems.transactionId,
            itemCount: sql<number>`COUNT(*)::int`,
            totalQty: sql<number>`COALESCE(SUM(${transactionItems.quantity}), 0)::double precision`,
            loadedQty: sql<number>`COALESCE(SUM(${transactionItems.loadedQty}), 0)::double precision`,
          })
          .from(transactionItems)
          .where(inArray(transactionItems.transactionId, pendingIds))
          .groupBy(transactionItems.transactionId);

        const sumMap = new Map(itemSums.map((s) => [s.transactionId, s]));

        pendingWithItems = pendingList.map((o) => {
          const s = sumMap.get(o.id);
          return {
            id: o.id,
            customerName: o.customerName,
            saleTime: o.saleTime,
            itemCount: s?.itemCount ?? 0,
            totalQty: s?.totalQty ?? 0,
            loadedQty: s?.loadedQty ?? 0,
          };
        });
      }

      return NextResponse.json({
        today: {
          totalOrders,
          loadedOrders,
          pendingOrders,
          otherOrders,
          completionPct,
        },
        pending: pendingWithItems,
      });
    }

  return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
}, {
  source: "display.route",
  operation: "GET /api/display",
  context: (request) => ({
    mode: request.nextUrl.searchParams.get("mode") || "current",
  }),
});

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  // Verify API key or authenticated session for display mutations
  const mutationAuth = await checkDisplayMutationAuth(request);
  if (!mutationAuth.ok) {
    return NextResponse.json(
      { error: mutationAuth.message || "Unauthorized" },
      { status: mutationAuth.status || 401 }
    );
  }

  const db = await getDb();
  const body = await request.json();
  const { action } = body;

  if (action === "done") {
      const parsedTransactionId = toPositiveInt(body?.transactionId);
      if (!parsedTransactionId) {
        return NextResponse.json({ error: "transactionId must be a positive integer" }, { status: 400 });
      }

      await db
        .update(transactions)
        .set({ fulfillment: "loaded" })
        .where(
          and(
            eq(transactions.id, parsedTransactionId),
            eq(transactions.fulfillment, "pending")
          )
        );

      return NextResponse.json({ success: true });
    }

  if (action === "updateLoaded") {
      const parsedTransactionItemId = toPositiveInt(body?.transactionItemId);
      const delta = body?.delta;
      if (!parsedTransactionItemId || typeof delta !== "number" || !Number.isFinite(delta)) {
        return NextResponse.json(
          { error: "transactionItemId must be a positive integer and delta must be a number" },
          { status: 400 }
        );
      }

      // Get current item to cap at ordered qty
      const [item] = await db
        .select()
        .from(transactionItems)
        .where(eq(transactionItems.id, parsedTransactionItemId))
        .limit(1);

      if (!item) {
        return NextResponse.json({ error: "Item not found" }, { status: 404 });
      }

      const newLoaded = Math.max(0, Math.min(item.quantity, (item.loadedQty || 0) + delta));

      await db
        .update(transactionItems)
        .set({ loadedQty: newLoaded })
        .where(eq(transactionItems.id, parsedTransactionItemId));

      return NextResponse.json({ success: true, loadedQty: newLoaded });
    }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}, {
  source: "display.route",
  operation: "POST /api/display",
  context: async (request) => {
    const body = await request.clone().json().catch(() => null);
    return {
      action:
        body && typeof body === "object" && "action" in body
          ? (body as { action?: unknown }).action
          : null,
    };
  },
});
