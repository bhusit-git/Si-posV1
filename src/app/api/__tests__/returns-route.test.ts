import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireManagerUp: vi.fn(),
  getDb: vi.fn(),
  getDbForFactory: vi.fn(),
  getFactories: vi.fn(() => [{ key: "si", name: "SI" }]),
  logAudit: vi.fn(),
  withBehaviorDetails: vi.fn(),
  reservePrintedBillNumber: vi.fn(),
  resolveActiveFactoryKey: vi.fn(),
  getPostHogClient: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireManagerUp: mocks.requireManagerUp,
}));

vi.mock("@/db", () => ({
  getDb: mocks.getDb,
  getDbForFactory: mocks.getDbForFactory,
  getFactories: mocks.getFactories,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
  withBehaviorDetails: mocks.withBehaviorDetails,
}));

vi.mock("@/lib/bill-counter", () => ({
  reservePrintedBillNumber: mocks.reservePrintedBillNumber,
}));

vi.mock("@/lib/factory-key", () => ({
  resolveActiveFactoryKey: mocks.resolveActiveFactoryKey,
}));

vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: mocks.getPostHogClient,
}));

import { POST } from "@/app/api/returns/route";

type AnyObj = Record<string, unknown>;

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/returns", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function buildLimitChain(rows: AnyObj[]) {
  const chain: AnyObj = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(async () => rows);
  return chain;
}

function buildGroupByChain(rows: AnyObj[]) {
  const chain: AnyObj = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.groupBy = vi.fn(async () => rows);
  return chain;
}

function buildOrderByChain(rows: AnyObj[]) {
  const chain: AnyObj = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(async () => rows);
  return chain;
}

function buildDirectFromChain(rows: AnyObj[]) {
  const chain: AnyObj = {};
  chain.from = vi.fn(async () => rows);
  return chain;
}

function buildUpdateChain(onSet?: (values: AnyObj) => void) {
  const chain: AnyObj = {};
  chain.set = vi.fn((values: AnyObj) => {
    onSet?.(values);
    return chain;
  });
  chain.where = vi.fn(async () => undefined);
  return chain;
}

describe("POST /api/returns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireManagerUp.mockResolvedValue({
      user: { id: 5, username: "manager", role: "manager" },
    });
    mocks.logAudit.mockResolvedValue(undefined);
    mocks.withBehaviorDetails.mockImplementation((details: unknown) => details);
    mocks.reservePrintedBillNumber.mockResolvedValue({
      printedBillNumber: 1234,
      nextBillNumber: 1235,
    });
    mocks.resolveActiveFactoryKey.mockResolvedValue("si");
    mocks.getPostHogClient.mockReturnValue({ capture: mocks.capture });
  });

  it("allows return against open, uninvoiced transfer_out bill and skips unrelated outstanding allocation", async () => {
    const dbSelectQueue = [
      buildLimitChain([]),
      buildGroupByChain([]),
    ];
    const insertValues: AnyObj[] = [];
    const tx = {
      select: vi.fn(() => buildDirectFromChain([])),
      update: vi.fn(() => buildUpdateChain()),
      insert: vi.fn(() => ({
        values: vi.fn((values: AnyObj) => {
          insertValues.push(values);
          if (insertValues.length === 1) {
            return {
              returning: vi.fn(async () => [{ id: 901 }]),
            };
          }
          return Promise.resolve(undefined);
        }),
      })),
    };
    const db = {
      query: {
        transactions: {
          findFirst: vi.fn().mockResolvedValue({
            id: 88,
            customerId: 9,
            transactionKind: "transfer_out",
            transferAccountingStatus: "open",
            note: "XFER|ref=XFER-20260406-001",
            items: [
              { productTypeId: 1, quantity: 5, unitPrice: 100 },
            ],
          }),
        },
      },
      select: vi.fn(() => dbSelectQueue.shift()),
      transaction: vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    mocks.getDbForFactory.mockReturnValue(db);

    const res = await POST(
      makeRequest({
        customerId: 9,
        items: [{ productTypeId: 1, quantity: 5, unitPrice: 100 }],
        bagReturns: [],
        saleDate: "2026-04-06",
        saleTime: "10:00:00",
        note: "คืนบิลเครดิต",
        originalBill: 88,
      })
    );
    const body = (await res.json()) as { id: number; totalRefund: number };

    expect(res.status).toBe(201);
    expect(body).toEqual({
      id: 901,
      totalRefund: 500,
      printedBillNumber: 1234,
      billNumber: "1234",
      internalReference: "Tx #901",
      nextBillNumber: 1235,
    });
    expect(tx.update).not.toHaveBeenCalled();
    expect(insertValues[0]).toMatchObject({
      customerId: 9,
      totalAmount: -500,
      paid: -500,
      status: "paid",
      transactionKind: "return",
      originalTransactionId: 88,
      printedBillNumber: 1234,
    });
    expect(insertValues[1]).toMatchObject({
      transactionId: 901,
      productTypeId: 1,
      quantity: -5,
      subtotal: -500,
    });
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "user:5",
        event: "sale.return.completed",
        properties: expect.objectContaining({
          schema_version: 2,
          app: "superice-pos",
          event_origin: "server",
          factory_key: "si",
          actor_user_id: 5,
          actor_role: "manager",
          customer_id: 9,
          return_transaction_id: 901,
          total_refund: 500,
          returned_item_qty: 5,
          returned_item_lines: 1,
          bags_reversed_from_items: 0,
          bags_returned_manual: 0,
          refund_applied_to_outstanding: 0,
          unapplied_refund_credit: 500,
          original_bill_id: 88,
          original_bill_kind: "transfer_out",
          invoice_credit_return: true,
          allocation_count: 0,
          printed_bill_number: 1234,
          bill_number: "1234",
        }),
      })
    );
  });

  it("allows zero-value transfer_out return corrections and still writes negative items", async () => {
    const dbSelectQueue = [
      buildLimitChain([]),
      buildGroupByChain([]),
    ];
    const insertValues: AnyObj[] = [];
    const tx = {
      select: vi.fn(() => buildDirectFromChain([])),
      update: vi.fn(() => buildUpdateChain()),
      insert: vi.fn(() => ({
        values: vi.fn((values: AnyObj) => {
          insertValues.push(values);
          if (insertValues.length === 1) {
            return {
              returning: vi.fn(async () => [{ id: 902 }]),
            };
          }
          return Promise.resolve(undefined);
        }),
      })),
    };
    const db = {
      query: {
        transactions: {
          findFirst: vi.fn().mockResolvedValue({
            id: 89,
            customerId: 9,
            transactionKind: "transfer_out",
            transferAccountingStatus: "open",
            note: "XFER|ref=XFER-20260406-002",
            items: [
              { productTypeId: 1, quantity: 4, unitPrice: 0 },
            ],
          }),
        },
      },
      select: vi.fn(() => dbSelectQueue.shift()),
      transaction: vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    mocks.getDbForFactory.mockReturnValue(db);

    const res = await POST(
      makeRequest({
        customerId: 9,
        items: [{ productTypeId: 1, quantity: 4, unitPrice: 0 }],
        bagReturns: [],
        saleDate: "2026-04-06",
        saleTime: "10:00:00",
        note: "แก้จำนวนผิด",
        originalBill: 89,
      })
    );
    const body = (await res.json()) as { id: number; totalRefund: number };

    expect(res.status).toBe(201);
    expect(body).toEqual({
      id: 902,
      totalRefund: 0,
      printedBillNumber: 1234,
      billNumber: "1234",
      internalReference: "Tx #902",
      nextBillNumber: 1235,
    });
    expect(tx.update).not.toHaveBeenCalled();
    expect(insertValues[0]).toMatchObject({
      customerId: 9,
      status: "paid",
      transactionKind: "return",
      originalTransactionId: 89,
    });
    expect(Math.abs(Number(insertValues[0].totalAmount))).toBe(0);
    expect(Math.abs(Number(insertValues[0].paid))).toBe(0);
    expect(insertValues[1]).toMatchObject({
      transactionId: 902,
      productTypeId: 1,
      quantity: -4,
      unitPrice: 0,
    });
    expect(Math.abs(Number(insertValues[1].subtotal))).toBe(0);
  });

  it("rejects transfer_out return when the credit bill is already closed", async () => {
    const db = {
      query: {
        transactions: {
          findFirst: vi.fn().mockResolvedValue({
            id: 88,
            customerId: 9,
            transactionKind: "transfer_out",
            transferAccountingStatus: "closed",
            note: "XFER|ref=XFER-20260406-001|acct=closed",
            items: [{ productTypeId: 1, quantity: 5, unitPrice: 100 }],
          }),
        },
      },
      select: vi.fn(),
      transaction: vi.fn(),
    };
    mocks.getDbForFactory.mockReturnValue(db);

    const res = await POST(
      makeRequest({
        customerId: 9,
        items: [{ productTypeId: 1, quantity: 1, unitPrice: 100 }],
        bagReturns: [],
        saleDate: "2026-04-06",
        saleTime: "10:00:00",
        originalBill: 88,
      })
    );
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("บิลเครดิตนี้ปิดยอดแล้ว ต้องเปิดยอดก่อนจึงจะคืนได้");
    expect(db.transaction).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("rejects transfer_out return when the original bill is already in a non-void invoice", async () => {
    const db = {
      query: {
        transactions: {
          findFirst: vi.fn().mockResolvedValue({
            id: 88,
            customerId: 9,
            transactionKind: "transfer_out",
            transferAccountingStatus: "open",
            note: "XFER|ref=XFER-20260406-001",
            items: [{ productTypeId: 1, quantity: 5, unitPrice: 100 }],
          }),
        },
      },
      select: vi
        .fn()
        .mockReturnValueOnce(
          buildLimitChain([{ invoiceId: 77, invoiceStatus: "issued" }])
        ),
      transaction: vi.fn(),
    };
    mocks.getDbForFactory.mockReturnValue(db);

    const res = await POST(
      makeRequest({
        customerId: 9,
        items: [{ productTypeId: 1, quantity: 1, unitPrice: 100 }],
        bagReturns: [],
        saleDate: "2026-04-06",
        saleTime: "10:00:00",
        originalBill: 88,
      })
    );
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("บิลเครดิตนี้อยู่ในใบวางบิลแล้ว กรุณาจัดการใบวางบิลก่อนคืนสินค้า");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("preserves existing refundable-quantity validation for normal sale bills", async () => {
    const db = {
      query: {
        transactions: {
          findFirst: vi.fn().mockResolvedValue({
            id: 55,
            customerId: 9,
            transactionKind: "sale",
            transferAccountingStatus: null,
            note: null,
            items: [{ productTypeId: 1, quantity: 5, unitPrice: 100 }],
          }),
        },
      },
      select: vi.fn(() => buildGroupByChain([])),
      transaction: vi.fn(),
    };
    mocks.getDbForFactory.mockReturnValue(db);

    const res = await POST(
      makeRequest({
        customerId: 9,
        items: [{ productTypeId: 1, quantity: 6, unitPrice: 100 }],
        bagReturns: [],
        saleDate: "2026-04-06",
        saleTime: "10:00:00",
        originalBill: 55,
      })
    );
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toContain("จำนวนคืนสินค้า (6) เกินจำนวนที่คืนได้ (5)");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("still allocates refund to outstanding rows for normal sale returns", async () => {
    const dbSelectQueue = [buildGroupByChain([])];
    const updatedRows: AnyObj[] = [];
    const txSelectQueue = [
      buildOrderByChain([
        {
          id: 55,
          totalAmount: 500,
          paid: 100,
          status: "partial",
          saleDate: "2026-04-01",
          saleTime: "08:00:00",
        },
      ]),
      buildDirectFromChain([]),
    ];
    const tx = {
      select: vi.fn(() => txSelectQueue.shift()),
      update: vi.fn(() =>
        buildUpdateChain((values) => {
          updatedRows.push(values);
        })
      ),
      insert: vi.fn(() => ({
        values: vi.fn((values: AnyObj) => {
          if ("customerId" in values && "totalAmount" in values) {
            return {
              returning: vi.fn(async () => [{ id: 999 }]),
            };
          }
          return Promise.resolve(undefined);
        }),
      })),
    };
    const db = {
      query: {
        transactions: {
          findFirst: vi.fn().mockResolvedValue({
            id: 55,
            customerId: 9,
            transactionKind: "sale",
            transferAccountingStatus: null,
            note: null,
            items: [{ productTypeId: 1, quantity: 5, unitPrice: 100 }],
          }),
        },
      },
      select: vi.fn(() => dbSelectQueue.shift()),
      transaction: vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) => callback(tx)),
    };
    mocks.getDbForFactory.mockReturnValue(db);

    const res = await POST(
      makeRequest({
        customerId: 9,
        items: [{ productTypeId: 1, quantity: 2, unitPrice: 100 }],
        bagReturns: [],
        saleDate: "2026-04-06",
        saleTime: "10:00:00",
        originalBill: 55,
      })
    );

    expect(res.status).toBe(201);
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(updatedRows[0]).toMatchObject({
      paid: 300,
      outstandingAmount: 200,
      status: "partial",
    });
  });

  it("returns auth response when requireManagerUp fails", async () => {
    mocks.requireManagerUp.mockResolvedValueOnce({
      error: NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 }),
    });

    const res = await POST(
      makeRequest({
        customerId: 9,
        items: [],
        bagReturns: [{ productTypeId: 1, quantity: 1 }],
        saleDate: "2026-04-06",
        saleTime: "10:00:00",
      })
    );
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("ไม่ได้เข้าสู่ระบบ");
    expect(mocks.getDbForFactory).not.toHaveBeenCalled();
  });
});
