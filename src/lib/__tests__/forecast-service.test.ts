import { describe, expect, it, vi } from "vitest";

import { getForecastSnapshot, persistForecastArtifact } from "@/lib/forecast-service";

function makeInsertDb(calls: unknown[]) {
  return {
    insert: vi.fn(() => ({
      values: (value: unknown) => ({
        onConflictDoUpdate: vi.fn(async () => {
          calls.push(value);
        }),
      }),
    })),
  };
}

function makeSelectDb(rows: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          orderBy: async () => rows,
        }),
      }),
    })),
  };
}

function makeThrowingSelectDb(error: unknown) {
  return {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          orderBy: vi.fn(async () => {
            throw error;
          }),
        }),
      }),
    })),
  };
}

describe("forecast-service", () => {
  it("deduplicates rows by product key before upsert (idempotency guard)", async () => {
    const calls: unknown[] = [];
    const db = makeInsertDb(calls) as never;

    await persistForecastArtifact(db, "si", {
      factory_key: "si",
      target_date: "2026-04-01",
      generated_at: "2026-03-31T12:00:00Z",
      model_version: "si-20260331",
      model_family: "",
      feature_snapshot_hash: "abc123",
      confidence: "medium",
      regime_distance: 0.5,
      key_drivers: [],
      data_end_date: "",
      signal_coverage: {},
      rows: [
        {
          product_type_id: null,
          product_name: "TOTAL",
          predicted_units: 100,
          predicted_units_lower: 90,
          predicted_units_upper: 110,
          predicted_revenue: 20000,
          predicted_revenue_lower: 18000,
          predicted_revenue_upper: 22000,
          confidence: "medium",
          key_drivers: [],
        },
        {
          product_type_id: 1,
          product_name: "Unit",
          predicted_units: 80,
          predicted_units_lower: 70,
          predicted_units_upper: 90,
          predicted_revenue: 16000,
          predicted_revenue_lower: 14000,
          predicted_revenue_upper: 18000,
          confidence: "medium",
          key_drivers: [],
        },
        {
          product_type_id: 1,
          product_name: "Unit",
          predicted_units: 81,
          predicted_units_lower: 71,
          predicted_units_upper: 91,
          predicted_revenue: 16100,
          predicted_revenue_lower: 14100,
          predicted_revenue_upper: 18100,
          confidence: "high",
          key_drivers: [],
        },
      ],
    });

    expect(calls).toHaveLength(2);
    const keys = (calls as Array<{ productKey: string }>).map((c) => c.productKey).sort();
    expect(keys).toEqual(["product:1", "total"]);
  });

  it("returns normalized snapshot with total row and products", async () => {
    const db = makeSelectDb([
      {
        productTypeId: null,
        productName: "TOTAL",
        predictedUnits: 100,
        predictedUnitsLower: 90,
        predictedUnitsUpper: 110,
        predictedRevenue: 20000,
        predictedRevenueLower: 18000,
        predictedRevenueUpper: 22000,
        confidence: "medium",
        keyDrivers: [{ feature: "lag1_revenue" }],
        modelVersion: "si-20260331",
        modelFamily: "elasticnet",
        featureSnapshotHash: "abc",
        dataEndDate: "2026-03-31",
        signalCoverage: {
          source_data_stale: true,
          weather_forecast_source: "fallback_history",
          weather_forecast_fallback: true,
          groups: {
            weather: { avg_non_null_ratio: 1 },
            price: { avg_non_null_ratio: 0.6 },
            operations: { avg_non_null_ratio: 0.7 },
          },
        },
        sourceGeneratedAt: new Date("2026-03-31T12:00:00Z"),
        targetDate: "2026-04-01",
        productKey: "total",
        createdAt: new Date("2026-03-31T12:00:00Z"),
        updatedAt: new Date("2026-03-31T12:00:00Z"),
      },
      {
        productTypeId: 1,
        productName: "Unit",
        predictedUnits: 80,
        predictedUnitsLower: 70,
        predictedUnitsUpper: 90,
        predictedRevenue: 16000,
        predictedRevenueLower: 14000,
        predictedRevenueUpper: 18000,
        confidence: "high",
        keyDrivers: [],
        modelVersion: "si-20260331",
        modelFamily: "elasticnet",
        featureSnapshotHash: "abc",
        dataEndDate: "2026-03-31",
        signalCoverage: {},
        sourceGeneratedAt: new Date("2026-03-31T12:00:00Z"),
        targetDate: "2026-04-01",
        productKey: "product:1",
        createdAt: new Date("2026-03-31T12:00:00Z"),
        updatedAt: new Date("2026-03-31T12:00:00Z"),
      },
    ]) as never;

    const snapshot = await getForecastSnapshot(db, "si", "2026-04-01");
    expect(snapshot).not.toBeNull();
    expect(snapshot?.modelVersion).toBe("si-20260331");
    expect(snapshot?.modelFamily).toBe("elasticnet");
    expect(snapshot?.dataEndDate).toBe("2026-03-31");
    expect(snapshot?.total?.predictedRevenue).toBe(20000);
    expect(snapshot?.total?.confidence).toBe("low");
    expect(snapshot?.products).toHaveLength(2);
    expect(snapshot?.products[1].productTypeId).toBe(1);
  });

  it("downgrades confidence when source history is stale even without weather fallback", async () => {
    const db = makeSelectDb([
      {
        productTypeId: null,
        productName: "TOTAL",
        predictedUnits: 100,
        predictedUnitsLower: 90,
        predictedUnitsUpper: 110,
        predictedRevenue: 20000,
        predictedRevenueLower: 18000,
        predictedRevenueUpper: 22000,
        confidence: "high",
        keyDrivers: [],
        modelVersion: "si-20260331",
        modelFamily: "elasticnet",
        featureSnapshotHash: "abc",
        dataEndDate: "2026-03-24",
        signalCoverage: {
          source_data_stale: true,
          weather_forecast_source: "cache",
          groups: {},
        },
        sourceGeneratedAt: new Date("2026-03-31T12:00:00Z"),
        targetDate: "2026-04-01",
        productKey: "total",
        createdAt: new Date("2026-03-31T12:00:00Z"),
        updatedAt: new Date("2026-03-31T12:00:00Z"),
      },
    ]) as never;

    const snapshot = await getForecastSnapshot(db, "si", "2026-04-01");
    expect(snapshot?.total?.confidence).toBe("medium");
  });

  it("returns null when the forecast_outputs table is missing", async () => {
    const db = makeThrowingSelectDb({
      message: 'relation "forecast_outputs" does not exist',
      cause: { code: "42P01" },
    }) as never;

    const snapshot = await getForecastSnapshot(db, "si", "2026-04-03");
    expect(snapshot).toBeNull();
  });
});
