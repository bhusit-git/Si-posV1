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

import { POST } from "@/app/api/invoices/[id]/void/route";

type AnyObj = Record<string, unknown>;

function makeRequest(
  body: Record<string, unknown> = {},
  headers?: Record<string, string>
): NextRequest {
  return new NextRequest("http://localhost/api/invoices/1/void", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(headers || {}) },
    body: JSON.stringify(body),
  });
}

function makeContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

function buildUpdateQuery(rows: AnyObj[]) {
  const chain: AnyObj = {};
  chain.set = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.returning = vi.fn(async () => rows);
  return chain;
}

function buildSelectQuery(rows: AnyObj[]) {
  const chain: AnyObj = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(async () => rows);
  chain.orderBy = vi.fn(async () => rows);
  return chain;
}

describe("POST /api/invoices/[id]/void", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOfficeUp.mockResolvedValue({
      user: { id: 5, username: "office", role: "office" },
    });
    mocks.readIdempotencyKey.mockReturnValue(null);
    mocks.stableHash.mockReturnValue("hash-void");
    mocks.claimOrReplay.mockResolvedValue({ kind: "proceed", claimId: 1 });
    mocks.completeClaim.mockResolvedValue(undefined);
    mocks.resolveActiveFactoryKey.mockResolvedValue("si");
    mocks.getPostHogClient.mockReturnValue({ capture: mocks.capture });
  });

  it("requires reason", async () => {
    const res = await POST(makeRequest({ reason: "   " }), makeContext("11"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("void reason is required");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("voids invoice with reason", async () => {
    const selectRowsQueue: AnyObj[][] = [
      [{ id: 11, status: "issued", paidTotal: 0 }], // invoice row
      [], // invoice payments
    ];
    const tx = {
      select: vi.fn(() => buildSelectQuery(selectRowsQueue.shift() || [])),
      insert: vi.fn(),
      update: vi.fn(() =>
        buildUpdateQuery([
          {
            id: 11,
            status: "void",
            voidReason: "duplicate invoice",
            paidTotal: 0,
            outstandingTotal: 0,
          },
        ])
      ),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(makeRequest({ reason: "duplicate invoice" }), makeContext("11"));
    const body = (await res.json()) as {
      id: number;
      status: string;
      voidReason: string;
      paidTotal: number;
      outstandingTotal: number;
    };

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      id: 11,
      status: "void",
      voidReason: "duplicate invoice",
      paidTotal: 0,
      outstandingTotal: 0,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "user:5",
        event: "invoice.voided",
        properties: expect.objectContaining({
          schema_version: 2,
          app: "superice-pos",
          event_origin: "server",
          factory_key: "si",
          actor_user_id: 5,
          actor_role: "office",
          invoice_id: 11,
          paid_total_before_reversal: 0,
          reversal_payment_count: 0,
          allocation_reversal_count: 0,
          idempotent_replay: false,
        }),
      })
    );
  });

  it("returns not found when invoice already voided or missing", async () => {
    const tx = {
      select: vi.fn(() => buildSelectQuery([])),
      insert: vi.fn(),
      update: vi.fn(),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(makeRequest({ reason: "bad bill" }), makeContext("11"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(404);
    expect(body.error).toBe("ไม่พบใบวางบิลหรือใบวางบิลถูก void แล้ว");
  });

  it("returns auth response when requireOfficeUp fails", async () => {
    mocks.requireOfficeUp.mockResolvedValueOnce({
      error: NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 }),
    });

    const res = await POST(makeRequest({ reason: "x" }), makeContext("11"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("ไม่ได้เข้าสู่ระบบ");
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("creates compensating reversals for paid invoice before voiding", async () => {
    const selectRowsQueue: AnyObj[][] = [
      [{ id: 11, status: "issued", paidTotal: 100 }], // invoice row
      [{ id: 21, amount: 100, method: "cash", paidAt: new Date().toISOString(), note: null }], // payments
      [{ id: 31, invoiceLineId: 41, transactionId: 51, allocatedAmount: 70 }], // allocations for payment 21
      [{ id: 51, totalAmount: 200, paid: 150 }], // transaction row
    ];
    const insert = vi.fn(() => {
      const chain: AnyObj = {};
      chain.values = vi.fn(() => chain);
      chain.returning = vi.fn(async () => [{ id: 999 }]);
      return chain;
    });
    const updateQueue: AnyObj[][] = [
      [], // transaction update (no returning call)
      [
        {
          id: 11,
          status: "void",
          voidReason: "customer cancel",
          paidTotal: 0,
          outstandingTotal: 0,
        },
      ], // final invoice update
    ];
    const tx = {
      select: vi.fn(() => buildSelectQuery(selectRowsQueue.shift() || [])),
      insert,
      update: vi.fn(() => buildUpdateQuery(updateQueue.shift() || [])),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(makeRequest({ reason: "customer cancel" }), makeContext("11"));
    const body = (await res.json()) as {
      id: number;
      status: string;
      paidTotal: number;
      outstandingTotal: number;
    };

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      id: 11,
      status: "void",
      paidTotal: 0,
      outstandingTotal: 0,
    });
    // reversal payment + reversal allocation + allocated payment_event + unallocated payment_event
    expect(insert).toHaveBeenCalledTimes(4);
    // one transaction rebalance update + one invoice final update
    expect(tx.update).toHaveBeenCalledTimes(2);
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "invoice.voided",
        properties: expect.objectContaining({
          invoice_id: 11,
          paid_total_before_reversal: 100,
          reversal_payment_count: 1,
          allocation_reversal_count: 1,
          idempotent_replay: false,
        }),
      })
    );
  });

  it("returns idempotency conflict when same key has different payload hash", async () => {
    mocks.readIdempotencyKey.mockReturnValue("idem-void-1");
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
      makeRequest({ reason: "x" }, { "Idempotency-Key": "idem-void-1" }),
      makeContext("11")
    );
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(409);
    expect(body.error).toBe("idempotency_key_conflict");
  });

  it("replays idempotent void without running compensation twice", async () => {
    mocks.readIdempotencyKey.mockReturnValue("idem-void-replay");
    mocks.claimOrReplay.mockResolvedValue({
      kind: "replay",
      claimId: 42,
      invoiceId: 11,
      invoicePaymentId: null,
    });
    const tx = {
      select: vi
        .fn()
        .mockReturnValueOnce(
          buildSelectQuery([
            {
              id: 11,
              status: "void",
              voidReason: "customer cancel",
              paidTotal: 0,
              outstandingTotal: 0,
            },
          ])
        )
        .mockReturnValueOnce(
          buildSelectQuery([
            {
              total: 1,
              paidTotalBeforeReversal: 100,
            },
          ])
        )
        .mockReturnValueOnce(buildSelectQuery([{ total: 1 }])),
      insert: vi.fn(),
      update: vi.fn(),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(
      makeRequest(
        { reason: "customer cancel" },
        { "Idempotency-Key": "idem-void-replay" }
      ),
      makeContext("11")
    );
    const body = (await res.json()) as {
      id: number;
      status: string;
      idempotentReplay: boolean;
      idempotencyKey: string;
    };

    expect(res.status).toBe(200);
    expect(body.id).toBe(11);
    expect(body.status).toBe("void");
    expect(body.idempotentReplay).toBe(true);
    expect(body.idempotencyKey).toBe("idem-void-replay");
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "invoice.voided",
        properties: expect.objectContaining({
          invoice_id: 11,
          paid_total_before_reversal: 100,
          reversal_payment_count: 1,
          allocation_reversal_count: 1,
          idempotent_replay: true,
        }),
      })
    );
  });
});
