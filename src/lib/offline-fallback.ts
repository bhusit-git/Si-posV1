import type { OfflinePrintPayload } from "@/lib/offline-print-payload";

export type OfflineFallbackKind = "navigation" | "receipt-print" | "epson-print";

export interface OfflineFallbackRoute {
  kind: OfflineFallbackKind;
  offlineToken: string | null;
}

export interface OfflineReceiptFallbackModel {
  customerName: string;
  saleDate: string;
  saleTime: string;
  totalAmount: number;
  paid: number;
  status: OfflinePrintPayload["status"];
  items: Array<{
    name: string;
    quantity: number;
    subtotal: number;
  }>;
}

export function resolveOfflineFallbackRoute(urlValue: string): OfflineFallbackRoute {
  const url = new URL(urlValue, "https://offline.local");
  const offlineToken = url.searchParams.get("offlineToken");

  if (url.pathname.startsWith("/print/receipt/")) {
    return { kind: "receipt-print", offlineToken };
  }
  if (url.pathname.startsWith("/print/preprinted-bill/")) {
    return { kind: "epson-print", offlineToken };
  }
  if (url.pathname.startsWith("/print/preprinted-bill-test/")) {
    return { kind: "epson-print", offlineToken };
  }
  return { kind: "navigation", offlineToken };
}

export function buildOfflineReceiptFallbackModel(
  payload: OfflinePrintPayload | null
): OfflineReceiptFallbackModel | null {
  if (!payload) return null;
  return {
    customerName: payload.customer.name,
    saleDate: payload.saleDate,
    saleTime: payload.saleTime,
    totalAmount: payload.totalAmount,
    paid: payload.paid,
    status: payload.status,
    items: payload.items
      .filter((item) => item.quantity > 0)
      .map((item) => ({
        name: item.productType.name,
        quantity: item.quantity,
        subtotal: item.subtotal,
      })),
  };
}
