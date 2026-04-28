import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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

describe("POST /api/invoices/[id]/pay transfer_out allocation behavior", () => {
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
    mocks.getPostHogClient.mockReturnValue({ capture: mocks.capture });
  });

  it("records payment at the invoice layer and leaves transfer_out transactions untouched", async () => {
    const selectRowsQueue: AnyObj[][] = [
      [
        {
          id: 1,
          status: "issued",
          grandTotal: 1000,
          paidTotal: 0,
          outstandingTotal: 1000,
        },
      ],
      [
        {
          lineId: 11,
          transactionId: 21,
          saleDate: "2026-03-01",
          saleTime: "09:00:00",
          txTotalAmount: 1000,
          txPaid: 1000,
          txKind: "transfer_out",
          txStatus: "paid",
        },
      ],
    ];
    const insertedValues: AnyObj[] = [];
    let insertCount = 0;
    const tx = {
      select: vi.fn(() => buildSelectQuery(selectRowsQueue.shift() || [])),
      insert: vi.fn(() => ({
        values: vi.fn((values: AnyObj) => {
          insertedValues.push(values);
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
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(() => ({
            returning: vi.fn(async () => [
              {
                id: 1,
                status: "paid",
                paidTotal: 1000,
                outstandingTotal: 0,
              },
            ]),
          })),
        })),
      })),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(
      makeRequest({ amount: 1000, method: "cash", note: "invoice-credit settlement" }),
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
        status: "paid",
        paidTotal: 1000,
        outstandingTotal: 0,
      },
    });
    expect(tx.update).toHaveBeenCalledTimes(1);
    expect(insertedValues[1]).toMatchObject({
      transactionId: null,
      invoiceId: 1,
      invoicePaymentId: 77,
      amount: 1000,
      method: "cash",
      note: "invoice-credit settlement (unallocated)",
    });
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "invoice.payment_recorded",
        properties: expect.objectContaining({
          invoice_id: 1,
          payment_id: 77,
          allocation_count: 0,
          unallocated_amount: 1000,
          invoice_status_after: "paid",
          idempotent_replay: false,
        }),
      })
    );
  });
});
