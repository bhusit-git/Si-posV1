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

import { GET } from "@/app/api/invoices/preview/route";

type AnyObj = Record<string, unknown>;

function makeRequest(query: string): NextRequest {
  return new NextRequest(`http://localhost/api/invoices/preview?${query}`);
}

function buildTxSelectQuery(rows: AnyObj[]) {
  const chain: AnyObj = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(async () => rows);
  return chain;
}

function buildSimpleWhereQuery(rows: AnyObj[]) {
  const chain: AnyObj = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(async () => rows);
  return chain;
}

describe("GET /api/invoices/preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOfficeUp.mockResolvedValue({
      user: { id: 1, username: "office", role: "office" },
    });
  });

  it("applies timeWindow + includeKinds and returns itemized totals", async () => {
    const txRows = [
      {
        id: 11,
        customerName: "SI Customer",
        saleDate: "2026-03-01",
        saleTime: "09:15:00",
        pool: 1,
        row: 2,
        col: 3,
        status: "partial",
        totalAmount: 1000,
        paid: 400,
        transactionKind: "sale",
        note: null,
      },
      {
        id: 12,
        customerName: "SI Customer",
        saleDate: "2026-03-01",
        saleTime: "11:05:00",
        pool: 1,
        row: 2,
        col: 4,
        status: "unpaid",
        totalAmount: 0,
        paid: 0,
        transactionKind: "transfer_out",
        note: "XFER|ref=T-001",
      },
    ];

    const items = [{ transactionId: 11, productTypeId: 1, quantity: 10 }];
    const bags = [
      { transactionId: 11, type: "out", quantity: 10 },
      { transactionId: 11, type: "return", quantity: 2 },
    ];
    const productTypes = [{ id: 1, name: "ซอง", sortOrder: 1 }];

    const select = vi
      .fn()
      .mockReturnValueOnce(buildTxSelectQuery(txRows))
      .mockReturnValueOnce(buildSimpleWhereQuery(items))
      .mockReturnValueOnce(buildSimpleWhereQuery(bags))
      .mockReturnValueOnce(buildSimpleWhereQuery(productTypes));

    mocks.getDb.mockResolvedValue({
      query: {
        customers: {
          findFirst: vi.fn().mockResolvedValue({ id: 9, name: "SI Customer", phone: "0800000000" }),
        },
      },
      select,
    });

    const res = await GET(
      makeRequest(
        "customerId=9&startDate=2026-03-01&endDate=2026-03-31&includeKinds=sale,return&timeWindow=08:00-10:00"
      )
    );
    const body = (await res.json()) as {
      rows: Array<{ transactionId: number; kind: string; creditOwed: number }>;
      totals: {
        rowCount: number;
        totalCashPaid: number;
        totalCreditOwed: number;
        totalRefundBalance: number;
        totalSum: number;
        totalBagsOut: number;
        totalBagsReturned: number;
      };
    };

    expect(res.status).toBe(200);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      transactionId: 11,
      kind: "sale",
      creditOwed: 600,
    });
    expect(body.totals).toMatchObject({
      rowCount: 1,
      totalCashPaid: 400,
      totalCreditOwed: 600,
      totalRefundBalance: 0,
      totalSum: 1000,
      totalBagsOut: 10,
      totalBagsReturned: 2,
    });
  });

  it("returns empty preview when no rows remain after filtering", async () => {
    const txRows = [
      {
        id: 21,
        customerName: "SI Customer",
        saleDate: "2026-03-01",
        saleTime: "22:00:00",
        pool: 1,
        row: 1,
        col: 1,
        status: "paid",
        totalAmount: 100,
        paid: 100,
        transactionKind: "sale",
        note: null,
      },
    ];

    const select = vi.fn().mockReturnValueOnce(buildTxSelectQuery(txRows));
    mocks.getDb.mockResolvedValue({
      query: {
        customers: {
          findFirst: vi.fn().mockResolvedValue({ id: 9, name: "SI Customer", phone: null }),
        },
      },
      select,
    });

    const res = await GET(
      makeRequest(
        "customerId=9&startDate=2026-03-01&endDate=2026-03-31&includeKinds=sale&timeWindow=08:00-10:00"
      )
    );
    const body = (await res.json()) as { rows: unknown[]; totals: { rowCount: number } };

    expect(res.status).toBe(200);
    expect(body.rows).toEqual([]);
    expect(body.totals.rowCount).toBe(0);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("returns refund balance separately for refund-heavy rows", async () => {
    const txRows = [
      {
        id: 31,
        customerName: "SI Customer",
        saleDate: "2026-03-01",
        saleTime: "09:30:00",
        pool: 1,
        row: 1,
        col: 1,
        status: "paid",
        totalAmount: -200,
        paid: -100,
        transactionKind: "return",
        note: "คืนสินค้า",
      },
    ];

    const select = vi
      .fn()
      .mockReturnValueOnce(buildTxSelectQuery(txRows))
      .mockReturnValueOnce(buildSimpleWhereQuery([]))
      .mockReturnValueOnce(buildSimpleWhereQuery([]))
      .mockReturnValueOnce(buildSimpleWhereQuery([{ id: 1, name: "ซอง", sortOrder: 1 }]));

    mocks.getDb.mockResolvedValue({
      query: {
        customers: {
          findFirst: vi.fn().mockResolvedValue({ id: 9, name: "SI Customer", phone: null }),
        },
      },
      select,
    });

    const res = await GET(
      makeRequest("customerId=9&startDate=2026-03-01&endDate=2026-03-31&includeKinds=return")
    );
    const body = (await res.json()) as {
      rows: Array<{ transactionId: number; refundBalance: number; creditOwed: number }>;
      totals: {
        totalCashPaid: number;
        totalCreditOwed: number;
        totalRefundBalance: number;
        totalSum: number;
      };
    };

    expect(res.status).toBe(200);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      transactionId: 31,
      creditOwed: 0,
      refundBalance: 100,
    });
    expect(body.totals).toMatchObject({
      totalCashPaid: -100,
      totalCreditOwed: 0,
      totalRefundBalance: 100,
      totalSum: -200,
    });
  });

  it("nets transfer_out bill and linked return into the invoice preview total", async () => {
    const txRows = [
      {
        id: 41,
        customerName: "SI Customer",
        saleDate: "2026-03-01",
        saleTime: "09:00:00",
        pool: 1,
        row: 1,
        col: 1,
        status: "paid",
        totalAmount: 1000,
        paid: 1000,
        transactionKind: "transfer_out",
        note: "XFER|ref=XFER-20260301-001",
      },
      {
        id: 42,
        customerName: "SI Customer",
        saleDate: "2026-03-01",
        saleTime: "10:00:00",
        pool: 1,
        row: 1,
        col: 1,
        status: "paid",
        totalAmount: -250,
        paid: -250,
        transactionKind: "return",
        note: "คืนสินค้า อ้างอิงบิล #41",
      },
    ];

    const select = vi
      .fn()
      .mockReturnValueOnce(buildTxSelectQuery(txRows))
      .mockReturnValueOnce(buildSimpleWhereQuery([{ transactionId: 41, productTypeId: 1, quantity: 10 }]))
      .mockReturnValueOnce(buildSimpleWhereQuery([]))
      .mockReturnValueOnce(buildSimpleWhereQuery([{ id: 1, name: "ซอง", sortOrder: 1 }]));

    mocks.getDb.mockResolvedValue({
      query: {
        customers: {
          findFirst: vi.fn().mockResolvedValue({ id: 9, name: "SI Customer", phone: null }),
        },
      },
      select,
    });

    const res = await GET(
      makeRequest(
        "customerId=9&startDate=2026-03-01&endDate=2026-03-31&includeKinds=transfer_out,return"
      )
    );
    const body = (await res.json()) as {
      rows: Array<{ transactionId: number; kind: string; sumTotal: number }>;
      totals: {
        rowCount: number;
        totalSum: number;
        totalCashPaid: number;
        totalCreditOwed: number;
        totalRefundBalance: number;
      };
    };

    expect(res.status).toBe(200);
    expect(body.rows.map((row) => [row.transactionId, row.kind, row.sumTotal])).toEqual([
      [41, "transfer_out", 1000],
      [42, "return", -250],
    ]);
    expect(body.totals).toMatchObject({
      rowCount: 2,
      totalSum: 750,
      totalCashPaid: 750,
      totalCreditOwed: 0,
      totalRefundBalance: 0,
    });
  });

  it("returns auth response when requireOfficeUp fails", async () => {
    mocks.requireOfficeUp.mockResolvedValueOnce({
      error: NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 }),
    });

    const res = await GET(makeRequest("customerId=9&startDate=2026-03-01&endDate=2026-03-31"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("ไม่ได้เข้าสู่ระบบ");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
