import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireManagerUp: vi.fn(),
  getDb: vi.fn(),
  getDbForFactory: vi.fn(),
  getFactories: vi.fn(() => [{ key: "si", name: "SI" }]),
  logAudit: vi.fn(),
  getOrCreateBillCounter: vi.fn(),
  setNextBillCounterNumber: vi.fn(),
  resolveActiveFactoryKey: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireManagerUp: mocks.requireManagerUp,
}));

vi.mock("@/db", () => ({
  FACTORY_COOKIE: "superice_factory",
  getDb: mocks.getDb,
  getDbForFactory: mocks.getDbForFactory,
  getFactories: mocks.getFactories,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
}));

vi.mock("@/lib/bill-counter", () => ({
  getOrCreateBillCounter: mocks.getOrCreateBillCounter,
  setNextBillCounterNumber: mocks.setNextBillCounterNumber,
}));

vi.mock("@/lib/factory-key", () => ({
  resolveActiveFactoryKey: mocks.resolveActiveFactoryKey,
}));

import { GET, PATCH } from "@/app/api/bill-counter/route";

function makePatchRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/bill-counter", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Cookie: "superice_factory=si",
    },
    body: JSON.stringify(body),
  });
}

describe("bill-counter route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireManagerUp.mockResolvedValue({
      user: { id: 7, username: "cashier", role: "manager", factoryKey: "si" },
    });
    mocks.getDb.mockResolvedValue({});
    mocks.getDbForFactory.mockReturnValue({});
    mocks.logAudit.mockResolvedValue(undefined);
    mocks.resolveActiveFactoryKey.mockResolvedValue("si");
    mocks.getOrCreateBillCounter.mockResolvedValue({
      factoryKey: "si",
      nextBillNumber: 1234,
      displayBillNumber: "1234",
    });
    mocks.setNextBillCounterNumber.mockResolvedValue({
      factoryKey: "si",
      nextBillNumber: 1235,
      displayBillNumber: "1235",
    });
  });

  it("returns the current bill counter", async () => {
    const request = new NextRequest("http://localhost/api/bill-counter", {
      method: "GET",
      headers: { Cookie: "superice_factory=si" },
    });

    const res = await GET(request);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      factoryKey: "si",
      nextBillNumber: 1234,
      displayBillNumber: "1234",
    });
  });

  it("updates the counter and writes an audit entry", async () => {
    const res = await PATCH(
      makePatchRequest({
        nextBillNumber: 1235,
        sourcePage: "sale",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      factoryKey: "si",
      nextBillNumber: 1235,
    });
    expect(mocks.setNextBillCounterNumber).toHaveBeenCalledWith({}, "si", 1235);
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "bill_counter.update",
        entity: "bill_counter",
      }),
      {}
    );
  });

  it("skips audit logging when the requested value is unchanged", async () => {
    const res = await PATCH(
      makePatchRequest({
        nextBillNumber: 1234,
        sourcePage: "returns",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ nextBillNumber: 1234 });
    expect(mocks.setNextBillCounterNumber).not.toHaveBeenCalled();
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("rejects invalid bill numbers", async () => {
    const res = await PATCH(
      makePatchRequest({
        nextBillNumber: 10000,
        sourcePage: "sale",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("0000-9999");
  });
});
