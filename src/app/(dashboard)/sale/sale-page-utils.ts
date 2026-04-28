import { nowTimeISO, todayISO } from "@/lib/thai-utils";
import { getString } from "@/lib/client-safe-storage";
import {
  buildLocalTransferRef,
} from "@/lib/transfer-utils";
import {
  isBuyBagProductName,
  isBillSlotProductName,
  parseSaleEntryViewMode,
  type SaleEntryViewMode,
} from "@/lib/sale-entry-view";
import {
  getFactorySaleEntryViewOptions,
  type FactorySaleEntryViewOption,
} from "@/lib/factory-profile";
import { compareProductsByDisplayOrder } from "@/lib/product-order";
import type { ProductType } from "@/lib/types";
import type { SalePrintMode } from "@/lib/sale-print";

export interface InvoiceReturnContext {
  customerId: number;
  saleDate: string | null;
  saleTime: string | null;
  invoiceStartDate: string;
  invoiceEndDate: string;
  invoiceKinds: string;
  invoiceVatEnabled: boolean;
  invoiceSource: "new" | "draft";
  anchorTransactionId: number | null;
  backdateMode: boolean;
}

export const SALE_ENTRY_VIEW_MODE_KEY = "superice-sale-entry-view-mode";

export type SaleEntryViewOption = FactorySaleEntryViewOption & {
  mode: SaleEntryViewMode;
};

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

export function buildDefaultTransferRef(dateISO: string): string {
  return buildLocalTransferRef(dateISO);
}

export function sortProducts(a: ProductType, b: ProductType): number {
  return compareProductsByDisplayOrder(a, b);
}

function normalizeProductName(name: string): string {
  return (name || "").trim().replace(/\s+/g, " ");
}

export function isTransferPresetProduct(name: string): boolean {
  return TRANSFER_PRELOAD_PRODUCT_NAMES.has(normalizeProductName(name));
}

export function normalizeTimeForApi(value: string): string {
  if (/^\d{2}:\d{2}$/.test(value)) return `${value}:00`;
  if (/^\d{2}:\d{2}:\d{2}$/.test(value)) return value;
  return nowTimeISO();
}

export function getBangkokNowForPayload(): { saleDate: string; saleTime: string } {
  const now = new Date();
  return {
    saleDate: now.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }),
    saleTime: now.toLocaleTimeString("en-GB", {
      timeZone: "Asia/Bangkok",
      hour12: false,
    }),
  };
}

export function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function withExactLine7ClientMarker(
  clientId: string,
  line7ProductTypeId: number | null
): string {
  if (!line7ProductTypeId || !Number.isFinite(line7ProductTypeId) || line7ProductTypeId <= 0) {
    return clientId;
  }
  return `${clientId}-eb7-${line7ProductTypeId}`;
}

export function loadInitialPrintMode(): SalePrintMode {
  if (typeof window === "undefined") return "none";
  const savedMode = getString("superice-print-mode");
  if (
    savedMode === "none" ||
    savedMode === "receipt" ||
    savedMode === "epson" ||
    savedMode === "epson_v2" ||
    savedMode === "epson_test"
  ) {
    return savedMode;
  }
  const legacyAutoPrint = getString("superice-autoprint");
  if (legacyAutoPrint === "true") return "receipt";
  return "none";
}

export function loadInitialSaleEntryViewMode(): SaleEntryViewMode {
  if (typeof window === "undefined") return "default";
  return parseSaleEntryViewMode(getString(SALE_ENTRY_VIEW_MODE_KEY));
}

export function getAvailableSaleEntryViewOptions(
  sessionRole: string | null | undefined,
  sessionFactoryKey: string | null | undefined
): readonly SaleEntryViewOption[] {
  void sessionRole;
  return getFactorySaleEntryViewOptions(sessionFactoryKey) as readonly SaleEntryViewOption[];
}

export function normalizeSaleEntryViewModeForSession(
  requestedMode: SaleEntryViewMode,
  sessionRole: string | null | undefined,
  sessionFactoryKey: string | null | undefined
): SaleEntryViewMode {
  const availableModes = getAvailableSaleEntryViewOptions(
    sessionRole,
    sessionFactoryKey
  ).map((option) => option.mode);

  if (availableModes.includes(requestedMode)) {
    return requestedMode;
  }

  return availableModes[0] ?? "default";
}

export function parseBagBalance(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function isIsoDate(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function isIsoTime(value: string | null | undefined): value is string {
  return Boolean(value && /^\d{2}:\d{2}(?::\d{2})?$/.test(value));
}

export function buildInvoiceReturnUrl(
  context: InvoiceReturnContext,
  createdTransactionId: number
): string {
  const query = new URLSearchParams();
  query.set("tab", "new");
  query.set("customerId", String(context.customerId));
  query.set("startDate", context.invoiceStartDate);
  query.set("endDate", context.invoiceEndDate);
  query.set("invoiceKinds", context.invoiceKinds);
  query.set("vatEnabled", context.invoiceVatEnabled ? "1" : "0");
  query.set("refreshPreview", "1");
  query.set("createdTransactionId", String(createdTransactionId));
  query.set("invoiceSource", context.invoiceSource);
  if (context.anchorTransactionId) {
    query.set("anchorTransactionId", String(context.anchorTransactionId));
  }
  return `/invoice?${query.toString()}`;
}

export function getBackdateMaxDate(): string {
  return todayISO();
}

export { isBillSlotProductName, isBuyBagProductName };
