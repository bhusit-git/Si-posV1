import {
  summarizeBagLedgerEntries,
  type BagLedgerEntryLike,
} from "@/lib/bag-flow";

export const BAG_USAGE_BIG_CHANGE_MIN_DELTA = 20;
export const BAG_USAGE_BIG_CHANGE_MIN_PCT = 50;

export interface BagUsageMovementGroup {
  customerId: number;
  customerName: string;
  phone: string | null;
  entries: BagLedgerEntryLike[];
}

export interface BagUsageBaseRow {
  customerId: number;
  customerName: string;
  phone: string | null;
  totalOut: number;
  totalReturn: number;
  totalAdjust: number;
  netMovement: number;
}

export interface BagUsageReportRow extends BagUsageBaseRow {
  previousOut: number;
  outDelta: number;
  outDeltaPct: number | null;
  hasBigChange: boolean;
}

export interface BagUsageSummary {
  weeklyOutflowTotal: number;
  weeklyWindowStart: string;
  weeklyWindowEnd: string;
  flaggedCustomerCount: number;
  totalOut: number;
  totalReturn: number;
  totalAdjust: number;
  netMovement: number;
}

export interface BagUsageReportResponse {
  summary: BagUsageSummary;
  rows: BagUsageReportRow[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function parseIsoDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shiftIsoDate(date: string, deltaDays: number): string {
  const next = parseIsoDate(date);
  next.setUTCDate(next.getUTCDate() + deltaDays);
  return formatIsoDate(next);
}

function getInclusiveDayCount(startDate: string, endDate: string): number {
  const diff = parseIsoDate(endDate).getTime() - parseIsoDate(startDate).getTime();
  return Math.max(1, Math.floor(diff / MS_PER_DAY) + 1);
}

export function getPreviousPeriodDateRange(startDate: string, endDate: string): {
  startDate: string;
  endDate: string;
} {
  const dayCount = getInclusiveDayCount(startDate, endDate);
  const previousEndDate = shiftIsoDate(startDate, -1);
  const previousStartDate = shiftIsoDate(previousEndDate, -(dayCount - 1));
  return {
    startDate: previousStartDate,
    endDate: previousEndDate,
  };
}

export function getRollingWeeklyDateRange(endDate: string): {
  startDate: string;
  endDate: string;
} {
  return {
    startDate: shiftIsoDate(endDate, -6),
    endDate,
  };
}

export function buildBagUsageRowsFromMovementGroups(
  groups: BagUsageMovementGroup[]
): BagUsageBaseRow[] {
  return groups.map((group) => {
    const bagSummary = summarizeBagLedgerEntries(group.entries);
    return {
      customerId: group.customerId,
      customerName: group.customerName,
      phone: group.phone,
      totalOut: bagSummary.bagsOut,
      totalReturn: bagSummary.bagsReturned + bagSummary.bagsBought,
      totalAdjust: bagSummary.bagAdjustDelta,
      netMovement: bagSummary.balanceDelta,
    };
  });
}

export function isBigBagOutChange(currentOut: number, previousOut: number): boolean {
  if (previousOut <= 0) return currentOut >= BAG_USAGE_BIG_CHANGE_MIN_DELTA;

  const outDelta = currentOut - previousOut;
  const outDeltaPct = (outDelta / previousOut) * 100;
  return (
    Math.abs(outDelta) >= BAG_USAGE_BIG_CHANGE_MIN_DELTA &&
    Math.abs(outDeltaPct) >= BAG_USAGE_BIG_CHANGE_MIN_PCT
  );
}

export function buildBagUsageReportResponse(params: {
  currentRows: BagUsageBaseRow[];
  previousRows: Pick<BagUsageBaseRow, "customerId" | "totalOut">[];
  weeklyOutflowTotal: number;
  weeklyWindowStart: string;
  weeklyWindowEnd: string;
}): BagUsageReportResponse {
  const previousOutByCustomer = new Map<number, number>();
  for (const row of params.previousRows) {
    previousOutByCustomer.set(row.customerId, Number(row.totalOut || 0));
  }

  const rows = params.currentRows.map((row) => {
    const previousOut = previousOutByCustomer.get(row.customerId) ?? 0;
    const outDelta = row.totalOut - previousOut;
    const outDeltaPct =
      previousOut > 0 ? (outDelta / previousOut) * 100 : null;

    return {
      ...row,
      previousOut,
      outDelta,
      outDeltaPct,
      hasBigChange: isBigBagOutChange(row.totalOut, previousOut),
    };
  });

  const summary: BagUsageSummary = {
    weeklyOutflowTotal: params.weeklyOutflowTotal,
    weeklyWindowStart: params.weeklyWindowStart,
    weeklyWindowEnd: params.weeklyWindowEnd,
    flaggedCustomerCount: rows.filter((row) => row.hasBigChange).length,
    totalOut: rows.reduce((sum, row) => sum + row.totalOut, 0),
    totalReturn: rows.reduce((sum, row) => sum + row.totalReturn, 0),
    totalAdjust: rows.reduce((sum, row) => sum + row.totalAdjust, 0),
    netMovement: rows.reduce((sum, row) => sum + row.netMovement, 0),
  };

  return { summary, rows };
}
