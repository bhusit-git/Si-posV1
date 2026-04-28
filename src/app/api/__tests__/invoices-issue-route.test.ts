import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireOfficeUp: vi.fn(),
  getDb: vi.fn(),
  getDbForFactory: vi.fn(),
  getFactories: vi.fn(() => [{ key: "si", name: "SI" }]),
  todayISO: vi.fn(),
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

vi.mock("@/lib/thai-utils", () => ({
  todayISO: mocks.todayISO,
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

import { POST } from "@/app/api/invoices/[id]/issue/route";
import { getInvoiceStartSeq } from "@/lib/invoice-issue";

type AnyObj = Record<string, unknown>;

function makeRequest(
  body: Record<string, unknown> = {},
  headers?: Record<string, string>
): NextRequest {
  return new NextRequest("http://localhost/api/invoices/1/issue", {
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
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(async () => rows);
  return chain;
}

function buildWhereQuery(rows: AnyObj[]) {
  const chain: AnyObj = {};
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(async () => rows);
  return chain;
}

function buildUpdateQuery(rows: AnyObj[]) {
  const chain: AnyObj = {};
  chain.set = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.returning = vi.fn(async () => rows);
  return chain;
}

describe("POST /api/invoices/[id]/issue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_INVOICE_DUPLICATE_WORKFLOW;
    mocks.todayISO.mockReturnValue("2026-03-02");
    mocks.requireOfficeUp.mockResolvedValue({
      user: { id: 99, username: "office", role: "office", factoryKey: "si" },
    });
    mocks.readIdempotencyKey.mockReturnValue(null);
    mocks.stableHash.mockReturnValue("hash-1");
    mocks.claimOrReplay.mockResolvedValue({ kind: "proceed", claimId: 1 });
    mocks.completeClaim.mockResolvedValue(undefined);
    mocks.resolveActiveFactoryKey.mockResolvedValue("si");
    mocks.getPostHogClient.mockReturnValue({ capture: mocks.capture });
  });

  it("validates dueDate format", async () => {
    const res = await POST(makeRequest({ dueDate: "02-03-2026" }), makeContext("10"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("invalid dueDate format");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects dueDate earlier than issueDate", async () => {
    const res = await POST(makeRequest({ dueDate: "2026-03-01" }), makeContext("10"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("dueDate must be on or after issueDate");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("issues draft invoice and returns generated invoice number", async () => {
    const txSelectQueue = [
      buildSelectQuery([{ id: 10, status: "draft", invoiceNo: null }]),
      buildWhereQuery([{ transactionId: 101 }]),
      buildWhereQuery([]),
    ];
    const tx = {
      select: vi.fn(() => txSelectQueue.shift()),
      execute: vi.fn(async () => [{ seq: 12 }]),
      update: vi.fn(() =>
        buildUpdateQuery([
          {
            id: 10,
            invoiceNo: "INV-SI-2026-00012",
            status: "issued",
            issueDate: "2026-03-02",
            dueDate: "2026-03-09",
          },
        ])
      ),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(makeRequest(), makeContext("10"));
    const body = (await res.json()) as {
      id: number;
      invoiceNo: string;
      status: string;
      issueDate: string;
      dueDate: string;
    };

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      id: 10,
      invoiceNo: "INV-SI-2026-00012",
      status: "issued",
      issueDate: "2026-03-02",
      dueDate: "2026-03-09",
    });
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "user:99",
        event: "invoice.issued",
        properties: expect.objectContaining({
          schema_version: 2,
          app: "superice-pos",
          event_origin: "server",
          factory_key: "si",
          actor_user_id: 99,
          actor_role: "office",
          invoice_id: 10,
          invoice_no: "INV-SI-2026-00012",
          issue_date: "2026-03-02",
          due_date: "2026-03-09",
          idempotent_replay: false,
        }),
      })
    );
  });

  it("uses the resolved active factory for invoice numbering when session factory is missing", async () => {
    mocks.requireOfficeUp.mockResolvedValueOnce({
      user: { id: 99, username: "office", role: "office", factoryKey: null },
    });
    const txSelectQueue = [
      buildSelectQuery([{ id: 10, status: "draft", invoiceNo: null }]),
      buildWhereQuery([{ transactionId: 101 }]),
      buildWhereQuery([]),
    ];
    const tx = {
      select: vi.fn(() => txSelectQueue.shift()),
      execute: vi.fn(async () => [{ seq: 1732 }]),
      update: vi.fn(() =>
        buildUpdateQuery([
          {
            id: 10,
            invoiceNo: "INV-SI-2026-01732",
            status: "issued",
            issueDate: "2026-03-02",
            dueDate: "2026-03-09",
          },
        ])
      ),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(
      makeRequest({}, { Cookie: "superice_factory=si" }),
      makeContext("10")
    );
    const body = (await res.json()) as {
      id: number;
      invoiceNo: string;
      status: string;
    };

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      id: 10,
      invoiceNo: "INV-SI-2026-01732",
      status: "issued",
    });
    expect(mocks.getDbForFactory).toHaveBeenCalledWith("si");
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        properties: expect.objectContaining({
          factory_key: "si",
          invoice_no: "INV-SI-2026-01732",
        }),
      })
    );
  });

  it("rejects issuing non-draft invoice", async () => {
    const tx = {
      select: vi.fn(() =>
        buildSelectQuery([{ id: 10, status: "issued", invoiceNo: "INV-SI-2026-00001" }])
      ),
      execute: vi.fn(),
      update: vi.fn(),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(makeRequest(), makeContext("10"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("ออกใบวางบิลได้เฉพาะสถานะ draft");
    expect(tx.execute).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("rejects issuing a draft when its transactions already exist in another active invoice", async () => {
    const txSelectQueue = [
      buildSelectQuery([{ id: 10, status: "draft", invoiceNo: null }]),
      buildWhereQuery([{ transactionId: 101 }]),
      buildWhereQuery([
        {
          transactionId: 101,
          invoiceId: 88,
          invoiceStatus: "issued",
          invoiceNo: "INV-SI-2026-00088",
        },
      ]),
    ];
    const tx = {
      select: vi.fn(() => txSelectQueue.shift()),
      execute: vi.fn(),
      update: vi.fn(),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(makeRequest(), makeContext("10"));
    const body = (await res.json()) as {
      error: string;
      conflicts: Array<{ invoiceId: number; invoiceNo: string; transactionId: number }>;
    };

    expect(res.status).toBe(409);
    expect(body.error).toBe("Some transactions already exist in an active invoice");
    expect(body.conflicts).toEqual([
      expect.objectContaining({
        invoiceId: 88,
        invoiceNo: "INV-SI-2026-00088",
        transactionId: 101,
      }),
    ]);
    expect(tx.execute).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("allows issuing a draft with duplicate active transactions when override is confirmed", async () => {
    const txSelectQueue = [
      buildSelectQuery([{ id: 10, status: "draft", invoiceNo: null }]),
      buildWhereQuery([{ transactionId: 101 }]),
      buildWhereQuery([
        {
          transactionId: 101,
          invoiceId: 88,
          invoiceStatus: "issued",
          invoiceNo: "INV-SI-2026-00088",
        },
      ]),
    ];
    const tx = {
      select: vi.fn(() => txSelectQueue.shift()),
      execute: vi.fn(async () => [{ seq: 12 }]),
      update: vi.fn(() =>
        buildUpdateQuery([
          {
            id: 10,
            invoiceNo: "INV-SI-2026-00012",
            status: "issued",
            issueDate: "2026-03-02",
            dueDate: "2026-03-09",
          },
        ])
      ),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(
      makeRequest({ allowDuplicateActiveInvoice: true }),
      makeContext("10")
    );
    const body = (await res.json()) as {
      id: number;
      invoiceNo: string;
      status: string;
    };

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      id: 10,
      invoiceNo: "INV-SI-2026-00012",
      status: "issued",
    });
    expect(tx.execute).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledTimes(1);
  });

  it("restores strict duplicate blocking even when override is requested", async () => {
    process.env.NEXT_PUBLIC_INVOICE_DUPLICATE_WORKFLOW = "strict";

    const txSelectQueue = [
      buildSelectQuery([{ id: 10, status: "draft", invoiceNo: null }]),
      buildWhereQuery([{ transactionId: 101 }]),
      buildWhereQuery([
        {
          transactionId: 101,
          invoiceId: 88,
          invoiceStatus: "issued",
          invoiceNo: "INV-SI-2026-00088",
        },
      ]),
    ];
    const tx = {
      select: vi.fn(() => txSelectQueue.shift()),
      execute: vi.fn(),
      update: vi.fn(),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(
      makeRequest({ allowDuplicateActiveInvoice: true }),
      makeContext("10")
    );
    const body = (await res.json()) as {
      error: string;
      conflicts: Array<{ invoiceId: number; invoiceNo: string; transactionId: number }>;
    };

    expect(res.status).toBe(409);
    expect(body.error).toBe("Some transactions already exist in an active invoice");
    expect(body.conflicts).toEqual([
      expect.objectContaining({
        invoiceId: 88,
        invoiceNo: "INV-SI-2026-00088",
        transactionId: 101,
      }),
    ]);
    expect(tx.execute).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });

  it("returns auth response when requireOfficeUp fails", async () => {
    mocks.requireOfficeUp.mockResolvedValueOnce({
      error: NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 }),
    });

    const res = await POST(makeRequest(), makeContext("10"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("ไม่ได้เข้าสู่ระบบ");
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
  });

  it("starts SI invoice sequence at 01732 in 2026", () => {
    expect(getInvoiceStartSeq("si", 2026)).toBe(1732);
  });

  it("keeps default invoice sequence for other factory/year", () => {
    expect(getInvoiceStartSeq("si", 2027)).toBe(1);
    expect(getInvoiceStartSeq("abc", 2026)).toBe(1);
  });

  it("replays idempotent issue without consuming new sequence", async () => {
    mocks.readIdempotencyKey.mockReturnValue("idem-issue-1");
    mocks.claimOrReplay.mockResolvedValue({
      kind: "replay",
      claimId: 5,
      invoiceId: 10,
      invoicePaymentId: null,
    });
    const tx = {
      select: vi.fn(() =>
        buildSelectQuery([
          {
            id: 10,
            invoiceNo: "INV-SI-2026-02000",
            status: "issued",
            issueDate: "2026-03-02",
            dueDate: "2026-03-09",
          },
        ])
      ),
      execute: vi.fn(),
      update: vi.fn(),
      insert: vi.fn(),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(
      makeRequest({}, { "Idempotency-Key": "idem-issue-1" }),
      makeContext("10")
    );
    const body = (await res.json()) as {
      id: number;
      invoiceNo: string;
      status: string;
      idempotentReplay: boolean;
      idempotencyKey: string;
    };

    expect(res.status).toBe(200);
    expect(body.idempotentReplay).toBe(true);
    expect(body.idempotencyKey).toBe("idem-issue-1");
    expect(body.invoiceNo).toBe("INV-SI-2026-02000");
    expect(tx.execute).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "invoice.issued",
        properties: expect.objectContaining({
          invoice_id: 10,
          invoice_no: "INV-SI-2026-02000",
          issue_date: "2026-03-02",
          due_date: "2026-03-09",
          idempotent_replay: true,
        }),
      })
    );
  });

  it("returns idempotency conflict when same key is reused with different payload hash", async () => {
    mocks.readIdempotencyKey.mockReturnValue("idem-issue-conflict");
    mocks.claimOrReplay.mockResolvedValue({ kind: "conflict" });
    const tx = {
      select: vi.fn(),
      execute: vi.fn(),
      update: vi.fn(),
      insert: vi.fn(),
    };
    const transaction = vi.fn(async (callback: (arg: typeof tx) => Promise<unknown>) =>
      callback(tx)
    );
    mocks.getDbForFactory.mockReturnValue({ transaction });

    const res = await POST(
      makeRequest({}, { "Idempotency-Key": "idem-issue-conflict" }),
      makeContext("10")
    );
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(409);
    expect(body.error).toBe("idempotency_key_conflict");
    expect(tx.execute).not.toHaveBeenCalled();
    expect(tx.update).not.toHaveBeenCalled();
  });
});
