import { NextRequest, NextResponse } from "next/server";
import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { bagLedger, customers, productTypes, transactionItems, transactions } from "@/db/schema";
import { requireOfficeUp } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import {
  ALL_BILL_KINDS,
  buildItemizedPreview,
  parseIncludeKinds,
  type BillKind,
} from "@/lib/invoice-utils";

function normalizeTime(value: string): string {
  return value.length === 5 ? `${value}:00` : value.slice(0, 8);
}

function inTimeWindow(saleTime: string, startTime: string, endTime: string): boolean {
  const t = normalizeTime(saleTime || "00:00:00");
  const start = normalizeTime(startTime);
  const end = normalizeTime(endTime);
  if (start <= end) return t >= start && t <= end;
  return t >= start || t <= end;
}

function parseTimeWindow(request: NextRequest): { startTime: string; endTime: string } | null {
  const windowParam = request.nextUrl.searchParams.get("timeWindow");
  if (windowParam && windowParam.includes("-")) {
    const [start, end] = windowParam.split("-", 2).map((v) => v.trim());
    if (start && end) return { startTime: start, endTime: end };
  }

  const startTime = request.nextUrl.searchParams.get("startTime");
  const endTime = request.nextUrl.searchParams.get("endTime");
  if (startTime && endTime) return { startTime, endTime };

  return null;
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireOfficeUp();
  if (auth.error) return auth.error;

  const customerId = Number(request.nextUrl.searchParams.get("customerId") || 0);
  const startDate = request.nextUrl.searchParams.get("startDate");
  const endDate = request.nextUrl.searchParams.get("endDate");
  const includeKinds = parseIncludeKinds(request.nextUrl.searchParams.get("includeKinds"));
  const timeWindow = parseTimeWindow(request);

  if (!Number.isFinite(customerId) || customerId <= 0) {
    return NextResponse.json({ error: "customerId is required" }, { status: 400 });
  }
  if (!startDate || !endDate) {
    return NextResponse.json({ error: "startDate and endDate are required" }, { status: 400 });
  }
  if (startDate > endDate) {
    return NextResponse.json({ error: "startDate must be less than or equal to endDate" }, { status: 400 });
  }

  const db = await getDb();
  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
    columns: { id: true, name: true, phone: true },
  });
  if (!customer) {
    return NextResponse.json({ error: "ไม่พบลูกค้า" }, { status: 404 });
  }

  const txRows = await db
    .select({
      id: transactions.id,
      customerName: customers.name,
      saleDate: transactions.saleDate,
      saleTime: transactions.saleTime,
      pool: transactions.pool,
      row: transactions.row,
      col: transactions.col,
      status: transactions.status,
      totalAmount: transactions.totalAmount,
      paid: transactions.paid,
      transactionKind: transactions.transactionKind,
      note: transactions.note,
    })
    .from(transactions)
    .innerJoin(customers, eq(transactions.customerId, customers.id))
    .where(
      and(
        eq(transactions.customerId, customerId),
        gte(transactions.saleDate, startDate),
        lte(transactions.saleDate, endDate),
        ne(transactions.status, "voided")
      )
    )
    .orderBy(transactions.saleDate, transactions.saleTime, transactions.id);

  const filteredByTime = timeWindow
    ? txRows.filter((tx) => inTimeWindow(tx.saleTime, timeWindow.startTime, timeWindow.endTime))
    : txRows;

  const txIds = filteredByTime.map((tx) => tx.id);
  if (txIds.length === 0) {
    return NextResponse.json({
      customer,
      includeKinds: Array.from(includeKinds),
      allKinds: ALL_BILL_KINDS,
      timeWindow,
      productColumns: [],
      rows: [],
      totals: {
        totalsByProduct: {},
        totalCashPaid: 0,
        totalCreditOwed: 0,
        totalRefundBalance: 0,
        totalSum: 0,
        totalBagsOut: 0,
        totalBagsReturned: 0,
        totalBagsBought: 0,
        totalBagAdjustDelta: 0,
        kindCounts: {
          sale: 0,
          return: 0,
          transfer_out: 0,
          adjustment: 0,
        } as Record<BillKind, number>,
        rowCount: 0,
      },
    });
  }

  const idsSql = sql.join(txIds.map((id) => sql`${id}`), sql`, `);
  const [items, bagEntries, activeProductTypes] = await Promise.all([
    db
      .select({
        transactionId: transactionItems.transactionId,
        productTypeId: transactionItems.productTypeId,
        quantity: transactionItems.quantity,
      })
      .from(transactionItems)
      .where(sql`${transactionItems.transactionId} IN (${idsSql})`),
    db
      .select({
        transactionId: bagLedger.transactionId,
        type: bagLedger.type,
        quantity: bagLedger.quantity,
        note: bagLedger.note,
      })
      .from(bagLedger)
      .where(sql`${bagLedger.transactionId} IN (${idsSql})`),
    db
      .select({
        id: productTypes.id,
        name: productTypes.name,
        sortOrder: productTypes.sortOrder,
      })
      .from(productTypes)
      .where(eq(productTypes.isActive, true)),
  ]);

  const preview = buildItemizedPreview({
    transactions: filteredByTime,
    items,
    bagEntries,
    productColumns: activeProductTypes,
    includeKinds,
  });

  return NextResponse.json({
    customer,
    includeKinds: Array.from(includeKinds),
    allKinds: ALL_BILL_KINDS,
    timeWindow,
    ...preview,
  });
});
