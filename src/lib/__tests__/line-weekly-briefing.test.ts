import { describe, it, expect } from "vitest";
import {
  buildWeeklyBriefingText,
  computeWeeklyChangePct,
} from "@/lib/line-weekly-briefing";

describe("line-weekly-briefing", () => {
  it("computes weekly change percentage", () => {
    expect(computeWeeklyChangePct(85, 100)).toBe(-15);
    expect(computeWeeklyChangePct(125, 100)).toBe(25);
    expect(computeWeeklyChangePct(10, 0)).toBeNull();
  });

  it("raises a revenue decline alert when drop meets threshold", () => {
    const result = buildWeeklyBriefingText({
      weekStart: "2026-03-09",
      weekEnd: "2026-03-15",
      previousWeekStart: "2026-03-02",
      previousWeekEnd: "2026-03-08",
      weekOrders: 320,
      previousWeekOrders: 350,
      weekRevenue: 85000,
      previousWeekRevenue: 100000,
      weekCashReceived: 70000,
      activeCustomers: 75,
      overdueCustomers: 0,
      overdueOutstanding: 0,
      declineThresholdPct: 15,
    });

    expect(result.alerts.some((alert) => alert.code === "revenue_decline")).toBe(true);
    expect(result.text).toContain("Revenue declined 15.0%");
  });

  it("includes overdue credit alert and active customer line", () => {
    const result = buildWeeklyBriefingText({
      weekStart: "2026-03-09",
      weekEnd: "2026-03-15",
      previousWeekStart: "2026-03-02",
      previousWeekEnd: "2026-03-08",
      weekOrders: 200,
      previousWeekOrders: 0,
      weekRevenue: 50000,
      previousWeekRevenue: 0,
      weekCashReceived: 40000,
      activeCustomers: 54,
      overdueCustomers: 3,
      overdueOutstanding: 12500,
    });

    expect(result.alerts.some((alert) => alert.code === "overdue_credit")).toBe(true);
    expect(result.text).toContain("Active customers: 54");
    expect(result.text).toContain("vs prev week: n/a");
  });
});
