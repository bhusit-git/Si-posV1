import { describe, it, expect } from "vitest";
import {
  buildBillRows,
  buildExactBillRows,
  isBillSlotProductName,
  parseSaleEntryViewMode,
} from "@/lib/sale-entry-view";
import { resolveSalePayment, type SalePaymentStatus } from "@/lib/sale-payment";

/**
 * Tests for computation logic used in the Sale page.
 * Tests the pure functions without React rendering.
 */

interface SaleItem {
  productTypeId: number;
  productName: string;
  hasBag: boolean;
  decreasesBag: boolean;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  isAdded: boolean;
}

interface ProductType {
  id: number;
  name: string;
  hasBag: boolean;
  decreasesBag: boolean;
  isActive: boolean;
  sortOrder: number;
  catalogCode?: number | null;
}

interface CustomerPrice {
  productTypeId: number;
  unitPrice: number;
}

const TRANSFER_PRELOAD_PRODUCT_NAMES = new Set<string>([
  "ซอง",
  "หลอดใหญ่ โม่",
  "หลอดดล็ก โม่",
  "หลอดเล็ก โม่",
  "หลอดใหญ่ 20กก.",
  "หลอดดล็ก 20กก.",
  "หลอดเล็ก 20กก.",
  "แพ็ค 20",
]);

// ---- Logic extracted from the Sale page ----

function computeGrandTotal(items: SaleItem[]): number {
  return items.reduce((sum, item) => sum + item.subtotal, 0);
}

function updateItemQuantity(items: SaleItem[], productTypeId: number, qty: number): SaleItem[] {
  return items.map((item) =>
    item.productTypeId === productTypeId
      ? { ...item, quantity: qty, subtotal: qty * item.unitPrice }
      : item
  );
}

function updateAddedItemPrice(items: SaleItem[], productTypeId: number, price: number): SaleItem[] {
  return items.map((item) =>
    item.productTypeId === productTypeId && item.isAdded
      ? { ...item, unitPrice: price, subtotal: item.quantity * price }
      : item
  );
}

function computeTotalBagsOut(items: SaleItem[]): number {
  return items.filter((i) => i.hasBag).reduce((sum, i) => sum + i.quantity, 0);
}

function computeNewBagBalance(
  currentBalance: number,
  bagsOut: number,
  bagsReturned: number
): number {
  return currentBalance + bagsOut - bagsReturned;
}

function canSave(
  selectedCustomer: boolean,
  grandTotal: number,
  bagReturnQty: number,
  saving: boolean,
  paymentIsValid = true
): boolean {
  return selectedCustomer && (grandTotal > 0 || bagReturnQty > 0) && !saving && paymentIsValid;
}

function parseLoadingLocation(input: string): { bay: number | null } {
  const trimmed = input.trim();
  if (!trimmed) return { bay: null };
  if (!/^\d+$/.test(trimmed)) return { bay: null };
  const bay = Number.parseInt(trimmed, 10);
  if (Number.isInteger(bay) && bay >= 1 && bay <= 6) {
    return { bay };
  }
  return { bay: null };
}

function normalizeProductName(name: string): string {
  return (name || "").trim().replace(/\s+/g, " ");
}

function isTransferPresetProduct(name: string): boolean {
  return TRANSFER_PRELOAD_PRODUCT_NAMES.has(normalizeProductName(name));
}

function sortProducts(a: ProductType, b: ProductType): number {
  const aCatalogCode = typeof a.catalogCode === "number" ? a.catalogCode : Number.MAX_SAFE_INTEGER;
  const bCatalogCode = typeof b.catalogCode === "number" ? b.catalogCode : Number.MAX_SAFE_INTEGER;
  if (aCatalogCode !== bCatalogCode) return aCatalogCode - bCatalogCode;
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return (a.name || "").localeCompare(b.name || "", "th");
}

function buildTransferItems(productList: ProductType[]): SaleItem[] {
  const activeProducts = [...productList].filter((p) => p.isActive);
  const presetProducts = activeProducts.filter((p) => isTransferPresetProduct(p.name));
  const preloadProducts = presetProducts.length > 0 ? presetProducts : activeProducts;
  const defaultPrices = new Map<number, number>([
    [1, 50],
    [2, 30],
    [3, 80],
    [4, 25],
  ]);
  return preloadProducts
    .sort(sortProducts)
    .map((pt) => ({
      productTypeId: pt.id,
      productName: pt.name,
      hasBag: pt.hasBag,
      decreasesBag: pt.decreasesBag,
      quantity: 0,
      unitPrice: defaultPrices.get(pt.id) ?? 0,
      subtotal: 0,
      isAdded: false,
    }));
}

function buildPricedItems(prices: CustomerPrice[], productList: ProductType[]): SaleItem[] {
  const productById = new Map(productList.map((product) => [product.id, product]));
  const pricedItems: SaleItem[] = [];
  for (const price of prices) {
    if (price.unitPrice <= 0) continue;
    const product = productById.get(price.productTypeId);
    if (!product) continue;
    pricedItems.push({
      productTypeId: product.id,
      productName: product.name,
      hasBag: product.hasBag,
      decreasesBag: product.decreasesBag,
      quantity: 0,
      unitPrice: price.unitPrice,
      subtotal: 0,
      isAdded: false,
    });
  }
  return pricedItems.sort((a, b) => {
    const aProduct = productById.get(a.productTypeId);
    const bProduct = productById.get(b.productTypeId);
    if (aProduct && bProduct) return sortProducts(aProduct, bProduct);
    if (aProduct) return -1;
    if (bProduct) return 1;
    return a.productName.localeCompare(b.productName, "th");
  });
}

function addProductLine(items: SaleItem[], productList: ProductType[], addProductId: string): SaleItem[] {
  if (!addProductId) return items;
  const pt = productList.find((p) => p.id === parseInt(addProductId));
  if (!pt) return items;
  return [
    ...items,
    {
      productTypeId: pt.id,
      productName: pt.name,
      hasBag: pt.hasBag,
      decreasesBag: pt.decreasesBag,
      quantity: 0,
      unitPrice: 0,
      subtotal: 0,
      isAdded: true,
    },
  ];
}

function buildSalePayload(
  customerId: number,
  items: SaleItem[],
  paymentStatus: SalePaymentStatus,
  paid: number,
  loadingLocation: string,
  saleDate: string,
  saleTime: string,
  bagReturnQty: number,
  products: { id: number; hasBag: boolean }[],
  transactionType: "sale" | "transfer_out" = "sale"
) {
  const bagPt = products.find((p) => p.hasBag);
  const { bay } = parseLoadingLocation(loadingLocation);
  const isTransferMode = transactionType === "transfer_out";
  const paymentResolution = resolveSalePayment({
    paymentStatus,
    grandTotal: computeGrandTotal(items),
    hasSaleItems: items.some((item) => item.quantity > 0),
    isTransferMode,
    partialPaidAmount: paymentStatus === "partial" ? paid : null,
  });
  return {
    customerId,
    items: items
      .filter((i) => i.quantity > 0)
      .map((i) => ({
        productTypeId: i.productTypeId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
    status: paymentResolution.effectiveStatus,
    paid: paymentResolution.payloadPaid,
    transactionType,
    pool: null,
    row: bay,
    col: null,
    saleDate,
    saleTime,
    bagReturns: bagReturnQty > 0 && bagPt
      ? [{ productTypeId: bagPt.id, quantity: bagReturnQty }]
      : [],
    newPrices: items
      .filter((i) => i.isAdded && i.unitPrice > 0)
      .map((i) => ({ productTypeId: i.productTypeId, unitPrice: i.unitPrice })),
  };
}

// ==================== Tests ====================

const sampleItems: SaleItem[] = [
  { productTypeId: 1, productName: "น้ำแข็งหลอด 10kg", hasBag: true, decreasesBag: false, quantity: 10, unitPrice: 50, subtotal: 500, isAdded: false },
  { productTypeId: 2, productName: "น้ำแข็งซอง 5kg", hasBag: false, decreasesBag: false, quantity: 5, unitPrice: 30, subtotal: 150, isAdded: false },
  { productTypeId: 3, productName: "น้ำแข็งก้อน", hasBag: true, decreasesBag: false, quantity: 0, unitPrice: 100, subtotal: 0, isAdded: true },
];

describe("Sale grand total computation", () => {
  it("sums all subtotals", () => {
    expect(computeGrandTotal(sampleItems)).toBe(650);
  });

  it("returns 0 for empty items", () => {
    expect(computeGrandTotal([])).toBe(0);
  });

  it("handles all-zero items", () => {
    const zeroItems = sampleItems.map((i) => ({ ...i, subtotal: 0 }));
    expect(computeGrandTotal(zeroItems)).toBe(0);
  });
});

describe("Update item quantity", () => {
  it("updates quantity and recalculates subtotal", () => {
    const updated = updateItemQuantity(sampleItems, 1, 20);
    const item = updated.find((i) => i.productTypeId === 1)!;
    expect(item.quantity).toBe(20);
    expect(item.subtotal).toBe(1000); // 20 * 50
  });

  it("does not affect other items", () => {
    const updated = updateItemQuantity(sampleItems, 1, 20);
    const item2 = updated.find((i) => i.productTypeId === 2)!;
    expect(item2.quantity).toBe(5);
    expect(item2.subtotal).toBe(150);
  });

  it("handles setting quantity to 0", () => {
    const updated = updateItemQuantity(sampleItems, 1, 0);
    const item = updated.find((i) => i.productTypeId === 1)!;
    expect(item.quantity).toBe(0);
    expect(item.subtotal).toBe(0);
  });
});

describe("Update added item price", () => {
  it("updates price for added items", () => {
    const updated = updateAddedItemPrice(sampleItems, 3, 150);
    const item = updated.find((i) => i.productTypeId === 3)!;
    expect(item.unitPrice).toBe(150);
  });

  it("does NOT update price for non-added items", () => {
    const updated = updateAddedItemPrice(sampleItems, 1, 999);
    const item = updated.find((i) => i.productTypeId === 1)!;
    expect(item.unitPrice).toBe(50); // unchanged
  });
});

describe("Bag tracking", () => {
  it("counts only items with hasBag", () => {
    expect(computeTotalBagsOut(sampleItems)).toBe(10); // only item 1 has qty>0 and hasBag
  });

  it("returns 0 when no items have bags", () => {
    const noBagItems = sampleItems.map((i) => ({ ...i, hasBag: false }));
    expect(computeTotalBagsOut(noBagItems)).toBe(0);
  });

  it("computes new bag balance correctly", () => {
    expect(computeNewBagBalance(20, 10, 5)).toBe(25); // 20 + 10 - 5
    expect(computeNewBagBalance(0, 10, 0)).toBe(10);
    expect(computeNewBagBalance(10, 0, 10)).toBe(0);
  });
});

describe("Save button state", () => {
  it("allows save when customer selected, total > 0, and not saving", () => {
    expect(canSave(true, 500, 0, false)).toBe(true);
  });

  it("allows save for bag-return-only transactions", () => {
    expect(canSave(true, 0, 3, false)).toBe(true);
  });

  it("disables when no customer", () => {
    expect(canSave(false, 500, 0, false)).toBe(false);
  });

  it("disables when total is 0 and no bag return", () => {
    expect(canSave(true, 0, 0, false)).toBe(false);
  });

  it("disables when saving is in progress", () => {
    expect(canSave(true, 500, 1, true)).toBe(false);
  });

  it("disables when partial payment is invalid", () => {
    expect(canSave(true, 500, 0, false, false)).toBe(false);
  });
});

describe("Loading location parser", () => {
  it("parses valid bay input 1-6", () => {
    expect(parseLoadingLocation("1")).toEqual({ bay: 1 });
    expect(parseLoadingLocation("6")).toEqual({ bay: 6 });
    expect(parseLoadingLocation(" 3 ")).toEqual({ bay: 3 });
  });

  it("returns null for empty input", () => {
    expect(parseLoadingLocation("")).toEqual({ bay: null });
    expect(parseLoadingLocation("  ")).toEqual({ bay: null });
  });

  it("returns null for out-of-range bay", () => {
    expect(parseLoadingLocation("0")).toEqual({ bay: null });
    expect(parseLoadingLocation("7")).toEqual({ bay: null });
  });

  it("returns null for malformed input", () => {
    expect(parseLoadingLocation("abc")).toEqual({ bay: null });
    expect(parseLoadingLocation("1-2")).toEqual({ bay: null });
    expect(parseLoadingLocation("1-2-3")).toEqual({ bay: null });
  });
});

describe("Sale payload builder", () => {
  it("filters out zero-quantity items", () => {
    const payload = buildSalePayload(
      1, sampleItems, "paid", -1, "",
      "2024-01-15", "10:00:00", 0,
      [{ id: 1, hasBag: true }, { id: 2, hasBag: false }]
    );
    expect(payload.items.length).toBe(2); // item 3 has qty 0
    expect(payload.items.map((i) => i.productTypeId)).toEqual([1, 2]);
  });

  it("sets paid=-1 for paid status", () => {
    const payload = buildSalePayload(
      1, sampleItems, "paid", -1, "",
      "2024-01-15", "10:00:00", 0,
      [{ id: 1, hasBag: true }]
    );
    expect(payload.paid).toBe(-1);
  });

  it("sets paid=0 for unpaid status", () => {
    const payload = buildSalePayload(
      1, sampleItems, "unpaid", 0, "",
      "2024-01-15", "10:00:00", 0,
      [{ id: 1, hasBag: true }]
    );
    expect(payload.paid).toBe(0);
  });

  it("sets actual paid amount for partial status", () => {
    const payload = buildSalePayload(
      1, sampleItems, "partial", 150, "",
      "2024-01-15", "10:00:00", 0,
      [{ id: 1, hasBag: true }]
    );
    expect(payload.status).toBe("partial");
    expect(payload.paid).toBe(150);
  });

  it("auto-converts partial equal to total into paid", () => {
    const payload = buildSalePayload(
      1, sampleItems, "partial", 650, "",
      "2024-01-15", "10:00:00", 0,
      [{ id: 1, hasBag: true }]
    );
    expect(payload.status).toBe("paid");
    expect(payload.paid).toBe(-1);
  });

  it("includes bag returns when qty > 0", () => {
    const payload = buildSalePayload(
      1, sampleItems, "paid", -1, "",
      "2024-01-15", "10:00:00", 5,
      [{ id: 1, hasBag: true }]
    );
    expect(payload.bagReturns).toEqual([{ productTypeId: 1, quantity: 5 }]);
  });

  it("excludes bag returns when qty is 0", () => {
    const payload = buildSalePayload(
      1, sampleItems, "paid", -1, "",
      "2024-01-15", "10:00:00", 0,
      [{ id: 1, hasBag: true }]
    );
    expect(payload.bagReturns).toEqual([]);
  });

  it("collects new prices from added items", () => {
    const payload = buildSalePayload(
      1,
      [
        ...sampleItems.slice(0, 2),
        { ...sampleItems[2], unitPrice: 120 },
      ],
      "paid", -1, "",
      "2024-01-15", "10:00:00", 0,
      [{ id: 1, hasBag: true }]
    );
    expect(payload.newPrices).toEqual([{ productTypeId: 3, unitPrice: 120 }]);
  });

  it("parses bay into row and keeps pool/col null", () => {
    const payload = buildSalePayload(
      1, sampleItems, "paid", -1, "4",
      "2024-01-15", "10:00:00", 0,
      [{ id: 1, hasBag: true }]
    );
    expect(payload.pool).toBeNull();
    expect(payload.row).toBe(4);
    expect(payload.col).toBeNull();
  });

  it("sets pool/row/col to null when location is empty", () => {
    const payload = buildSalePayload(
      1, sampleItems, "paid", -1, "",
      "2024-01-15", "10:00:00", 0,
      [{ id: 1, hasBag: true }]
    );
    expect(payload.pool).toBeNull();
    expect(payload.row).toBeNull();
    expect(payload.col).toBeNull();
  });

  it("preserves real prices in transfer payload", () => {
    const payload = buildSalePayload(
      1,
      [
        { ...sampleItems[0], unitPrice: 100, subtotal: 1000, quantity: 10 },
        { ...sampleItems[1], unitPrice: 55, subtotal: 275, quantity: 5 },
      ],
      "unpaid",
      0,
      "",
      "2024-01-15",
      "10:00:00",
      0,
      [{ id: 1, hasBag: true }],
      "transfer_out"
    );
    expect(payload.transactionType).toBe("transfer_out");
    expect(payload.status).toBe("paid");
    expect(payload.paid).toBe(-1);
    expect(payload.items.map((i) => i.unitPrice)).toEqual([100, 55]);
  });

  it("allows bag returns in transfer payload while keeping real prices", () => {
    const payload = buildSalePayload(
      1,
      [
        { ...sampleItems[0], unitPrice: 100, subtotal: 1000, quantity: 10 },
      ],
      "paid",
      -1,
      "",
      "2024-01-15",
      "10:00:00",
      3,
      [{ id: 1, hasBag: true }],
      "transfer_out"
    );
    expect(payload.transactionType).toBe("transfer_out");
    expect(payload.status).toBe("paid");
    expect(payload.paid).toBe(-1);
    expect(payload.items.map((i) => i.unitPrice)).toEqual([100]);
    expect(payload.bagReturns).toEqual([{ productTypeId: 1, quantity: 3 }]);
  });
});

describe("Transfer preset preload", () => {
  it("preloads only configured transfer product names when present", () => {
    const products: ProductType[] = [
      { id: 1, name: "ซอง", hasBag: true, decreasesBag: false, isActive: true, sortOrder: 1 },
      { id: 2, name: "หลอดใหญ่ โม่", hasBag: true, decreasesBag: false, isActive: true, sortOrder: 2 },
      { id: 3, name: "แพ็ค 20", hasBag: false, decreasesBag: false, isActive: true, sortOrder: 3 },
      { id: 4, name: "สินค้าทั่วไป", hasBag: false, decreasesBag: false, isActive: true, sortOrder: 4 },
    ];
    const result = buildTransferItems(products);
    expect(result.map((r) => r.productName)).toEqual(["ซอง", "หลอดใหญ่ โม่", "แพ็ค 20"]);
    expect(result.map((r) => r.unitPrice)).toEqual([50, 30, 80]);
  });

  it("falls back to all active products if preset names are not found", () => {
    const products: ProductType[] = [
      { id: 9, name: "A", hasBag: false, decreasesBag: false, isActive: true, sortOrder: 2 },
      { id: 10, name: "B", hasBag: true, decreasesBag: false, isActive: true, sortOrder: 1 },
      { id: 11, name: "C", hasBag: false, decreasesBag: false, isActive: false, sortOrder: 3 },
    ];
    const result = buildTransferItems(products);
    expect(result.map((r) => r.productTypeId)).toEqual([10, 9]); // active + sorted
    expect(result.map((r) => r.unitPrice)).toEqual([0, 0]);
  });

  it("prefers three-digit catalog code order over legacy sort order", () => {
    const products: ProductType[] = [
      { id: 9, name: "A", hasBag: false, decreasesBag: false, isActive: true, sortOrder: 1, catalogCode: 200 },
      { id: 10, name: "B", hasBag: true, decreasesBag: false, isActive: true, sortOrder: 99, catalogCode: 12 },
    ];

    const result = buildTransferItems(products);

    expect(result.map((r) => r.productTypeId)).toEqual([10, 9]);
  });
});

describe("Customer-priced sale items", () => {
  it("orders priced items by catalog code before sort order", () => {
    const products: ProductType[] = [
      { id: 1, name: "A", hasBag: false, decreasesBag: false, isActive: true, sortOrder: 1, catalogCode: 200 },
      { id: 2, name: "B", hasBag: true, decreasesBag: false, isActive: true, sortOrder: 99, catalogCode: 12 },
      { id: 3, name: "C", hasBag: false, decreasesBag: false, isActive: true, sortOrder: 2, catalogCode: null },
    ];
    const prices: CustomerPrice[] = [
      { productTypeId: 1, unitPrice: 10 },
      { productTypeId: 2, unitPrice: 20 },
      { productTypeId: 3, unitPrice: 30 },
    ];

    const result = buildPricedItems(prices, products);

    expect(result.map((item) => item.productTypeId)).toEqual([2, 1, 3]);
  });
});

describe("Added line items", () => {
  it("adds new line item with zero price by default", () => {
    const products: ProductType[] = [
      { id: 1, name: "ซอง", hasBag: true, decreasesBag: false, isActive: true, sortOrder: 1 },
      { id: 2, name: "แพ็ค 20", hasBag: false, decreasesBag: false, isActive: true, sortOrder: 2 },
    ];
    const base = buildTransferItems(products);
    const next = addProductLine(base, products, "2");
    const added = next[next.length - 1];
    expect(added.productTypeId).toBe(2);
    expect(added.isAdded).toBe(true);
    expect(added.unitPrice).toBe(0);
    expect(added.subtotal).toBe(0);
  });

  it("ignores add action for invalid product id", () => {
    const products: ProductType[] = [
      { id: 1, name: "ซอง", hasBag: true, decreasesBag: false, isActive: true, sortOrder: 1 },
    ];
    const base = buildTransferItems(products);
    const next = addProductLine(base, products, "999");
    expect(next).toEqual(base);
  });
});

describe("Sale entry view mode persistence", () => {
  it("defaults to default mode for unknown values", () => {
    expect(parseSaleEntryViewMode(null)).toBe("default");
    expect(parseSaleEntryViewMode("x")).toBe("default");
  });

  it("parses known mode values", () => {
    expect(parseSaleEntryViewMode("default")).toBe("default");
    expect(parseSaleEntryViewMode("exact_bill")).toBe("exact_bill");
    expect(parseSaleEntryViewMode("bearing_bill")).toBe("bearing_bill");
  });
});

describe("Exact bill row mapping", () => {
  it("maps items into fixed bill slots using aliases", () => {
    const items = [
      { ...sampleItems[0], productTypeId: 10, productName: "หลอดดล็ก โม่" },
      { ...sampleItems[1], productTypeId: 11, productName: "ซอง" },
      { ...sampleItems[2], productTypeId: 12, productName: "แพ็ค 20", isAdded: false, unitPrice: 40, quantity: 2, subtotal: 80 },
    ];

    const result = buildExactBillRows(items);
    expect(result.rows.map((r) => r.item?.productName || null)).toEqual([
      "ซอง",
      "แพ็ค 20",
      null,
      "หลอดดล็ก โม่",
      null,
      null,
    ]);
    expect(result.extraItems).toEqual([]);
  });

  it("keeps non-bill products in extras", () => {
    const items = [
      { ...sampleItems[0], productTypeId: 100, productName: "ถุงแพ็คใส" },
      { ...sampleItems[1], productTypeId: 101, productName: "หลอดใหญ่ 20กก." },
    ];
    const result = buildExactBillRows(items);
    expect(result.rows[2].item?.productTypeId).toBe(101);
    expect(result.extraItems.map((i) => i.productTypeId)).toEqual([100]);
  });

  it("recognizes bill-slot products and excludes non-slot names", () => {
    expect(isBillSlotProductName("หลอดเล็ก โม่")).toBe(true);
    expect(isBillSlotProductName("หลอดดล็ก 20กก.")).toBe(true);
    expect(isBillSlotProductName("ถุงแพ็คใส")).toBe(false);
  });

  it("uses the Bearing bill slot order without remapping standard exact bill behavior", () => {
    const items = [
      { ...sampleItems[0], productTypeId: 30, productName: "ซอง โม่" },
      { ...sampleItems[1], productTypeId: 31, productName: "ซอง" },
      { ...sampleItems[2], productTypeId: 32, productName: "แพ็ค 20", isAdded: false, unitPrice: 40, quantity: 2, subtotal: 80 },
    ];

    const bearingResult = buildBillRows(items, "bearing_bill");
    const exactResult = buildExactBillRows(items);

    expect(bearingResult.rows.map((r) => r.item?.productName || null)).toEqual([
      "ซอง โม่",
      "แพ็ค 20",
      null,
      null,
      null,
      null,
    ]);
    expect(bearingResult.extraItems.map((item) => item.productName)).toEqual(["ซอง"]);

    expect(exactResult.rows[0].item?.productName).toBe("ซอง");
  });
});
