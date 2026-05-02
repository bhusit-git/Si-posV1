import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireManagerUp: vi.fn(),
  resolveSupplyReadContext: vi.fn(),
  resolveSupplyWriteContext: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireAdmin: mocks.requireAdmin,
  requireManagerUp: mocks.requireManagerUp,
}));

vi.mock("@/lib/supply/route-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/supply/route-helpers")>("@/lib/supply/route-helpers");
  return {
    ...actual,
    resolveSupplyWriteContext: mocks.resolveSupplyWriteContext,
    resolveSupplyReadContext: mocks.resolveSupplyReadContext,
  };
});

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
}));

import { GET, POST } from "@/app/api/supply/items/route";
import { PUT } from "@/app/api/supply/items/[id]/route";

describe("supply item routes", () => {
  const selectOrderBy = vi.fn();
  const selectLimit = vi.fn();
  const selectWhere = vi.fn();
  const selectFrom = vi.fn();
  const insertValues = vi.fn();
  const insertReturning = vi.fn();
  const updateSet = vi.fn();
  const updateWhere = vi.fn();
  const updateReturning = vi.fn();
  const execute = vi.fn();
  const db = {
    query: {
      supplyItems: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    },
    execute,
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mocks.requireAdmin.mockResolvedValue({
      user: { id: 1, username: "admin", role: "admin", factoryKey: "si" },
    });
    mocks.requireManagerUp.mockResolvedValue({
      user: { id: 1, username: "manager", role: "manager", factoryKey: "si" },
    });
    mocks.resolveSupplyReadContext.mockReturnValue({
      factoryKey: "si",
      db,
    });
    mocks.resolveSupplyWriteContext.mockReturnValue({
      factoryKey: "si",
      db,
    });
    mocks.logAudit.mockResolvedValue(undefined);

    db.query.supplyItems.findFirst.mockResolvedValue(undefined);
    db.query.supplyItems.findMany.mockResolvedValue([]);
    insertReturning.mockResolvedValue([
      {
        id: 11,
        name: "ปากกา",
        unit: "ด้าม",
        category: "ออฟฟิศ",
        itemCode: "MAT-001",
        imageUrl: "https://cdn.example.com/pen-v1.jpg",
        itemType: "consumable",
        brand: "Pilot",
        model: "G2",
        serialNumber: null,
        barcode: "8850001",
        details: "ปากกาหมึกเจล",
        purchasedAt: "2026-05-01",
        warrantyExpiresAt: null,
        packSize: 12,
        borrowLimit: 3,
        linkedProductTypeId: null,
        lowStockThreshold: 10,
        isActive: true,
      },
    ]);
    insertValues.mockReturnValue({ returning: insertReturning });
    db.insert.mockReturnValue({ values: insertValues });

    updateReturning.mockResolvedValue([
      {
        id: 11,
        name: "ปากกา",
        unit: "ด้าม",
        category: "ออฟฟิศ",
        itemCode: "MAT-002",
        imageUrl: "https://cdn.example.com/pen-v2.jpg",
        itemType: "consumable",
        brand: "Uni",
        model: "Jetstream",
        serialNumber: null,
        barcode: "8850002",
        details: "ปากกาลื่น",
        purchasedAt: "2026-05-01",
        warrantyExpiresAt: null,
        packSize: 24,
        borrowLimit: 5,
        linkedProductTypeId: 5,
        lowStockThreshold: 10,
        isActive: true,
      },
    ]);
    updateWhere.mockReturnValue({ returning: updateReturning });
    updateSet.mockReturnValue({ where: updateWhere });
    db.update.mockReturnValue({ set: updateSet });

    selectOrderBy.mockResolvedValue([]);
    selectLimit.mockResolvedValue([]);
    selectWhere.mockReturnValue({ limit: selectLimit });
    selectFrom.mockReturnValue({
      orderBy: selectOrderBy,
      where: selectWhere,
    });
    db.select.mockReturnValue({ from: selectFrom });
    execute.mockResolvedValue([]);
  });

  it("self-heals missing detail columns on catalog load", async () => {
    db.query.supplyItems.findMany
      .mockRejectedValueOnce({
        code: "42703",
        column: "image_url",
        message: 'column "image_url" does not exist',
      })
      .mockResolvedValueOnce([
        {
          id: 11,
          name: "ปากกา",
          unit: "ด้าม",
          category: "ออฟฟิศ",
          itemCode: "MAT-001",
          imageUrl: "/uploads/supply-items/pen.png",
          itemType: "consumable",
          brand: "Pilot",
          model: "G2",
          serialNumber: null,
          barcode: "8850001",
          details: "ปากกาหมึกเจล",
          purchasedAt: "2026-05-01",
          warrantyExpiresAt: null,
          packSize: 12,
          borrowLimit: 3,
          linkedProductTypeId: null,
          lowStockThreshold: 10,
          isActive: true,
        },
      ]);
    execute.mockResolvedValueOnce([]);
    execute.mockResolvedValueOnce([
      {
        id: 11,
        name: "ปากกา",
        unit: "ด้าม",
        category: "ออฟฟิศ",
        itemCode: "MAT-001",
        imageUrl: null,
        linkedProductTypeId: null,
        lowStockThreshold: 10,
        isActive: true,
      },
    ]);

    const request = new NextRequest("http://localhost/api/supply/items");
    const response = await GET(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual([
      expect.objectContaining({
        id: 11,
        name: "ปากกา",
        imageUrl: "/uploads/supply-items/pen.png",
        details: "ปากกาหมึกเจล",
      }),
    ]);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("stores itemCode and imageUrl on create", async () => {
    const request = new NextRequest("http://localhost/api/supply/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "ปากกา",
        unit: "ด้าม",
        category: "ออฟฟิศ",
        itemCode: " MAT-001 ",
        imageUrl: " https://cdn.example.com/pen-v1.jpg ",
        itemType: "consumable",
        brand: " Pilot ",
        model: " G2 ",
        barcode: " 8850001 ",
        details: " ปากกาหมึกเจล ",
        purchasedAt: "2026-05-01",
        packSize: 12,
        borrowLimit: 3,
        lowStockThreshold: 10,
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        itemCode: "MAT-001",
        imageUrl: "https://cdn.example.com/pen-v1.jpg",
        itemType: "consumable",
        brand: "Pilot",
        model: "G2",
        barcode: "8850001",
        details: "ปากกาหมึกเจล",
        purchasedAt: "2026-05-01",
        packSize: 12,
        borrowLimit: 3,
        linkedProductTypeId: null,
      })
    );
    expect(body).toMatchObject({
      itemCode: "MAT-001",
      imageUrl: "https://cdn.example.com/pen-v1.jpg",
      brand: "Pilot",
      packSize: 12,
      borrowLimit: 3,
    });
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          itemCode: "MAT-001",
          imageUrl: "https://cdn.example.com/pen-v1.jpg",
          brand: "Pilot",
          packSize: 12,
          borrowLimit: 3,
        }),
      }),
      db
    );
  });

  it("updates itemCode and imageUrl without overwriting linked product id", async () => {
    db.query.supplyItems.findFirst.mockResolvedValueOnce({
      id: 11,
      name: "ปากกา",
      unit: "ด้าม",
      category: "ออฟฟิศ",
      itemCode: "MAT-001",
      imageUrl: "https://cdn.example.com/pen-v1.jpg",
      itemType: "consumable",
      brand: "Pilot",
      model: "G2",
      serialNumber: null,
      barcode: "8850001",
      details: "ปากกาหมึกเจล",
      purchasedAt: "2026-05-01",
      warrantyExpiresAt: null,
      packSize: 12,
      borrowLimit: 3,
      linkedProductTypeId: 5,
      lowStockThreshold: 10,
      isActive: true,
    });

    const request = new NextRequest("http://localhost/api/supply/items/11", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemCode: " MAT-002 ",
        imageUrl: " https://cdn.example.com/pen-v2.jpg ",
        brand: " Uni ",
        model: " Jetstream ",
        barcode: " 8850002 ",
        details: " ปากกาลื่น ",
        packSize: 24,
        borrowLimit: 5,
      }),
    });

    const response = await PUT(request, { params: Promise.resolve({ id: "11" }) });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        itemCode: "MAT-002",
        imageUrl: "https://cdn.example.com/pen-v2.jpg",
        brand: "Uni",
        model: "Jetstream",
        barcode: "8850002",
        details: "ปากกาลื่น",
        packSize: 24,
        borrowLimit: 5,
        linkedProductTypeId: 5,
      })
    );
    expect(body).toMatchObject({
      itemCode: "MAT-002",
      imageUrl: "https://cdn.example.com/pen-v2.jpg",
      brand: "Uni",
      model: "Jetstream",
      packSize: 24,
      borrowLimit: 5,
      linkedProductTypeId: 5,
    });
  });

  it("returns auth error when admin access is denied", async () => {
    mocks.requireAdmin.mockResolvedValueOnce({
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    });

    const request = new NextRequest("http://localhost/api/supply/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("forbidden");
    expect(db.insert).not.toHaveBeenCalled();
  });
});
