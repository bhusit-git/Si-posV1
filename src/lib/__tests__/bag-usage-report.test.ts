import { describe, expect, it } from "vitest";
import {
  buildBagUsageReportResponse,
  buildBagUsageRowsFromMovementGroups,
  getPreviousPeriodDateRange,
  getRollingWeeklyDateRange,
  isBigBagOutChange,
} from "@/lib/bag-usage-report";

describe("bag usage report helpers", () => {
  it("builds bag usage rows with canonical return semantics", () => {
    const rows = buildBagUsageRowsFromMovementGroups([
      {
        customerId: 7,
        customerName: "ร้าน A",
        phone: "0812345678",
        entries: [
          { type: "out", quantity: 50, note: null },
          { type: "return", quantity: 10, note: null },
          { type: "return", quantity: 5, note: "ซื้อกระสอบ" },
          { type: "adjust", quantity: -3, note: "ปรับยอด" },
        ],
      },
    ]);

    expect(rows).toEqual([
      {
        customerId: 7,
        customerName: "ร้าน A",
        phone: "0812345678",
        totalOut: 50,
        totalReturn: 15,
        totalAdjust: -3,
        netMovement: 32,
      },
    ]);
  });

  it("calculates the previous period with the same inclusive day count", () => {
    expect(
      getPreviousPeriodDateRange("2026-04-04", "2026-04-10")
    ).toEqual({
      startDate: "2026-03-28",
      endDate: "2026-04-03",
    });

    expect(
      getPreviousPeriodDateRange("2026-04-10", "2026-04-10")
    ).toEqual({
      startDate: "2026-04-09",
      endDate: "2026-04-09",
    });
  });

  it("calculates the rolling 7-day window ending on endDate", () => {
    expect(getRollingWeeklyDateRange("2026-04-10")).toEqual({
      startDate: "2026-04-04",
      endDate: "2026-04-10",
    });
  });

  it("flags a large increase only when both thresholds are met", () => {
    expect(isBigBagOutChange(60, 30)).toBe(true);
    expect(isBigBagOutChange(34, 20)).toBe(false);
  });

  it("flags a large decrease using the same threshold rule", () => {
    expect(isBigBagOutChange(15, 45)).toBe(true);
    expect(isBigBagOutChange(25, 40)).toBe(false);
  });

  it("flags zero-baseline customers only when current outflow is at least 20", () => {
    expect(isBigBagOutChange(20, 0)).toBe(true);
    expect(isBigBagOutChange(19, 0)).toBe(false);
  });

  it("builds the bag usage response summary and comparison fields", () => {
    const response = buildBagUsageReportResponse({
      currentRows: [
        {
          customerId: 1,
          customerName: "ร้าน A",
          phone: null,
          totalOut: 60,
          totalReturn: 12,
          totalAdjust: 0,
          netMovement: 48,
        },
        {
          customerId: 2,
          customerName: "ร้าน B",
          phone: "0890000000",
          totalOut: 10,
          totalReturn: 3,
          totalAdjust: -1,
          netMovement: 6,
        },
      ],
      previousRows: [
        { customerId: 1, totalOut: 30 },
        { customerId: 2, totalOut: 0 },
      ],
      weeklyOutflowTotal: 88,
      weeklyWindowStart: "2026-04-04",
      weeklyWindowEnd: "2026-04-10",
    });

    expect(response.summary).toEqual({
      weeklyOutflowTotal: 88,
      weeklyWindowStart: "2026-04-04",
      weeklyWindowEnd: "2026-04-10",
      flaggedCustomerCount: 1,
      totalOut: 70,
      totalReturn: 15,
      totalAdjust: -1,
      netMovement: 54,
    });

    expect(response.rows).toEqual([
      {
        customerId: 1,
        customerName: "ร้าน A",
        phone: null,
        totalOut: 60,
        totalReturn: 12,
        totalAdjust: 0,
        netMovement: 48,
        previousOut: 30,
        outDelta: 30,
        outDeltaPct: 100,
        hasBigChange: true,
      },
      {
        customerId: 2,
        customerName: "ร้าน B",
        phone: "0890000000",
        totalOut: 10,
        totalReturn: 3,
        totalAdjust: -1,
        netMovement: 6,
        previousOut: 0,
        outDelta: 10,
        outDeltaPct: null,
        hasBigChange: false,
      },
    ]);
  });
});
