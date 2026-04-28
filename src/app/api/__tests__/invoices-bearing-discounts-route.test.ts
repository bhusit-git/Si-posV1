import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireManagerUp: vi.fn(),
  requireFactoryReadContext: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireManagerUp: mocks.requireManagerUp,
}));

vi.mock("@/lib/factory-context", () => ({
  requireFactoryReadContext: mocks.requireFactoryReadContext,
}));

import { GET } from "@/app/api/invoices/bearing-discounts/route";

function makeRequest(query = "", cookie = "superice_factory=bearing") {
  const suffix = query ? `?${query}` : "";
  return new NextRequest(`http://localhost/api/invoices/bearing-discounts${suffix}`, {
    headers: { Cookie: cookie },
  });
}

function buildDb(rows: Array<Record<string, unknown>>) {
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(async () => rows),
  };
  return {
    select: vi.fn(() => chain),
  };
}

describe("GET /api/invoices/bearing-discounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireManagerUp.mockResolvedValue({
      user: { id: 5, username: "manager-bearing", role: "manager", factoryKey: "bearing" },
    });
  });

  it("returns exact audit-backed Bearing discount rows and daily totals", async () => {
    const db = buildDb([
      {
        transactionId: 101,
        status: "paid",
        details: {
          bearingDiscount: {
            transactionId: 101,
            billNumber: "0042",
            customerId: 12,
            customerName: "Bearing Shop",
            saleDate: "2026-04-26",
            saleTime: "08:30:00",
            originalSubtotal: 1670,
            discountAmount: 240,
            finalSubtotal: 1430,
          },
        },
      },
      {
        transactionId: 102,
        status: "paid",
        details: {
          bearingDiscount: {
            transactionId: 102,
            billNumber: "0043",
            customerId: 13,
            customerName: "Bearing Cafe",
            saleDate: "2026-04-26",
            saleTime: "09:10:00",
            originalSubtotal: 2000,
            discountAmount: 100,
            finalSubtotal: 1900,
          },
        },
      },
    ]);
    mocks.requireFactoryReadContext.mockReturnValue({ factoryKey: "bearing", db });

    const res = await GET(makeRequest("startDate=2026-04-26&endDate=2026-04-26"));
    const body = (await res.json()) as {
      rows: Array<{ billNumber: string; discountAmount: number }>;
      dailyTotals: Array<{ saleDate: string; discountAmount: number; rowCount: number }>;
      grandTotalDiscount: number;
    };

    expect(res.status).toBe(200);
    expect(body.rows.map((row) => row.billNumber)).toEqual(["0042", "0043"]);
    expect(body.grandTotalDiscount).toBe(340);
    expect(body.dailyTotals).toEqual([
      { saleDate: "2026-04-26", discountAmount: 340, rowCount: 2 },
    ]);
    expect(db.select).toHaveBeenCalled();
  });

  it("rejects non-Bearing factories", async () => {
    mocks.requireFactoryReadContext.mockReturnValue({ factoryKey: "si", db: buildDb([]) });

    const res = await GET(makeRequest("startDate=2026-04-26&endDate=2026-04-26", "superice_factory=si"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(404);
    expect(body.error).toBe("Bearing discounts are only available for Bearing");
  });

  it("returns auth errors from requireManagerUp", async () => {
    mocks.requireManagerUp.mockResolvedValueOnce({
      error: NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 }),
    });

    const res = await GET(makeRequest("startDate=2026-04-26&endDate=2026-04-26"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("ไม่ได้เข้าสู่ระบบ");
  });
});
