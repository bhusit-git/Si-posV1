import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireManagerUp: vi.fn(),
  resolveSupplyWriteContext: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireManagerUp: mocks.requireManagerUp,
}));

vi.mock("@/lib/supply/route-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supply/route-helpers")>("@/lib/supply/route-helpers");
  return {
    ...actual,
    resolveSupplyWriteContext: mocks.resolveSupplyWriteContext,
    resolveSupplyReadContext: vi.fn(),
  };
});

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
}));

import { POST } from "@/app/api/supply/requests/route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/supply/requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/supply/requests invalid input", () => {
  const db = {
    transaction: vi.fn(),
    query: {
      supplyRequests: {
        findFirst: vi.fn(),
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireManagerUp.mockResolvedValue({
      user: { id: 4, username: "manager", role: "manager", factoryKey: "si" },
    });
    mocks.resolveSupplyWriteContext.mockReturnValue({ factoryKey: "si", db });
  });

  it("rejects cross-factory requests without a targetFactoryKey", async () => {
    const res = await POST(
      makeRequest({
        requestType: "cross_factory",
        requesterName: "packing",
        items: [{ supplyItemId: 2, quantity: 4 }],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("กรุณาเลือกโรงงานต้นทางสำหรับการเบิกข้ามโรงงาน");
    expect(db.transaction).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("rejects requests whose items normalize to an empty list", async () => {
    const res = await POST(
      makeRequest({
        requestType: "internal_factory",
        items: [{ supplyItemId: null, quantity: 0 }],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("กรุณาระบุรายการเบิกอย่างน้อย 1 รายการ");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects requests without requesterName", async () => {
    const res = await POST(
      makeRequest({
        requestType: "internal_factory",
        items: [{ supplyItemId: 2, quantity: 4 }],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("กรุณาระบุผู้ขอใช้จริง");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("creates requests even when user relations cannot be joined after insert", async () => {
    const insertedRequest = {
      id: 41,
      factoryKey: "si",
      requestType: "internal_factory",
      targetFactoryKey: null,
      requesterName: "packing",
      createdBy: 4,
      approvedBy: null,
      status: "pending",
      note: null,
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    };
    const insertedItems = [
      {
        id: 7,
        requestId: 41,
        supplyItemId: 2,
        quantityRequested: 4,
        quantityApproved: null,
        note: null,
      },
    ];

    db.transaction.mockImplementation(async (callback) =>
      callback({
        insert: (table: unknown) => ({
          values: () => ({
            returning: async () => (table === undefined ? [] : [insertedRequest]),
          }),
        }),
      })
    );
    db.query.supplyRequests.findFirst.mockRejectedValueOnce(new Error('relation "users" does not exist'));
    // Fallback path uses the select builder for the request row, items, and monthly request refs.
    const selectRequestLimit = vi.fn().mockResolvedValue([insertedRequest]);
    const selectRequestWhere = vi.fn(() => ({ limit: selectRequestLimit }));
    const selectItemsOrderBy = vi.fn().mockResolvedValue(insertedItems);
    const selectItemsWhere = vi.fn(() => ({ orderBy: selectItemsOrderBy }));
    const selectRefsOrderBy = vi.fn().mockResolvedValue([{ id: 41, createdAt: insertedRequest.createdAt }]);
    const selectRefsWhere = vi.fn(() => ({ orderBy: selectRefsOrderBy }));
    const selectFrom = vi
      .fn()
      .mockReturnValueOnce({ where: selectRequestWhere })
      .mockReturnValueOnce({ where: selectItemsWhere })
      .mockReturnValueOnce({ where: selectRefsWhere });
    const select = vi.fn(() => ({ from: selectFrom }));
    Object.assign(db, { select });

    const res = await POST(
      makeRequest({
        requestType: "internal_factory",
        requesterName: "packing",
        status: "pending",
        items: [{ supplyItemId: 2, quantity: 4 }],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      id: 41,
      factoryKey: "si",
      requesterName: "packing",
      status: "pending",
      items: [
        {
          requestId: 41,
          supplyItemId: 2,
          quantityRequested: 4,
        },
      ],
      createdByUser: null,
      approvedByUser: null,
      requestRef: "REQ-20260501-001",
    });
    expect(mocks.logAudit).toHaveBeenCalled();
  });
});
