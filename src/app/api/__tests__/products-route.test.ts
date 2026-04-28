import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  requireManagerUp: vi.fn(),
  requireAdmin: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/db", () => ({
  getDb: mocks.getDb,
}));

vi.mock("@/lib/api-auth", () => ({
  requireManagerUp: mocks.requireManagerUp,
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
}));

import { GET as getProducts } from "@/app/api/products/route";

async function parseJsonResponse<T>(response: Response): Promise<T> {
  return JSON.parse(await response.text()) as T;
}

describe("products route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireManagerUp.mockResolvedValue({
      user: { id: 1, username: "manager", role: "manager", factoryKey: "si" },
    });
  });

  it("orders /api/products by catalog code, then sort order, then name", async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 2, name: "B", catalogCode: 12, sortOrder: 99 },
      { id: 1, name: "A", catalogCode: 200, sortOrder: 1 },
    ]);
    mocks.getDb.mockResolvedValue({
      query: {
        productTypes: { findMany },
      },
    });

    const res = await getProducts(new NextRequest("http://localhost/api/products"));
    const body = await parseJsonResponse<Array<{ id: number }>>(res as Response);

    expect(res.status).toBe(200);
    expect(body.map((row) => row.id)).toEqual([2, 1]);
    expect(findMany).toHaveBeenCalledTimes(1);

    const args = findMany.mock.calls[0]?.[0] as {
      orderBy: (pt: Record<string, string>, helpers: { asc: (value: string) => string }) => string[];
    };
    const orderByColumns = args.orderBy(
      { catalogCode: "catalogCode", sortOrder: "sortOrder", name: "name" },
      { asc: (value) => `asc:${value}` }
    );

    expect(orderByColumns).toEqual(["asc:catalogCode", "asc:sortOrder", "asc:name"]);
  });

  it("returns auth error when manager access is denied", async () => {
    mocks.requireManagerUp.mockResolvedValueOnce({
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    });

    const res = await getProducts(new NextRequest("http://localhost/api/products"));
    const body = await parseJsonResponse<{ error: string }>(res as Response);

    expect(res.status).toBe(403);
    expect(body.error).toBe("forbidden");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
