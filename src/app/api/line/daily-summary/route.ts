import { NextRequest, NextResponse } from "next/server";
import { and, eq, lt, ne, sql } from "drizzle-orm";
import { getDbForFactory, getFactories } from "@/db";
import { transactionItems, transactions } from "@/db/schema";
import { withErrorHandler } from "@/lib/api-utils";
import { buildDailySummaryText } from "@/lib/line-daily-summary";
import {
  getDateInTimezone,
  parseDryRun,
  parseFactoryKeys,
  pushLineTextMessage,
  readCronToken,
  REPORT_TIMEZONE,
  shiftDate,
} from "@/lib/line-report-utils";
import { getSupericeLineEnv } from "@/lib/config/env";

function getFactoryTargetIds(factoryKey: string, defaultTargetIds: string[]): string[] {
  const lineEnv = getSupericeLineEnv();
  const targetIds = lineEnv.getDailyTargetIds(factoryKey);
  return targetIds.length > 0 ? targetIds : defaultTargetIds;
}

const DECLINE_THRESHOLD_PCT = 30;

async function buildFactorySummary(
  factoryKey: string,
  reportDate: string,
  previousDate: string,
  overdueCutoff: string
) {
  const db = getDbForFactory(factoryKey);
  // This summary follows the same convention as dashboard/reports: exclude
  // `transfer_out` because those rows are invoiced later. The underlying transaction
  // still stores real totals; this endpoint is showing same-day operational sales.
  const [yesterdayRows, previousRows, unitsRows, overdueRows] = await Promise.all([
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
          eq(transactions.saleDate, reportDate),
          ne(transactions.status, "voided"),
          ne(transactions.transactionKind, "transfer_out")
        )
      ),
    db
      .select({
        orders: sql<number>`COUNT(*)::int`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.saleDate, previousDate),
          ne(transactions.status, "voided"),
          ne(transactions.transactionKind, "transfer_out")
        )
      ),
    db
      .select({
        units: sql<number>`COALESCE(SUM(${transactionItems.quantity}), 0)`,
      })
      .from(transactions)
      .innerJoin(
        transactionItems,
        eq(transactionItems.transactionId, transactions.id)
      )
      .where(
        and(
          eq(transactions.saleDate, reportDate),
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

  const yesterday = yesterdayRows[0] || {
    orders: 0,
    revenue: 0,
    cashReceived: 0,
    activeCustomers: 0,
  };
  const previous = previousRows[0] || { orders: 0 };
  const units = unitsRows[0] || { units: 0 };
  const overdue = overdueRows[0] || { overdueCustomers: 0, overdueOutstanding: 0 };

  return buildDailySummaryText({
    reportDate,
    yesterdayOrders: Number(yesterday.orders || 0),
    yesterdayUnits: Number(units.units || 0),
    activeCustomers: Number(yesterday.activeCustomers || 0),
    previousOrders: Number(previous.orders || 0),
    yesterdayRevenue: Number(yesterday.revenue || 0),
    yesterdayCashReceived: Number(yesterday.cashReceived || 0),
    overdueCustomers: Number(overdue.overdueCustomers || 0),
    overdueOutstanding: Number(overdue.overdueOutstanding || 0),
    declineThresholdPct: DECLINE_THRESHOLD_PCT,
  });
}

async function handle(request: NextRequest) {
  const lineEnv = getSupericeLineEnv();
  const expectedToken = lineEnv.lineReportCronToken;
  if (!expectedToken) {
    return NextResponse.json(
      { error: "LINE_REPORT_CRON_TOKEN is not configured" },
      { status: 500 }
    );
  }

  const providedToken = readCronToken(request);
  if (!providedToken || providedToken !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const channelAccessToken = lineEnv.lineChannelAccessToken;
  const defaultTargetIds = lineEnv.lineReportTargetIds;
  const dryRun = parseDryRun(request);

  if (!dryRun) {
    if (!channelAccessToken) {
      return NextResponse.json(
        { error: "LINE_CHANNEL_ACCESS_TOKEN is not configured" },
        { status: 500 }
      );
    }
  }

  const todayBkk = getDateInTimezone(REPORT_TIMEZONE);
  const reportDate = shiftDate(todayBkk, -1);
  const previousDate = shiftDate(todayBkk, -2);
  const overdueCutoff = shiftDate(reportDate, -60);

  const configuredFactories = getFactories();
  const selectedFactoryKeys = parseFactoryKeys(
    request.nextUrl.searchParams.get("factories") ??
      request.nextUrl.searchParams.get("factory") ??
      lineEnv.lineReportFactoryKeys ??
      undefined
  );

  const factoriesToSend =
    selectedFactoryKeys.length > 0
      ? configuredFactories.filter((f) => selectedFactoryKeys.includes(f.key))
      : configuredFactories;

  if (factoriesToSend.length === 0) {
    return NextResponse.json(
      { error: "No matching factories found for LINE report" },
      { status: 400 }
    );
  }

  const missingFactoryKeys = selectedFactoryKeys.filter(
    (key) => !configuredFactories.some((f) => f.key === key)
  );
  if (missingFactoryKeys.length > 0) {
    return NextResponse.json(
      {
        error: "Unknown factory key(s)",
        unknown: missingFactoryKeys,
        available: configuredFactories.map((f) => f.key),
      },
      { status: 400 }
    );
  }

  const summaries = await Promise.all(
    factoriesToSend.map(async (factory) => {
      const summary = await buildFactorySummary(
        factory.key,
        reportDate,
        previousDate,
        overdueCutoff
      );
      const targetIds = getFactoryTargetIds(factory.key, defaultTargetIds);
      const messageText = `[${factory.name}]\n${summary.text}`;
      return {
        factory,
        summary,
        messageText,
        targetIds,
      };
    })
  );

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      reportDate,
      factories: summaries.map((item) => ({
        factoryKey: item.factory.key,
        factoryName: item.factory.name,
        summary: item.summary,
        targetCount: item.targetIds.length,
      })),
    });
  }

  const factoriesMissingTargets = summaries
    .filter((item) => item.targetIds.length === 0)
    .map((item) => item.factory.key);
  if (factoriesMissingTargets.length > 0) {
    return NextResponse.json(
      {
        error:
          "Missing LINE recipients for one or more factories. Set LINE_REPORT_TARGET_IDS or LINE_REPORT_TARGET_IDS_<FACTORY>.",
        factoriesMissingTargets,
      },
      { status: 500 }
    );
  }

  for (const item of summaries) {
    for (const targetId of item.targetIds) {
      await pushLineTextMessage(channelAccessToken!, targetId, item.messageText);
    }
  }

  return NextResponse.json({
    ok: true,
    reportDate,
    factories: summaries.map((item) => ({
      factoryKey: item.factory.key,
      factoryName: item.factory.name,
      targetCount: item.targetIds.length,
      alerts: item.summary.alerts,
    })),
    sentMessages: summaries.reduce(
      (sum, item) => sum + item.targetIds.length,
      0
    ),
  });
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  return handle(request);
});

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  return handle(request);
});
