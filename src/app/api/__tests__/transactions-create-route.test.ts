import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getDbForFactory: vi.fn(),
  getFactories: vi.fn(() => [{ key: "si", name: "SI" }]),
  requireManagerUp: vi.fn(),
  requireOfficeUp: vi.fn(),
  requireAdmin: vi.fn(),
  logAudit: vi.fn(),
  withBehaviorDetails: vi.fn((details: unknown) => details),
  validateBody: vi.fn(),
  evaluateTransactionDateTimePolicy: vi.fn(),
  detectInvoiceOverlapWarnings: vi.fn(),
  scanAndPersistAuditFindings: vi.fn(),
  buildBagLedgerWrites: vi.fn(() => []),
  summarizeSaleBagFlow: vi.fn(() => ({ bagsReturned: 0, bagsOut: 0, bagsBought: 0 })),
  reverseBagLedgerEntry: vi.fn(),
  allocateTransferRef: vi.fn(),
  buildTransferNote: vi.fn(),
  getTransferAccountingStatus: vi.fn(),
  isActiveInvoiceCreditCustomer: vi.fn(() => true),
  parseTransferNote: vi.fn(() => null),
  reservePrintedBillNumber: vi.fn(),
  resolveActiveFactoryKey: vi.fn(),
  getPostHogClient: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("@/db", () => ({
  FACTORY_COOKIE: "superice_factory",
  getDb: mocks.getDb,
  getDbForFactory: mocks.getDbForFactory,
  getFactories: mocks.getFactories,
}));

vi.mock("@/lib/api-auth", () => ({
  requireManagerUp: mocks.requireManagerUp,
  requireOfficeUp: mocks.requireOfficeUp,
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
  withBehaviorDetails: mocks.withBehaviorDetails,
}));

vi.mock("@/lib/validations", () => ({
  createTransactionSchema: {},
  voidTransactionSchema: {},
  payTransactionSchema: {},
  payAllTransactionSchema: {},
  validateBody: mocks.validateBody,
}));

vi.mock("@/lib/transaction-backdate", () => ({
  evaluateTransactionDateTimePolicy: mocks.evaluateTransactionDateTimePolicy,
  detectInvoiceOverlapWarnings: mocks.detectInvoiceOverlapWarnings,
}));

vi.mock("@/lib/fraud-detection", () => ({
  scanAndPersistAuditFindings: mocks.scanAndPersistAuditFindings,
}));

vi.mock("@/lib/bag-flow", () => ({
  buildBagLedgerWrites: mocks.buildBagLedgerWrites,
  summarizeSaleBagFlow: mocks.summarizeSaleBagFlow,
  reverseBagLedgerEntry: mocks.reverseBagLedgerEntry,
}));

vi.mock("@/lib/transfer-utils", () => ({
  allocateTransferRef: mocks.allocateTransferRef,
  buildTransferNote: mocks.buildTransferNote,
  getTransferAccountingStatus: mocks.getTransferAccountingStatus,
  parseTransferNote: mocks.parseTransferNote,
  TRANSFER_REF_REGEX: /^(?:TRF|XFER)-\d{8}-\d{3}$/,
}));

vi.mock("@/lib/invoice-credit-rollout", () => ({
  isActiveInvoiceCreditCustomer: mocks.isActiveInvoiceCreditCustomer,
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

import { POST } from "@/app/api/transactions/route";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/transactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: "superice_factory=si",
    },
    body: JSON.stringify(body),
  });
}

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    customerId: 88,
    items: [{ productTypeId: 1, quantity: 5, unitPrice: 100 }],
    paid: -1,
    status: "paid",
    pool: null,
    row: null,
    col: null,
    bagReturns: [],
    newPrices: [],
    fulfillment: null,
    clientId: "client-123",
    transactionType: "sale",
    transferRef: null,
    transferDestination: null,
    transferTruck: null,
    saleDate: "2026-03-26",
    saleTime: "10:00:00",
    backdateReason: null,
    note: null,
    ...overrides,
  };
}

describe("POST /api/transactions duplicate protection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireManagerUp.mockResolvedValue({
      user: {
        id: 7,
        username: "manager-si",
        role: "manager",
        factoryKey: "si",
      },
    });
    mocks.evaluateTransactionDateTimePolicy.mockReturnValue({
      ok: true,
      data: {
        effectiveSaleDate: "2026-03-26",
        effectiveSaleTime: "10:00:00",
        isBackdated: false,
        backdateMinutes: 0,
      },
    });
    mocks.detectInvoiceOverlapWarnings.mockResolvedValue([]);
    mocks.resolveActiveFactoryKey.mockResolvedValue("si");
    mocks.getPostHogClient.mockReturnValue({ capture: mocks.capture });
  });

  it("returns the existing transaction when the same clientId is retried", async () => {
    mocks.validateBody.mockReturnValue({
      data: makePayload(),
    });

    const existing = {
      id: 441,
      totalAmount: 500,
      paid: 500,
      outstandingAmount: 0,
      status: "paid",
      saleDate: "2026-03-24",
      saleTime: "08:45:00",
      printedBillNumber: 4123,
      transferRef: null,
      transactionKind: "sale",
      clientId: "client-123",
    };

    const db = {
      query: {
        transactions: {
          findFirst: vi.fn(async () => existing),
        },
      },
      select: vi.fn(),
      transaction: vi.fn(),
    };
    mocks.getDbForFactory.mockReturnValue(db);

    const res = await POST(makeRequest(makePayload()));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      id: 441,
      totalAmount: 500,
      status: "paid",
      printedBillNumber: 4123,
      duplicate: true,
      effectiveSaleDate: "2026-03-24",
      effectiveSaleTime: "08:45:00",
      isBackdated: false,
    });
    expect(db.transaction).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("replays the existing transaction when a concurrent duplicate hits the clientId unique index", async () => {
    mocks.validateBody.mockReturnValue({
      data: makePayload({ clientId: "client-race" }),
    });
    mocks.reservePrintedBillNumber.mockResolvedValue({
      printedBillNumber: 4124,
      nextBillNumber: 4125,
    });

    const existing = {
      id: 442,
      totalAmount: 500,
      paid: 500,
      outstandingAmount: 0,
      status: "paid",
      saleDate: "2026-03-24",
      saleTime: "08:46:00",
      printedBillNumber: 4124,
      transferRef: null,
      transactionKind: "sale",
      clientId: "client-race",
    };
    const duplicateError = Object.assign(new Error("duplicate key value"), {
      code: "23505",
      constraint_name: "idx_transactions_client_id",
      detail: "Key (client_id)=(client-race) already exists.",
    });
    const tx = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => {
            throw duplicateError;
          }),
        })),
      })),
    };
    const db = {
      query: {
        transactions: {
          findFirst: vi.fn()
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(existing),
        },
      },
      select: vi.fn((fields?: unknown) => ({
        from: vi.fn(() => {
          if (fields) {
            return {
              where: vi.fn(async () => []),
            };
          }
          return [{ id: 1, catalogCode: "ICE-001", hasBag: false, decreasesBag: false }];
        }),
      })),
      transaction: vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
        callback(tx)
      ),
      execute: vi.fn(),
    };
    mocks.getDbForFactory.mockReturnValue(db);

    const res = await POST(makeRequest(makePayload({ clientId: "client-race" })));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      id: 442,
      totalAmount: 500,
      status: "paid",
      printedBillNumber: 4124,
      duplicate: true,
      effectiveSaleDate: "2026-03-24",
      effectiveSaleTime: "08:46:00",
    });
    expect(db.query.transactions.findFirst).toHaveBeenCalledTimes(2);
    expect(mocks.logAudit).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("rejects transfer_out writes for customers without active invoice-credit status", async () => {
    mocks.validateBody.mockReturnValue({
      data: makePayload({
        transactionType: "transfer_out",
        clientId: "transfer-001",
      }),
    });
    mocks.isActiveInvoiceCreditCustomer.mockReturnValue(false);

    const db = {
      query: {
        transactions: {
          findFirst: vi.fn(async () => null),
        },
        customers: {
          findFirst: vi.fn(async () => ({
            id: 88,
            name: "ACME",
            transferCustomer: false,
          })),
        },
      },
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(async () => []),
        })),
      })),
      transaction: vi.fn(),
    };
    mocks.getDbForFactory.mockReturnValue(db);

    const res = await POST(
      makeRequest(
        makePayload({
          transactionType: "transfer_out",
          clientId: "transfer-001",
        })
      )
    );
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("ลูกค้านี้ไม่มีสถานะเครดิต");
    expect(db.transaction).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("records exact Bearing discount metadata in the transaction audit details", async () => {
    mocks.getFactories.mockReturnValue([
      { key: "si", name: "SI" },
      { key: "bearing", name: "Bearing" },
    ]);
    mocks.requireManagerUp.mockResolvedValue({
      user: {
        id: 7,
        username: "manager-bearing",
        role: "manager",
        factoryKey: "bearing",
      },
    });
    mocks.validateBody.mockReturnValue({
      data: makePayload({
        customerId: 88,
        clientId: "bearing-discount-001",
        items: [
          { productTypeId: 1, quantity: 10, unitPrice: 140 },
          { productTypeId: 6, quantity: 5, unitPrice: 26 },
          { productTypeId: 7, quantity: 5, unitPrice: 28 },
        ],
      }),
    });
    mocks.reservePrintedBillNumber.mockResolvedValue({
      printedBillNumber: 42,
      nextBillNumber: 43,
    });

    const insertedValues: Array<Record<string, unknown>> = [];
    let insertCall = 0;
    const tx = {
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => {
          insertedValues.push(values);
          insertCall += 1;
          if (insertCall === 1) {
            return {
              returning: vi.fn(async () => [{
                id: 501,
                totalAmount: 1430,
                paid: 1430,
                outstandingAmount: 0,
                status: "paid",
                transactionKind: "sale",
                printedBillNumber: 42,
                transferRef: null,
              }]),
            };
          }
          return Promise.resolve();
        }),
      })),
    };
    const db = {
      query: {
        transactions: {
          findFirst: vi.fn(async () => null),
        },
        customers: {
          findFirst: vi.fn(async () => ({ id: 88, name: "Bearing Shop" })),
        },
      },
      select: vi.fn((fields?: unknown) => ({
        from: vi.fn(() => {
          if (fields) {
            return {
              where: vi.fn(async () => [
                { productTypeId: 1, unitPrice: 140 },
                { productTypeId: 6, unitPrice: 26 },
                { productTypeId: 7, unitPrice: 28 },
              ]),
            };
          }
          return [
            { id: 1, catalogCode: 101, hasBag: false, decreasesBag: false },
            { id: 6, catalogCode: 301, hasBag: true, decreasesBag: false },
            { id: 7, catalogCode: 201, hasBag: true, decreasesBag: false },
          ];
        }),
      })),
      transaction: vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
        callback(tx)
      ),
    };
    mocks.getDbForFactory.mockReturnValue(db);

    const res = await POST(makeRequest(makePayload({ clientId: "bearing-discount-001" })));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      id: 501,
      totalAmount: 1430,
      printedBillNumber: 42,
    });
    expect(insertedValues.slice(1).map((values) => values.unitPrice)).toEqual([120, 22, 24]);
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "transaction.create",
        details: expect.objectContaining({
          bearingDiscount: expect.objectContaining({
            policy: "bearing_threshold_discount",
            transactionId: 501,
            printedBillNumber: 42,
            billNumber: "0042",
            customerId: 88,
            customerName: "Bearing Shop",
            saleDate: "2026-03-26",
            saleTime: "10:00:00",
            originalSubtotal: 1670,
            finalSubtotal: 1430,
            discountAmount: 240,
          }),
        }),
      }),
      tx
    );
  });
});
