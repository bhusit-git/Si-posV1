import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getDb: vi.fn(),
  scanAndPersistAuditFindings: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("@/db", () => ({
  getDb: mocks.getDb,
}));

vi.mock("@/lib/fraud-detection", () => ({
  scanAndPersistAuditFindings: mocks.scanAndPersistAuditFindings,
}));

import { GET, POST } from "@/app/api/audit/findings/route";

function makeBuilder<T>(result: T) {
  const builder = {
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    orderBy: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    offset: vi.fn(() => builder),
    groupBy: vi.fn(() => builder),
    then: (resolve: (value: T) => unknown) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

describe("GET /api/audit/findings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      user: { id: 1, username: "admin", role: "admin" },
    });
  });

  it("returns filtered findings with summary counts", async () => {
    const select = vi
      .fn()
      .mockImplementationOnce(() =>
        makeBuilder([
          {
            id: 10,
            fingerprint: "fp-1",
            ruleKey: "void_after_payment",
            category: "suspicious_cancellations",
            severity: "high",
            riskScore: 82,
            status: "open",
            entity: "transaction",
            entityId: 88,
            userId: 3,
            username: "office-a",
            customerId: 18,
            transactionId: 88,
            title: "ยกเลิกหลังมีการรับชำระ",
            reason: "risk",
            evidence: { paidAmount: 100 },
            reviewNote: null,
            firstSeenAt: new Date("2026-03-15T00:00:00.000Z"),
            lastSeenAt: new Date("2026-03-15T01:00:00.000Z"),
            createdAt: new Date("2026-03-15T00:00:00.000Z"),
            updatedAt: new Date("2026-03-15T01:00:00.000Z"),
          },
        ])
      )
      .mockImplementationOnce(() => makeBuilder([{ count: 1 }]))
      .mockImplementationOnce(() =>
        makeBuilder([
          {
            category: "suspicious_cancellations",
            severity: "high",
            status: "open",
            count: 1,
          },
        ])
      );
    mocks.getDb.mockResolvedValue({ select });

    const req = new NextRequest(
      "http://localhost/api/audit/findings?status=open&severity=high&limit=25"
    );
    const res = await GET(req);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(select).toHaveBeenCalledTimes(3);
    expect(body.total).toBe(1);
    expect((body.findings as Array<Record<string, unknown>>)[0].ruleKey).toBe(
      "void_after_payment"
    );
    expect(body.summary).toMatchObject({
      suspiciousCancellations: 1,
      suspiciousPayments: 0,
      unresolvedCriticalHigh: 1,
      openCount: 1,
    });
  });

  it("excludes legacy credit-only rules from the default fraud feed", async () => {
    const select = vi
      .fn()
      .mockImplementationOnce(() => makeBuilder([]))
      .mockImplementationOnce(() => makeBuilder([{ count: 0 }]))
      .mockImplementationOnce(() => makeBuilder([]));
    mocks.getDb.mockResolvedValue({ select });

    const req = new NextRequest("http://localhost/api/audit/findings?status=open");
    const res = await GET(req);
    expect(res.status).toBe(200);

    const whereCall = select.mock.results[0].value.where;
    expect(whereCall).toHaveBeenCalled();
  });

  it("returns auth error when admin session is missing", async () => {
    mocks.requireAdmin.mockResolvedValueOnce({
      error: NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 }),
    });

    const res = await GET(new NextRequest("http://localhost/api/audit/findings"));
    expect(res.status).toBe(403);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});

describe("POST /api/audit/findings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      user: { id: 9, username: "admin", role: "admin" },
    });
    mocks.getDb.mockResolvedValue({ db: "mock" });
  });

  it("rescans the requested window and returns the detector result", async () => {
    mocks.scanAndPersistAuditFindings.mockResolvedValue({
      findings: [{ ruleKey: "micro_payment_sequence" }],
      upsertedCount: 4,
      targetTransactionCount: 12,
      targetCustomerCount: 5,
    });

    const req = new NextRequest("http://localhost/api/audit/findings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        startDate: "2026-03-01",
        endDate: "2026-03-15",
        customerId: 33,
      }),
    });

    const res = await POST(req);
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(mocks.scanAndPersistAuditFindings).toHaveBeenCalledWith(
      { db: "mock" },
      expect.objectContaining({
        startDate: "2026-03-01",
        endDate: "2026-03-15",
        customerIds: [33],
        userIds: [9],
      })
    );
    expect(body.success).toBe(true);
    expect(body.upsertedCount).toBe(4);
  });

  it("rejects requests without a window or transaction id", async () => {
    const req = new NextRequest("http://localhost/api/audit/findings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(400);
    expect(body.error).toBe("ต้องระบุ transactionId หรือช่วงวันที่สำหรับสแกน");
  });
});
