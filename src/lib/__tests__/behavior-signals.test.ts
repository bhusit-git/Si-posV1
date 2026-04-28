import { describe, expect, it } from "vitest";
import {
  buildBehaviorSignalsResponse,
  TRACKED_BEHAVIOR_ACTIONS,
} from "@/lib/behavior-signals";

describe("buildBehaviorSignalsResponse", () => {
  it("computes production KPIs from mixed sales + action inputs", () => {
    const result = buildBehaviorSignalsResponse({
      startDate: "2026-02-01",
      endDate: "2026-02-29",
      txRows: [
        { customerId: 1, totalAmount: 100, status: "paid" },
        { customerId: 1, totalAmount: 300, status: "partial" },
        { customerId: 2, totalAmount: 200, status: "unpaid" },
        { customerId: 99, totalAmount: 999, status: "voided" }, // defensive exclude
      ],
      actionRows: [
        { action: "transaction.create", count: 4 },
        { action: "return.create", count: 1 },
        { action: "price.change", count: 2 },
        { action: "bag.adjust", count: 1 },
        { action: "bag.clear", count: 2 },
        { action: "sync.sale_failed", count: 1 },
      ],
      offlineSyncedSales: 1,
    });

    expect(result.range).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-02-29",
    });

    expect(result.kpis.totalSales).toBe(3);
    expect(result.kpis.avgOrderValue).toBe(200);
    expect(result.kpis.unpaidSales).toBe(2);
    expect(result.kpis.unpaidRatePct).toBeCloseTo(66.666, 2);
    expect(result.kpis.returnEvents).toBe(1);
    expect(result.kpis.returnRatePct).toBe(25);
    expect(result.kpis.offlineSyncedSales).toBe(1);
    expect(result.kpis.offlineSyncRatePct).toBe(25);
    expect(result.kpis.priceChanges).toBe(2);
    expect(result.kpis.bagAdjustments).toBe(3);
    expect(result.kpis.syncFailures).toBe(1);

    expect(result.customerMix).toEqual({
      uniqueCustomers: 2,
      repeatCustomers: 1,
      oneTimeCustomers: 1,
      repeatRatePct: 50,
    });
  });

  it("prevents NaN/Infinity style errors when denominators are zero", () => {
    const result = buildBehaviorSignalsResponse({
      startDate: "2026-02-01",
      endDate: "2026-02-29",
      txRows: [],
      actionRows: [
        { action: "return.create", count: 5 },
        { action: "sync.sale_failed", count: 2 },
      ],
      offlineSyncedSales: 9,
    });

    expect(result.kpis.totalSales).toBe(0);
    expect(result.kpis.avgOrderValue).toBe(0);
    expect(result.kpis.unpaidRatePct).toBe(0);
    expect(result.kpis.returnRatePct).toBe(0);
    expect(result.kpis.offlineSyncRatePct).toBe(0);
    expect(result.customerMix.repeatRatePct).toBe(0);
    expect(Number.isNaN(result.kpis.unpaidRatePct)).toBe(false);
  });

  it("sanitizes malformed counts and amounts for long-term data integrity", () => {
    const result = buildBehaviorSignalsResponse({
      startDate: "2026-02-01",
      endDate: "2026-02-29",
      txRows: [
        { customerId: 10, totalAmount: Number.NaN, status: "paid" },
        { customerId: null, totalAmount: 150, status: "unpaid" },
        { customerId: 0, totalAmount: 50, status: "partial" },
      ],
      actionRows: [
        { action: "transaction.create", count: -10 }, // should clamp to 0
        { action: "return.create", count: 1.9 }, // should floor to 1
        { action: "bag.adjust", count: 2.2 }, // should floor to 2
        { action: "bag.clear", count: -2 }, // should clamp to 0
      ],
      offlineSyncedSales: -5,
    });

    expect(result.kpis.totalSales).toBe(3);
    expect(result.kpis.avgOrderValue).toBeCloseTo(200 / 3, 5);
    expect(result.kpis.unpaidSales).toBe(2);

    expect(result.kpis.returnEvents).toBe(1);
    expect(result.kpis.returnRatePct).toBe(0); // salesFromAudit = 0
    expect(result.kpis.bagAdjustments).toBe(2);
    expect(result.kpis.offlineSyncedSales).toBe(0);

    expect(result.customerMix.uniqueCustomers).toBe(1);
    expect(result.customerMix.repeatCustomers).toBe(0);
    expect(result.customerMix.oneTimeCustomers).toBe(1);
  });

  it("aggregates duplicate action rows to avoid under-counting", () => {
    const result = buildBehaviorSignalsResponse({
      startDate: "2026-02-01",
      endDate: "2026-02-29",
      txRows: [{ customerId: 1, totalAmount: 100, status: "paid" }],
      actionRows: [
        { action: "price.change", count: 1 },
        { action: "price.change", count: 4 },
        { action: "transaction.create", count: 1 },
      ],
      offlineSyncedSales: 0,
    });

    expect(result.kpis.priceChanges).toBe(5);
    expect(result.actionCounts["price.change"]).toBe(5);
  });
});

describe("TRACKED_BEHAVIOR_ACTIONS", () => {
  it("contains critical production actions and has no duplicates", () => {
    const mustHave = [
      "transaction.create",
      "transaction.payment",
      "transaction.void",
      "return.create",
      "price.change",
      "bag.adjust",
      "bag.clear",
      "sync.queued",
      "sync.sync_started",
      "sync.sale_synced",
      "sync.sale_failed",
      "sync.sync_finished",
    ];

    for (const action of mustHave) {
      expect(TRACKED_BEHAVIOR_ACTIONS).toContain(action);
    }

    expect(new Set(TRACKED_BEHAVIOR_ACTIONS).size).toBe(
      TRACKED_BEHAVIOR_ACTIONS.length
    );
  });
});
