import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireManagerUp: vi.fn(),
  requireOfficeUp: vi.fn(),
  validateBody: vi.fn(),
  getDb: vi.fn(),
  logAudit: vi.fn(),
  withBehaviorDetails: vi.fn((details: unknown) => details),
  resolveActiveFactoryKey: vi.fn(),
  getPostHogClient: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireManagerUp: mocks.requireManagerUp,
  requireOfficeUp: mocks.requireOfficeUp,
}));

vi.mock("@/lib/validations", () => ({
  createCustomerSchema: {},
  updateCustomerSchema: {},
  validateBody: mocks.validateBody,
}));

vi.mock("@/db", () => ({
  getDb: mocks.getDb,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
  withBehaviorDetails: mocks.withBehaviorDetails,
}));

vi.mock("@/lib/factory-key", () => ({
  resolveActiveFactoryKey: mocks.resolveActiveFactoryKey,
}));

vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: mocks.getPostHogClient,
}));

import { GET } from "@/app/api/customers/route";

function makeRequest(query = "") {
  const suffix = query ? `?${query}` : "";
  return new NextRequest(`http://localhost/api/customers${suffix}`);
}

describe("GET /api/customers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireManagerUp.mockResolvedValue({
      user: { id: 8, username: "manager", role: "manager", factoryKey: "si" },
    });
  });

  it("supports lightweight search mode with a bounded limit", async () => {
    const rows = [
      { id: 101, name: "Alpha", phone: "081", credit: false, transferCustomer: false, createdAt: "2026-03-01" },
      { id: 102, name: "Beta", phone: "082", credit: true, transferCustomer: false, createdAt: "2026-03-02" },
    ];
    const chain = {
      from: vi.fn(() => chain),
      where: vi.fn(() => chain),
      orderBy: vi.fn(() => chain),
      limit: vi.fn(async () => rows),
    };
    mocks.getDb.mockResolvedValue({
      select: vi.fn(() => chain),
    });

    const res = await GET(makeRequest("search=%23101,%20%23102&includeBagBalance=0&limit=2"));
    const body = (await res.json()) as Array<Record<string, unknown>>;

    expect(res.status).toBe(200);
    expect(chain.limit).toHaveBeenCalledWith(2);
    expect(body).toHaveLength(2);
    expect(body[0]).not.toHaveProperty("bagBalance");
  });

  it("returns bagBalance on detail lookup", async () => {
    const customer = {
      id: 101,
      name: "Alpha",
      phone: "081",
      credit: false,
      transferCustomer: false,
      prices: [],
    };
    const balanceChain = {
      from: vi.fn(() => balanceChain),
      where: vi.fn(async () => [{ bagBalance: 7 }]),
    };
    mocks.getDb.mockResolvedValue({
      query: {
        customers: {
          findFirst: vi.fn(async () => customer),
        },
      },
      select: vi.fn(() => balanceChain),
    });

    const res = await GET(makeRequest("id=101"));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      id: 101,
      name: "Alpha",
      bagBalance: 7,
    });
  });

  it("returns auth response when requireManagerUp fails", async () => {
    mocks.requireManagerUp.mockResolvedValueOnce({
      error: NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 }),
    });

    const res = await GET(makeRequest());
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("ไม่ได้เข้าสู่ระบบ");
  });
});
