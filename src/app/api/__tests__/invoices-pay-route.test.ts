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

import { POST } from "@/app/api/invoices/[id]/pay/route";

type AnyObj = Record<string, unknown>;
type SelectQueryMock = ReturnType<typeof buildSelectQuery>;

function makeRequest(
  body: Record<string, unknown> = {},
  headers?: Record<string, string>
): NextRequest {
  return new NextRequest("http://localhost/api/invoices/1/pay", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(body),
  });
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function buildSelectQuery(rows: AnyObj[]) {
  const chain: AnyObj = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => chain);
  chain.for = vi.fn(async () => rows);
  chain.then = (resolve: (value: AnyObj[]) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(rows).then(resolve, reject);
  return chain;
}

describe("POST /api/invoices/[id]/pay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOfficeUp.mockResolvedValue({
      user: { id: 6, username: "office", role: "office" },
    });
    mocks.readIdempotencyKey.mockReturnValue(null);
    mocks.stableHash.mockReturnValue("hash-pay");
    mocks.claimOrReplay.mockResolvedValue({ kind: "proceed", claimId: 1 });
    mocks.completeClaim.mockResolvedValue(undefined);
    mocks.resolveActiveFactoryKey.mockResolvedValue("si");
    mocks.getDbForFactory.mockReset();
    mocks.getPostHogClient.mockReturnValue({ capture: mocks.capture });
  });

  it("rejects invalid invoice id", async () => {
    const res = await POST(makeRequest({ amount: 100, method: "cash" }), makeContext("abc"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid invoice id");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects non-positive amount", async () => {
    const res = await POST(makeRequest({ amount: 0, method: "cash" }), makeContext("1"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("amount must be > 0");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects invalid payment method", async () => {
    const res = await POST(makeRequest({ amount: 100, method: "promptpay" }), makeContext("1"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid payment method");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects payment when invoice is draft", async () => {
    const tx = {
      select: vi.fn(() =>
        buildSelectQuery([
          {
            id: 1,
            status: "draft",
            grandTotal: 1000,
            paidTotal: 0,
            outstandingTotal: 1000,
          },
        ])
      ),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(makeRequest({ amount: 100, method: "cash" }), makeContext("1"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("กรุณาออกใบวางบิลก่อนรับชำระ");
  });

  it("returns auth response when requireOfficeUp fails", async () => {
    mocks.requireOfficeUp.mockResolvedValueOnce({
      error: NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 }),
    });

    const res = await POST(makeRequest({ amount: 100, method: "cash" }), makeContext("1"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("ไม่ได้เข้าสู่ระบบ");
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("records payment and emits invoice payment telemetry", async () => {
    const selectQueries: SelectQueryMock[] = [];
    const selectRowsQueue: AnyObj[][] = [
      [
        {
          id: 1,
          status: "issued",
          grandTotal: 1000,
          paidTotal: 100,
          outstandingTotal: 900,
        },
      ],
      [
        {
          lineId: 11,
          transactionId: 21,
          saleDate: "2026-03-01",
          saleTime: "09:00:00",
          txTotalAmount: 1000,
          txPaid: 100,
          txKind: "sale",
          txStatus: "partial",
        },
      ],
    ];
    let insertCount = 0;
    const tx = {
      select: vi.fn(() => {
        const query = buildSelectQuery(selectRowsQueue.shift() || []);
        selectQueries.push(query);
        return query;
      }),
      insert: vi.fn(() => ({
        values: vi.fn(() => {
          insertCount += 1;
          if (insertCount === 1) {
            return {
              returning: vi.fn(async () => [
                { id: 77, paidAt: "2026-03-03T10:00:00.000Z" },
              ]),
            };
          }
          return Promise.resolve(undefined);
        }),
      })),
      update: vi
        .fn()
        .mockReturnValueOnce({
          set: vi.fn(() => ({
            where: vi.fn(async () => undefined),
          })),
        })
        .mockReturnValueOnce({
          set: vi.fn(() => ({
            where: vi.fn(() => ({
              returning: vi.fn(async () => [
                {
                  id: 1,
                  status: "issued",
                  paidTotal: 200,
                  outstandingTotal: 800,
                },
              ]),
            })),
          })),
        }),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(
      makeRequest({ amount: 100, method: "cash", note: "" }),
      makeContext("1")
    );
    const body = (await res.json()) as {
      paymentId: number;
      paidAt: string;
      invoice: { id: number; status: string; paidTotal: number; outstandingTotal: number };
    };

    expect(res.status).toBe(200);
    expect(body).toEqual({
      paymentId: 77,
      paidAt: "2026-03-03T10:00:00.000Z",
      invoice: {
        id: 1,
        status: "issued",
        paidTotal: 200,
        outstandingTotal: 800,
      },
    });
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "user:6",
        event: "invoice.payment_recorded",
        properties: expect.objectContaining({
          schema_version: 2,
          app: "superice-pos",
          event_origin: "server",
          factory_key: "si",
          actor_user_id: 6,
          actor_role: "office",
          invoice_id: 1,
          payment_id: 77,
          amount: 100,
          method: "cash",
          paid_total_after: 200,
          outstanding_after: 800,
          invoice_status_after: "issued",
          allocation_count: 1,
          unallocated_amount: 0,
          idempotent_replay: false,
        }),
      })
    );
    expect(tx.insert).toHaveBeenCalledTimes(3);
    expect(selectQueries[0].for).toHaveBeenCalledWith("update", expect.any(Object));
    expect(selectQueries[1].for).toHaveBeenCalledWith("update", expect.any(Object));
  });

  it("rejects stale concurrent overpayment after locking the latest invoice row", async () => {
    const selectQueries: SelectQueryMock[] = [];
    const selectRowsQueue: AnyObj[][] = [
      [
        {
          id: 1,
          status: "issued",
          grandTotal: 1000,
          paidTotal: 950,
          outstandingTotal: 50,
        },
      ],
    ];
    const tx = {
      select: vi.fn(() => {
        const query = buildSelectQuery(selectRowsQueue.shift() || []);
        selectQueries.push(query);
        return query;
      }),
      insert: vi.fn(),
      update: vi.fn(),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(
      makeRequest({ amount: 100, method: "cash", note: "" }),
      makeContext("1")
    );
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("จำนวนรับชำระเกินยอดคงค้าง");
    expect(selectQueries[0].for).toHaveBeenCalledWith("update", expect.any(Object));
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("replays idempotent payment without creating new allocations", async () => {
    mocks.readIdempotencyKey.mockReturnValue("idem-pay-1");
    mocks.claimOrReplay.mockResolvedValue({
      kind: "replay",
      claimId: 9,
      invoiceId: 1,
      invoicePaymentId: 77,
    });
    const selectRowsQueue: AnyObj[][] = [
      [{ id: 77, paidAt: "2026-03-03T10:00:00.000Z", amount: 100, method: "cash" }],
      [{ total: 0 }],
      [{ total: 0 }],
      [{ id: 1, status: "issued", paidTotal: 100, outstandingTotal: 900 }],
    ];
    const tx = {
      select: vi.fn(() => buildSelectQuery(selectRowsQueue.shift() || [])),
      insert: vi.fn(),
      update: vi.fn(),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(
      makeRequest(
        { amount: 100, method: "cash", note: "" },
        { "Idempotency-Key": "idem-pay-1" }
      ),
      makeContext("1")
    );
    const body = (await res.json()) as {
      paymentId: number;
      idempotentReplay: boolean;
      idempotencyKey: string;
    };

    expect(res.status).toBe(200);
    expect(body.paymentId).toBe(77);
    expect(body.idempotentReplay).toBe(true);
    expect(body.idempotencyKey).toBe("idem-pay-1");
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "invoice.payment_recorded",
        properties: expect.objectContaining({
          invoice_id: 1,
          payment_id: 77,
          amount: 100,
          method: "cash",
          idempotent_replay: true,
        }),
      })
    );
  });

  it("returns idempotency conflict when same key is reused with different payload hash", async () => {
    mocks.readIdempotencyKey.mockReturnValue("idem-pay-conflict");
    mocks.claimOrReplay.mockResolvedValue({ kind: "conflict" });
    const tx = {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(
      makeRequest(
        { amount: 100, method: "cash", note: "" },
        { "Idempotency-Key": "idem-pay-conflict" }
      ),
      makeContext("1")
    );
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(409);
    expect(body.error).toBe("idempotency_key_conflict");
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });
});
