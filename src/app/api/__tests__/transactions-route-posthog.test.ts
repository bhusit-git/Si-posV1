import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getDbForFactory: vi.fn(),
  getFactories: vi.fn(() => [{ key: "si", name: "SI" }, { key: "bearing", name: "Bearing" }]),
  requireManagerUp: vi.fn(),
  logAudit: vi.fn(),
  withBehaviorDetails: vi.fn((details: unknown) => details),
  validateBody: vi.fn(),
  evaluateTransactionDateTimePolicy: vi.fn(),
  detectInvoiceOverlapWarnings: vi.fn(),
  scanAndPersistAuditFindings: vi.fn(),
  buildBagLedgerWrites: vi.fn(() => []),
  summarizeSaleBagFlow: vi.fn(() => ({ bagsReturned: 0, bagsOut: 0, bagsBought: 0 })),
  reverseBagLedgerEntry: vi.fn(),
  allocateTransferRef: vi.fn(() => "XFER-20260326-001"),
  buildTransferNote: vi.fn(() => "XFER|ref=XFER-20260326-001"),
  getTransferAccountingStatus: vi.fn(() => "pending"),
  isActiveInvoiceCreditCustomer: vi.fn(() => true),
  parseTransferNote: vi.fn(() => null),
  reservePrintedBillNumber: vi.fn(),
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
  requireOfficeUp: vi.fn(),
  requireAdmin: vi.fn(),
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

vi.mock("@/lib/transfer-utils", () => ({
  allocateTransferRef: mocks.allocateTransferRef,
  buildTransferNote: mocks.buildTransferNote,
  getTransferAccountingStatus: mocks.getTransferAccountingStatus,
  parseTransferNote: mocks.parseTransferNote,
  TRANSFER_REF_REGEX: /^XFER-\d{8}-\d{3}$/,
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

vi.mock("@/lib/bill-counter", () => ({
  reservePrintedBillNumber: mocks.reservePrintedBillNumber,
}));

vi.mock("@/lib/factory-key", () => ({
  resolveActiveFactoryKey: mocks.resolveActiveFactoryKey,
}));

import { GET, POST } from "@/app/api/transactions/route";

function makeRequest(body: Record<string, unknown> = {}): NextRequest {
  return new NextRequest("http://localhost/api/transactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: "superice_factory=si",
    },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(query = ""): NextRequest {
  const suffix = query ? `?${query}` : "";
  return new NextRequest(`http://localhost/api/transactions${suffix}`, {
    method: "GET",
    headers: {
      Cookie: "superice_factory=si",
    },
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
    clientId: null,
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

function makeDbMock() {
  const customerRecord = {
    id: 88,
    name: "ACME",
    transferCustomer: false,
  };
  const allProductTypes = [{ id: 1, catalogCode: "ICE-001", hasBag: false }];
  const tx = {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: 9001 }]),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(async () => []),
    })),
  };

  return {
    query: {
      customers: {
        findFirst: vi.fn(async (args?: { columns?: Record<string, boolean> }) => {
          if (!args?.columns) return customerRecord;
          return Object.fromEntries(
            Object.entries(args.columns)
              .filter(([, enabled]) => enabled)
              .map(([key]) => [key, customerRecord[key as keyof typeof customerRecord]])
          );
        }),
      },
      productTypes: {
        findFirst: vi.fn(async (): Promise<{ id: number } | null> => null),
      },
      transactions: {
        findFirst: vi.fn(async () => null),
      },
    },
    select: vi.fn((fields?: unknown) => ({
      from: vi.fn(() => {
        if (fields) {
          return {
            where: vi.fn(async () => []),
          };
        }
        return allProductTypes;
      }),
    })),
    transaction: vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    ),
  };
}

function getCaptureByEvent(eventName: string) {
  return mocks.capture.mock.calls.find(([payload]) => payload?.event === eventName)?.[0] as
    | {
        distinctId: string;
        event: string;
        uuid?: string;
        properties: Record<string, unknown>;
      }
    | undefined;
}

describe("POST /api/transactions PostHog sale_completed", () => {
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
    mocks.logAudit.mockResolvedValue(undefined);
    mocks.scanAndPersistAuditFindings.mockResolvedValue(undefined);
    mocks.reservePrintedBillNumber.mockResolvedValue({
      printedBillNumber: 1234,
      nextBillNumber: 1235,
    });
    mocks.resolveActiveFactoryKey.mockResolvedValue("si");
    mocks.getPostHogClient.mockReturnValue({ capture: mocks.capture });
    mocks.getDbForFactory.mockReturnValue(makeDbMock());
  });

  it("emits cash sale_type for paid sale", async () => {
    mocks.validateBody.mockReturnValue({
      data: makePayload({ status: "paid", transactionType: "sale", paid: -1 }),
    });

    const res = await POST(makeRequest({}));
    const saleCompleted = getCaptureByEvent("sale_completed");
    const analyticsSnapshot = getCaptureByEvent("sale_analytics_snapshot");

    expect(res.status).toBe(201);
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(saleCompleted).toEqual(
      expect.objectContaining({
        distinctId: "user:7",
        event: "sale_completed",
        properties: expect.objectContaining({
          schema_version: 2,
          app: "superice-pos",
          event_origin: "server",
          actor_user_id: 7,
          actor_role: "manager",
          payment_status: "paid",
          transaction_type: "sale",
          sale_type: "cash",
          sale_type_th: "เงินสด",
          factory_key: "si",
          paid_amount: 500,
          outstanding_amount: 0,
          event_source: "server",
          items_count: 1,
          quantity_total: 5,
          bags_out: 0,
          bags_returned: 0,
          bags_bought: 0,
          printed_bill_number: 1234,
          bill_number: "1234",
          internal_reference: "Tx #9001",
          sale_date: "2026-03-26",
          sale_time: "10:00:00",
          is_backdated: false,
          warning_count: 0,
          source_system: "app_pos",
        }),
      })
    );
    expect(analyticsSnapshot).toEqual(
      expect.objectContaining({
        distinctId: "customer:si:88",
        event: "sale_analytics_snapshot",
        uuid: "sale_analytics_snapshot-si-9001",
        properties: expect.objectContaining({
          schema_version: 2,
          app: "superice-pos",
          event_origin: "server",
          actor_user_id: 7,
          actor_role: "manager",
          payment_status: "paid",
          transaction_type: "sale",
          sale_type: "cash",
          sale_type_th: "เงินสด",
          factory_key: "si",
          items_count: 1,
          quantity_total: 5,
          bags_out: 0,
          bags_returned: 0,
          bags_bought: 0,
        }),
      })
    );
  });

  it("emits short_term_credit for partial/unpaid sale", async () => {
    mocks.validateBody.mockReturnValue({
      data: makePayload({ status: "partial", transactionType: "sale", paid: 200 }),
    });

    const res = await POST(makeRequest({}));
    const saleCompleted = getCaptureByEvent("sale_completed");

    expect(res.status).toBe(201);
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(saleCompleted).toEqual(
      expect.objectContaining({
        event: "sale_completed",
        properties: expect.objectContaining({
          actor_user_id: 7,
          actor_role: "manager",
          payment_status: "partial",
          transaction_type: "sale",
          sale_type: "short_term_credit",
          sale_type_th: "ค้าง",
          paid_amount: 200,
          outstanding_amount: 300,
        }),
      })
    );
  });

  it("emits long_term_credit for transfer_out", async () => {
    mocks.validateBody.mockReturnValue({
      data: makePayload({
        status: "unpaid",
        paid: 0,
        transactionType: "transfer_out",
        transferDestination: "Warehouse B",
      }),
    });

    const res = await POST(makeRequest({}));
    const saleCompleted = getCaptureByEvent("sale_completed");

    expect(res.status).toBe(201);
    expect(mocks.capture).toHaveBeenCalledTimes(2);
    expect(saleCompleted).toEqual(
      expect.objectContaining({
        event: "sale_completed",
        properties: expect.objectContaining({
          actor_user_id: 7,
          actor_role: "manager",
          payment_status: "paid",
          transaction_type: "transfer_out",
          sale_type: "long_term_credit",
          sale_type_th: "เครดิต",
          transfer_ref: "XFER-20260326-001",
          paid_amount: 500,
          outstanding_amount: 0,
        }),
      })
    );
  });

  it("loads transferCustomer before checking active invoice-credit eligibility", async () => {
    mocks.isActiveInvoiceCreditCustomer.mockImplementation(
      (customer?: { transferCustomer?: boolean | null }) => customer?.transferCustomer === true
    );

    const db = makeDbMock();
    db.query.customers.findFirst = vi.fn(async (args?: { columns?: Record<string, boolean> }) => {
      const transferCustomerRecord = {
        id: 90,
        name: "เซเว่น-1",
        transferCustomer: true,
      };
      if (!args?.columns) return transferCustomerRecord;
      return Object.fromEntries(
        Object.entries(args.columns)
          .filter(([, enabled]) => enabled)
          .map(([key]) => [key, transferCustomerRecord[key as keyof typeof transferCustomerRecord]])
      );
    });
    mocks.getDbForFactory.mockReturnValueOnce(db);
    mocks.validateBody.mockReturnValue({
      data: makePayload({
        customerId: 90,
        items: [{ productTypeId: 1, quantity: 5, unitPrice: 0 }],
        status: "unpaid",
        paid: 0,
        transactionType: "transfer_out",
        transferDestination: "Bearing warehouse",
      }),
    });

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(201);
    expect(db.query.customers.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: expect.objectContaining({
          id: true,
          name: true,
          transferCustomer: true,
        }),
      })
    );
    expect(mocks.isActiveInvoiceCreditCustomer).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 90,
        name: "เซเว่น-1",
        transferCustomer: true,
      })
    );
  });

  it("keeps core compatibility properties present and adds bag metrics", async () => {
    mocks.validateBody.mockReturnValue({
      data: makePayload({ status: "unpaid", transactionType: "sale", paid: 0 }),
    });

    const res = await POST(makeRequest({}));
    const captured = getCaptureByEvent("sale_completed") as {
      properties: Record<string, unknown>;
    };

    expect(res.status).toBe(201);
    expect(captured.properties).toHaveProperty("transaction_id");
    expect(captured.properties).toHaveProperty("customer_id");
    expect(captured.properties).toHaveProperty("total_amount");
    expect(captured.properties).toHaveProperty("paid_amount");
    expect(captured.properties).toHaveProperty("outstanding_amount");
    expect(captured.properties).toHaveProperty("payment_status");
    expect(captured.properties).toHaveProperty("transaction_type");
    expect(captured.properties).toHaveProperty("transfer_ref");
    expect(captured.properties).toHaveProperty("items_count");
    expect(captured.properties).toHaveProperty("quantity_total");
    expect(captured.properties).toHaveProperty("bags_out");
    expect(captured.properties).toHaveProperty("bags_returned");
    expect(captured.properties).toHaveProperty("bags_bought");
    expect(captured.properties).toHaveProperty("printed_bill_number");
    expect(captured.properties).toHaveProperty("bill_number");
    expect(captured.properties).toHaveProperty("internal_reference");
    expect(captured.properties).toHaveProperty("sale_date");
    expect(captured.properties).toHaveProperty("sale_time");
    expect(captured.properties).toHaveProperty("is_backdated");
    expect(captured.properties).toHaveProperty("warning_count");
    expect(captured.properties).toHaveProperty("source_system");
  });

  it("keeps bag-only manual returns visible in snapshot analytics", async () => {
    const db = makeDbMock();
    db.query.productTypes.findFirst.mockResolvedValueOnce({ id: 9 });
    mocks.getDbForFactory.mockReturnValueOnce(db);
    mocks.summarizeSaleBagFlow.mockReturnValueOnce({
      bagsReturned: 4,
      bagsOut: 0,
      bagsBought: 0,
    });
    mocks.validateBody.mockReturnValue({
      data: makePayload({
        items: [{ productTypeId: 1, quantity: 0, unitPrice: 100 }],
        bagReturns: [{ productTypeId: 9, quantity: 4 }],
        status: "paid",
        paid: -1,
      }),
    });

    const res = await POST(makeRequest({}));
    const analyticsSnapshot = getCaptureByEvent("sale_analytics_snapshot");

    expect(res.status).toBe(201);
    expect(analyticsSnapshot).toEqual(
      expect.objectContaining({
        event: "sale_analytics_snapshot",
        properties: expect.objectContaining({
          actor_user_id: 7,
          actor_role: "manager",
          items_count: 0,
          quantity_total: 0,
          bags_out: 0,
          bags_returned: 4,
          bags_bought: 0,
        }),
      })
    );
  });

  it("marks backdated transaction creates clearly in the audit details", async () => {
    mocks.evaluateTransactionDateTimePolicy.mockReturnValueOnce({
      ok: true,
      data: {
        effectiveSaleDate: "2026-03-20",
        effectiveSaleTime: "09:30:00",
        isBackdated: true,
        backdateMinutes: 360,
      },
    });
    mocks.validateBody.mockReturnValue({
      data: makePayload({
        saleDate: "2026-03-20",
        saleTime: "09:30:00",
        backdateReason: "missed entry",
      }),
    });

    const res = await POST(makeRequest({}));

    expect(res.status).toBe(201);
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "transaction.create",
        details: expect.objectContaining({
          auditSummary: "backdated transaction",
          backdatedTransaction: true,
          isBackdated: true,
        }),
      }),
      expect.anything()
    );
  });

  it("returns auth response when requireManagerUp fails", async () => {
    mocks.requireManagerUp.mockResolvedValueOnce({
      error: NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 }),
    });

    const res = await POST(makeRequest({}));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("ไม่ได้เข้าสู่ระบบ");
    expect(mocks.capture).not.toHaveBeenCalled();
  });
});

describe("GET /api/transactions customerQuery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireManagerUp.mockResolvedValue({
      user: {
        id: 7,
        username: "manager-si",
        role: "admin",
        factoryKey: "si",
      },
    });
  });

  it("supports comma-separated customer ids without doing a name lookup", async () => {
    const findMany = vi.fn(async () => [
      { id: 1, customerId: 101, saleDate: "2026-03-26", saleTime: "08:00:00", status: "paid" },
      { id: 2, customerId: 102, saleDate: "2026-03-26", saleTime: "09:00:00", status: "paid" },
    ]);
    const select = vi.fn();
    mocks.getDb.mockResolvedValue({
      query: {
        transactions: { findMany },
      },
      select,
    });

    const res = await GET(makeGetRequest("customerQuery=%23101,%20%23102&startDate=2026-03-01&endDate=2026-03-31"));
    const body = (await res.json()) as Array<{ customerId: number }>;

    expect(res.status).toBe(200);
    expect(body.map((row) => row.customerId)).toEqual([101, 102]);
    expect(select).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it("still resolves customer name queries through the customer lookup path", async () => {
    const selectChain = {
      from: vi.fn(() => selectChain),
      where: vi.fn(() => selectChain),
      limit: vi.fn(async () => [{ id: 77 }]),
    };
    const findMany = vi.fn(async () => [{ id: 3, customerId: 77, saleDate: "2026-03-26", saleTime: "10:00:00", status: "paid" }]);
    const select = vi.fn(() => selectChain);
    mocks.getDb.mockResolvedValue({
      select,
      query: {
        transactions: { findMany },
      },
    });

    const res = await GET(makeGetRequest("customerQuery=Alpha&startDate=2026-03-01&endDate=2026-03-31"));
    const body = (await res.json()) as Array<{ customerId: number }>;

    expect(res.status).toBe(200);
    expect(body.map((row) => row.customerId)).toEqual([77]);
    expect(select).toHaveBeenCalledTimes(1);
    expect(selectChain.limit).toHaveBeenCalledWith(300);
  });

  it("accepts exact 4-digit bill searches without falling back to customer-name lookup", async () => {
    const findMany = vi.fn(async () => [
      {
        id: 42,
        customerId: 77,
        saleDate: "2026-03-26",
        saleTime: "10:00:00",
        status: "paid",
        printedBillNumber: 42,
        transactionKind: "sale",
        transferRef: null,
      },
    ]);
    const select = vi.fn();
    mocks.getDb.mockResolvedValue({
      select,
      query: {
        transactions: { findMany },
      },
    });

    const res = await GET(makeGetRequest("customerQuery=0042&startDate=2026-03-01&endDate=2026-03-31"));
    const body = (await res.json()) as Array<{ billNumber: string }>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject([{ billNumber: "0042" }]);
    expect(select).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
