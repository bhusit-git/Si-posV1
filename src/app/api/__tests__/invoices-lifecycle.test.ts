import { describe, expect, it } from "vitest";
import {
  buildItemizedPreview,
  computeInvoiceDisplayStatus,
  inferInvoiceLineType,
  parseIncludeKinds,
  type PreviewSourceProductColumn,
  type PreviewSourceTransaction,
} from "@/lib/invoice-utils";

const productColumns: PreviewSourceProductColumn[] = [
  { id: 1, name: "ซอง", sortOrder: 1 },
];

describe("invoice production lifecycle contracts", () => {
  it("derives display status from stored invoice totals", () => {
    expect(computeInvoiceDisplayStatus("draft", 0, 1000)).toBe("draft");
    expect(computeInvoiceDisplayStatus("issued", 0, 1000)).toBe("issued");
    expect(computeInvoiceDisplayStatus("issued", 100, 900)).toBe("partially_paid");
    expect(computeInvoiceDisplayStatus("paid", 1000, 0)).toBe("paid");
    expect(computeInvoiceDisplayStatus("void", 0, 0)).toBe("void");
  });

  it("keeps invoice-credit rows commercially billable even though transaction writes mark them paid", () => {
    const txs: PreviewSourceTransaction[] = [
      {
        id: 41,
        customerName: "ACME",
        saleDate: "2026-03-01",
        saleTime: "09:00:00",
        pool: 1,
        row: 1,
        col: 1,
        status: "paid",
        totalAmount: 1000,
        paid: 1000,
        transactionKind: "transfer_out",
        note: "XFER|ref=XFER-20260301-001",
      },
    ];

    const preview = buildItemizedPreview({
      transactions: txs,
      items: [{ transactionId: 41, productTypeId: 1, quantity: 10 }],
      bagEntries: [],
      productColumns,
      includeKinds: parseIncludeKinds("transfer_out"),
    });

    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({
      transactionId: 41,
      kind: "transfer_out",
      cashPaid: 1000,
      creditOwed: 0,
      sumTotal: 1000,
    });
    expect(preview.totals).toMatchObject({
      totalCashPaid: 1000,
      totalCreditOwed: 0,
      totalSum: 1000,
      rowCount: 1,
    });
  });

  it("nets return rows into invoice drafts and stores them as return lines", () => {
    const txs: PreviewSourceTransaction[] = [
      {
        id: 42,
        customerName: "ACME",
        saleDate: "2026-03-02",
        saleTime: "09:00:00",
        pool: 1,
        row: 1,
        col: 1,
        status: "paid",
        totalAmount: -200,
        paid: -200,
        transactionKind: "return",
        note: "คืนสินค้า อ้างอิงบิล #41",
      },
    ];

    const preview = buildItemizedPreview({
      transactions: txs,
      items: [{ transactionId: 42, productTypeId: 1, quantity: -2 }],
      bagEntries: [],
      productColumns,
      includeKinds: parseIncludeKinds("return"),
    });

    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0]).toMatchObject({
      transactionId: 42,
      kind: "return",
      sumTotal: -200,
    });
    expect(preview.totals.totalSum).toBe(-200);
    expect(inferInvoiceLineType("return", preview.rows[0].sumTotal)).toBe("return");
  });

  it("keeps positive transfer rows as sale invoice lines while negative amounts become return lines", () => {
    expect(inferInvoiceLineType("transfer_out", 1000)).toBe("sale");
    expect(inferInvoiceLineType("sale", -50)).toBe("return");
  });
});
