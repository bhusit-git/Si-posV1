import { describe, expect, it, vi } from "vitest";

import {
  checkStockSufficiency,
  getStockBalance,
  getStockBalances,
  writeStockLedger,
} from "@/lib/supply/stock-engine";

function createChainMock<T>(
  terminalMethod: string,
  result: T,
  chainMethods: string[]
): Record<string, ReturnType<typeof vi.fn>> {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};

  for (const method of chainMethods) {
    chain[method] = vi.fn(() => chain);
  }
  chain[terminalMethod] = vi.fn().mockResolvedValue(result);

  return chain;
}

describe("stock-engine", () => {
  it("getStockBalance returns 0 when there is no ledger", async () => {
    const whereChain = createChainMock("where", [{ balance: 0 }], []);
    const fromChain = {
      from: vi.fn(() => whereChain),
    };
    const db = {
      select: vi.fn(() => fromChain),
    } as const;

    const balance = await getStockBalance(db as never, "si", 1);

    expect(balance).toBe(0);
    expect(db.select).toHaveBeenCalledTimes(1);
    expect(fromChain.from).toHaveBeenCalledTimes(1);
    expect(whereChain.where).toHaveBeenCalledTimes(1);
  });

  it("getStockBalance returns aggregated signed quantity", async () => {
    const whereChain = createChainMock("where", [{ balance: 9 }], []);
    const fromChain = {
      from: vi.fn(() => whereChain),
    };
    const db = {
      select: vi.fn(() => fromChain),
    } as const;

    const balance = await getStockBalance(db as never, "bearing", 8);

    expect(balance).toBe(9);
  });

  it("getStockBalances prefers per-factory threshold over the item default", async () => {
    const rows = [
      {
        itemId: 1,
        itemName: "ถุงกระสอบ",
        itemUnit: "ใบ",
        itemCategory: "บรรจุภัณฑ์",
        itemItemCode: "SACK-001",
        itemImageUrl: "https://cdn.example.com/sack.jpg",
        itemItemType: "consumable",
        itemBrand: "Super Sack",
        itemModel: "A1",
        itemSerialNumber: null,
        itemBarcode: "SACK-001",
        itemDetails: "ถุงกระสอบมาตรฐาน",
        itemPurchasedAt: "2026-04-01",
        itemWarrantyExpiresAt: null,
        itemPackSize: 12,
        itemBorrowLimit: 0,
        itemLinkedProductTypeId: 3,
        itemLowStockThreshold: 5,
        itemIsActive: true,
        itemCreatedBy: 7,
        itemCreatedAt: new Date("2026-04-30T01:00:00.000Z"),
        itemUpdatedAt: new Date("2026-04-30T02:00:00.000Z"),
        balance: 4,
        threshold: 6,
        lastMovementAt: new Date("2026-04-30T03:00:00.000Z"),
      },
      {
        itemId: 2,
        itemName: "น้ำยาล้างเครื่อง",
        itemUnit: "ขวด",
        itemCategory: "สารเคมี",
        itemItemCode: null,
        itemImageUrl: null,
        itemItemType: null,
        itemBrand: null,
        itemModel: null,
        itemSerialNumber: null,
        itemBarcode: null,
        itemDetails: null,
        itemPurchasedAt: null,
        itemWarrantyExpiresAt: null,
        itemPackSize: 1,
        itemBorrowLimit: 2,
        itemLinkedProductTypeId: null,
        itemLowStockThreshold: 2,
        itemIsActive: true,
        itemCreatedBy: null,
        itemCreatedAt: new Date("2026-04-29T01:00:00.000Z"),
        itemUpdatedAt: new Date("2026-04-29T02:00:00.000Z"),
        balance: 3,
        threshold: 2,
        lastMovementAt: null,
      },
    ];
    const query = createChainMock("orderBy", rows, [
      "leftJoin",
      "where",
      "groupBy",
    ]);
    const fromChain = {
      from: vi.fn(() => query),
    };
    const db = {
      select: vi.fn(() => fromChain),
    } as const;

    const balances = await getStockBalances(db as never, "si");

    expect(balances).toEqual([
      {
        item: {
          id: 1,
          name: "ถุงกระสอบ",
          unit: "ใบ",
          category: "บรรจุภัณฑ์",
          itemCode: "SACK-001",
          imageUrl: "https://cdn.example.com/sack.jpg",
          itemType: "consumable",
          brand: "Super Sack",
          model: "A1",
          serialNumber: null,
          barcode: "SACK-001",
          details: "ถุงกระสอบมาตรฐาน",
          purchasedAt: "2026-04-01",
          warrantyExpiresAt: null,
          packSize: 12,
          borrowLimit: 0,
          linkedProductTypeId: 3,
          lowStockThreshold: 5,
          isActive: true,
          createdBy: 7,
          createdAt: new Date("2026-04-30T01:00:00.000Z"),
          updatedAt: new Date("2026-04-30T02:00:00.000Z"),
        },
        balance: 4,
        threshold: 6,
        isLow: true,
        lastMovementAt: new Date("2026-04-30T03:00:00.000Z"),
      },
      {
        item: {
          id: 2,
          name: "น้ำยาล้างเครื่อง",
          unit: "ขวด",
          category: "สารเคมี",
          itemCode: null,
          imageUrl: null,
          itemType: null,
          brand: null,
          model: null,
          serialNumber: null,
          barcode: null,
          details: null,
          purchasedAt: null,
          warrantyExpiresAt: null,
          packSize: 1,
          borrowLimit: 2,
          linkedProductTypeId: null,
          lowStockThreshold: 2,
          isActive: true,
          createdBy: null,
          createdAt: new Date("2026-04-29T01:00:00.000Z"),
          updatedAt: new Date("2026-04-29T02:00:00.000Z"),
        },
        balance: 3,
        threshold: 2,
        isLow: false,
        lastMovementAt: null,
      },
    ]);
  });

  it("checkStockSufficiency reports shortfalls and treats missing balance rows as zero", async () => {
    const groupChain = createChainMock(
      "groupBy",
      [
        { supplyItemId: 1, balance: 10 },
        { supplyItemId: 2, balance: 3 },
      ],
      []
    );
    const whereChain = {
      where: vi.fn(() => groupChain),
    };
    const fromChain = {
      from: vi.fn(() => whereChain),
    };
    const db = {
      select: vi.fn(() => fromChain),
    } as const;

    const result = await checkStockSufficiency(db as never, "si", [
      { supplyItemId: 1, quantity: 7 },
      { supplyItemId: 2, quantity: 5 },
      { supplyItemId: 2, quantity: 1 },
      { supplyItemId: 3, quantity: 1 },
    ]);

    expect(result).toEqual({
      sufficient: false,
      shortfalls: [
        { supplyItemId: 2, available: 3, requested: 6 },
        { supplyItemId: 3, available: 0, requested: 1 },
      ],
    });
  });

  it("checkStockSufficiency returns sufficient when every requested item fits", async () => {
    const groupChain = createChainMock(
      "groupBy",
      [
        { supplyItemId: 1, balance: 10 },
        { supplyItemId: 2, balance: 6 },
      ],
      []
    );
    const whereChain = {
      where: vi.fn(() => groupChain),
    };
    const fromChain = {
      from: vi.fn(() => whereChain),
    };
    const db = {
      select: vi.fn(() => fromChain),
    } as const;

    const result = await checkStockSufficiency(db as never, "si", [
      { supplyItemId: 1, quantity: 4 },
      { supplyItemId: 2, quantity: 6 },
    ]);

    expect(result).toEqual({
      sufficient: true,
      shortfalls: [],
    });
  });

  it("writeStockLedger normalizes optional fields and returns the inserted row", async () => {
    const insertedRow = {
      id: 11,
      factoryKey: "si",
      supplyItemId: 2,
      type: "adjustment" as const,
      quantity: -3,
      referenceId: null,
      referenceType: null,
      note: "manual recount",
      createdBy: 9,
      createdAt: new Date("2026-04-30T10:00:00.000Z"),
    };
    const valuesChain = {
      returning: vi.fn().mockResolvedValue([insertedRow]),
    };
    const insertChain = {
      values: vi.fn(() => valuesChain),
    };
    const db = {
      insert: vi.fn(() => insertChain),
    } as const;

    const result = await writeStockLedger(db as never, {
      factoryKey: "si",
      supplyItemId: 2,
      type: "adjustment",
      quantity: -3,
      note: "manual recount",
      createdBy: 9,
      createdAt: new Date("2026-04-30T10:00:00.000Z"),
    });

    expect(result).toEqual(insertedRow);
    expect(insertChain.values).toHaveBeenCalledWith({
      factoryKey: "si",
      supplyItemId: 2,
      type: "adjustment",
      quantity: -3,
      referenceId: null,
      referenceType: null,
      note: "manual recount",
      createdBy: 9,
      createdAt: new Date("2026-04-30T10:00:00.000Z"),
    });
  });
});
