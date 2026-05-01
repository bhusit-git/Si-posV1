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
  scanAndPersistAuditFindings: vi.fn(),
  allocateTransferRef: vi.fn(),
  buildTransferNote: vi.fn(),
  getTransferAccountingStatus: vi.fn(),
  isActiveInvoiceCreditCustomer: vi.fn(),
  parseTransferNote: vi.fn(),
  buildBagLedgerWrites: vi.fn(() => []),
  summarizeSaleBagFlow: vi.fn(() => ({ bagsReturned: 0, bagsOut: 0, bagsBought: 0 })),
  reverseBagLedgerEntry: vi.fn(),
  evaluateTransactionDateTimePolicy: vi.fn(),
  detectInvoiceOverlapWarnings: vi.fn(),
  resolveActiveFactoryKey: vi.fn(),
  capture: vi.fn(),
  getPostHogClient: vi.fn(),
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

vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: mocks.getPostHogClient,
}));

vi.mock("@/lib/factory-key", () => ({
  resolveActiveFactoryKey: mocks.resolveActiveFactoryKey,
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

import { PUT } from "@/app/api/transactions/route";

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/transactions", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Cookie: "superice_factory=si",
    },
    body: JSON.stringify(body),
  });
}

function makeDbMock(txOverride: Partial<{
  id: number;
  customerId: number;
  totalAmount: number;
  paid: number;
  status: string;
  transactionKind: string;
}> = {}, options: { activeInvoiceRows?: Array<Record<string, unknown>> } = {}) {
  const updateSet = vi.fn(() => ({
    where: vi.fn(async () => undefined),
  }));
  const update = vi.fn(() => ({ set: updateSet }));
  const insertValues = vi.fn(async () => undefined);
  const selectLimit = vi.fn(async () => options.activeInvoiceRows || []);
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: selectLimit,
        })),
      })),
    })),
  }));

  const db = {
    query: {
      transactions: {
        findFirst: vi.fn(async () => ({
          id: 77,
          customerId: 9,
          totalAmount: 500,
          paid: 500,
          status: "paid",
          transactionKind: "sale",
          items: [],
          ...txOverride,
        })),
      },
    },
    update,
    select,
    insert: vi.fn(() => ({ values: insertValues })),
    transaction: vi.fn(async (callback: (arg: unknown) => Promise<unknown>) => callback(db)),
    _update: update,
    _updateSet: updateSet,
    _insertValues: insertValues,
    _selectLimit: selectLimit,
  };
  return db;
}

function makeMutableDbMock(initialTx: {
  id: number;
  customerId: number;
  totalAmount: number;
  paid: number;
  outstandingAmount?: number;
  status: string;
  transactionKind: string;
}) {
  const state = {
    outstandingAmount: Math.max(0, initialTx.totalAmount - initialTx.paid),
    ...initialTx,
    items: [] as unknown[],
  };
  const where = vi.fn(async () => undefined);
  const set = vi.fn((values: Partial<typeof state>) => {
    Object.assign(state, values);
    return { where };
  });
  const update = vi.fn(() => ({ set }));

  const insertValues = vi.fn(async () => undefined);
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(async () => []),
        })),
      })),
    })),
  }));
  const db = {
    state,
    query: {
      transactions: {
        findFirst: vi.fn(async () => ({ ...state })),
      },
    },
    update,
    select,
    insert: vi.fn(() => ({ values: insertValues })),
    transaction: vi.fn(async (callback: (arg: unknown) => Promise<unknown>) => callback(db)),
    _set: set,
    _insertValues: insertValues,
  };
  return db;
}

describe("PUT /api/transactions payment adjustment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireOfficeUp.mockResolvedValue({
      user: { id: 5, username: "office-si", role: "office", factoryKey: "si" },
    });
    mocks.logAudit.mockResolvedValue(undefined);
    mocks.scanAndPersistAuditFindings.mockResolvedValue(undefined);
    mocks.resolveActiveFactoryKey.mockResolvedValue("si");
    mocks.getPostHogClient.mockReturnValue({ capture: mocks.capture });
  });

  it("allows reversing a paid transaction back to credit", async () => {
    const db = makeDbMock({ paid: 500, totalAmount: 500, status: "paid" });
    mocks.getDbForFactory.mockReturnValue(db);
    mocks.validateBody.mockReturnValue({
      data: { id: 77, action: "payment", amount: -500 },
    });

    const res = await PUT(makeRequest({ id: 77, action: "payment", amount: -500 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, paid: 0, status: "unpaid" });
    expect(db._updateSet).toHaveBeenCalledWith({
      paid: 0,
      outstandingAmount: 500,
      status: "unpaid",
    });
    expect(db._insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: 77,
        invoiceId: null,
        invoicePaymentId: null,
        amount: -500,
        method: "cash",
        createdBy: 5,
      })
    );
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "transaction.payment",
        details: expect.objectContaining({
          auditActionLabel: "เปลี่ยนเป็นเครดิตระยะสั้น",
          auditSummary: "เปลี่ยนสถานะการชำระ: เงินสด -> เครดิตระยะสั้น",
          amount: -500,
          previousPaid: 500,
          newPaid: 0,
          newStatus: "unpaid",
          appliedAmount: -500,
          paymentDirection: "reverse",
          backToCredit: true,
        }),
      }),
      expect.any(Object)
    );
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "user:5",
        event: "sale.payment.recorded",
        properties: expect.objectContaining({
          schema_version: 2,
          app: "superice-pos",
          event_origin: "server",
          factory_key: "si",
          actor_user_id: 5,
          actor_role: "office",
          transaction_id: 77,
          customer_id: 9,
          payment_amount: -500,
          previous_paid: 500,
          new_paid: 0,
          new_status: "unpaid",
          outstanding_after_payment: 500,
          payment_direction: "reverse",
          back_to_credit: true,
        }),
      })
    );
  });

  it("clamps overpayment to the transaction total", async () => {
    const db = makeDbMock({ paid: 100, totalAmount: 500, status: "partial" });
    mocks.getDbForFactory.mockReturnValue(db);
    mocks.validateBody.mockReturnValue({
      data: { id: 77, action: "payment", amount: 999 },
    });

    const res = await PUT(makeRequest({ id: 77, action: "payment", amount: 999 }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, paid: 500, status: "paid" });
    expect(db._updateSet).toHaveBeenCalledWith({
      paid: 500,
      outstandingAmount: 0,
      status: "paid",
    });
    expect(db._insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: 77,
        amount: 400,
        method: "cash",
        createdBy: 5,
      })
    );
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          auditActionLabel: "ชำระครบ",
          auditSummary: "บันทึกชำระเงินจนชำระครบ",
          amount: 999,
          previousPaid: 100,
          newPaid: 500,
          newStatus: "paid",
          appliedAmount: 400,
          paymentDirection: "settle_full",
          backToCredit: false,
        }),
      }),
      expect.any(Object)
    );
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "sale.payment.recorded",
        properties: expect.objectContaining({
          payment_amount: 999,
          previous_paid: 100,
          new_paid: 500,
          new_status: "paid",
          outstanding_after_payment: 0,
          payment_direction: "settle_full",
          back_to_credit: false,
        }),
      })
    );
  });

  it("blocks negative transaction payment when the transaction is in an active invoice", async () => {
    const db = makeDbMock(
      { paid: 500, totalAmount: 500, status: "paid" },
      { activeInvoiceRows: [{ invoiceId: 10, invoiceStatus: "issued" }] }
    );
    mocks.getDbForFactory.mockReturnValue(db);
    mocks.validateBody.mockReturnValue({
      data: { id: 77, action: "payment", amount: -500 },
    });

    const res = await PUT(makeRequest({ id: 77, action: "payment", amount: -500 }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toEqual({
      error: "รายการนี้อยู่ในใบวางบิล กรุณาปรับชำระผ่านใบวางบิล",
    });
    expect(db._update).not.toHaveBeenCalled();
    expect(db._insertValues).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
    expect(mocks.scanAndPersistAuditFindings).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("blocks positive transaction payment when the transaction is in an active invoice", async () => {
    const db = makeDbMock(
      { paid: 100, totalAmount: 500, status: "partial" },
      { activeInvoiceRows: [{ invoiceId: 10, invoiceStatus: "paid" }] }
    );
    mocks.getDbForFactory.mockReturnValue(db);
    mocks.validateBody.mockReturnValue({
      data: { id: 77, action: "payment", amount: 100 },
    });

    const res = await PUT(makeRequest({ id: 77, action: "payment", amount: 100 }));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body).toEqual({
      error: "รายการนี้อยู่ในใบวางบิล กรุณาปรับชำระผ่านใบวางบิล",
    });
    expect(db._update).not.toHaveBeenCalled();
    expect(db._insertValues).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
    expect(mocks.scanAndPersistAuditFindings).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("supports repeated switching between cash and short-term credit without drift", async () => {
    const db = makeMutableDbMock({
      id: 77,
      customerId: 9,
      totalAmount: 500,
      paid: 500,
      status: "paid",
      transactionKind: "sale",
    });
    mocks.getDbForFactory.mockReturnValue(db);

    mocks.validateBody.mockReturnValueOnce({
      data: { id: 77, action: "payment", amount: -500 },
    });
    const toCreditRes = await PUT(makeRequest({ id: 77, action: "payment", amount: -500 }));
    expect(toCreditRes.status).toBe(200);
    expect(await toCreditRes.json()).toEqual({ success: true, paid: 0, status: "unpaid" });
    expect(db.state.paid).toBe(0);
    expect(db.state.outstandingAmount).toBe(500);
    expect(db.state.status).toBe("unpaid");

    mocks.validateBody.mockReturnValueOnce({
      data: { id: 77, action: "payment", amount: 500 },
    });
    const backToCashRes = await PUT(makeRequest({ id: 77, action: "payment", amount: 500 }));
    expect(backToCashRes.status).toBe(200);
    expect(await backToCashRes.json()).toEqual({ success: true, paid: 500, status: "paid" });
    expect(db.state.paid).toBe(500);
    expect(db.state.outstandingAmount).toBe(0);
    expect(db.state.status).toBe("paid");
    expect(mocks.capture).toHaveBeenCalledTimes(2);
  });
});

function makeVoidDbMock() {
  const state = {
    id: 77,
    customerId: 9,
    totalAmount: 500,
    paid: 500,
    outstandingAmount: 0,
    status: "paid",
    transactionKind: "sale",
    items: [] as unknown[],
  };
  const bagEntries = [
    {
      id: 1,
      customerId: 9,
      productTypeId: 2,
      type: "out",
      quantity: 3,
      transactionId: 77,
    },
  ];
  const returning = vi.fn(async () => {
    if (state.status === "voided") return [];
    state.status = "voided";
    state.outstandingAmount = 0;
    return [{ ...state }];
  });
  const updateWhere = vi.fn(() => ({ returning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));
  const insertValues = vi.fn(async () => undefined);
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn(async () => [{ id: state.id }]),
        then: (resolve: (value: unknown) => unknown) => resolve(bagEntries),
      })),
    })),
  }));

  const db = {
    update,
    select,
    insert: vi.fn(() => ({ values: insertValues })),
    transaction: vi.fn(async (callback: (arg: unknown) => Promise<unknown>) => callback(db)),
    _insertValues: insertValues,
    _returning: returning,
  };
  return db;
}

describe("PUT /api/transactions void adjustment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      user: { id: 1, username: "admin-si", role: "admin", factoryKey: "si" },
    });
    mocks.logAudit.mockResolvedValue(undefined);
    mocks.scanAndPersistAuditFindings.mockResolvedValue(undefined);
    mocks.resolveActiveFactoryKey.mockResolvedValue("si");
    mocks.reverseBagLedgerEntry.mockReturnValue({ type: "return", quantity: 3 });
    mocks.getPostHogClient.mockReturnValue({ capture: mocks.capture });
  });

  it("only inserts bag reversal side effects for the first successful void", async () => {
    const db = makeVoidDbMock();
    mocks.getDbForFactory.mockReturnValue(db);
    mocks.validateBody.mockReturnValue({
      data: { id: 77, action: "void", reason: "duplicate click" },
    });

    const first = await PUT(makeRequest({ id: 77, action: "void", reason: "duplicate click" }));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ success: true, status: "voided" });
    expect(db._insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.logAudit).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledTimes(1);

    const second = await PUT(makeRequest({ id: 77, action: "void", reason: "duplicate click" }));
    expect(second.status).toBe(400);
    expect(await second.json()).toEqual({ error: "รายการนี้ถูกยกเลิกแล้ว" });
    expect(db._returning).toHaveBeenCalledTimes(2);
    expect(db._insertValues).toHaveBeenCalledTimes(1);
    expect(mocks.logAudit).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledTimes(1);
  });
});
