import { describe, it, expect } from "vitest";

/**
 * Display / factory kiosk logic tests.
 * Tests loaded qty capping, negative delta handling, FIFO ordering,
 * summary percentage calculation, and timezone date boundaries.
 */

// ---- Loaded qty capping logic (mirrors display/route.ts POST) ----

function computeNewLoaded(
  currentLoaded: number,
  orderedQty: number,
  delta: number
): number {
  return Math.max(0, Math.min(orderedQty, currentLoaded + delta));
}

// ---- FIFO ordering ----

interface DisplayOrder {
  id: number;
  saleDate: string;
  saleTime: string;
  fulfillment: "pending" | "loaded" | null;
}

function sortFIFO(orders: DisplayOrder[]): DisplayOrder[] {
  return [...orders].sort((a, b) => {
    // pending first, then loaded
    if (a.fulfillment === "pending" && b.fulfillment !== "pending") return -1;
    if (a.fulfillment !== "pending" && b.fulfillment === "pending") return 1;
    // Within same status, FIFO by date/time
    if (a.saleDate !== b.saleDate) return a.saleDate.localeCompare(b.saleDate);
    return a.saleTime.localeCompare(b.saleTime);
  });
}

// ---- Summary percentage ----

function computeSummaryPercentage(
  items: { quantity: number; loadedQty: number }[]
): number {
  const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
  if (totalQty === 0) return 100;
  const totalLoaded = items.reduce((sum, i) => sum + i.loadedQty, 0);
  return Math.round((totalLoaded / totalQty) * 100);
}

// ---- Today's date in ICT timezone ----

function todayInICT(nowUtc: Date): string {
  // Convert to ICT (UTC+7)
  const ict = new Date(nowUtc.getTime() + 7 * 60 * 60 * 1000);
  return ict.toISOString().slice(0, 10);
}

const FACTORY_BAY_COUNT = 6;

interface BayOrderInput {
  id: number;
  customerName: string;
  saleTime: string;
  row: number | null;
  items: { productTypeId: number; productName: string; quantity: number; loadedQty: number }[];
}

interface BayBucketOutput {
  bay: number | null;
  orderCount: number;
  totalOrderedQty: number;
  totalLoadedQty: number;
  totalRemainingQty: number;
  items: {
    productTypeId: number;
    productName: string;
    totalOrderedQty: number;
    totalLoadedQty: number;
    totalRemainingQty: number;
  }[];
}

function summarizeOrdersByBay(orders: BayOrderInput[]): {
  bays: BayBucketOutput[];
  unassigned: BayBucketOutput;
} {
  const initBucket = (bay: number | null): BayBucketOutput => ({
    bay,
    orderCount: 0,
    totalOrderedQty: 0,
    totalLoadedQty: 0,
    totalRemainingQty: 0,
    items: [],
  });

  const buckets = new Map<number, BayBucketOutput>();
  const itemMaps = new Map<number | null, Map<number, BayBucketOutput["items"][number]>>();
  for (let bay = 1; bay <= FACTORY_BAY_COUNT; bay += 1) {
    buckets.set(bay, initBucket(bay));
    itemMaps.set(bay, new Map());
  }
  const unassigned = initBucket(null);
  itemMaps.set(null, new Map());

  for (const order of orders) {
    const bay = Number.isInteger(order.row) && order.row! >= 1 && order.row! <= FACTORY_BAY_COUNT
      ? (order.row as number)
      : null;
    const bucket = bay !== null ? buckets.get(bay)! : unassigned;
    const itemMap = itemMaps.get(bay !== null ? bay : null)!;

    bucket.orderCount += 1;

    for (const item of order.items) {
      const ordered = item.quantity;
      const loaded = Math.max(0, Math.min(item.quantity, item.loadedQty));
      const remaining = Math.max(0, ordered - loaded);

      bucket.totalOrderedQty += ordered;
      bucket.totalLoadedQty += loaded;
      bucket.totalRemainingQty += remaining;

      const existing = itemMap.get(item.productTypeId);
      if (existing) {
        existing.totalOrderedQty += ordered;
        existing.totalLoadedQty += loaded;
        existing.totalRemainingQty += remaining;
      } else {
        itemMap.set(item.productTypeId, {
          productTypeId: item.productTypeId,
          productName: item.productName,
          totalOrderedQty: ordered,
          totalLoadedQty: loaded,
          totalRemainingQty: remaining,
        });
      }
    }
  }

  for (const [bay, bucket] of buckets) {
    const itemMap = itemMaps.get(bay)!;
    bucket.items = [...itemMap.values()];
  }
  unassigned.items = [...itemMaps.get(null)!.values()];

  return { bays: [...buckets.values()], unassigned };
}

describe("Display Logic", () => {
  describe("loaded qty capping", () => {
    it("increment within bounds", () => {
      expect(computeNewLoaded(3, 10, 1)).toBe(4);
    });

    it("decrement within bounds", () => {
      expect(computeNewLoaded(3, 10, -1)).toBe(2);
    });

    it("cannot exceed ordered quantity", () => {
      expect(computeNewLoaded(9, 10, 5)).toBe(10);
    });

    it("cannot go below zero", () => {
      expect(computeNewLoaded(2, 10, -5)).toBe(0);
    });

    it("delta of zero keeps current value", () => {
      expect(computeNewLoaded(5, 10, 0)).toBe(5);
    });

    it("already at max, positive delta stays at max", () => {
      expect(computeNewLoaded(10, 10, 1)).toBe(10);
    });

    it("already at zero, negative delta stays at zero", () => {
      expect(computeNewLoaded(0, 10, -3)).toBe(0);
    });

    it("ordered qty of 0, loaded stays at 0", () => {
      expect(computeNewLoaded(0, 0, 5)).toBe(0);
    });

    it("negative delta larger than current loaded", () => {
      expect(computeNewLoaded(3, 100, -10)).toBe(0);
    });

    it("large delta capped at ordered", () => {
      expect(computeNewLoaded(0, 50, 999)).toBe(50);
    });
  });

  describe("FIFO ordering", () => {
    it("pending orders come before loaded", () => {
      const orders: DisplayOrder[] = [
        { id: 1, saleDate: "2026-02-14", saleTime: "08:00", fulfillment: "loaded" },
        { id: 2, saleDate: "2026-02-14", saleTime: "09:00", fulfillment: "pending" },
      ];
      const sorted = sortFIFO(orders);
      expect(sorted[0].id).toBe(2);
      expect(sorted[1].id).toBe(1);
    });

    it("within pending, earliest first", () => {
      const orders: DisplayOrder[] = [
        { id: 1, saleDate: "2026-02-14", saleTime: "10:00", fulfillment: "pending" },
        { id: 2, saleDate: "2026-02-14", saleTime: "08:00", fulfillment: "pending" },
        { id: 3, saleDate: "2026-02-14", saleTime: "09:00", fulfillment: "pending" },
      ];
      const sorted = sortFIFO(orders);
      expect(sorted.map((o) => o.id)).toEqual([2, 3, 1]);
    });

    it("cross-day ordering", () => {
      const orders: DisplayOrder[] = [
        { id: 1, saleDate: "2026-02-15", saleTime: "08:00", fulfillment: "pending" },
        { id: 2, saleDate: "2026-02-14", saleTime: "23:00", fulfillment: "pending" },
      ];
      const sorted = sortFIFO(orders);
      expect(sorted[0].id).toBe(2);
    });

    it("null fulfillment treated as non-pending", () => {
      const orders: DisplayOrder[] = [
        { id: 1, saleDate: "2026-02-14", saleTime: "08:00", fulfillment: null },
        { id: 2, saleDate: "2026-02-14", saleTime: "09:00", fulfillment: "pending" },
      ];
      const sorted = sortFIFO(orders);
      expect(sorted[0].id).toBe(2);
    });

    it("empty list returns empty", () => {
      expect(sortFIFO([])).toEqual([]);
    });
  });

  describe("summary percentage", () => {
    it("100% when all loaded", () => {
      const items = [
        { quantity: 10, loadedQty: 10 },
        { quantity: 5, loadedQty: 5 },
      ];
      expect(computeSummaryPercentage(items)).toBe(100);
    });

    it("0% when nothing loaded", () => {
      const items = [{ quantity: 10, loadedQty: 0 }];
      expect(computeSummaryPercentage(items)).toBe(0);
    });

    it("50% when half loaded", () => {
      const items = [
        { quantity: 10, loadedQty: 5 },
        { quantity: 10, loadedQty: 5 },
      ];
      expect(computeSummaryPercentage(items)).toBe(50);
    });

    it("rounds to nearest integer", () => {
      const items = [{ quantity: 3, loadedQty: 1 }];
      expect(computeSummaryPercentage(items)).toBe(33);
    });

    it("empty items = 100%", () => {
      expect(computeSummaryPercentage([])).toBe(100);
    });

    it("all zero quantities = 100%", () => {
      const items = [{ quantity: 0, loadedQty: 0 }];
      expect(computeSummaryPercentage(items)).toBe(100);
    });
  });

  describe("timezone date boundary", () => {
    it("midnight UTC is morning in ICT", () => {
      const utcMidnight = new Date("2026-02-14T00:00:00Z");
      expect(todayInICT(utcMidnight)).toBe("2026-02-14");
    });

    it("23:00 UTC is next day in ICT", () => {
      const utc23 = new Date("2026-02-14T23:00:00Z");
      expect(todayInICT(utc23)).toBe("2026-02-15");
    });

    it("17:00 UTC is midnight in ICT (date boundary)", () => {
      const utc17 = new Date("2026-02-14T17:00:00Z");
      expect(todayInICT(utc17)).toBe("2026-02-15");
    });

    it("16:59 UTC is still same day in ICT", () => {
      const utc1659 = new Date("2026-02-14T16:59:59Z");
      expect(todayInICT(utc1659)).toBe("2026-02-14");
    });

    it("new year boundary", () => {
      const utcNye = new Date("2025-12-31T18:00:00Z");
      expect(todayInICT(utcNye)).toBe("2026-01-01");
    });
  });

  describe("bay board grouping", () => {
    it("groups pending orders into bays 1-6 and computes totals", () => {
      const source: BayOrderInput[] = [
        {
          id: 101,
          customerName: "A",
          saleTime: "08:00",
          row: 1,
          items: [
            { productTypeId: 1, productName: "ซอง", quantity: 10, loadedQty: 4 },
            { productTypeId: 2, productName: "หลอด", quantity: 5, loadedQty: 5 },
          ],
        },
        {
          id: 102,
          customerName: "B",
          saleTime: "08:10",
          row: 1,
          items: [{ productTypeId: 1, productName: "ซอง", quantity: 6, loadedQty: 1 }],
        },
        {
          id: 103,
          customerName: "C",
          saleTime: "08:20",
          row: 4,
          items: [{ productTypeId: 3, productName: "เกล็ด", quantity: 8, loadedQty: 3 }],
        },
      ];

      const summary = summarizeOrdersByBay(source);
      const bay1 = summary.bays.find((b) => b.bay === 1)!;
      const bay4 = summary.bays.find((b) => b.bay === 4)!;

      expect(bay1.orderCount).toBe(2);
      expect(bay1.totalOrderedQty).toBe(21);
      expect(bay1.totalLoadedQty).toBe(10);
      expect(bay1.totalRemainingQty).toBe(11);
      expect(bay1.items.find((i) => i.productTypeId === 1)?.totalRemainingQty).toBe(11);

      expect(bay4.orderCount).toBe(1);
      expect(bay4.totalRemainingQty).toBe(5);
    });

    it("routes null and legacy/out-of-range rows to unassigned", () => {
      const source: BayOrderInput[] = [
        {
          id: 201,
          customerName: "No Bay",
          saleTime: "09:00",
          row: null,
          items: [{ productTypeId: 1, productName: "ซอง", quantity: 3, loadedQty: 1 }],
        },
        {
          id: 202,
          customerName: "Legacy",
          saleTime: "09:10",
          row: 15,
          items: [{ productTypeId: 2, productName: "หลอด", quantity: 4, loadedQty: 0 }],
        },
      ];

      const summary = summarizeOrdersByBay(source);
      expect(summary.unassigned.orderCount).toBe(2);
      expect(summary.unassigned.totalOrderedQty).toBe(7);
      expect(summary.unassigned.totalLoadedQty).toBe(1);
      expect(summary.unassigned.totalRemainingQty).toBe(6);
      expect(summary.unassigned.items.map((item) => item.productTypeId).sort((a, b) => a - b)).toEqual([1, 2]);
    });
  });
});
