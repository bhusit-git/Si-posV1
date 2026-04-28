import { NextRequest, NextResponse } from "next/server";
import { auditLog, transactions } from "@/db/schema";
import { and, asc, eq, gte, lte, ne, sql } from "drizzle-orm";
import { requireManagerUp } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { requireFactoryReadContext } from "@/lib/factory-context";
import {
  getFactorySalePricingAuditDetailKey,
  supportsFactoryFeature,
} from "@/lib/factory-profile";
import { todayISO } from "@/lib/thai-utils";

type BearingDiscountAuditDetails = {
  bearingDiscount?: {
    transactionId?: number | null;
    printedBillNumber?: number | null;
    billNumber?: string | null;
    customerId?: number | null;
    customerName?: string | null;
    saleDate?: string | null;
    saleTime?: string | null;
    originalSubtotal?: number | null;
    finalSubtotal?: number | null;
    discountAmount?: number | null;
  } | null;
};

type BearingDiscountReportRow = {
  transactionId: number;
  billNumber: string;
  customerId: number | null;
  customerName: string | null;
  saleDate: string;
  saleTime: string | null;
  originalSubtotal: number;
  discountAmount: number;
  finalSubtotal: number;
};

function asFiniteNumber(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function buildDailyTotals(rows: BearingDiscountReportRow[]) {
  const totalsByDate = new Map<string, { saleDate: string; discountAmount: number; rowCount: number }>();
  for (const row of rows) {
    const existing = totalsByDate.get(row.saleDate) || {
      saleDate: row.saleDate,
      discountAmount: 0,
      rowCount: 0,
    };
    existing.discountAmount += row.discountAmount;
    existing.rowCount += 1;
    totalsByDate.set(row.saleDate, existing);
  }
  return Array.from(totalsByDate.values()).sort((a, b) => a.saleDate.localeCompare(b.saleDate));
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  const factoryContext = requireFactoryReadContext(request, auth.user);
  if ("error" in factoryContext) return factoryContext.error;
  const { db, factoryKey } = factoryContext;
  const auditDetailKey = getFactorySalePricingAuditDetailKey(factoryKey);

  if (
    !supportsFactoryFeature(factoryKey, "bearingDiscountsReport") ||
    auditDetailKey !== "bearingDiscount"
  ) {
    return NextResponse.json(
      { error: "Bearing discounts are only available for Bearing" },
      { status: 404 }
    );
  }

  const startDate = request.nextUrl.searchParams.get("startDate") || todayISO();
  const endDate = request.nextUrl.searchParams.get("endDate") || startDate;
  if (!isYmd(startDate) || !isYmd(endDate) || startDate > endDate) {
    return NextResponse.json({ error: "invalid date range" }, { status: 400 });
  }

  const auditRows = await db
    .select({
      transactionId: auditLog.entityId,
      details: auditLog.details,
    })
    .from(auditLog)
    .innerJoin(transactions, eq(auditLog.entityId, transactions.id))
    .where(
      and(
        eq(auditLog.action, "transaction.create"),
        eq(auditLog.entity, "transaction"),
        ne(transactions.status, "voided"),
        sql`${auditLog.details} ? 'bearingDiscount'`,
        gte(sql<string>`${auditLog.details}->'bearingDiscount'->>'saleDate'`, startDate),
        lte(sql<string>`${auditLog.details}->'bearingDiscount'->>'saleDate'`, endDate)
      )
    )
    .orderBy(
      asc(sql`${auditLog.details}->'bearingDiscount'->>'saleDate'`),
      asc(sql`${auditLog.details}->'bearingDiscount'->>'saleTime'`),
      asc(auditLog.entityId)
    );

  const rows: BearingDiscountReportRow[] = auditRows.flatMap((row) => {
    const details = row.details as BearingDiscountAuditDetails | null;
    const discount = details?.bearingDiscount;
    const transactionId = Number(discount?.transactionId || row.transactionId || 0);
    const saleDate = typeof discount?.saleDate === "string" ? discount.saleDate : "";
    const discountAmount = asFiniteNumber(discount?.discountAmount);
    if (!transactionId || !isYmd(saleDate) || discountAmount <= 0) return [];

    return [{
      transactionId,
      billNumber:
        typeof discount?.billNumber === "string" && discount.billNumber
          ? discount.billNumber
          : `#${transactionId}`,
      customerId:
        typeof discount?.customerId === "number" && Number.isFinite(discount.customerId)
          ? discount.customerId
          : null,
      customerName: typeof discount?.customerName === "string" ? discount.customerName : null,
      saleDate,
      saleTime: typeof discount?.saleTime === "string" ? discount.saleTime : null,
      originalSubtotal: asFiniteNumber(discount?.originalSubtotal),
      discountAmount,
      finalSubtotal: asFiniteNumber(discount?.finalSubtotal),
    }];
  });

  const dailyTotals = buildDailyTotals(rows);
  const grandTotalDiscount = rows.reduce((sum, row) => sum + row.discountAmount, 0);

  return NextResponse.json({
    factoryKey,
    startDate,
    endDate,
    rows,
    dailyTotals,
    grandTotalDiscount,
    rowCount: rows.length,
  });
});
