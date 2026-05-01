import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireManagerUp: vi.fn(),
  resolveSupplyReadContext: vi.fn(),
  getStockBalances: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireManagerUp: mocks.requireManagerUp,
}));

vi.mock("@/lib/supply/route-helpers", () => ({
  parseBooleanFlag: (value: string | null) => value === "1" || value === "true",
  resolveSupplyReadContext: mocks.resolveSupplyReadContext,
}));

vi.mock("@/lib/supply/stock-engine", () => ({
  getStockBalances: mocks.getStockBalances,
}));

import { GET } from "@/app/api/supply/stock/route";

describe("GET /api/supply/stock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireManagerUp.mockResolvedValue({
      user: { id: 8, username: "manager", role: "manager", factoryKey: "si" },
    });
    mocks.resolveSupplyReadContext.mockReturnValue({
      factoryKey: "si",
      db: { tag: "db" },
    });
  });

  it("filters to low-stock rows when lowOnly=true", async () => {
    mocks.getStockBalances.mockResolvedValue([
      { item: { id: 1, name: "A", unit: "ชิ้น", category: null }, balance: 2, threshold: 3, isLow: true, lastMovementAt: null },
      { item: { id: 2, name: "B", unit: "กล่อง", category: null }, balance: 9, threshold: 3, isLow: false, lastMovementAt: null },
    ]);

    const res = await GET(new NextRequest("http://localhost/api/supply/stock?lowOnly=true"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ item: { id: 1 }, isLow: true });
    expect(mocks.getStockBalances).toHaveBeenCalledWith({ tag: "db" }, "si");
  });

  it("returns auth error when manager access is denied", async () => {
    mocks.requireManagerUp.mockResolvedValueOnce({
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    });

    const res = await GET(new NextRequest("http://localhost/api/supply/stock"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("forbidden");
    expect(mocks.resolveSupplyReadContext).not.toHaveBeenCalled();
    expect(mocks.getStockBalances).not.toHaveBeenCalled();
  });
});
