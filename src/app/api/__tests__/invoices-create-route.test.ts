import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireOfficeUp: vi.fn(),
  getDb: vi.fn(),
  getDbForFactory: vi.fn(),
  getFactories: vi.fn(() => [{ key: "si", name: "SI" }]),
  readIdempotencyKey: vi.fn(),
  stableHash: vi.fn(),
  claimOrReplay: vi.fn(),
  completeClaim: vi.fn(),
  resolveActiveFactoryKey: vi.fn(),
  getPostHogClient: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireOfficeUp: mocks.requireOfficeUp,
}));

vi.mock("@/db", () => ({
  getDb: mocks.getDb,
  getDbForFactory: mocks.getDbForFactory,
  getFactories: mocks.getFactories,
}));

vi.mock("@/lib/idempotency", () => ({
  readIdempotencyKey: mocks.readIdempotencyKey,
  stableHash: mocks.stableHash,
  claimOrReplay: mocks.claimOrReplay,
  completeClaim: mocks.completeClaim,
}));

vi.mock("@/lib/factory-key", () => ({
  resolveActiveFactoryKey: mocks.resolveActiveFactoryKey,
}));

vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: mocks.getPostHogClient,
}));

import { POST } from "@/app/api/invoices/route";

type AnyObj = Record<string, unknown>;

function makeRequest(
  body: Record<string, unknown>,
  headers?: Record<string, string>
): NextRequest {
  return new NextRequest("http://localhost/api/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(body),
  });
}

function buildWhereQuery(rows: AnyObj[]) {
  const chain: AnyObj = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(async () => rows);
  return chain;
}

function buildLimitQuery(rows: AnyObj[]) {
  const chain: AnyObj = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(async () => rows);
  return chain;
}

describe("POST /api/invoices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_INVOICE_DUPLICATE_WORKFLOW;
    mocks.requireOfficeUp.mockResolvedValue({
      user: { id: 8, username: "office", role: "office" },
    });
    mocks.readIdempotencyKey.mockReturnValue("idem-create-1");
    mocks.stableHash.mockReturnValue("hash-create-1");
    mocks.claimOrReplay.mockResolvedValue({ kind: "conflict" });
    mocks.completeClaim.mockResolvedValue(undefined);
    mocks.resolveActiveFactoryKey.mockResolvedValue("si");
    mocks.getPostHogClient.mockReturnValue({ capture: mocks.capture });
  });

  it("returns idempotency conflict when same key is reused with different request hash", async () => {
    const tx = {};
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(
      makeRequest(
        {
          customerId: 10,
          periodStart: "2026-03-01",
          periodEnd: "2026-03-31",
          includeKinds: ["sale", "return"],
          selectedTransactionIds: [101],
          vatEnabled: false,
          notes: "",
        },
        { "Idempotency-Key": "idem-create-1" }
      )
    );
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(409);
    expect(body.error).toBe("idempotency_key_conflict");
  });

  it("returns auth response when requireOfficeUp fails", async () => {
    mocks.requireOfficeUp.mockResolvedValueOnce({
      error: NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 }),
    });

    const res = await POST(
      makeRequest({
        customerId: 10,
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        includeKinds: ["sale"],
        selectedTransactionIds: [1],
      })
    );
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("ไม่ได้เข้าสู่ระบบ");
    expect(mocks.getDbForFactory).not.toHaveBeenCalled();
  });

  it("stores linked return rows as invoice line type return and nets totals", async () => {
    mocks.readIdempotencyKey.mockReturnValue(null);

    const invoiceLineValues: AnyObj[] = [];
    const txSelectQueue = [
      buildLimitQuery([{ id: 10 }]),
      buildWhereQuery([
        {
          id: 101,
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
          id: 102,
          customerName: "SI Customer",
          saleDate: "2026-03-02",
          saleTime: "09:00:00",
          pool: 1,
          row: 1,
          col: 1,
          status: "paid",
          totalAmount: -200,
          paid: -200,
          transactionKind: "return",
          note: "คืนสินค้า อ้างอิงบิล #101",
        },
      ]),
      buildWhereQuery([]),
      buildWhereQuery([
        { transactionId: 101, productTypeId: 1, quantity: 10 },
        { transactionId: 102, productTypeId: 1, quantity: -2 },
      ]),
      buildWhereQuery([]),
      buildWhereQuery([{ id: 1, name: "ซอง", sortOrder: 1 }]),
    ];
    const tx = {
      select: vi.fn(() => txSelectQueue.shift()),
      insert: vi.fn(() => ({
        values: vi.fn((values: AnyObj) => {
          if ("periodStart" in values) {
            return {
              returning: vi.fn(async () => [
                {
                  id: 555,
                  status: "draft",
                  createdAt: new Date("2026-03-05T10:00:00.000Z"),
                  subtotal: 800,
                  vatAmount: 0,
                  grandTotal: 800,
                },
              ]),
            };
          }

          invoiceLineValues.push(values);
          return Promise.resolve(undefined);
        }),
      })),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(
      makeRequest({
        customerId: 10,
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        includeKinds: ["transfer_out", "return"],
        selectedTransactionIds: [101, 102],
        vatEnabled: false,
        notes: "",
      })
    );
    const body = (await res.json()) as {
      id: number;
      status: string;
      subtotal: number;
      grandTotal: number;
      rowCount: number;
    };

    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      id: 555,
      status: "draft",
      subtotal: 800,
      grandTotal: 800,
      rowCount: 2,
    });
    expect(invoiceLineValues).toHaveLength(2);
    expect(invoiceLineValues[0]).toMatchObject({
      invoiceId: 555,
      transactionId: 101,
      lineType: "sale",
      amount: 1000,
    });
    expect(invoiceLineValues[1]).toMatchObject({
      invoiceId: 555,
      transactionId: 102,
      lineType: "return",
      amount: -200,
    });
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "user:8",
        event: "invoice.draft_created",
        properties: expect.objectContaining({
          schema_version: 2,
          app: "superice-pos",
          event_origin: "server",
          factory_key: "si",
          actor_user_id: 8,
          actor_role: "office",
          invoice_id: 555,
          customer_id: 10,
          period_start: "2026-03-01",
          period_end: "2026-03-31",
          include_kinds: ["return", "transfer_out"],
          line_count: 2,
          subtotal: 800,
          vat_enabled: false,
          vat_amount: 0,
          grand_total: 800,
          selected_transaction_count: 2,
          idempotent_replay: false,
        }),
      })
    );
  });

  it("allows creating another draft when duplicate line items only exist in other drafts", async () => {
    mocks.readIdempotencyKey.mockReturnValue(null);

    const invoiceLineValues: AnyObj[] = [];
    const txSelectQueue = [
      buildLimitQuery([{ id: 10 }]),
      buildWhereQuery([
        {
          id: 101,
          customerName: "SI Customer",
          saleDate: "2026-03-01",
          saleTime: "09:00:00",
          pool: 1,
          row: 1,
          col: 1,
          status: "paid",
          totalAmount: 1000,
          paid: 1000,
          transactionKind: "sale",
          note: null,
        },
      ]),
      // Draft-only duplicates are filtered out at the SQL layer and should not block create.
      buildWhereQuery([]),
      buildWhereQuery([{ transactionId: 101, productTypeId: 1, quantity: 10 }]),
      buildWhereQuery([]),
      buildWhereQuery([{ id: 1, name: "ซอง", sortOrder: 1 }]),
    ];
    const tx = {
      select: vi.fn(() => txSelectQueue.shift()),
      insert: vi.fn(() => ({
        values: vi.fn((values: AnyObj) => {
          if ("periodStart" in values) {
            return {
              returning: vi.fn(async () => [
                {
                  id: 556,
                  status: "draft",
                  createdAt: new Date("2026-03-05T10:00:00.000Z"),
                  subtotal: 1000,
                  vatAmount: 0,
                  grandTotal: 1000,
                },
              ]),
            };
          }

          invoiceLineValues.push(values);
          return Promise.resolve(undefined);
        }),
      })),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(
      makeRequest({
        customerId: 10,
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        includeKinds: ["sale"],
        selectedTransactionIds: [101],
        vatEnabled: false,
        notes: "",
      })
    );
    const body = (await res.json()) as {
      id: number;
      status: string;
      subtotal: number;
      grandTotal: number;
      rowCount: number;
    };

    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      id: 556,
      status: "draft",
      subtotal: 1000,
      grandTotal: 1000,
      rowCount: 1,
    });
    expect(invoiceLineValues).toHaveLength(1);
    expect(invoiceLineValues[0]).toMatchObject({
      invoiceId: 556,
      transactionId: 101,
      lineType: "sale",
      amount: 1000,
    });
  });

  it("restores strict duplicate-draft blocking when duplicate workflow is strict", async () => {
    mocks.readIdempotencyKey.mockReturnValue(null);
    process.env.NEXT_PUBLIC_INVOICE_DUPLICATE_WORKFLOW = "strict";

    const txSelectQueue = [
      buildLimitQuery([{ id: 10 }]),
      buildWhereQuery([
        {
          id: 101,
          customerName: "SI Customer",
          saleDate: "2026-03-01",
          saleTime: "09:00:00",
          pool: 1,
          row: 1,
          col: 1,
          status: "paid",
          totalAmount: 1000,
          paid: 1000,
          transactionKind: "sale",
          note: null,
        },
      ]),
      buildWhereQuery([
        { transactionId: 101, invoiceId: 55, invoiceStatus: "draft" },
      ]),
    ];
    const tx = {
      select: vi.fn(() => txSelectQueue.shift()),
      insert: vi.fn(),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(
      makeRequest({
        customerId: 10,
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        includeKinds: ["sale"],
        selectedTransactionIds: [101],
        vatEnabled: false,
        notes: "",
      })
    );
    const body = (await res.json()) as {
      error: string;
      conflicts: Array<{ invoiceId: number; invoiceStatus: string; transactionId: number }>;
    };

    expect(res.status).toBe(409);
    expect(body.error).toBe("Some transactions already exist in an active invoice");
    expect(body.conflicts).toEqual([
      expect.objectContaining({
        invoiceId: 55,
        invoiceStatus: "draft",
        transactionId: 101,
      }),
    ]);
    expect(tx.insert).not.toHaveBeenCalled();
  });
});
