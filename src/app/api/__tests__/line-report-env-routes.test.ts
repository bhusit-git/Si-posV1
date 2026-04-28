import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getDbForFactory: vi.fn(),
  getFactories: vi.fn(),
  buildDailySummaryText: vi.fn(),
  buildWeeklyBriefingText: vi.fn(),
  pushLineTextMessage: vi.fn(),
}));

vi.mock("@/db", () => ({
  getDbForFactory: mocks.getDbForFactory,
  getFactories: mocks.getFactories,
}));

vi.mock("@/lib/line-daily-summary", () => ({
  buildDailySummaryText: mocks.buildDailySummaryText,
}));

vi.mock("@/lib/line-weekly-briefing", () => ({
  buildWeeklyBriefingText: mocks.buildWeeklyBriefingText,
}));

vi.mock("@/lib/line-report-utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/line-report-utils")>(
    "@/lib/line-report-utils"
  );

  return {
    ...actual,
    getDateInTimezone: vi.fn(() => "2026-04-10"),
    getPreviousCompletedIsoWeekRange: vi.fn(() => ({
      weekStart: "2026-03-30",
      weekEnd: "2026-04-05",
      previousWeekStart: "2026-03-23",
      previousWeekEnd: "2026-03-29",
    })),
    pushLineTextMessage: mocks.pushLineTextMessage,
  };
});

import { GET as getDailySummary } from "@/app/api/line/daily-summary/route";
import { POST as postWeeklyBriefing } from "@/app/api/line/weekly-briefing/route";

function setEnv(name: string, value: string) {
  Reflect.set(process.env, name, value);
}

function createSelectDb(results: unknown[]) {
  let index = 0;

  return {
    select() {
      const result = results[index++];
      const builder = {
        from: () => builder,
        innerJoin: () => builder,
        leftJoin: () => builder,
        where: () => Promise.resolve(result),
      };
      return builder;
    },
  };
}

describe("LINE report routes env integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    delete process.env.LINE_CHANNEL_ACCESS_TOKEN;
    delete process.env.LINE_REPORT_CRON_TOKEN;
    delete process.env.LINE_WEEKLY_BRIEFING_CRON_TOKEN;
    delete process.env.LINE_REPORT_FACTORY_KEYS;
    delete process.env.LINE_WEEKLY_FACTORY_KEYS;
    delete process.env.LINE_REPORT_TARGET_IDS;
    delete process.env.LINE_REPORT_TARGET_IDS_KTK;
    delete process.env.LINE_WEEKLY_TARGET_IDS;
    delete process.env.LINE_WEEKLY_TARGET_IDS_SI;

    mocks.getFactories.mockReturnValue([
      { key: "si", name: "SI" },
      { key: "ktk", name: "KTK" },
    ]);
    mocks.getDbForFactory.mockImplementation(() =>
      createSelectDb([
        [{ orders: 8, revenue: 5000, cashReceived: 4500, activeCustomers: 6 }],
        [{ orders: 10 }],
        [{ units: 123 }],
        [{ overdueCustomers: 1, overdueOutstanding: 800 }],
      ])
    );
    mocks.buildDailySummaryText.mockReturnValue({
      text: "Daily summary",
      alerts: [],
    });
    mocks.buildWeeklyBriefingText.mockReturnValue({
      text: "Weekly briefing",
      alerts: [],
    });
    mocks.pushLineTextMessage.mockResolvedValue(undefined);
    setEnv("NODE_ENV", "test");
  });

  it("returns 500 when the daily cron token is not configured", async () => {
    const req = new NextRequest("http://localhost/api/line/daily-summary", {
      headers: { "x-cron-token": "abc" },
    });

    const res = await getDailySummary(req);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(body.error).toBe("LINE_REPORT_CRON_TOKEN is not configured");
  });

  it("uses selected factories and per-factory daily targets", async () => {
    process.env.LINE_REPORT_CRON_TOKEN = "daily-token";
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-token";
    process.env.LINE_REPORT_TARGET_IDS = "default-target";
    process.env.LINE_REPORT_TARGET_IDS_KTK = "ktk-target";

    const req = new NextRequest(
      "http://localhost/api/line/daily-summary?factories=ktk",
      { headers: { "x-cron-token": "daily-token" } }
    );

    const res = await getDailySummary(req);
    const body = (await res.json()) as {
      ok: boolean;
      sentMessages: number;
      factories: Array<{ factoryKey: string; targetCount: number }>;
    };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.factories).toEqual([
      {
        factoryKey: "ktk",
        factoryName: "KTK",
        targetCount: 1,
        alerts: [],
      },
    ]);
    expect(body.sentMessages).toBe(1);
    expect(mocks.pushLineTextMessage).toHaveBeenCalledWith(
      "line-token",
      "ktk-target",
      expect.stringContaining("[KTK]")
    );
    expect(mocks.buildDailySummaryText).toHaveBeenCalledWith(
      expect.objectContaining({
        yesterdayOrders: 8,
        yesterdayUnits: 123,
        activeCustomers: 6,
      })
    );
  });

  it("falls back to the daily token and daily per-factory targets for weekly briefings", async () => {
    process.env.LINE_REPORT_CRON_TOKEN = "daily-token";
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-token";
    process.env.LINE_REPORT_TARGET_IDS_SI = "si-daily";

    const req = new NextRequest(
      "http://localhost/api/line/weekly-briefing?factories=si",
      { method: "POST", headers: { "x-cron-token": "daily-token" } }
    );

    const res = await postWeeklyBriefing(req);
    const body = (await res.json()) as {
      ok: boolean;
      sentMessages: number;
      factories: Array<{ factoryKey: string; targetCount: number }>;
    };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.factories).toEqual([
      {
        factoryKey: "si",
        factoryName: "SI",
        targetCount: 1,
        alerts: [],
      },
    ]);
    expect(body.sentMessages).toBe(1);
    expect(mocks.pushLineTextMessage).toHaveBeenCalledWith(
      "line-token",
      "si-daily",
      expect.stringContaining("[SI]")
    );
  });
});
