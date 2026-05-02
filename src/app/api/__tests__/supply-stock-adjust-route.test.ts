import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  resolveSupplyWriteContext: vi.fn(),
  logAudit: vi.fn(),
  writeStockLedger: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("@/lib/supply/route-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supply/route-helpers")>("@/lib/supply/route-helpers");
  return {
    ...actual,
    resolveSupplyWriteContext: mocks.resolveSupplyWriteContext,
  };
});

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
}));

vi.mock("@/lib/supply/stock-engine", () => ({
  writeStockLedger: mocks.writeStockLedger,
}));

import { POST } from "@/app/api/supply/stock/adjust/route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/supply/stock/adjust", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/supply/stock/adjust", () => {
  const db = {
    query: {
      supplyItems: {
        findFirst: vi.fn(),
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      user: { id: 1, username: "admin", role: "admin", factoryKey: "si" },
    });
    mocks.resolveSupplyWriteContext.mockReturnValue({
      factoryKey: "si",
      db,
    });
    db.query.supplyItems.findFirst.mockResolvedValue({ id: 9, name: "Bag", packSize: 12 });
  });

  it("rejects negative purchase_in quantities", async () => {
    const res = await POST(makeRequest({
      supplyItemId: 9,
      quantity: -3,
      type: "purchase_in",
      note: "bad",
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("จำนวน");
    expect(db.query.supplyItems.findFirst).not.toHaveBeenCalled();
    expect(mocks.writeStockLedger).not.toHaveBeenCalled();
  });

  it("rejects invalid adjustment types", async () => {
    const res = await POST(makeRequest({
      supplyItemId: 9,
      quantity: 3,
      type: "transfer_out",
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("ประเภทการปรับยอดไม่ถูกต้อง");
    expect(mocks.writeStockLedger).not.toHaveBeenCalled();
  });

  it("rejects unknown quantity units", async () => {
    const res = await POST(makeRequest({
      supplyItemId: 9,
      quantity: 2,
      quantityUnit: "packs",
      type: "purchase_in",
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("หน่วยจำนวนไม่ถูกต้อง");
    expect(mocks.writeStockLedger).not.toHaveBeenCalled();
  });

  it("rejects fractional quantities instead of truncating them", async () => {
    const res = await POST(makeRequest({
      supplyItemId: 9,
      quantity: 1.5,
      quantityUnit: "pack",
      type: "purchase_in",
    }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("กรุณาระบุจำนวนเต็มที่ถูกต้อง");
    expect(mocks.writeStockLedger).not.toHaveBeenCalled();
  });

  it("converts pack quantities into base units before writing stock", async () => {
    mocks.writeStockLedger.mockResolvedValue({ id: 99, quantity: 24 });

    const res = await POST(makeRequest({
      supplyItemId: 9,
      quantity: 2,
      quantityUnit: "pack",
      type: "purchase_in",
      note: "รับเข้า 2 แพ็ค",
    }));

    expect(res.status).toBe(201);
    expect(mocks.writeStockLedger).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        supplyItemId: 9,
        quantity: 24,
        type: "purchase_in",
      })
    );
  });
});
