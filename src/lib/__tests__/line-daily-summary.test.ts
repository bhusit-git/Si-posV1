import { describe, it, expect } from "vitest";
import { buildDailySummaryText, computeOrderChangePct } from "@/lib/line-daily-summary";

describe("line-daily-summary", () => {
  it("computes order change percentage", () => {
    expect(computeOrderChangePct(70, 100)).toBe(-30);
    expect(computeOrderChangePct(120, 100)).toBe(20);
    expect(computeOrderChangePct(10, 0)).toBeNull();
  });

  it("raises decline alert when drop is 30% or more", () => {
    const result = buildDailySummaryText({
      reportDate: "2026-02-28",
      yesterdayOrders: 70,
      yesterdayUnits: 140,
      activeCustomers: 25,
      previousOrders: 100,
      yesterdayRevenue: 7000,
      yesterdayCashReceived: 6500,
      overdueCustomers: 0,
      overdueOutstanding: 0,
      declineThresholdPct: 30,
    });

    expect(result.alerts.some((a) => a.code === "order_decline")).toBe(true);
    expect(result.text).toContain("Orders declined 30.0%");
  });

  it("does not raise decline alert when previous day has zero orders", () => {
    const result = buildDailySummaryText({
      reportDate: "2026-02-28",
      yesterdayOrders: 5,
      yesterdayUnits: 12,
      activeCustomers: 4,
      previousOrders: 0,
      yesterdayRevenue: 500,
      yesterdayCashReceived: 500,
      overdueCustomers: 0,
      overdueOutstanding: 0,
    });

    expect(result.alerts.some((a) => a.code === "order_decline")).toBe(false);
    expect(result.text).toContain("vs prev day: n/a");
  });

  it("includes overdue credit alert as second alert", () => {
    const result = buildDailySummaryText({
      reportDate: "2026-02-28",
      yesterdayOrders: 60,
      yesterdayUnits: 180,
      activeCustomers: 33,
      previousOrders: 100,
      yesterdayRevenue: 10000,
      yesterdayCashReceived: 8000,
      overdueCustomers: 3,
      overdueOutstanding: 15000,
    });

    const codes = result.alerts.map((a) => a.code);
    expect(codes).toContain("order_decline");
    expect(codes).toContain("overdue_credit");
    expect(result.text).toContain("Units: 180");
    expect(result.text).toContain("Customers: 33");
    expect(result.text).toContain("customer(s) have overdue credit >60 days");
  });
});
