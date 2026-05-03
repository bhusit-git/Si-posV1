import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireManagerUp: vi.fn(),
  resolveSupplyWriteContext: vi.fn(),
  validateSupplyRequestTargetFactoryKey: vi.fn(),
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
    validateSupplyRequestTargetFactoryKey: mocks.validateSupplyRequestTargetFactoryKey,
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
      supplyItems: {
        findMany: vi.fn(),
      },
      supplyRequests: {
        findFirst: vi.fn(),
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    db.transaction.mockReset();
    db.query.supplyItems.findMany.mockReset();
    db.query.supplyRequests.findFirst.mockReset();
    delete (db as { select?: unknown }).select;
    mocks.requireManagerUp.mockResolvedValue({
      user: { id: 4, username: "manager", role: "manager", factoryKey: "si" },
    });
    mocks.resolveSupplyWriteContext.mockReturnValue({ factoryKey: "si", db });
    mocks.validateSupplyRequestTargetFactoryKey.mockImplementation((requestType, targetFactoryKey, options) => {
      if (requestType !== "cross_factory") return { targetFactoryKey: null, error: null };
      if (!targetFactoryKey) {
        return options?.allowEmpty
          ? { targetFactoryKey: null, error: null }
          : { targetFactoryKey: null, error: "กรุณาเลือกโรงงานต้นทางสำหรับการเบิกข้ามโรงงาน" };
      }
      if (targetFactoryKey === "bearng") {
        return { targetFactoryKey: null, error: "โรงงานต้นทางไม่ถูกต้อง" };
      }
      return { targetFactoryKey, error: null };
    });
    db.query.supplyItems.findMany.mockResolvedValue([
      { id: 2, name: "ถุงแพ็ค", unit: "อัน", packSize: 12 },
    ]);
  });

  it("rejects cross-factory requests without a targetFactoryKey", async () => {
    const res = await POST(
      makeRequest({
        status: "pending",
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

  it("rejects cross-factory requests with an invalid targetFactoryKey", async () => {
    const res = await POST(
      makeRequest({
        status: "pending",
        requestType: "cross_factory",
        targetFactoryKey: "bearng",
        requesterName: "packing",
        items: [{ supplyItemId: 2, quantity: 4 }],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("โรงงานต้นทางไม่ถูกต้อง");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects cross-factory requests whose source factory is the requester factory", async () => {
    const res = await POST(
      makeRequest({
        status: "pending",
        requestType: "cross_factory",
        targetFactoryKey: "si",
        requesterName: "packing",
        items: [{ supplyItemId: 2, quantity: 4 }],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("โรงงานต้นทางและโรงงานผู้ขอต้องไม่ซ้ำกัน");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects requests whose items normalize to an empty list", async () => {
    const res = await POST(
      makeRequest({
        status: "pending",
        requestType: "internal_factory",
        items: [{ supplyItemId: null, quantity: 0 }],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("กรุณาระบุรายการเบิกอย่างน้อย 1 รายการ");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects requests with unknown quantity units", async () => {
    const res = await POST(
      makeRequest({
        requestType: "internal_factory",
        requesterName: "packing",
        items: [{ supplyItemId: 2, quantity: 2, quantityUnit: "packs" }],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("หน่วยจำนวนไม่ถูกต้อง");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects fractional quantities instead of truncating them", async () => {
    const res = await POST(
      makeRequest({
        requestType: "internal_factory",
        requesterName: "packing",
        items: [{ supplyItemId: 2, quantity: 1.5, quantityUnit: "pack" }],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("กรุณาระบุจำนวนเต็มที่ถูกต้อง");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("rejects requests without requesterName", async () => {
    const res = await POST(
      makeRequest({
        status: "pending",
        requestType: "internal_factory",
        items: [{ supplyItemId: 2, quantity: 4 }],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("กรุณาระบุผู้ขอใช้จริง");
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("allows saving a sparse draft without requesterName or items", async () => {
    const insertedRequest = {
      id: 41,
      factoryKey: "si",
      requestType: "internal_factory",
      targetFactoryKey: null,
      requesterName: null,
      createdBy: 4,
      approvedBy: null,
      status: "draft",
      note: "ยังรวบรวมรายการไม่ครบ",
      createdAt: new Date("2026-05-01T00:00:00.000Z"),
      updatedAt: new Date("2026-05-01T00:00:00.000Z"),
    };

    db.transaction.mockImplementation(async (callback) =>
      callback({
        insert: () => ({
          values: () => ({
            returning: async () => [insertedRequest],
          }),
        }),
      })
    );
    db.query.supplyRequests.findFirst.mockRejectedValueOnce(new Error('relation "users" does not exist'));
    const selectRequestLimit = vi.fn().mockResolvedValue([insertedRequest]);
    const selectRequestWhere = vi.fn(() => ({ limit: selectRequestLimit }));
    const selectItemsOrderBy = vi.fn().mockResolvedValue([]);
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
        status: "draft",
        requestType: "internal_factory",
        note: "ยังรวบรวมรายการไม่ครบ",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body).toMatchObject({
      id: 41,
      status: "draft",
      requesterName: null,
      items: [],
    });
  });

  it("creates a cross-factory request in the requester factory with the selected source factory", async () => {
    mocks.resolveSupplyWriteContext.mockReturnValueOnce({ factoryKey: "bearing", db });
    const insertedRequest = {
      id: 42,
      factoryKey: "bearing",
      requestType: "cross_factory",
      targetFactoryKey: "si",
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
        id: 8,
        requestId: 42,
        supplyItemId: 2,
        quantityRequested: 24,
        quantityApproved: null,
        note: null,
        supplyItem: { id: 2, name: "ถุงแพ็ค", unit: "อัน", packSize: 12 },
      },
    ];
    const insertedValues: unknown[] = [];

    db.transaction.mockImplementation(async (callback) =>
      callback({
        insert: () => ({
          values: (values: unknown) => {
            insertedValues.push(values);
            return {
              returning: async () => [insertedRequest],
            };
          },
        }),
      })
    );
    db.query.supplyRequests.findFirst.mockResolvedValueOnce({
      ...insertedRequest,
      items: insertedItems,
      createdByUser: null,
      approvedByUser: null,
    });
    const selectRefsOrderBy = vi.fn().mockResolvedValue([{ id: 42, createdAt: insertedRequest.createdAt }]);
    const selectRefsWhere = vi.fn(() => ({ orderBy: selectRefsOrderBy }));
    const selectFrom = vi.fn(() => ({ where: selectRefsWhere }));
    const select = vi.fn(() => ({ from: selectFrom }));
    Object.assign(db, { select });

    const res = await POST(
      makeRequest({
        status: "pending",
        requestType: "cross_factory",
        targetFactoryKey: "si",
        requesterName: "packing",
        items: [{ supplyItemId: 2, quantity: 2, quantityUnit: "pack" }],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(insertedValues[0]).toMatchObject({
      factoryKey: "bearing",
      requestType: "cross_factory",
      targetFactoryKey: "si",
      status: "pending",
    });
    expect(body).toMatchObject({
      id: 42,
      factoryKey: "bearing",
      targetFactoryKey: "si",
      status: "pending",
      items: [{ requestId: 42, quantityRequested: 24 }],
    });
  });

  it("rejects drafts with an invalid targetFactoryKey when requestType is cross_factory", async () => {
    const res = await POST(
      makeRequest({
        status: "draft",
        requestType: "cross_factory",
        targetFactoryKey: "bearng",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("โรงงานต้นทางไม่ถูกต้อง");
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
        quantityRequested: 24,
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
        items: [{ supplyItemId: 2, quantity: 2, quantityUnit: "pack" }],
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
          quantityRequested: 24,
          supplyItem: {
            id: 2,
            name: "ถุงแพ็ค",
            unit: "อัน",
            packSize: 12,
          },
        },
      ],
      createdByUser: null,
      approvedByUser: null,
      requestRef: "REQ-20260501-001",
    });
    expect(mocks.logAudit).toHaveBeenCalled();
  });
});
