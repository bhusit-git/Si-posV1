import { describe, expect, it } from "vitest";
import type { OfflinePrintPayload } from "@/lib/offline-print-payload";
import {
  buildOfflineReceiptFallbackModel,
  resolveOfflineFallbackRoute,
} from "@/lib/offline-fallback";

function buildPayload(): OfflinePrintPayload {
  return {
    id: 77,
    clientId: "tok-77",
    transactionKind: "sale",
    saleDate: "2026-04-03",
    saleTime: "09:45:00",
    totalAmount: 350,
    paid: 200,
    status: "partial",
    pool: 1,
    row: 2,
    col: null,
    customer: {
      id: 9,
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
        productTypeId: 2,
        quantity: 2,
        unitPrice: 50,
        subtotal: 100,
        productType: {
          name: "หลอดใหญ่",
          hasBag: false,
          decreasesBag: false,
        },
      },
    ],
    bagLedgerEntries: [],
  };
}

describe("offline-fallback", () => {
  it("parses receipt print fallback routes and tokens", () => {
    expect(
      resolveOfflineFallbackRoute("https://superice.local/print/receipt/77?offlineToken=abc123")
    ).toEqual({
      kind: "receipt-print",
      offlineToken: "abc123",
    });
  });

  it("parses Epson test print fallback routes and tokens", () => {
    expect(
      resolveOfflineFallbackRoute(
        "https://superice.local/print/preprinted-bill-test/77?offlineToken=test123"
      )
    ).toEqual({
      kind: "epson-print",
      offlineToken: "test123",
    });
  });

  it("builds a receipt fallback model when payload exists", () => {
    expect(buildOfflineReceiptFallbackModel(buildPayload())).toEqual({
      customerName: "ร้านทดสอบ",
      saleDate: "2026-04-03",
      saleTime: "09:45:00",
      totalAmount: 350,
      paid: 200,
      status: "partial",
      items: [
        { name: "ซอง", quantity: 5, subtotal: 250 },
        { name: "หลอดใหญ่", quantity: 2, subtotal: 100 },
      ],
    });
  });

  it("returns null when no receipt payload exists", () => {
    expect(buildOfflineReceiptFallbackModel(null)).toBeNull();
  });
});
