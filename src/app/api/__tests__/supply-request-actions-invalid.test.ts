import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireManagerUp: vi.fn(),
  resolveSupplyWriteContext: vi.fn(),
  logAudit: vi.fn(),
  approveRequest: vi.fn(),
  submitRequest: vi.fn(),
  rejectRequest: vi.fn(),
  fulfillRequest: vi.fn(),
  cancelRequest: vi.fn(),
  updateDraftRequest: vi.fn(),
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

vi.mock("@/lib/supply/request-engine", () => ({
  approveRequest: mocks.approveRequest,
  submitRequest: mocks.submitRequest,
  rejectRequest: mocks.rejectRequest,
  fulfillRequest: mocks.fulfillRequest,
  cancelRequest: mocks.cancelRequest,
  updateDraftRequest: mocks.updateDraftRequest,
}));

import { POST, PUT } from "@/app/api/supply/requests/[id]/route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/supply/requests/41", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/supply/requests/[id] invalid input", () => {
  const db = {
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
    mocks.resolveSupplyWriteContext.mockReturnValue({ factoryKey: "si", db });
    db.query.supplyItems.findMany.mockResolvedValue([
      { id: 2, name: "ถุงแพ็ค", unit: "อัน", packSize: 12 },
    ]);
    db.query.supplyRequests.findFirst.mockResolvedValue({ id: 41, factoryKey: "si", status: "pending" });
  });

  it("rejects approve requests without a signature before calling the engine", async () => {
    const res = await POST(makeRequest({
      action: "approve",
      signature: "   ",
      approvedQtys: [{ requestItemId: 1001, quantity: 2 }],
    }), { params: Promise.resolve({ id: "41" }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("กรุณาระบุลายเซ็นผู้อนุมัติ");
    expect(mocks.approveRequest).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("rejects draft edits when the request is no longer draft", async () => {
    db.query.supplyRequests.findFirst.mockResolvedValueOnce({
      id: 41,
      factoryKey: "si",
      status: "pending",
      items: [],
    });

    const res = await PUT(
      new NextRequest("http://localhost/api/supply/requests/41", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requesterName: "packing",
          items: [{ supplyItemId: 2, quantity: 1, quantityUnit: "base" }],
        }),
      }),
      { params: Promise.resolve({ id: "41" }) }
    );
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("แก้ไขได้เฉพาะใบเบิกสถานะ draft");
    expect(mocks.updateDraftRequest).not.toHaveBeenCalled();
  });

  it("rejects draft edits with an invalid cross-factory targetFactoryKey", async () => {
    db.query.supplyRequests.findFirst.mockResolvedValueOnce({
      id: 41,
      factoryKey: "si",
      status: "draft",
      items: [],
    });

    const res = await PUT(
      new NextRequest("http://localhost/api/supply/requests/41", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestType: "cross_factory",
          targetFactoryKey: "bearng",
          requesterName: "packing",
          items: [{ supplyItemId: 2, quantity: 1, quantityUnit: "base" }],
        }),
      }),
      { params: Promise.resolve({ id: "41" }) }
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("โรงงานต้นทางไม่ถูกต้อง");
    expect(mocks.updateDraftRequest).not.toHaveBeenCalled();
  });
});
