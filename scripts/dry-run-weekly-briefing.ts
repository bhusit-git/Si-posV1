#!/usr/bin/env npx tsx

import fs from "node:fs";
import path from "node:path";
import { buildWeeklyBriefingText } from "@/lib/line-weekly-briefing";
import {
  getDateInTimezone,
  getPreviousCompletedIsoWeekRange,
  shiftDate,
} from "@/lib/line-report-utils";

function loadEnvFromFile() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;

  const text = fs.readFileSync(envPath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const idx = line.indexOf("=");
    if (idx <= 0) continue;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

async function main() {
  loadEnvFromFile();
  const { and, between, lt, ne, sql } = await import("drizzle-orm");
  const { getDbForFactory } = await import("@/db");
  const { transactions } = await import("@/db/schema");

  const factoryKey = (process.argv[2] || "si").toLowerCase();
  const referenceDate =
    process.argv[3] ||
    getDateInTimezone("Asia/Bangkok");

  const {
    weekStart,
    weekEnd,
    previousWeekStart,
    previousWeekEnd,
  } = getPreviousCompletedIsoWeekRange(referenceDate);
  const overdueCutoff = shiftDate(weekEnd, -60);
  const db = getDbForFactory(factoryKey);

  const [currentWeekRows, previousWeekRows, overdueRows] = await Promise.all([
    db
      .select({
        orders: sql<number>`COUNT(*)::int`,
        revenue: sql<number>`COALESCE(SUM(${transactions.totalAmount}), 0)`,
        cashReceived: sql<number>`COALESCE(SUM(${transactions.paid}), 0)`,
        activeCustomers: sql<number>`COUNT(DISTINCT ${transactions.customerId})::int`,
      })
      .from(transactions)
      .where(
        and(
          between(transactions.saleDate, weekStart, weekEnd),
          ne(transactions.status, "voided"),
          ne(transactions.transactionKind, "transfer_out")
        )
      ),
    db
      .select({
        orders: sql<number>`COUNT(*)::int`,
        revenue: sql<number>`COALESCE(SUM(${transactions.totalAmount}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          between(transactions.saleDate, previousWeekStart, previousWeekEnd),
          ne(transactions.status, "voided"),
          ne(transactions.transactionKind, "transfer_out")
        )
      ),
    db
      .select({
        overdueCustomers: sql<number>`COUNT(DISTINCT ${transactions.customerId})::int`,
        overdueOutstanding: sql<number>`COALESCE(SUM(${transactions.totalAmount} - ${transactions.paid}), 0)`,
      })
      .from(transactions)
      .where(
        and(
          sql`${transactions.status} IN ('unpaid', 'partial')`,
          lt(transactions.saleDate, overdueCutoff),
          ne(transactions.transactionKind, "transfer_out"),
          sql`(${transactions.totalAmount} - ${transactions.paid}) > 0`
        )
      ),
  ]);

  const currentWeek = currentWeekRows[0] || {
    orders: 0,
    revenue: 0,
    cashReceived: 0,
    activeCustomers: 0,
  };
  const previousWeek = previousWeekRows[0] || { orders: 0, revenue: 0 };
  const overdue = overdueRows[0] || { overdueCustomers: 0, overdueOutstanding: 0 };

  const briefing = buildWeeklyBriefingText({
    weekStart,
    weekEnd,
    previousWeekStart,
    previousWeekEnd,
    weekOrders: Number(currentWeek.orders || 0),
    previousWeekOrders: Number(previousWeek.orders || 0),
    weekRevenue: Number(currentWeek.revenue || 0),
    previousWeekRevenue: Number(previousWeek.revenue || 0),
    weekCashReceived: Number(currentWeek.cashReceived || 0),
    activeCustomers: Number(currentWeek.activeCustomers || 0),
    overdueCustomers: Number(overdue.overdueCustomers || 0),
    overdueOutstanding: Number(overdue.overdueOutstanding || 0),
    declineThresholdPct: 15,
  });

  console.log(
    JSON.stringify(
      {
        factoryKey,
        weekStart,
        weekEnd,
        previousWeekStart,
        previousWeekEnd,
        targetCount: 0,
        briefing,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
