import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireManagerUp: vi.fn(),
  resolveSupplyWriteContext: vi.fn(),
  resolveSupplyReadContext: vi.fn(),
  validateSupplyRequestTargetFactoryKey: vi.fn(),
  logAudit: vi.fn(),
  getDbForFactory: vi.fn(),
  submitRequest: vi.fn(),
  approveRequest: vi.fn(),
  rejectRequest: vi.fn(),
  fulfillRequest: vi.fn(),
  cancelRequest: vi.fn(),
  updateDraftRequest: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireManagerUp: mocks.requireManagerUp,
}));

vi.mock("@/db", () => ({
  getDbForFactory: mocks.getDbForFactory,
}));

vi.mock("@/lib/supply/route-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supply/route-helpers")>("@/lib/supply/route-helpers");
  return {
    ...actual,
    ensureFactoryKey: vi.fn((factoryKey: string) =>
      ["si", "bearing"].includes(factoryKey) ? factoryKey : null
    ),
    resolveSupplyWriteContext: mocks.resolveSupplyWriteContext,
    resolveSupplyReadContext: mocks.resolveSupplyReadContext,
    validateSupplyRequestTargetFactoryKey: mocks.validateSupplyRequestTargetFactoryKey,
  };
});

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
}));

vi.mock("@/lib/supply/request-engine", () => ({
  submitRequest: mocks.submitRequest,
  approveRequest: mocks.approveRequest,
  rejectRequest: mocks.rejectRequest,
  fulfillRequest: mocks.fulfillRequest,
  cancelRequest: mocks.cancelRequest,
  updateDraftRequest: mocks.updateDraftRequest,
}));

import { GET, POST, PUT } from "@/app/api/supply/requests/[id]/route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/supply/requests/41", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/supply/requests/[id]", () => {
  const db = {
    select: vi.fn(),
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
    mocks.requireManagerUp.mockResolvedValue({
      user: { id: 9, username: "office", role: "office", factoryKey: "si" },
    });
    mocks.resolveSupplyWriteContext.mockReturnValue({
      factoryKey: "si",
      db,
    });
    mocks.resolveSupplyReadContext.mockReturnValue({
      factoryKey: "si",
      db,
    });
    mocks.logAudit.mockResolvedValue(undefined);
    mocks.getDbForFactory.mockImplementation((factoryKey: string) => {
      if (factoryKey === "bearing") return db;
      if (factoryKey === "si") return db;
      return db;
    });
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
    db.query.supplyRequests.findFirst.mockResolvedValue({
      id: 41,
      factoryKey: "si",
      status: "pending",
      items: [],
    });
    const selectOrderBy = vi.fn().mockResolvedValue([
      { id: 41, createdAt: new Date("2026-05-01T00:00:00.000Z") },
    ]);
    const selectWhere = vi.fn(() => ({ orderBy: selectOrderBy }));
    const selectFrom = vi.fn(() => ({ where: selectWhere }));
    db.select.mockReturnValue({ from: selectFrom });
  });

  it("routes approve action through approveRequest and logs approval scope", async () => {
    mocks.approveRequest.mockResolvedValue({ status: "approved" });
    db.query.supplyRequests.findFirst
      .mockResolvedValueOnce({ id: 41, factoryKey: "si", status: "pending" })
      .mockResolvedValueOnce({ id: 41, factoryKey: "si", status: "approved", items: [] });

    const res = await POST(makeRequest({
      action: "approve",
      signature: " manager-pin ",
      approvedQtys: [
        { requestItemId: 1001, quantity: 3 },
        { requestItemId: 1002, quantity: "5" },
        { requestItemId: null, quantity: 2 },
      ],
    }), { params: Promise.resolve({ id: "41" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ id: 41, status: "approved" });
    expect(mocks.approveRequest).toHaveBeenCalledWith(
      db,
      41,
      { id: 9, username: "office", role: "office", factoryKey: "si" },
      [
        { requestItemId: 1001, quantity: 3 },
        { requestItemId: 1002, quantity: 5 },
      ],
      "manager-pin",
      { stockDb: undefined }
    );
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "supply.request.approve",
        entityId: 41,
        details: expect.objectContaining({
          actorFactoryKey: "si",
          approvalFactoryKey: "si",
          status: "approved",
        }),
      }),
      db
    );
  });

  it("lets the source factory approve an incoming cross-factory request from the requester database", async () => {
    const requesterDb = {
      ...db,
      query: {
        ...db.query,
        supplyRequests: {
          findFirst: vi.fn(),
        },
      },
    };
    const sourceDb = { select: vi.fn(), query: { supplyRequests: { findFirst: vi.fn() } } };
    mocks.resolveSupplyWriteContext.mockReturnValueOnce({
      factoryKey: "si",
      db: sourceDb,
    });
    mocks.getDbForFactory.mockImplementation((factoryKey: string) => {
      if (factoryKey === "bearing") return requesterDb;
      if (factoryKey === "si") return sourceDb;
      return db;
    });
    mocks.approveRequest.mockResolvedValue({ status: "approved" });
    requesterDb.query.supplyRequests.findFirst
      .mockResolvedValueOnce({
        id: 41,
        factoryKey: "bearing",
        requestType: "cross_factory",
        targetFactoryKey: "si",
        status: "pending",
      })
      .mockResolvedValueOnce({
        id: 41,
        factoryKey: "bearing",
        requestType: "cross_factory",
        targetFactoryKey: "si",
        status: "approved",
        createdBy: 9,
        approvedBy: 9,
        items: [],
      });

    const res = await POST(
      new NextRequest("http://localhost/api/supply/requests/41?factoryKey=bearing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", signature: "manager-pin" }),
      }),
      { params: Promise.resolve({ id: "41" }) }
    );

    expect(res.status).toBe(200);
    expect(mocks.approveRequest).toHaveBeenCalledWith(
      requesterDb,
      41,
      { id: 9, username: "office", role: "office", factoryKey: "si" },
      [],
      "manager-pin",
      { stockDb: sourceDb }
    );
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          factoryKey: "bearing",
          actorFactoryKey: "si",
          approvalFactoryKey: "si",
        }),
      }),
      requesterDb
    );
  });

  it("prevents the requester factory from approving its own cross-factory request", async () => {
    db.query.supplyRequests.findFirst.mockResolvedValueOnce({
      id: 41,
      factoryKey: "bearing",
      requestType: "cross_factory",
      targetFactoryKey: "si",
      status: "pending",
    });
    mocks.resolveSupplyWriteContext.mockReturnValueOnce({
      factoryKey: "bearing",
      db,
    });

    const res = await POST(
      new NextRequest("http://localhost/api/supply/requests/41", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", signature: "manager-pin" }),
      }),
      { params: Promise.resolve({ id: "41" }) }
    );
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("ไม่มีสิทธิ์ทำรายการนี้จากโรงงานปัจจุบัน");
    expect(mocks.approveRequest).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("rejects unknown actions before calling the engine", async () => {
    const res = await POST(makeRequest({ action: "archive" }), {
      params: Promise.resolve({ id: "41" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("action ไม่ถูกต้อง");
    expect(mocks.submitRequest).not.toHaveBeenCalled();
    expect(mocks.approveRequest).not.toHaveBeenCalled();
    expect(mocks.rejectRequest).not.toHaveBeenCalled();
    expect(mocks.fulfillRequest).not.toHaveBeenCalled();
    expect(mocks.cancelRequest).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("updates draft requests through PUT and logs the edit", async () => {
    mocks.updateDraftRequest.mockResolvedValue({ status: "draft" });
    db.query.supplyRequests.findFirst
      .mockResolvedValueOnce({ id: 41, factoryKey: "si", status: "draft", items: [] })
      .mockResolvedValueOnce({ id: 41, factoryKey: "si", status: "draft", items: [] });

    const res = await PUT(
      new NextRequest("http://localhost/api/supply/requests/41", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestType: "internal_factory",
          targetFactoryKey: null,
          requesterName: "packing",
          note: "save later",
          items: [{ supplyItemId: 2, quantity: 2, quantityUnit: "pack" }],
        }),
      }),
      { params: Promise.resolve({ id: "41" }) }
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ id: 41, status: "draft" });
    expect(mocks.updateDraftRequest).toHaveBeenCalledWith(
      db,
      41,
      {
        requestType: "internal_factory",
        targetFactoryKey: null,
        requesterName: "packing",
        note: "save later",
        items: [{ supplyItemId: 2, quantityRequested: 24, note: null }],
      }
    );
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "supply.request.update_draft",
        entityId: 41,
        details: expect.objectContaining({ itemCount: 1, requestType: "internal_factory" }),
      }),
      db
    );
  });

  it("loads request detail without failing when the factory DB cannot join users", async () => {
    const createdAt = new Date("2026-05-01T00:00:00.000Z");
    db.query.supplyRequests.findFirst.mockRejectedValueOnce(
      new Error('relation "users" does not exist')
    );

    let selectCall = 0;
    db.select.mockImplementation((selection?: unknown) => {
      const currentCall = selectCall++;

      if (selection && typeof selection === "object") {
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              orderBy: vi.fn().mockResolvedValue([{ id: 41, createdAt }]),
            })),
          })),
        };
      }

      if (currentCall === 0) {
        return {
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue([
                {
                  id: 41,
                  factoryKey: "si",
                  requestType: "internal_factory",
                  targetFactoryKey: null,
                  requesterName: "packing",
                  createdBy: 9,
                  approvedBy: 12,
                  status: "approved",
                  note: null,
                  approverSignature: "pin",
                  approvedAt: createdAt,
                  fulfilledAt: null,
                  createdAt,
                  updatedAt: createdAt,
                },
              ]),
            })),
          })),
        };
      }

      return {
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn().mockResolvedValue([
              {
                id: 7,
                requestId: 41,
                supplyItemId: 2,
                quantityRequested: 24,
                quantityApproved: 24,
                note: null,
              },
            ]),
          })),
        })),
      };
    });

    const res = await GET(new NextRequest("http://localhost/api/supply/requests/41"), {
      params: Promise.resolve({ id: "41" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.id).toBe(41);
  });

  it("returns fallback users when a request references missing users", async () => {
    db.query.supplyRequests.findFirst.mockResolvedValueOnce({
      id: 41,
      factoryKey: "si",
      requestType: "internal_factory",
      targetFactoryKey: null,
      requesterName: "packing",
      createdBy: 9,
      approvedBy: 12,
      status: "approved",
      note: null,
      approverSignature: "pin",
      approvedAt: "2026-05-01T00:00:00.000Z",
      fulfilledAt: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
      createdByUser: null,
      approvedByUser: null,
      items: [],
    });

    const res = await GET(new NextRequest("http://localhost/api/supply/requests/41"), {
      params: Promise.resolve({ id: "41" }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.createdByUser).toMatchObject({
      id: 9,
      username: "[missing creator #9]",
      isFallback: true,
    });
    expect(body.approvedByUser).toMatchObject({
      id: 12,
      username: "[missing approver #12]",
      isFallback: true,
    });
  });
});
