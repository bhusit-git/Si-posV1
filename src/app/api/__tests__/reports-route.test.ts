import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireManagerUp: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireManagerUp: mocks.requireManagerUp,
}));

vi.mock("@/db", () => ({
  getDb: mocks.getDb,
}));

import { GET } from "@/app/api/reports/route";

function makeRequest(query = "") {
  const suffix = query ? `?${query}` : "";
  return new NextRequest(`http://localhost/api/reports${suffix}`);
}

function buildByCustomerQuery(rows: Array<Record<string, unknown>>) {
  const chain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    groupBy: vi.fn(() => chain),
    orderBy: vi.fn(async () => rows),
  };
  return chain;
}

describe("GET /api/reports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireManagerUp.mockResolvedValue({
      user: { id: 5, username: "manager", role: "manager", factoryKey: "si" },
    });
  });

  it("supports comma-separated customer ids for by-customer reports", async () => {
    const rows = [
      { customerId: 101, customerName: "Alpha", totalTransactions: 3, totalAmount: 3000 },
      { customerId: 102, customerName: "Beta", totalTransactions: 2, totalAmount: 2200 },
    ];
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => buildByCustomerQuery(rows)),
    });

    const res = await GET(
      makeRequest("type=byCustomer&startDate=2026-03-01&endDate=2026-03-31&customerQuery=%23101,%20%23102")
    );
    const body = (await res.json()) as Array<{ customerId: number }>;

    expect(res.status).toBe(200);
    expect(body.map((row) => row.customerId)).toEqual([101, 102]);
  });

  it("keeps single-name filtering working for by-customer reports", async () => {
    const rows = [{ customerId: 77, customerName: "Alpha Co", totalTransactions: 1, totalAmount: 500 }];
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => buildByCustomerQuery(rows)),
    });

    const res = await GET(
      makeRequest("type=byCustomer&startDate=2026-03-01&endDate=2026-03-31&customerQuery=Alpha")
    );
    const body = (await res.json()) as Array<{ customerId: number }>;

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]?.customerId).toBe(77);
  });

  it("returns auth response when requireManagerUp fails", async () => {
    mocks.requireManagerUp.mockResolvedValueOnce({
      error: NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 }),
    });

    const res = await GET(makeRequest("type=byCustomer"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("ไม่ได้เข้าสู่ระบบ");
  });
});
