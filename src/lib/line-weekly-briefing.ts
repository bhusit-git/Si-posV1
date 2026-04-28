export interface WeeklyBriefingInput {
  weekStart: string;
  weekEnd: string;
  previousWeekStart: string;
  previousWeekEnd: string;
  weekOrders: number;
  previousWeekOrders: number;
  weekRevenue: number;
  previousWeekRevenue: number;
  weekCashReceived: number;
  activeCustomers: number;
  overdueCustomers: number;
  overdueOutstanding: number;
  declineThresholdPct?: number;
}

export interface WeeklyBriefingAlert {
  code: "revenue_decline" | "overdue_credit";
  message: string;
}

export interface WeeklyBriefingResult {
  text: string;
  alerts: WeeklyBriefingAlert[];
  metrics: {
    averageOrderValue: number;
    newCredit: number;
    revenueChangePct: number | null;
    orderChangePct: number | null;
  };
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatSignedPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function computeWeeklyChangePct(
  currentValue: number,
  previousValue: number
): number | null {
  if (previousValue <= 0) return null;
  return ((currentValue - previousValue) / previousValue) * 100;
}

export function buildWeeklyBriefingText(
  input: WeeklyBriefingInput
): WeeklyBriefingResult {
  const declineThresholdPct = input.declineThresholdPct ?? 15;
  const revenueChangePct = computeWeeklyChangePct(
    input.weekRevenue,
    input.previousWeekRevenue
  );
  const orderChangePct = computeWeeklyChangePct(
    input.weekOrders,
    input.previousWeekOrders
  );
  const averageOrderValue =
    input.weekOrders > 0 ? input.weekRevenue / input.weekOrders : 0;
  const newCredit = Math.max(0, input.weekRevenue - input.weekCashReceived);

  const alerts: WeeklyBriefingAlert[] = [];

  if (input.previousWeekRevenue > 0) {
    const declinePct =
      ((input.previousWeekRevenue - input.weekRevenue) /
        input.previousWeekRevenue) *
      100;
    if (declinePct >= declineThresholdPct) {
      alerts.push({
        code: "revenue_decline",
        message: `Revenue declined ${declinePct.toFixed(1)}% versus previous week (${formatMoney(input.weekRevenue)} vs ${formatMoney(input.previousWeekRevenue)} THB).`,
      });
    }
  }

  if (input.overdueCustomers > 0) {
    alerts.push({
      code: "overdue_credit",
      message: `${formatInt(input.overdueCustomers)} customer(s) have overdue credit >60 days (${formatMoney(input.overdueOutstanding)} THB).`,
    });
  }

  const lines = [
    `Weekly Sales Briefing (${input.weekStart} to ${input.weekEnd})`,
    `Compare week: ${input.previousWeekStart} to ${input.previousWeekEnd}`,
    "",
    `Orders: ${formatInt(input.weekOrders)}${orderChangePct === null ? " (vs prev week: n/a)" : ` (vs prev week: ${formatSignedPercent(orderChangePct)})`}`,
    `Revenue: ${formatMoney(input.weekRevenue)} THB${revenueChangePct === null ? " (vs prev week: n/a)" : ` (vs prev week: ${formatSignedPercent(revenueChangePct)})`}`,
    `Cash received: ${formatMoney(input.weekCashReceived)} THB`,
    `New credit: ${formatMoney(newCredit)} THB`,
    `Avg order value: ${formatMoney(averageOrderValue)} THB`,
    `Active customers: ${formatInt(input.activeCustomers)}`,
    "",
    "Alerts:",
  ];

  if (alerts.length === 0) {
    lines.push("- None");
  } else {
    for (const alert of alerts.slice(0, 2)) {
      lines.push(`- ${alert.message}`);
    }
  }

  return {
    text: lines.join("\n"),
    alerts,
    metrics: {
      averageOrderValue,
      newCredit,
      revenueChangePct,
      orderChangePct,
    },
  };
}
