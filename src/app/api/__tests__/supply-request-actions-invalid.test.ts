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
}));

import { POST } from "@/app/api/supply/requests/[id]/route";

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
});
