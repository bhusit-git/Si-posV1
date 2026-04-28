import { describe, expect, it } from "vitest";

type AccountingStatus = "open" | "closed";
type AccountingFilter = AccountingStatus | "all";

function deriveAccountingState(parsedTransferNote: { accountingStatus?: AccountingStatus } | null): {
  accountingStatus: AccountingStatus;
  canToggleAccounting: boolean;
} {
  return {
    accountingStatus: parsedTransferNote?.accountingStatus ?? "open",
    canToggleAccounting: true,
  };
}

function filterByAccountingStatus<T extends { accountingStatus: AccountingStatus }>(
  rows: T[],
  filter: AccountingFilter
): T[] {
  if (filter === "all") return rows;
  return rows.filter((row) => row.accountingStatus === filter);
}

function computeTransferTotals(
  rows: Array<{ itemQty: number; totalAmount: number; bagReturnQty: number }>
): { count: number; totalQty: number; totalAmount: number; totalBagReturnQty: number } {
  return rows.reduce(
    (acc, row) => ({
      count: acc.count + 1,
      totalQty: acc.totalQty + Number(row.itemQty || 0),
      totalAmount: acc.totalAmount + Number(row.totalAmount || 0),
      totalBagReturnQty: acc.totalBagReturnQty + Number(row.bagReturnQty || 0),
    }),
    { count: 0, totalQty: 0, totalAmount: 0, totalBagReturnQty: 0 }
  );
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.getFullYear(), d.getMonth(), diff);
}

function applyQuickRange(
  key: string,
  now: Date
): { startDate: string; endDate: string } | null {
  let s: Date;
  let e: Date;
  switch (key) {
    case "today":
      s = now;
      e = now;
      break;
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      s = y;
      e = y;
      break;
    }
    case "thisWeek":
      s = getMonday(now);
      e = now;
      break;
    case "lastWeek": {
      const lm = getMonday(now);
      lm.setDate(lm.getDate() - 7);
      const ls = new Date(lm);
      ls.setDate(ls.getDate() + 6);
      s = lm;
      e = ls;
      break;
    }
    case "thisMonth":
      s = new Date(now.getFullYear(), now.getMonth(), 1);
      e = now;
      break;
    case "lastMonth":
      s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      e = new Date(now.getFullYear(), now.getMonth(), 0);
      break;
    case "last3Months":
      s = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      e = now;
      break;
    case "all":
      s = new Date(2000, 0, 1);
      e = now;
      break;
    default:
      return null;
  }
  return { startDate: toISO(s), endDate: toISO(e) };
}

function buildTransfersQueryParams(input: {
  startDate: string;
  endDate: string;
  accountingStatus: AccountingFilter;
  customerQuery: string;
}): string {
  const params = new URLSearchParams({
    startDate: input.startDate,
    endDate: input.endDate,
    accountingStatus: input.accountingStatus,
  });
  if (input.customerQuery.trim()) params.set("customerQuery", input.customerQuery.trim());
  return params.toString();
}

describe("Transfers accounting settle logic", () => {
  it("defaults to open and toggleable for legacy rows", () => {
    expect(deriveAccountingState(null)).toEqual({
      accountingStatus: "open",
      canToggleAccounting: true,
    });
  });

  it("uses closed status when transfer note carries acct=closed", () => {
    expect(deriveAccountingState({ accountingStatus: "closed" })).toEqual({
      accountingStatus: "closed",
      canToggleAccounting: true,
    });
  });

  it("filters open rows by default", () => {
    const rows = [
      { id: 1, accountingStatus: "open" as const },
      { id: 2, accountingStatus: "closed" as const },
      { id: 3, accountingStatus: "open" as const },
    ];
    expect(filterByAccountingStatus(rows, "open").map((r) => r.id)).toEqual([1, 3]);
  });

  it("supports closed and all filters", () => {
    const rows = [
      { id: 1, accountingStatus: "open" as const },
      { id: 2, accountingStatus: "closed" as const },
    ];
    expect(filterByAccountingStatus(rows, "closed").map((r) => r.id)).toEqual([2]);
    expect(filterByAccountingStatus(rows, "all").map((r) => r.id)).toEqual([1, 2]);
  });

  it("computes totals from the filtered result", () => {
    const totals = computeTransferTotals([
      { itemQty: 100, totalAmount: 0, bagReturnQty: 3 },
      { itemQty: 50, totalAmount: 0, bagReturnQty: 2 },
    ]);
    expect(totals).toEqual({
      count: 2,
      totalQty: 150,
      totalAmount: 0,
      totalBagReturnQty: 5,
    });
  });

  it("sums real priced transfer totals while keeping legacy zero-price rows valid", () => {
    const totals = computeTransferTotals([
      { itemQty: 100, totalAmount: 4200, bagReturnQty: 1 },
      { itemQty: 25, totalAmount: 0, bagReturnQty: 0 },
      { itemQty: 80, totalAmount: 3150, bagReturnQty: 2 },
    ]);

    expect(totals).toEqual({
      count: 3,
      totalQty: 205,
      totalAmount: 7350,
      totalBagReturnQty: 3,
    });
  });

  it("builds query params with customerQuery and no transfer ref", () => {
    const query = buildTransfersQueryParams({
      startDate: "2026-03-01",
      endDate: "2026-03-10",
      accountingStatus: "open",
      customerQuery: "  #123  ",
    });
    const params = new URLSearchParams(query);
    expect(params.get("customerQuery")).toBe("#123");
    expect(params.get("startDate")).toBe("2026-03-01");
    expect(params.get("endDate")).toBe("2026-03-10");
    expect(params.get("accountingStatus")).toBe("open");
    expect(params.has("ref")).toBe(false);
  });

  it("omits customerQuery when it trims to empty", () => {
    const query = buildTransfersQueryParams({
      startDate: "2026-03-01",
      endDate: "2026-03-10",
      accountingStatus: "all",
      customerQuery: "   ",
    });
    const params = new URLSearchParams(query);
    expect(params.get("startDate")).toBe("2026-03-01");
    expect(params.get("endDate")).toBe("2026-03-10");
    expect(params.get("accountingStatus")).toBe("all");
    expect(params.has("customerQuery")).toBe(false);
  });

  it("returns zero totals for empty transfer rows", () => {
    expect(computeTransferTotals([])).toEqual({
      count: 0,
      totalQty: 0,
      totalAmount: 0,
      totalBagReturnQty: 0,
    });
  });

  it("quick range today/lastWeek/all computes expected date windows", () => {
    const now = new Date("2026-03-15T10:00:00.000Z");

    expect(applyQuickRange("today", now)).toEqual({
      startDate: "2026-03-15",
      endDate: "2026-03-15",
    });

    expect(applyQuickRange("lastWeek", now)).toEqual({
      startDate: "2026-03-02",
      endDate: "2026-03-08",
    });

    expect(applyQuickRange("all", now)).toEqual({
      startDate: "2000-01-01",
      endDate: "2026-03-15",
    });
  });

  it("quick range thisMonth and invalid key behave as expected", () => {
    const now = new Date("2026-03-15T10:00:00.000Z");

    expect(applyQuickRange("thisMonth", now)).toEqual({
      startDate: "2026-03-01",
      endDate: "2026-03-15",
    });

    expect(applyQuickRange("bad-key", now)).toBeNull();
  });
});
