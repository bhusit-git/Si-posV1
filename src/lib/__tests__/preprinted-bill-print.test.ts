import { describe, expect, it } from "vitest";
import type { OfflinePrintPayload } from "@/lib/offline-print-payload";
import { buildPreprintedBillPrintModel } from "@/lib/preprinted-bill-print";

function buildPayload(
  overrides: Partial<OfflinePrintPayload> = {}
): OfflinePrintPayload {
  return {
    id: 901,
    clientId: "901-alpha",
    transactionKind: "sale",
    saleDate: "2026-04-03",
    saleTime: "09:45:00",
    totalAmount: 260,
    paid: 260,
    status: "paid",
    pool: null,
    row: 2,
    col: null,
    bagBalanceBefore: 10,
    bagBalanceAfter: 12,
    hidePrintTotals: false,
    customer: {
      id: 77,
      name: "ร้านทดสอบ",
    },
    items: [
      {
        productTypeId: 1,
        quantity: 5,
        unitPrice: 50,
        subtotal: 250,
        productType: {
          name: "ซอง",
          hasBag: true,
          decreasesBag: false,
        },
      },
      {
        productTypeId: 8,
        quantity: 1,
        unitPrice: 10,
        subtotal: 10,
        productType: {
          name: "ซื้อกระสอบ",
          hasBag: false,
          decreasesBag: true,
        },
      },
    ],
    bagLedgerEntries: [
      { type: "out", quantity: 5, note: null },
      { type: "return", quantity: 1, note: "ซื้อกระสอบ" },
    ],
    ...overrides,
  };
}

describe("preprinted-bill-print", () => {
  it("builds fixed Epson rows for a standard sale", () => {
    const model = buildPreprintedBillPrintModel(buildPayload());

    expect(model.customerName).toBe("ร้านทดสอบ");
    expect(model.timeText).toBe("09:45");
    expect(model.itemRows[0]).toMatchObject({ qty: 5, item: "ซอง", amount: 250 });
    expect(model.bagRows[0]).toMatchObject({ qty: 1, item: "ซื้อกระสอบ", amount: 10 });
    expect(model.bagRows[3]).toMatchObject({ qty: 12, item: "ค้างถุง", amount: 0 });
    expect(model.totalAmount).toBe(260);
    expect(model.partialPaidAmount).toBeNull();
    expect(model.partialRemainingAmount).toBeNull();
  });

  it("includes partial payment summary for short-term credit sales", () => {
    const model = buildPreprintedBillPrintModel(
      buildPayload({
        totalAmount: 500,
        paid: 125,
        status: "partial",
        items: [
          {
            productTypeId: 1,
            quantity: 10,
            unitPrice: 50,
            subtotal: 500,
            productType: {
              name: "ซอง",
              hasBag: true,
              decreasesBag: false,
            },
          },
        ],
        bagLedgerEntries: [{ type: "out", quantity: 10, note: null }],
      })
    );

    expect(model.totalAmount).toBe(500);
    expect(model.partialPaidAmount).toBe(125);
    expect(model.partialRemainingAmount).toBe(375);
    expect(model.layout.partialRemainingY).toBeGreaterThan(model.layout.partialPaidY);
  });

  it("masks totals for transfer-out and hidden-total prints", () => {
    const model = buildPreprintedBillPrintModel(
      buildPayload({
        transactionKind: "transfer_out",
        hidePrintTotals: true,
      })
    );

    expect(model.hidePrintTotals).toBe(true);
    expect(model.itemRows[0]?.amount).toBe(0);
    expect(model.bagRows[0]?.amount).toBe(0);
    expect(model.totalAmount).toBe(0);
    expect(model.partialPaidAmount).toBeNull();
  });

  it("honors exact line 7 markers and explicit bag balance after values", () => {
    const model = buildPreprintedBillPrintModel(
      buildPayload({
        clientId: "901-alpha-eb7-44",
        bagBalanceAfter: 55,
        items: [
          {
            productTypeId: 44,
            quantity: 3,
            unitPrice: 12,
            subtotal: 36,
            productType: {
              name: "ถุงพิเศษ",
              hasBag: false,
              decreasesBag: true,
            },
          },
        ],
        bagLedgerEntries: [{ type: "return", quantity: 3, note: "ซื้อกระสอบ" }],
      })
    );

    expect(model.bagRows[0]).toMatchObject({ qty: 3, item: "ถุงพิเศษ", amount: 36 });
    expect(model.bagRows[3]).toMatchObject({ qty: 55, item: "ค้างถุง", amount: 0 });
  });
});
