import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireManagerUp: vi.fn(),
  resolveSupplyWriteContext: vi.fn(),
  getDbForFactory: vi.fn(),
  ensureFactoryKey: vi.fn(),
  logAudit: vi.fn(),
  createTransfer: vi.fn(),
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
    resolveSupplyWriteContext: mocks.resolveSupplyWriteContext,
    resolveSupplyReadContext: vi.fn(),
    ensureFactoryKey: mocks.ensureFactoryKey,
  };
});

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
}));

vi.mock("@/lib/supply/transfer-engine", () => ({
  createTransfer: mocks.createTransfer,
}));

import { POST } from "@/app/api/supply/transfers/route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/supply/transfers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/supply/transfers invalid input", () => {
  const db = {
    query: {
      supplyRequests: {
        findFirst: vi.fn(),
      },
      supplyRequestItems: {
        findMany: vi.fn(),
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireManagerUp.mockResolvedValue({
      user: { id: 7, username: "manager", role: "manager", factoryKey: "si" },
    });
    mocks.resolveSupplyWriteContext.mockReturnValue({ factoryKey: "si", db });
    mocks.ensureFactoryKey.mockImplementation((value: string) => value);
    mocks.getDbForFactory.mockReturnValue({ query: db.query });
  });

  it("rejects same source and destination factory", async () => {
    const res = await POST(makeRequest({
      toFactoryKey: "si",
      items: [{ supplyItemId: 4, quantity: 2 }],
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("โรงงานต้นทางและปลายทางต้องไม่ซ้ำกัน");
    expect(mocks.createTransfer).not.toHaveBeenCalled();
  });

  it("rejects requests without items when requestId is absent", async () => {
    const res = await POST(makeRequest({
      toFactoryKey: "bearing",
      items: [{ supplyItemId: null, quantity: 0 }],
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("กรุณาระบุรายการโอนอย่างน้อย 1 รายการ");
    expect(mocks.createTransfer).not.toHaveBeenCalled();
  });
});
