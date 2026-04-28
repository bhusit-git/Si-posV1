import { NextRequest, NextResponse } from "next/server";
import { and, between, lt, ne, sql } from "drizzle-orm";
import { getDbForFactory, getFactories } from "@/db";
import { transactions } from "@/db/schema";
import { withErrorHandler } from "@/lib/api-utils";
import { buildWeeklyBriefingText } from "@/lib/line-weekly-briefing";
import {
  getDateInTimezone,
  getPreviousCompletedIsoWeekRange,
  parseDryRun,
  parseFactoryKeys,
  pushLineTextMessage,
  readCronToken,
  REPORT_TIMEZONE,
  shiftDate,
} from "@/lib/line-report-utils";
import { getSupericeLineEnv } from "@/lib/config/env";

const DECLINE_THRESHOLD_PCT = 15;

function getFactoryTargetIds(factoryKey: string, defaultTargetIds: string[]): string[] {
  const lineEnv = getSupericeLineEnv();
  const targetIds = lineEnv.getWeeklyTargetIds(factoryKey);
  return targetIds.length > 0 ? targetIds : defaultTargetIds;
}

async function buildFactoryWeeklyBriefing(
  factoryKey: string,
  weekStart: string,
  weekEnd: string,
  previousWeekStart: string,
  previousWeekEnd: string,
  overdueCutoff: string
) {
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

  return buildWeeklyBriefingText({
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
    declineThresholdPct: DECLINE_THRESHOLD_PCT,
  });
}

async function handle(request: NextRequest) {
  const lineEnv = getSupericeLineEnv();
  const expectedToken = lineEnv.lineWeeklyBriefingCronToken;
  if (!expectedToken) {
    return NextResponse.json(
      { error: "LINE_WEEKLY_BRIEFING_CRON_TOKEN is not configured" },
      { status: 500 }
    );
  }

  const providedToken = readCronToken(request);
  if (!providedToken || providedToken !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const channelAccessToken = lineEnv.lineChannelAccessToken;
  const defaultTargetIds = lineEnv.lineWeeklyTargetIds;
  const dryRun = parseDryRun(request);

  if (!dryRun && !channelAccessToken) {
    return NextResponse.json(
      { error: "LINE_CHANNEL_ACCESS_TOKEN is not configured" },
      { status: 500 }
    );
  }

  const todayBkk = getDateInTimezone(REPORT_TIMEZONE);
  const {
    weekStart,
    weekEnd,
    previousWeekStart,
    previousWeekEnd,
  } = getPreviousCompletedIsoWeekRange(todayBkk);
  const overdueCutoff = shiftDate(weekEnd, -60);

  const configuredFactories = getFactories();
  const selectedFactoryKeys = parseFactoryKeys(
    request.nextUrl.searchParams.get("factories") ??
      request.nextUrl.searchParams.get("factory") ??
      lineEnv.lineWeeklyFactoryKeys ??
      undefined
  );

  const factoriesToSend =
    selectedFactoryKeys.length > 0
      ? configuredFactories.filter((factory) =>
          selectedFactoryKeys.includes(factory.key)
        )
      : configuredFactories;

  if (factoriesToSend.length === 0) {
    return NextResponse.json(
      { error: "No matching factories found for LINE weekly briefing" },
      { status: 400 }
    );
  }

  const missingFactoryKeys = selectedFactoryKeys.filter(
    (key) => !configuredFactories.some((factory) => factory.key === key)
  );
  if (missingFactoryKeys.length > 0) {
    return NextResponse.json(
      {
        error: "Unknown factory key(s)",
        unknown: missingFactoryKeys,
        available: configuredFactories.map((factory) => factory.key),
      },
      { status: 400 }
    );
  }

  const briefings = await Promise.all(
    factoriesToSend.map(async (factory) => {
      const briefing = await buildFactoryWeeklyBriefing(
        factory.key,
        weekStart,
        weekEnd,
        previousWeekStart,
        previousWeekEnd,
        overdueCutoff
      );
      const targetIds = getFactoryTargetIds(factory.key, defaultTargetIds);
      const messageText = `[${factory.name}]\n${briefing.text}`;
      return {
        factory,
        briefing,
        messageText,
        targetIds,
      };
    })
  );

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      weekStart,
      weekEnd,
      previousWeekStart,
      previousWeekEnd,
      factories: briefings.map((item) => ({
        factoryKey: item.factory.key,
        factoryName: item.factory.name,
        briefing: item.briefing,
        targetCount: item.targetIds.length,
      })),
    });
  }

  const factoriesMissingTargets = briefings
    .filter((item) => item.targetIds.length === 0)
    .map((item) => item.factory.key);
  if (factoriesMissingTargets.length > 0) {
    return NextResponse.json(
      {
        error:
          "Missing LINE recipients for one or more factories. Set LINE_WEEKLY_TARGET_IDS or LINE_REPORT_TARGET_IDS.",
        factoriesMissingTargets,
      },
      { status: 500 }
    );
  }

  for (const item of briefings) {
    for (const targetId of item.targetIds) {
      await pushLineTextMessage(channelAccessToken!, targetId, item.messageText);
    }
  }

  return NextResponse.json({
    ok: true,
    weekStart,
    weekEnd,
    previousWeekStart,
    previousWeekEnd,
    factories: briefings.map((item) => ({
      factoryKey: item.factory.key,
      factoryName: item.factory.name,
      targetCount: item.targetIds.length,
      alerts: item.briefing.alerts,
    })),
    sentMessages: briefings.reduce(
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
