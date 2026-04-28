import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireOfficeUp: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireOfficeUp: mocks.requireOfficeUp,
}));

vi.mock("@/db", () => ({
  getDb: mocks.getDb,
}));

import { GET } from "@/app/api/invoices/route";

type AnyObj = Record<string, unknown>;

function makeRequest(query = ""): NextRequest {
  const suffix = query ? `?${query}` : "";
  return new NextRequest(`http://localhost/api/invoices${suffix}`);
}

function buildRowsQuery(rows: AnyObj[]) {
  const chain: AnyObj = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.offset = vi.fn(async () => rows);
  return chain;
}

function buildCountQuery(total: number) {
  const chain: AnyObj = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(async () => [{ total }]);
  return chain;
}

describe("GET /api/invoices list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOfficeUp.mockResolvedValue({
      user: { id: 11, username: "office", role: "office" },
    });
  });

  it("returns rows + meta and computes displayStatus", async () => {
    const rows = [
      {
        id: 1,
        invoiceNo: "INV-SI-2026-00001",
        customerId: 101,
        customerName: "Alpha",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        status: "issued",
        grandTotal: 1000,
        paidTotal: 200,
        outstandingTotal: 800,
        issueDate: "2026-03-02",
        dueDate: "2026-03-09",
        createdAt: new Date("2026-03-02T10:00:00.000Z"),
        updatedAt: new Date("2026-03-02T11:00:00.000Z"),
      },
      {
        id: 2,
        invoiceNo: "INV-SI-2026-00002",
        customerId: 102,
        customerName: "Beta",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        status: "paid",
        grandTotal: 500,
        paidTotal: 500,
        outstandingTotal: 0,
        issueDate: "2026-03-02",
        dueDate: "2026-03-09",
        createdAt: new Date("2026-03-02T10:00:00.000Z"),
        updatedAt: new Date("2026-03-02T11:00:00.000Z"),
      },
    ];

    const rowsQuery = buildRowsQuery(rows);
    const countQuery = buildCountQuery(3);
    const select = vi.fn().mockReturnValueOnce(rowsQuery).mockReturnValueOnce(countQuery);
    mocks.getDb.mockResolvedValue({ select });

    const res = await GET(makeRequest("limit=2&offset=0&q=INV&status=issued&dateFrom=2026-03-01&dateTo=2026-03-31"));
    const body = (await res.json()) as {
      rows: Array<{ id: number; displayStatus: string }>;
      meta: { total: number; limit: number; offset: number; hasMore: boolean };
    };

    expect(res.status).toBe(200);
    expect(body.rows).toHaveLength(2);
    expect(body.rows[0].displayStatus).toBe("partially_paid");
    expect(body.rows[1].displayStatus).toBe("paid");
    expect(body.meta).toEqual({ total: 3, limit: 2, offset: 0, hasMore: true });

    expect(rowsQuery.limit).toHaveBeenCalledWith(2);
    expect(rowsQuery.offset).toHaveBeenCalledWith(0);
  });

  it("falls back to safe defaults when limit/offset are invalid", async () => {
    const rows: AnyObj[] = [];
    const rowsQuery = buildRowsQuery(rows);
    const countQuery = buildCountQuery(0);
    const select = vi.fn().mockReturnValueOnce(rowsQuery).mockReturnValueOnce(countQuery);
    mocks.getDb.mockResolvedValue({ select });

    const res = await GET(makeRequest("limit=abc&offset=xyz"));
    const body = (await res.json()) as {
      meta: { total: number; limit: number; offset: number; hasMore: boolean };
    };

    expect(res.status).toBe(200);
    expect(rowsQuery.limit).toHaveBeenCalledWith(50);
    expect(rowsQuery.offset).toHaveBeenCalledWith(0);
    expect(body.meta).toEqual({ total: 0, limit: 50, offset: 0, hasMore: false });
  });

  it("accepts comma-separated customer ids in q while keeping invoice and name search active", async () => {
    const rows = [
      {
        id: 7,
        invoiceNo: "INV-SI-2026-00007",
        customerId: 101,
        customerName: "Alpha",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        status: "draft",
        grandTotal: 1000,
        paidTotal: 0,
        outstandingTotal: 1000,
        issueDate: null,
        dueDate: null,
        createdAt: new Date("2026-03-02T10:00:00.000Z"),
        updatedAt: new Date("2026-03-02T11:00:00.000Z"),
      },
      {
        id: 8,
        invoiceNo: "INV-SI-2026-00008",
        customerId: 102,
        customerName: "Beta",
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        status: "issued",
        grandTotal: 500,
        paidTotal: 0,
        outstandingTotal: 500,
        issueDate: "2026-03-03",
        dueDate: "2026-03-10",
        createdAt: new Date("2026-03-03T10:00:00.000Z"),
        updatedAt: new Date("2026-03-03T11:00:00.000Z"),
      },
    ];
    const rowsQuery = buildRowsQuery(rows);
    const countQuery = buildCountQuery(2);
    const select = vi.fn().mockReturnValueOnce(rowsQuery).mockReturnValueOnce(countQuery);
    mocks.getDb.mockResolvedValue({ select });

    const res = await GET(makeRequest("q=%23101,%20%23102"));
    const body = (await res.json()) as { rows: Array<{ customerId: number }> };

    expect(res.status).toBe(200);
    expect(body.rows.map((row) => row.customerId)).toEqual([101, 102]);
    expect(rowsQuery.where).toHaveBeenCalledTimes(1);
  });

  it("returns auth response when requireOfficeUp fails", async () => {
    mocks.requireOfficeUp.mockResolvedValueOnce({
      error: NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 }),
    });

    const res = await GET(makeRequest());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("ไม่ได้เข้าสู่ระบบ");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
