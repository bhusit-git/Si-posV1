import { describe, it, expect } from "vitest";

/**
 * Tests for computation logic used in the Returns page.
 * Tests the pure functions without React rendering.
 */

interface ReturnItem {
  productTypeId: number;
  productName: string;
  hasBag: boolean;
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

// ---- Logic extracted from the Returns page ----

function computeTotalRefund(items: ReturnItem[]): number {
  return items.reduce((s, i) => s + i.subtotal, 0);
}

function updateReturnQty(items: ReturnItem[], id: number, qty: number): ReturnItem[] {
  return items.map((i) =>
    i.productTypeId === id ? { ...i, quantity: qty, subtotal: qty * i.unitPrice } : i
  );
}

function buildReturnItemsFromTransaction(
  txItems: { quantity: number; unitPrice: number; productType: { id: number; name: string; hasBag: boolean } }[]
): ReturnItem[] {
  const filtered = txItems.filter((i) => i.quantity > 0);
  return filtered.map((i) => ({
    productTypeId: i.productType.id,
    productName: i.productType.name,
    hasBag: i.productType.hasBag,
    quantity: 0, // start at 0 -- user types in return amount
    unitPrice: i.unitPrice,
    subtotal: 0,
  }));
}

function buildOrderedQtys(
  txItems: { quantity: number; productType: { id: number } }[]
): Record<number, number> {
  const qtyMap: Record<number, number> = {};
  for (const i of txItems.filter((x) => x.quantity > 0)) {
    qtyMap[i.productType.id] = i.quantity;
  }
  return qtyMap;
}

function canSaveReturn(
  hasCustomer: boolean,
  totalRefund: number,
  bagReturnQty: number,
  saving: boolean
): boolean {
  return hasCustomer && (totalRefund > 0 || bagReturnQty > 0) && !saving;
}

function buildReturnPayload(
  customerId: number,
  items: ReturnItem[],
  bagReturnQty: number,
  products: { id: number; hasBag: boolean }[],
  saleDate: string,
  saleTime: string,
  originalBill: string,
  note: string
) {
  const bagPt = products.find((p) => p.hasBag);
  const bagReturnsPayload =
    bagReturnQty > 0 && bagPt
      ? [{ productTypeId: bagPt.id, quantity: bagReturnQty }]
      : [];

  return {
    customerId,
    items: items
      .filter((i) => i.quantity > 0)
      .map((i) => ({
        productTypeId: i.productTypeId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
    bagReturns: bagReturnsPayload,
    saleDate,
    saleTime,
    note: originalBill
      ? `คืนสินค้า อ้างอิงบิล #${originalBill}${note ? " - " + note : ""}`
      : note || "คืนสินค้า",
    originalBill: originalBill ? parseInt(originalBill) : null,
  };
}

function buildReturnSuccessDescription(
  computedRefund: number,
  bagReturnQty: number
): string {
  const refundText = computedRefund.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `คืนเงิน ${refundText} บาท${bagReturnQty > 0 ? ` + คืนถุง ${bagReturnQty} ใบ` : ""}`;
}

// ==================== Tests ====================

const sampleItems: ReturnItem[] = [
  { productTypeId: 1, productName: "น้ำแข็งหลอด", hasBag: true, quantity: 3, unitPrice: 50, subtotal: 150 },
  { productTypeId: 2, productName: "น้ำแข็งซอง", hasBag: false, quantity: 0, unitPrice: 30, subtotal: 0 },
];

describe("Return total refund computation", () => {
  it("sums all subtotals", () => {
    expect(computeTotalRefund(sampleItems)).toBe(150);
  });

  it("returns 0 for empty list", () => {
    expect(computeTotalRefund([])).toBe(0);
  });
});

describe("Update return quantity", () => {
  it("updates quantity and recalculates subtotal", () => {
    const updated = updateReturnQty(sampleItems, 2, 5);
    const item = updated.find((i) => i.productTypeId === 2)!;
    expect(item.quantity).toBe(5);
    expect(item.subtotal).toBe(150); // 5 * 30
  });

  it("does not affect other items", () => {
    const updated = updateReturnQty(sampleItems, 2, 5);
    const item1 = updated.find((i) => i.productTypeId === 1)!;
    expect(item1.quantity).toBe(3);
    expect(item1.subtotal).toBe(150);
  });
});

describe("Build return items from transaction", () => {
  it("creates items with quantity=0 from transaction items", () => {
    const txItems = [
      { quantity: 10, unitPrice: 50, productType: { id: 1, name: "หลอด", hasBag: true } },
      { quantity: 5, unitPrice: 30, productType: { id: 2, name: "ซอง", hasBag: false } },
    ];
    const result = buildReturnItemsFromTransaction(txItems);
    expect(result).toHaveLength(2);
    expect(result[0].quantity).toBe(0);
    expect(result[0].subtotal).toBe(0);
    expect(result[0].unitPrice).toBe(50);
    expect(result[1].quantity).toBe(0);
  });

  it("filters out zero-quantity transaction items", () => {
    const txItems = [
      { quantity: 10, unitPrice: 50, productType: { id: 1, name: "หลอด", hasBag: true } },
      { quantity: 0, unitPrice: 30, productType: { id: 2, name: "ซอง", hasBag: false } },
    ];
    const result = buildReturnItemsFromTransaction(txItems);
    expect(result).toHaveLength(1);
    expect(result[0].productTypeId).toBe(1);
  });
});

describe("Build ordered quantities map", () => {
  it("creates a map of product type ID to ordered quantity", () => {
    const txItems = [
      { quantity: 10, productType: { id: 1 } },
      { quantity: 5, productType: { id: 2 } },
      { quantity: 0, productType: { id: 3 } },
    ];
    const result = buildOrderedQtys(txItems);
    expect(result).toEqual({ 1: 10, 2: 5 });
  });

  it("returns empty object for empty items", () => {
    expect(buildOrderedQtys([])).toEqual({});
  });
});

describe("Can save return check", () => {
  it("allows when customer exists and has refund", () => {
    expect(canSaveReturn(true, 500, 0, false)).toBe(true);
  });

  it("allows when customer exists and has bag returns only", () => {
    expect(canSaveReturn(true, 0, 5, false)).toBe(true);
  });

  it("disables when no customer", () => {
    expect(canSaveReturn(false, 500, 0, false)).toBe(false);
  });

  it("disables when no refund and no bags", () => {
    expect(canSaveReturn(true, 0, 0, false)).toBe(false);
  });

  it("disables when saving", () => {
    expect(canSaveReturn(true, 500, 0, true)).toBe(false);
  });
});

describe("Return payload builder", () => {
  const products = [
    { id: 1, hasBag: true },
    { id: 2, hasBag: false },
  ];

  it("builds correct payload with items and original bill", () => {
    const payload = buildReturnPayload(
      1, sampleItems, 3, products,
      "2024-01-15", "10:00:00", "1234", "สินค้าเสีย"
    );
    expect(payload.customerId).toBe(1);
    expect(payload.items).toHaveLength(1); // only item with qty > 0
    expect(payload.items[0].quantity).toBe(3);
    expect(payload.bagReturns).toEqual([{ productTypeId: 1, quantity: 3 }]);
    expect(payload.note).toBe("คืนสินค้า อ้างอิงบิล #1234 - สินค้าเสีย");
    expect(payload.originalBill).toBe(1234);
  });

  it("builds correct payload without original bill", () => {
    const payload = buildReturnPayload(
      1, sampleItems, 0, products,
      "2024-01-15", "10:00:00", "", "ลูกค้าเปลี่ยนใจ"
    );
    expect(payload.note).toBe("ลูกค้าเปลี่ยนใจ");
    expect(payload.originalBill).toBeNull();
    expect(payload.bagReturns).toEqual([]);
  });

  it("uses default note when no bill and no note", () => {
    const payload = buildReturnPayload(
      1, sampleItems, 0, products,
      "2024-01-15", "10:00:00", "", ""
    );
    expect(payload.note).toBe("คืนสินค้า");
  });
});

describe("Return success notification", () => {
  it("shows actual computed refund amount (not original bill total)", () => {
    const computedRefund = 150;
    const originalBillTotal = 750; // should not be shown
    expect(originalBillTotal).not.toBe(computedRefund);
    const msg = buildReturnSuccessDescription(computedRefund, 0);
    expect(msg).toContain("150.00");
    expect(msg).not.toContain("750.00");
  });

  it("includes bag return qty when present", () => {
    const msg = buildReturnSuccessDescription(150, 3);
    expect(msg).toBe("คืนเงิน 150.00 บาท + คืนถุง 3 ใบ");
  });
});
