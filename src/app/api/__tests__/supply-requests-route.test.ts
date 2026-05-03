import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireManagerUp: vi.fn(),
  resolveSupplyReadContext: vi.fn(),
  getDbForFactory: vi.fn(),
  getFactories: vi.fn(() => [{ key: "si", name: "SI" }]),
}));

vi.mock("@/lib/api-auth", () => ({
  requireManagerUp: mocks.requireManagerUp,
}));

vi.mock("@/db", () => ({
  getDbForFactory: mocks.getDbForFactory,
  getFactories: mocks.getFactories,
}));

vi.mock("@/lib/supply/route-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supply/route-helpers")>("@/lib/supply/route-helpers");
  return {
    ...actual,
    resolveSupplyReadContext: mocks.resolveSupplyReadContext,
    resolveSupplyWriteContext: vi.fn(),
  };
});

import { GET } from "@/app/api/supply/requests/route";

describe("GET /api/supply/requests", () => {
  const findMany = vi.fn();
  const selectOrderBy = vi.fn();
  const selectWhere = vi.fn(() => ({ orderBy: selectOrderBy }));
  const selectFrom = vi.fn(() => ({ where: selectWhere }));
  const select = vi.fn(() => ({ from: selectFrom }));
  const db = {
    select,
    query: {
      supplyRequests: {
        findMany,
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireManagerUp.mockResolvedValue({
      user: { id: 8, username: "manager", role: "manager", factoryKey: "si" },
    });
    mocks.resolveSupplyReadContext.mockReturnValue({
      factoryKey: "si",
      db,
    });
  });

  it("returns request rows even when the factory DB cannot join central user relations", async () => {
    const createdAt = "2026-04-30T15:00:00.000Z";
    findMany.mockImplementation(async (query) => {
      if (query?.with?.createdByUser || query?.with?.approvedByUser) {
        throw new Error('relation "users" does not exist');
      }
      return [
        {
          id: 41,
          factoryKey: "si",
          requestType: "internal_factory",
          targetFactoryKey: null,
          requesterName: "packing",
          status: "pending",
          note: null,
          createdAt,
          updatedAt: createdAt,
          items: [],
        },
      ];
    });
    selectOrderBy.mockResolvedValueOnce([{ id: 41, createdAt }]);

    const res = await GET(new NextRequest("http://localhost/api/supply/requests?status=pending"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      id: 41,
      factoryKey: "si",
      status: "pending",
      requestRef: "REQ-20260430-001",
    });
  });

  it("returns an empty list when legacy databases do not have supply request tables yet", async () => {
    findMany.mockRejectedValueOnce({
      code: "42P01",
      message: 'relation "supply_requests" does not exist',
    });

    const res = await GET(new NextRequest("http://localhost/api/supply/requests?status=pending"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
  });

  it("includes incoming cross-factory requests targeted to the current factory", async () => {
    const createdAt = "2026-05-01T02:00:00.000Z";
    const externalFindMany = vi.fn().mockResolvedValue([
      {
        id: 52,
        factoryKey: "bearing",
        requestType: "cross_factory",
        targetFactoryKey: "si",
        requesterName: "packing",
        status: "pending",
        note: null,
        createdAt,
        updatedAt: createdAt,
        items: [{ id: 7, requestId: 52, supplyItemId: 2, quantityRequested: 12 }],
      },
    ]);
    const externalSelect = vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn().mockResolvedValue([{ id: 52, createdAt }]),
        })),
      })),
    }));
    const externalDb = {
      select: externalSelect,
      query: {
        supplyRequests: {
          findMany: externalFindMany,
        },
      },
    };

    mocks.getFactories.mockReturnValueOnce([
      { key: "si", name: "SI" },
      { key: "bearing", name: "Bearing" },
    ]);
    mocks.getDbForFactory.mockImplementation((factoryKey: string) =>
      factoryKey === "bearing" ? externalDb : db
    );
    findMany.mockResolvedValueOnce([]);
    selectOrderBy.mockResolvedValueOnce([]);

    const res = await GET(new NextRequest("http://localhost/api/supply/requests?status=pending"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([
      expect.objectContaining({
        id: 52,
        factoryKey: "bearing",
        requestType: "cross_factory",
        targetFactoryKey: "si",
        requestRef: "REQ-20260501-001",
      }),
    ]);
    expect(externalFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        with: { items: true },
      })
    );
  });

  it("does not expose requester drafts to the source factory", async () => {
    const externalFindMany = vi.fn();
    const externalDb = {
      select: vi.fn(),
      query: {
        supplyRequests: {
          findMany: externalFindMany,
        },
      },
    };

    mocks.getFactories.mockReturnValueOnce([
      { key: "si", name: "SI" },
      { key: "bearing", name: "Bearing" },
    ]);
    mocks.getDbForFactory.mockImplementation((factoryKey: string) =>
      factoryKey === "bearing" ? externalDb : db
    );
    findMany.mockResolvedValueOnce([]);
    selectOrderBy.mockResolvedValueOnce([]);

    const res = await GET(new NextRequest("http://localhost/api/supply/requests?status=draft"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual([]);
    expect(externalFindMany).not.toHaveBeenCalled();
  });

  it("returns auth error when manager access is denied", async () => {
    mocks.requireManagerUp.mockResolvedValueOnce({
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    });

    const res = await GET(new NextRequest("http://localhost/api/supply/requests"));
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.error).toBe("forbidden");
    expect(mocks.resolveSupplyReadContext).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });
});
