import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  getDbForFactory: vi.fn(),
  getFactories: vi.fn(),
  getDb: vi.fn(),
  loadForecastArtifact: vi.fn(),
  persistForecastArtifact: vi.fn(),
  tomorrowInBangkok: vi.fn(),
  getForecastSnapshot: vi.fn(),
  parseDryRun: vi.fn(),
  parseFactoryKeys: vi.fn(),
  readCronToken: vi.fn(),
  requireOfficeUp: vi.fn(),
}));

vi.mock("@/db", () => ({
  getDbForFactory: mocks.getDbForFactory,
  getFactories: mocks.getFactories,
  getDb: mocks.getDb,
}));

vi.mock("@/lib/forecast-service", () => ({
  loadForecastArtifact: mocks.loadForecastArtifact,
  persistForecastArtifact: mocks.persistForecastArtifact,
  tomorrowInBangkok: mocks.tomorrowInBangkok,
  getForecastSnapshot: mocks.getForecastSnapshot,
}));

vi.mock("@/lib/line-report-utils", () => ({
  parseDryRun: mocks.parseDryRun,
  parseFactoryKeys: mocks.parseFactoryKeys,
  readCronToken: mocks.readCronToken,
}));

vi.mock("@/lib/api-auth", () => ({
  requireOfficeUp: mocks.requireOfficeUp,
}));

import { GET as getForecastNextDay } from "@/app/api/forecast/next-day/route";
import { POST as runForecast } from "@/app/api/forecast/run/route";

describe("forecast routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    process.env.FORECAST_CRON_TOKEN = "test-token";
    process.env.FORECAST_DEFAULT_FACTORY_KEY = "si";

    mocks.getFactories.mockReturnValue([{ key: "si", name: "SI" }]);
    mocks.parseFactoryKeys.mockReturnValue(["si"]);
    mocks.tomorrowInBangkok.mockReturnValue("2026-04-01");
    mocks.parseDryRun.mockReturnValue(false);
    mocks.readCronToken.mockReturnValue("test-token");
    mocks.getDbForFactory.mockReturnValue({ tag: "si-db" });
    mocks.getDb.mockResolvedValue({ tag: "session-db" });
    mocks.requireOfficeUp.mockResolvedValue({ user: { id: 1, role: "office" } });
    mocks.loadForecastArtifact.mockResolvedValue({
      factory_key: "si",
      target_date: "2026-04-01",
      generated_at: "2026-03-31T12:00:00Z",
      model_version: "si-20260331",
      model_family: "elasticnet",
      feature_snapshot_hash: "abc",
      confidence: "medium",
      regime_distance: 0.4,
      key_drivers: [],
      data_end_date: "2026-03-31",
      signal_coverage: {
        data_end_date: "2026-03-31",
        weather_forecast_fallback: false,
        groups: {},
      },
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
      ],
    });
    mocks.persistForecastArtifact.mockResolvedValue({
      upserted: 1,
      targetDate: "2026-04-01",
      modelVersion: "si-20260331",
    });
    mocks.getForecastSnapshot.mockResolvedValue({
      targetDate: "2026-04-01",
      modelVersion: "si-20260331",
      modelFamily: "elasticnet",
      dataEndDate: "2026-03-31",
      featureSnapshotHash: "abc",
      confidence: "medium",
      regimeDistance: 0,
      keyDrivers: [],
      signalCoverage: { groups: {} },
      total: {
        predictedUnits: 100,
        predictedUnitsLower: 90,
        predictedUnitsUpper: 110,
        predictedRevenue: 20000,
        predictedRevenueLower: 18000,
        predictedRevenueUpper: 22000,
        confidence: "medium",
      },
      products: [],
    });
  });

  it("POST /api/forecast/run rejects invalid cron token", async () => {
    mocks.readCronToken.mockReturnValue("wrong-token");

    const req = new NextRequest("http://localhost/api/forecast/run", { method: "POST" });
    const res = await runForecast(req);

    expect(res.status).toBe(401);
    expect(mocks.persistForecastArtifact).not.toHaveBeenCalled();
  });

  it("POST /api/forecast/run supports dry-run mode", async () => {
    mocks.parseDryRun.mockReturnValue(true);

    const req = new NextRequest("http://localhost/api/forecast/run?dryRun=1", { method: "POST" });
    const res = await runForecast(req);
    const body = (await res.json()) as {
      dryRun: boolean;
      successCount: number;
      results: Array<{ dryRun?: boolean; ok: boolean }>;
    };

    expect(res.status).toBe(200);
    expect(body.dryRun).toBe(true);
    expect(body.successCount).toBe(1);
    expect(body.results[0].dryRun).toBe(true);
    expect(mocks.persistForecastArtifact).not.toHaveBeenCalled();
  });

  it("POST /api/forecast/run persists forecasts when artifact is fresh", async () => {
    const req = new NextRequest("http://localhost/api/forecast/run", { method: "POST" });
    const res = await runForecast(req);
    const body = (await res.json()) as { successCount: number; failureCount: number };

    expect(res.status).toBe(200);
    expect(body.successCount).toBe(1);
    expect(body.failureCount).toBe(0);
    expect(mocks.persistForecastArtifact).toHaveBeenCalledTimes(1);
  });

  it("POST /api/forecast/run blocks stale artifacts unless allowStale=1", async () => {
    mocks.loadForecastArtifact.mockResolvedValueOnce({
      factory_key: "si",
      target_date: "2026-03-31",
      generated_at: "2026-03-31T00:00:00Z",
      model_version: "si-old",
      model_family: "elasticnet",
      feature_snapshot_hash: "old",
      confidence: "medium",
      regime_distance: 1,
      key_drivers: [],
      data_end_date: "2026-03-30",
      signal_coverage: { groups: {} },
      rows: [
        {
          product_type_id: null,
          product_name: "TOTAL",
          predicted_units: 90,
          predicted_units_lower: 80,
          predicted_units_upper: 100,
          predicted_revenue: 18000,
          predicted_revenue_lower: 16000,
          predicted_revenue_upper: 20000,
          confidence: "medium",
          key_drivers: [],
        },
      ],
    });

    const req = new NextRequest("http://localhost/api/forecast/run", { method: "POST" });
    const res = await runForecast(req);
    const body = (await res.json()) as {
      successCount: number;
      results: Array<{ reason?: string; ok: boolean }>;
    };

    expect(res.status).toBe(500);
    expect(body.successCount).toBe(0);
    expect(body.results[0].reason).toBe("stale_target_date");
    expect(mocks.persistForecastArtifact).not.toHaveBeenCalled();
  });

  it("GET /api/forecast/next-day returns snapshot payload", async () => {
    const req = new NextRequest("http://localhost/api/forecast/next-day?factory=si&targetDate=2026-04-01");
    const res = await getForecastNextDay(req);
    const body = (await res.json()) as {
      ok: boolean;
      snapshot: { modelVersion: string; modelFamily: string; dataEndDate: string };
    };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.snapshot.modelVersion).toBe("si-20260331");
    expect(body.snapshot.modelFamily).toBe("elasticnet");
    expect(body.snapshot.dataEndDate).toBe("2026-03-31");
  });

  it("GET /api/forecast/next-day returns 404 when snapshot missing", async () => {
    mocks.getForecastSnapshot.mockResolvedValueOnce(null);

    const req = new NextRequest("http://localhost/api/forecast/next-day?factory=si");
    const res = await getForecastNextDay(req);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(404);
    expect(body.error).toBe("Forecast not found");
  });

  it("GET /api/forecast/next-day falls back to the configured default factory", async () => {
    const req = new NextRequest("http://localhost/api/forecast/next-day");
    const res = await getForecastNextDay(req);
    const body = (await res.json()) as { ok: boolean; factoryKey: string };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.factoryKey).toBe("si");
    expect(mocks.getDb).toHaveBeenCalled();
    expect(mocks.getDbForFactory).not.toHaveBeenCalled();
    expect(mocks.getForecastSnapshot).toHaveBeenCalledWith(
      { tag: "session-db" },
      "si",
      "2026-04-01"
    );
  });

  it("GET /api/forecast/next-day passes through auth failure", async () => {
    mocks.requireOfficeUp.mockResolvedValueOnce({
      error: NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 }),
    });

    const req = new NextRequest("http://localhost/api/forecast/next-day?factory=si");
    const res = await getForecastNextDay(req);

    expect(res.status).toBe(401);
    expect(mocks.getForecastSnapshot).not.toHaveBeenCalled();
  });
});
