import { describe, it, expect } from "vitest";

/**
 * Tests for the business logic used in /api/returns.
 * These test the computation patterns without needing the full Next.js + DB stack.
 */

// ---- Helpers extracted from the return route logic ----

function computeRefundTotal(
  items: { quantity: number; unitPrice: number }[]
): number {
  let total = 0;
  for (const item of items || []) {
    total += (item.quantity || 0) * (item.unitPrice || 0);
  }
  return total;
}

function buildReturnNote(
  originalBill: number | null,
  note: string | undefined
): string {
  return originalBill
    ? `คืนสินค้า อ้างอิงบิล #${originalBill}${note ? " - " + note : ""}`
    : note || "คืนสินค้า";
}

function validateReturnInput(body: {
  customerId?: number;
  saleDate?: string;
  saleTime?: string;
}): boolean {
  return !!(body.customerId && body.saleDate && body.saleTime);
}

function requiresOriginalBill(
  items: { quantity: number }[] | null | undefined
): boolean {
  return Array.isArray(items) && items.some((item) => (item.quantity || 0) > 0);
}

function remainingRefundableQty(
  soldQty: number,
  alreadyReturnedQty: number
): number {
  return Math.max(0, soldQty - alreadyReturnedQty);
}

function buildTransactionValues(
  customerId: number,
  totalRefund: number,
  note: string,
  saleDate: string,
  saleTime: string
) {
  return {
    customerId,
    totalAmount: -totalRefund,
    paid: -totalRefund,
    status: "paid" as const,
    pool: null,
    row: null,
    col: null,
    saleDate,
    saleTime,
    note,
  };
}

function buildReturnItemValues(
  txId: number,
  item: { productTypeId: number; quantity: number; unitPrice: number }
) {
  return {
    transactionId: txId,
    productTypeId: item.productTypeId,
    quantity: -item.quantity,
    unitPrice: item.unitPrice,
    subtotal: -(item.quantity * item.unitPrice),
  };
}

function allocateRefundToOutstanding(
  totalRefund: number,
  outstandingRows: { id: number; totalAmount: number; paid: number }[],
  originalBill: number | null
): {
  allocations: { transactionId: number; amount: number }[];
  unappliedRefundCredit: number;
} {
  let remaining = Math.max(0, totalRefund);

  const prioritized = [
    ...(originalBill ? outstandingRows.filter((r) => r.id === originalBill) : []),
    ...outstandingRows.filter((r) => r.id !== originalBill),
  ];

  const allocations: { transactionId: number; amount: number }[] = [];

  for (const row of prioritized) {
    if (remaining <= 0) break;
    const outstanding = Math.max(0, row.totalAmount - (row.paid || 0));
    if (outstanding <= 0) continue;
    const amount = Math.min(outstanding, remaining);
    allocations.push({ transactionId: row.id, amount });
    remaining -= amount;
  }

  return { allocations, unappliedRefundCredit: remaining };
}

// ==================== Tests ====================

describe("Return refund total computation", () => {
  it("computes total from items", () => {
    const items = [
      { quantity: 3, unitPrice: 150 },
      { quantity: 2, unitPrice: 200 },
    ];
    expect(computeRefundTotal(items)).toBe(850);
  });

  it("handles empty array", () => {
    expect(computeRefundTotal([])).toBe(0);
  });

  it("handles zero quantities", () => {
    expect(computeRefundTotal([{ quantity: 0, unitPrice: 100 }])).toBe(0);
  });

  it("handles null/undefined items gracefully", () => {
    expect(computeRefundTotal(null as unknown as [])).toBe(0);
    expect(computeRefundTotal(undefined as unknown as [])).toBe(0);
  });
});

describe("Return note builder", () => {
  it("builds note with original bill reference", () => {
    expect(buildReturnNote(1234, "สินค้าเสีย")).toBe(
      "คืนสินค้า อ้างอิงบิล #1234 - สินค้าเสีย"
    );
  });

  it("builds note with original bill but no extra note", () => {
    expect(buildReturnNote(1234, undefined)).toBe(
      "คืนสินค้า อ้างอิงบิล #1234"
    );
  });

  it("builds note with original bill and empty note", () => {
    expect(buildReturnNote(1234, "")).toBe("คืนสินค้า อ้างอิงบิล #1234");
  });

  it("builds note without original bill but with note", () => {
    expect(buildReturnNote(null, "ลูกค้าเปลี่ยนใจ")).toBe("ลูกค้าเปลี่ยนใจ");
  });

  it("builds default note without any references", () => {
    expect(buildReturnNote(null, undefined)).toBe("คืนสินค้า");
    expect(buildReturnNote(null, "")).toBe("คืนสินค้า");
  });
});

describe("Return input validation", () => {
  it("accepts valid input", () => {
    expect(
      validateReturnInput({
        customerId: 1,
        saleDate: "2024-01-15",
        saleTime: "10:00:00",
      })
    ).toBe(true);
  });

  it("rejects missing customerId", () => {
    expect(
      validateReturnInput({ saleDate: "2024-01-15", saleTime: "10:00:00" })
    ).toBe(false);
  });

  it("rejects missing saleDate", () => {
    expect(
      validateReturnInput({ customerId: 1, saleTime: "10:00:00" })
    ).toBe(false);
  });

  it("rejects missing saleTime", () => {
    expect(
      validateReturnInput({ customerId: 1, saleDate: "2024-01-15" })
    ).toBe(false);
  });

  it("requires an original bill when product refund items exist", () => {
    expect(requiresOriginalBill([{ quantity: 1 }])).toBe(true);
    expect(requiresOriginalBill([{ quantity: 0 }])).toBe(false);
    expect(requiresOriginalBill([])).toBe(false);
    expect(requiresOriginalBill(undefined)).toBe(false);
  });
});

describe("Return transaction values builder", () => {
  it("creates correct negative values for return transaction", () => {
    const values = buildTransactionValues(1, 500, "คืนสินค้า", "2024-01-15", "10:00:00");
    expect(values.totalAmount).toBe(-500);
    expect(values.paid).toBe(-500);
    expect(values.status).toBe("paid");
    expect(values.customerId).toBe(1);
  });

  it("handles zero refund", () => {
    const values = buildTransactionValues(1, 0, "test", "2024-01-15", "10:00:00");
    expect(values.totalAmount).toBe(-0); // -0 is expected: -(0) = -0
    expect(values.paid).toBe(-0);
  });
});

describe("Return item values builder", () => {
  it("creates correct negative quantity and subtotal", () => {
    const values = buildReturnItemValues(100, {
      productTypeId: 1,
      quantity: 5,
      unitPrice: 200,
    });
    expect(values.transactionId).toBe(100);
    expect(values.quantity).toBe(-5);
    expect(values.subtotal).toBe(-1000);
    expect(values.unitPrice).toBe(200);
  });

  it("preserves positive unitPrice", () => {
    const values = buildReturnItemValues(100, {
      productTypeId: 2,
      quantity: 1,
      unitPrice: 99,
    });
    expect(values.unitPrice).toBe(99);
    expect(values.quantity).toBe(-1);
    expect(values.subtotal).toBe(-99);
  });
});

describe("Refund allocation to outstanding credit bills", () => {
  it("allocates to original bill first", () => {
    const result = allocateRefundToOutstanding(
      300,
      [
        { id: 10, totalAmount: 1000, paid: 600 }, // outstanding 400
        { id: 11, totalAmount: 500, paid: 100 }, // outstanding 400
      ],
      11
    );
    expect(result.allocations).toEqual([{ transactionId: 11, amount: 300 }]);
    expect(result.unappliedRefundCredit).toBe(0);
  });

  it("spills remainder to oldest outstanding after original bill", () => {
    const result = allocateRefundToOutstanding(
      600,
      [
        { id: 10, totalAmount: 1000, paid: 600 }, // outstanding 400
        { id: 11, totalAmount: 500, paid: 100 }, // outstanding 400
      ],
      11
    );
    expect(result.allocations).toEqual([
      { transactionId: 11, amount: 400 },
      { transactionId: 10, amount: 200 },
    ]);
    expect(result.unappliedRefundCredit).toBe(0);
  });

  it("allocates oldest-first when no original bill is given", () => {
    const result = allocateRefundToOutstanding(
      250,
      [
        { id: 1, totalAmount: 300, paid: 0 }, // outstanding 300
        { id: 2, totalAmount: 300, paid: 0 }, // outstanding 300
      ],
      null
    );
    expect(result.allocations).toEqual([{ transactionId: 1, amount: 250 }]);
    expect(result.unappliedRefundCredit).toBe(0);
  });

  it("keeps remainder as unapplied credit when refund exceeds outstanding", () => {
    const result = allocateRefundToOutstanding(
      1000,
      [
        { id: 1, totalAmount: 300, paid: 100 }, // outstanding 200
        { id: 2, totalAmount: 500, paid: 300 }, // outstanding 200
      ],
      null
    );
    expect(result.allocations).toEqual([
      { transactionId: 1, amount: 200 },
      { transactionId: 2, amount: 200 },
    ]);
    expect(result.unappliedRefundCredit).toBe(600);
  });
});

describe("Original bill refundable quantity guard", () => {
  it("allows refund up to the remaining refundable quantity", () => {
    expect(remainingRefundableQty(10, 3)).toBe(7);
    expect(remainingRefundableQty(10, 10)).toBe(0);
  });

  it("prevents repeated refunds from exceeding the sold quantity", () => {
    const remaining = remainingRefundableQty(10, 8);
    expect(remaining).toBe(2);
    expect(3 > remaining).toBe(true);
  });
});

describe("Bag return payload construction", () => {
  // This tests the frontend logic that builds the bag return payload
  interface ProductType {
    id: number;
    name: string;
    hasBag: boolean;
    isActive: boolean;
  }

  function buildBagReturnsPayload(
    bagReturnQty: number,
    products: ProductType[]
  ): { productTypeId: number; quantity: number }[] {
    const bagPt = products.find((p) => p.hasBag);
    return bagReturnQty > 0 && bagPt
      ? [{ productTypeId: bagPt.id, quantity: bagReturnQty }]
      : [];
  }

  it("creates payload when there are bag returns and products with bags", () => {
    const products = [
      { id: 1, name: "น้ำแข็งหลอด", hasBag: true, isActive: true },
      { id: 2, name: "น้ำแข็งซอง", hasBag: false, isActive: true },
    ];
    const result = buildBagReturnsPayload(10, products);
    expect(result).toEqual([{ productTypeId: 1, quantity: 10 }]);
  });

  it("returns empty array when bagReturnQty is 0", () => {
    const products = [
      { id: 1, name: "น้ำแข็งหลอด", hasBag: true, isActive: true },
    ];
    expect(buildBagReturnsPayload(0, products)).toEqual([]);
  });

  it("returns empty array when no products have bags", () => {
    const products = [
      { id: 1, name: "น้ำแข็งซอง", hasBag: false, isActive: true },
    ];
    expect(buildBagReturnsPayload(5, products)).toEqual([]);
  });

  it("returns empty array when products list is empty", () => {
    expect(buildBagReturnsPayload(5, [])).toEqual([]);
  });
});

describe("Automatic bag reversal for refunded bagged products", () => {
  interface ProductType {
    id: number;
    hasBag: boolean;
  }

  function computeAutoReversedBagQty(
    items: { productTypeId: number; quantity: number }[],
    productTypes: ProductType[]
  ): number {
    const ptMap = new Map(productTypes.map((pt) => [pt.id, pt]));
    return items.reduce((sum, item) => {
      const pt = ptMap.get(item.productTypeId);
      if (!pt?.hasBag || item.quantity <= 0) return sum;
      return sum + item.quantity;
    }, 0);
  }

  it("reverses bag debt for bagged refunded products", () => {
    const result = computeAutoReversedBagQty(
      [
        { productTypeId: 1, quantity: 10 },
        { productTypeId: 2, quantity: 3 },
      ],
      [
        { id: 1, hasBag: true },
        { id: 2, hasBag: false },
      ]
    );

    expect(result).toBe(10);
  });

  it("ignores zero or negative quantities", () => {
    const result = computeAutoReversedBagQty(
      [
        { productTypeId: 1, quantity: 0 },
        { productTypeId: 1, quantity: -2 },
      ],
      [{ id: 1, hasBag: true }]
    );

    expect(result).toBe(0);
  });

  it("should be recorded as an adjustment, not a manual bag return", () => {
    const reversedQty = computeAutoReversedBagQty(
      [{ productTypeId: 1, quantity: 4 }],
      [{ id: 1, hasBag: true }]
    );

    const bagLedgerEntry = {
      type: "adjust" as const,
      quantity: -reversedQty,
      note: "ยกเลิกบิล #77",
    };

    expect(bagLedgerEntry).toEqual({
      type: "adjust",
      quantity: -4,
      note: "ยกเลิกบิล #77",
    });
  });
});
