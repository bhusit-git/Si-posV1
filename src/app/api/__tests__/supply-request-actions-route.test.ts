import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireManagerUp: vi.fn(),
  resolveSupplyWriteContext: vi.fn(),
  logAudit: vi.fn(),
  submitRequest: vi.fn(),
  approveRequest: vi.fn(),
  rejectRequest: vi.fn(),
  fulfillRequest: vi.fn(),
  cancelRequest: vi.fn(),
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
  submitRequest: mocks.submitRequest,
  approveRequest: mocks.approveRequest,
  rejectRequest: mocks.rejectRequest,
  fulfillRequest: mocks.fulfillRequest,
  cancelRequest: mocks.cancelRequest,
}));

import { POST } from "@/app/api/supply/requests/[id]/route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/supply/requests/41", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/supply/requests/[id]", () => {
  const db = {
    query: {
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
    mocks.logAudit.mockResolvedValue(undefined);
    db.query.supplyRequests.findFirst.mockResolvedValue({
      id: 41,
      factoryKey: "si",
      status: "pending",
      items: [],
    });
  });

  it("routes approve action through approveRequest and logs the signature", async () => {
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
      "manager-pin"
    );
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "supply.request.approve",
        entityId: 41,
        details: expect.objectContaining({ signature: "manager-pin", status: "approved" }),
      }),
      db
    );
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
});
