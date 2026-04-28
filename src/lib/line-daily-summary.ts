export interface DailySummaryInput {
  reportDate: string;
  yesterdayOrders: number;
  yesterdayUnits: number;
  activeCustomers: number;
  previousOrders: number;
  yesterdayRevenue: number;
  yesterdayCashReceived: number;
  overdueCustomers: number;
  overdueOutstanding: number;
  declineThresholdPct?: number;
}

export interface DailySummaryAlert {
  code: "order_decline" | "overdue_credit";
  message: string;
}

export interface DailySummaryResult {
  text: string;
  alerts: DailySummaryAlert[];
  metrics: {
    averageOrderValue: number;
    newCredit: number;
    orderChangePct: number | null;
    totalUnits: number;
    activeCustomers: number;
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

export function computeOrderChangePct(
  yesterdayOrders: number,
  previousOrders: number
): number | null {
  if (previousOrders <= 0) return null;
  return ((yesterdayOrders - previousOrders) / previousOrders) * 100;
}

export function buildDailySummaryText(input: DailySummaryInput): DailySummaryResult {
  const declineThresholdPct = input.declineThresholdPct ?? 30;
  const orderChangePct = computeOrderChangePct(
    input.yesterdayOrders,
    input.previousOrders
  );
  const averageOrderValue =
    input.yesterdayOrders > 0 ? input.yesterdayRevenue / input.yesterdayOrders : 0;
  const newCredit = Math.max(0, input.yesterdayRevenue - input.yesterdayCashReceived);

  const alerts: DailySummaryAlert[] = [];

  if (input.previousOrders > 0) {
    const declinePct =
      ((input.previousOrders - input.yesterdayOrders) / input.previousOrders) * 100;
    if (declinePct >= declineThresholdPct) {
      alerts.push({
        code: "order_decline",
        message: `Orders declined ${declinePct.toFixed(1)}% (${formatInt(input.yesterdayOrders)} vs ${formatInt(input.previousOrders)}).`,
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
    `Daily Sales Summary (${input.reportDate})`,
    "",
    `Orders: ${formatInt(input.yesterdayOrders)}${orderChangePct === null ? " (vs prev day: n/a)" : ` (vs prev day: ${formatSignedPercent(orderChangePct)})`}`,
    `Units: ${formatInt(input.yesterdayUnits)}`,
    `Customers: ${formatInt(input.activeCustomers)}`,
    `Revenue: ${formatMoney(input.yesterdayRevenue)} THB`,
    `Cash received: ${formatMoney(input.yesterdayCashReceived)} THB`,
    `New credit: ${formatMoney(newCredit)} THB`,
    `Avg order value: ${formatMoney(averageOrderValue)} THB`,
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
      orderChangePct,
      totalUnits: input.yesterdayUnits,
      activeCustomers: input.activeCustomers,
    },
  };
}
