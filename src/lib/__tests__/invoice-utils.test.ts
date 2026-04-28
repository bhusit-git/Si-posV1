import { describe, expect, it } from "vitest";
import {
  buildItemizedPreview,
  computeInvoiceDisplayStatus,
  inferBillKind,
  parseIncludeKinds,
  type PreviewSourceProductColumn,
  type PreviewSourceTransaction,
} from "@/lib/invoice-utils";

const productColumns: PreviewSourceProductColumn[] = [
  { id: 1, name: "ซอง", sortOrder: 1 },
  { id: 2, name: "หลอดใหญ่", sortOrder: 2 },
];

describe("invoice-utils", () => {
  it("parses includeKinds and defaults to all when empty", () => {
    const setA = parseIncludeKinds("sale,return");
    expect(setA.has("sale")).toBe(true);
    expect(setA.has("return")).toBe(true);
    expect(setA.has("transfer_out")).toBe(false);

    const setB = parseIncludeKinds("");
    expect(setB.has("sale")).toBe(true);
    expect(setB.has("return")).toBe(true);
    expect(setB.has("transfer_out")).toBe(true);
    expect(setB.has("adjustment")).toBe(true);
  });

  it("ignores whitespace and unknown includeKinds entries", () => {
    const set = parseIncludeKinds(" sale , bad_kind , return ");
    expect(set.has("sale")).toBe(true);
    expect(set.has("return")).toBe(true);
    expect(set.has("transfer_out")).toBe(false);
    expect(set.has("adjustment")).toBe(false);
  });

  it("infers kind from explicit field and fallbacks", () => {
    expect(inferBillKind({ transactionKind: "transfer_out", totalAmount: 100, note: null })).toBe("transfer_out");
    expect(inferBillKind({ transactionKind: null, totalAmount: -10, note: null })).toBe("return");
    expect(inferBillKind({ transactionKind: null, totalAmount: 0, note: "XFER|ref=XFER-20260302-001" })).toBe("transfer_out");
    expect(inferBillKind({ transactionKind: null, totalAmount: 100, note: null })).toBe("sale");
  });

  it("builds itemized rows and totals by selected kinds", () => {
    const txs: PreviewSourceTransaction[] = [
      {
        id: 1,
        customerName: "A",
        saleDate: "2026-03-01",
        saleTime: "09:00:00",
        pool: 1,
        row: 2,
        col: null,
        status: "paid",
        totalAmount: 1000,
        paid: 1000,
        transactionKind: "sale",
        note: null,
      },
      {
        id: 2,
        customerName: "A",
        saleDate: "2026-03-01",
        saleTime: "10:00:00",
        pool: 1,
        row: 3,
        col: null,
        status: "unpaid",
        totalAmount: 0,
        paid: 0,
        transactionKind: "transfer_out",
        note: "XFER|ref=XFER-20260301-001",
      },
      {
        id: 3,
        customerName: "A",
        saleDate: "2026-03-01",
        saleTime: "11:00:00",
        pool: 1,
        row: 4,
        col: null,
        status: "paid",
        totalAmount: -200,
        paid: -200,
        transactionKind: "return",
        note: null,
      },
    ];

    const items = [
      { transactionId: 1, productTypeId: 1, quantity: 10 },
      { transactionId: 3, productTypeId: 1, quantity: -2 },
    ];
    const bags = [
      { transactionId: 1, type: "out" as const, quantity: 10 },
      { transactionId: 3, type: "return" as const, quantity: 2 },
    ];

    const result = buildItemizedPreview({
      transactions: txs,
      items,
      bagEntries: bags,
      productColumns,
      includeKinds: parseIncludeKinds("sale,return"),
    });

    expect(result.rows).toHaveLength(2);
    expect(result.totals.kindCounts.sale).toBe(1);
    expect(result.totals.kindCounts.return).toBe(1);
    expect(result.totals.kindCounts.transfer_out).toBe(0);
    expect(result.totals.totalSum).toBe(800);
    expect(result.totals.totalCashPaid).toBe(800);
    expect(result.totals.totalCreditOwed).toBe(0);
    expect(result.totals.totalRefundBalance).toBe(0);
    expect(result.totals.totalsByProduct[1]).toBe(8);
    expect(result.totals.totalBagsOut).toBe(10);
    expect(result.totals.totalBagsReturned).toBe(2);
    expect(result.totals.totalBagsBought).toBe(0);
    expect(result.totals.totalBagAdjustDelta).toBe(0);
  });

  it("includes partial sales in invoice credit owed totals", () => {
    const txs: PreviewSourceTransaction[] = [
      {
        id: 11,
        customerName: "A",
        saleDate: "2026-03-01",
        saleTime: "09:00:00",
        pool: 1,
        row: 2,
        col: null,
        status: "partial",
        totalAmount: 1000,
        paid: 300,
        transactionKind: "sale",
        note: null,
      },
    ];

    const result = buildItemizedPreview({
      transactions: txs,
      items: [{ transactionId: 11, productTypeId: 1, quantity: 10 }],
      bagEntries: [],
      productColumns,
      includeKinds: parseIncludeKinds("sale"),
    });

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].cashPaid).toBe(300);
    expect(result.rows[0].creditOwed).toBe(700);
    expect(result.rows[0].refundBalance).toBe(0);
    expect(result.totals.totalCashPaid).toBe(300);
    expect(result.totals.totalCreditOwed).toBe(700);
    expect(result.totals.totalRefundBalance).toBe(0);
  });

  it("computes derived partially paid status", () => {
    expect(computeInvoiceDisplayStatus("issued", 100, 50)).toBe("partially_paid");
    expect(computeInvoiceDisplayStatus("issued", 0, 150)).toBe("issued");
    expect(computeInvoiceDisplayStatus("paid", 150, 0)).toBe("paid");
  });

  it("tracks buy-bags and signed bag adjustments separately from manual returns", () => {
    const txs: PreviewSourceTransaction[] = [
      {
        id: 20,
        customerName: "A",
        saleDate: "2026-03-02",
        saleTime: "08:00:00",
        pool: null,
        row: null,
        col: null,
        status: "paid",
        totalAmount: -100,
        paid: -100,
        transactionKind: "return",
        note: "คืนสินค้า อ้างอิงบิล #10",
      },
    ];

    const result = buildItemizedPreview({
      transactions: txs,
      items: [],
      bagEntries: [
        { transactionId: 20, type: "adjust", quantity: -5, note: "ยกเลิกบิล #10" },
        { transactionId: 20, type: "return", quantity: 2, note: "ซื้อกระสอบ" },
      ],
      productColumns,
      includeKinds: parseIncludeKinds("return"),
    });

    expect(result.rows[0].bagsOut).toBe(0);
    expect(result.rows[0].bagsReturned).toBe(0);
    expect(result.rows[0].bagsBought).toBe(2);
    expect(result.rows[0].bagAdjustDelta).toBe(-5);
    expect(result.totals.totalBagsBought).toBe(2);
    expect(result.totals.totalBagAdjustDelta).toBe(-5);
  });
});
