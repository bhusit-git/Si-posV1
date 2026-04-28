import { NextResponse } from "next/server";
import { getDb, getMainDb } from "@/db";
import { transactions, transactionItems, bagLedger, productTypes, customers, users } from "@/db/schema";
import { eq, and, gte, lte, sql, ne, desc } from "drizzle-orm";
import { requireOfficeUp } from "@/lib/api-auth";
import { todayISO } from "@/lib/thai-utils";
import { withErrorHandler } from "@/lib/api-utils";
import { computeFinancialTotals } from "@/lib/financial-totals";
import { getForecastSnapshot, tomorrowInBangkok } from "@/lib/forecast-service";

function dateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isReturnTransaction(row: {
  transactionKind: string | null;
  totalAmount: number;
}): boolean {
  if (row.transactionKind === "return") return true;
  if (!row.transactionKind && Number(row.totalAmount || 0) < 0) return true;
  return false;
}

export const GET = withErrorHandler(async function GET() {
  const auth = await requireOfficeUp();
  if (auth.error) return auth.error;

  const db = await getDb();
  const today = todayISO();

  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = dateISO(yesterdayDate);

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const startDate = dateISO(sevenDaysAgo);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);
  const thirtyStart = dateISO(thirtyDaysAgo);

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const weeklyStart = dateISO(sixMonthsAgo);

  // Dashboard KPIs intentionally exclude `transfer_out` rows. Those transactions keep
  // real totals in the database, but the business reads them as invoice-later volume
  // rather than same-day operational sales. See invoice routes for where they return.
  const [
    todayFinancialRows, outstanding, bagTotal, topProducts, dailyTrend, recentTx,
    topCustomers, productTrend, hourlyDist, weeklySummary,
    creditAging, userActivity, yesterdaySales,
  ] = await Promise.all([
    // 1. Today's transaction rows for canonical totals
    db
      .select({
        status: transactions.status,
        transactionKind: transactions.transactionKind,
        totalAmount: transactions.totalAmount,
        paid: transactions.paid,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.saleDate, today),
          ne(transactions.transactionKind, "transfer_out")
        )
      ),

    // 2. Total outstanding
    db
      .select({
        totalOutstanding: sql<number>`COALESCE(SUM(${transactions.totalAmount} - ${transactions.paid}), 0)`,
        customerCount: sql<number>`COUNT(DISTINCT ${transactions.customerId})`,
      })
      .from(transactions)
      .where(
        and(
          sql`${transactions.status} IN ('unpaid', 'partial')`,
          ne(transactions.transactionKind, "transfer_out")
        )
      ),

    // 3. Total bag balance
    db
      .select({
        totalBalance: sql<number>`COALESCE(SUM(CASE
          WHEN ${bagLedger.type} = 'out' THEN ${bagLedger.quantity}
          WHEN ${bagLedger.type} = 'return' THEN -${bagLedger.quantity}
          WHEN ${bagLedger.type} = 'adjust' THEN ${bagLedger.quantity}
          ELSE 0 END), 0)`,
      })
      .from(bagLedger),

    // 4. Top 5 products today
    db
      .select({
        productName: productTypes.name,
        totalQty: sql<number>`COALESCE(SUM(${transactionItems.quantity}), 0)`,
        totalAmount: sql<number>`COALESCE(SUM(${transactionItems.subtotal}), 0)`,
      })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
      .innerJoin(productTypes, eq(transactionItems.productTypeId, productTypes.id))
      .where(
        and(
          eq(transactions.saleDate, today),
          ne(transactions.status, "voided"),
          ne(transactions.transactionKind, "transfer_out")
        )
      )
      .groupBy(productTypes.id, productTypes.name)
      .orderBy(desc(sql`COALESCE(SUM(${transactionItems.subtotal}), 0)`))
      .limit(5),

    // 5. Last 7 days trend
    db
      .select({
        date: transactions.saleDate,
        totalAmount: sql<number>`COALESCE(SUM(${transactions.totalAmount}), 0)`,
        txCount: sql<number>`COUNT(*)`,
      })
      .from(transactions)
      .where(
        and(
          gte(transactions.saleDate, startDate),
          lte(transactions.saleDate, today),
          ne(transactions.status, "voided"),
          ne(transactions.transactionKind, "transfer_out")
        )
      )
      .groupBy(transactions.saleDate)
      .orderBy(transactions.saleDate),

    // 6. Recent 5 transactions
    db.query.transactions.findMany({
      where: and(
        eq(transactions.saleDate, today),
        ne(transactions.status, "voided"),
        ne(transactions.transactionKind, "transfer_out")
      ),
      with: { customer: true, items: { with: { productType: true } } },
      orderBy: [desc(transactions.saleTime)],
      limit: 5,
    }),

    // 7. Top 10 customers (last 30 days)
    db
      .select({
        customerId: transactions.customerId,
        customerName: customers.name,
        visitCount: sql<number>`COUNT(*)::int`,
        totalSpend: sql<number>`COALESCE(SUM(${transactions.totalAmount}), 0)`,
        lastVisit: sql<string>`MAX(${transactions.saleDate})`,
      })
      .from(transactions)
      .innerJoin(customers, eq(transactions.customerId, customers.id))
      .where(
        and(
          gte(transactions.saleDate, thirtyStart),
          ne(transactions.status, "voided"),
          ne(transactions.transactionKind, "transfer_out")
        )
      )
      .groupBy(transactions.customerId, customers.name)
      .orderBy(desc(sql`COUNT(*)`))
      .limit(10),

    // 8. Sales by product type (last 7 days)
    db
      .select({
        date: transactions.saleDate,
        productName: productTypes.name,
        totalQty: sql<number>`COALESCE(SUM(${transactionItems.quantity}), 0)`,
        totalAmount: sql<number>`COALESCE(SUM(${transactionItems.subtotal}), 0)`,
      })
      .from(transactionItems)
      .innerJoin(transactions, eq(transactionItems.transactionId, transactions.id))
      .innerJoin(productTypes, eq(transactionItems.productTypeId, productTypes.id))
      .where(
        and(
          gte(transactions.saleDate, startDate),
          lte(transactions.saleDate, today),
          ne(transactions.status, "voided"),
          ne(transactions.transactionKind, "transfer_out")
        )
      )
      .groupBy(transactions.saleDate, productTypes.name)
      .orderBy(transactions.saleDate),

    // 9. Hourly distribution today
    db
      .select({
        hour: sql<number>`EXTRACT(HOUR FROM ${transactions.saleTime}::time)::int`,
        txCount: sql<number>`COUNT(*)::int`,
        totalAmount: sql<number>`COALESCE(SUM(${transactions.totalAmount}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.saleDate, today),
          ne(transactions.status, "voided"),
          ne(transactions.transactionKind, "transfer_out")
        )
      )
      .groupBy(sql`EXTRACT(HOUR FROM ${transactions.saleTime}::time)`)
      .orderBy(sql`EXTRACT(HOUR FROM ${transactions.saleTime}::time)`),

    // 10. Weekly summary (last 6 months)
    db
      .select({
        weekStart: sql<string>`DATE_TRUNC('week', ${transactions.saleDate}::date)::date::text`,
        totalAmount: sql<number>`COALESCE(SUM(${transactions.totalAmount}), 0)`,
        txCount: sql<number>`COUNT(*)::int`,
      })
      .from(transactions)
      .where(
        and(
          gte(transactions.saleDate, weeklyStart),
          lte(transactions.saleDate, today),
          ne(transactions.status, "voided"),
          ne(transactions.transactionKind, "transfer_out")
        )
      )
      .groupBy(sql`DATE_TRUNC('week', ${transactions.saleDate}::date)`)
      .orderBy(sql`DATE_TRUNC('week', ${transactions.saleDate}::date)`),

    // 11. Credit aging -- per-customer outstanding with age buckets
    db
      .select({
        customerId: customers.id,
        customerName: customers.name,
        owed: sql<number>`COALESCE(SUM(${transactions.totalAmount} - ${transactions.paid}), 0)`,
        oldestDate: sql<string>`MIN(${transactions.saleDate})`,
        ageBucket: sql<string>`CASE
          WHEN MIN(${transactions.saleDate}) >= CURRENT_DATE - 7  THEN '0-7'
          WHEN MIN(${transactions.saleDate}) >= CURRENT_DATE - 14 THEN '8-14'
          WHEN MIN(${transactions.saleDate}) >= CURRENT_DATE - 30 THEN '15-30'
          ELSE '30+'
        END`,
      })
      .from(transactions)
      .innerJoin(customers, eq(transactions.customerId, customers.id))
      .where(
        and(
          sql`${transactions.status} IN ('unpaid', 'partial')`,
          ne(transactions.transactionKind, "transfer_out")
        )
      )
      .groupBy(customers.id, customers.name)
      .orderBy(sql`MIN(${transactions.saleDate}) ASC`)
      .limit(15),

    // 12. User activity today -- aggregate by created_by from factory DB
    //     (users live in main DB, so we resolve names in a second step below)
    db
      .select({
        userId: transactions.createdBy,
        saleCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} <> 'voided')::int`,
        saleTotal: sql<number>`COALESCE(SUM(${transactions.totalAmount}) FILTER (WHERE ${transactions.status} <> 'voided'), 0)`,
        voidCount: sql<number>`COUNT(*) FILTER (WHERE ${transactions.status} = 'voided')::int`,
        voidTotal: sql<number>`COALESCE(SUM(${transactions.totalAmount}) FILTER (WHERE ${transactions.status} = 'voided'), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.saleDate, today),
          sql`${transactions.createdBy} IS NOT NULL`,
          ne(transactions.transactionKind, "transfer_out")
        )
      )
      .groupBy(transactions.createdBy)
      .orderBy(desc(sql`COALESCE(SUM(${transactions.totalAmount}) FILTER (WHERE ${transactions.status} <> 'voided'), 0)`)),

    // 13. Yesterday's sales summary (for comparison)
    db
      .select({
        totalTransactions: sql<number>`COUNT(*)`,
        totalAmount: sql<number>`COALESCE(SUM(${transactions.totalAmount}), 0)`,
        paidAmount: sql<number>`COALESCE(SUM(${transactions.paid}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.saleDate, yesterday),
          ne(transactions.status, "voided"),
          ne(transactions.transactionKind, "transfer_out")
        )
      ),
  ]);

  // Resolve user IDs from the centralized main DB
  const userIds = userActivity.map((u) => u.userId).filter((id): id is number => id !== null);
  let userMap = new Map<number, { username: string; role: string }>();
  if (userIds.length > 0) {
    const mainDb = getMainDb();
    const userRows = await mainDb
      .select({ id: users.id, username: users.username, role: users.role })
      .from(users)
      .where(sql`${users.id} IN (${sql.join(userIds.map(id => sql`${id}`), sql`, `)})`);
    userMap = new Map(userRows.map((u) => [u.id, { username: u.username, role: u.role }]));
  }

  const enrichedUserActivity = userActivity.map((u) => {
    const info = u.userId ? userMap.get(u.userId) : null;
    return {
      userId: u.userId,
      username: info?.username ?? `user#${u.userId}`,
      role: info?.role ?? "unknown",
      saleCount: u.saleCount,
      saleTotal: u.saleTotal,
      voidCount: u.voidCount,
      voidTotal: u.voidTotal,
    };
  });

  const todayRows = todayFinancialRows.map((row) => ({
    status: row.status,
    transactionKind: row.transactionKind,
    totalAmount: Number(row.totalAmount || 0),
    paid: Number(row.paid || 0),
  }));
  const todayTotals = computeFinancialTotals(todayRows);
  const todayReturnRows = todayRows.filter(
    (row) => row.status !== "voided" && isReturnTransaction(row)
  );
  const todayReturnTotals = computeFinancialTotals(todayReturnRows);
  const todayVoidTotals = computeFinancialTotals(todayRows);
  const forecastFactoryKey = auth.user?.factoryKey || "default";
  const tomorrowForecast = await getForecastSnapshot(
    db,
    forecastFactoryKey,
    tomorrowInBangkok()
  );

  return NextResponse.json({
    today: {
      totalTransactions: todayTotals.activeCount,
      totalAmount: todayTotals.netSales,
      paidAmount: todayTotals.netCash,
      receivableDelta: todayTotals.receivableDelta,
      outstandingDebt: todayTotals.outstandingDebt,
      refundBalance: todayTotals.refundBalance,
    },
    outstanding: outstanding[0] || { totalOutstanding: 0, customerCount: 0 },
    bagBalance: bagTotal[0]?.totalBalance || 0,
    topProducts,
    dailyTrend,
    recentTx,
    topCustomers,
    productTrend,
    hourlyDist,
    weeklySummary,
    todayReturns: {
      returnCount: todayReturnRows.length,
      returnAmount: todayReturnTotals.netSales,
    },
    todayVoids: {
      voidCount: todayVoidTotals.voidCount,
      voidAmount: todayVoidTotals.voidAmount,
    },
    creditAging,
    userActivity: enrichedUserActivity,
    yesterday: yesterdaySales[0] || { totalTransactions: 0, totalAmount: 0, paidAmount: 0 },
    tomorrowForecast,
  });
});
