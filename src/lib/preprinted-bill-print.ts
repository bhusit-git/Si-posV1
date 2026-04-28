import { normalizeCustomerPrintAmount } from "@/lib/customer-credit-labels";
import {
  mapTransactionToPreprintedBill,
  type PreprintedBillLineModel,
  type PreprintedSourceBagEntry,
  type PreprintedSourceItem,
} from "@/lib/preprinted-bill-mapper";
import { getSalePrintPaymentSummary } from "@/lib/sale-payment";

export interface PreprintedBillSourceData {
  id?: number;
  clientId?: string | null;
  transactionKind?: "sale" | "transfer_out" | "return" | "adjustment" | null;
  saleDate: string;
  saleTime: string;
  totalAmount: number;
  paid: number;
  status: string;
  bagBalanceAfter?: number;
  hidePrintTotals?: boolean;
  customer: { id: number; name: string };
  items: PreprintedSourceItem[];
  bagLedgerEntries?: PreprintedSourceBagEntry[] | null;
}

export interface PreprintedBillPrintRow {
  qty: number;
  item: string;
  amount: number;
}

export interface PreprintedBillLayoutMetrics {
  bagStartY: number;
  totalY: number;
  partialPaidY: number;
  partialRemainingY: number;
  timeY: number;
  signY: number;
}

export interface PreprintedBillPrintModel {
  data: PreprintedBillSourceData;
  hidePrintTotals: boolean;
  mapped: PreprintedBillLineModel;
  customerName: string;
  formattedDate: string;
  timeText: string;
  itemRows: PreprintedBillPrintRow[];
  bagRows: PreprintedBillPrintRow[];
  totalAmount: number;
  partialPaidAmount: number | null;
  partialRemainingAmount: number | null;
  layout: PreprintedBillLayoutMetrics;
}

export const PREPRINTED_BILL_LAYOUT = {
  PAPER_WIDTH_MM: 115,
  PAPER_HEIGHT_MM: 140,
  BASE_OFFSET_X_MM: 5,
  BASE_OFFSET_Y_MM: -2,
  PRINTABLE_WIDTH_MM: 90,
  CONTENT_LEFT_MM: 8,
  ITEM_QTY_SHIFT_LEFT_MM: 5,
  ITEM_NAME_SHIFT_LEFT_MM: 10,
  COL_AMOUNT_WIDTH_MM: 20,
  RIGHT_AMOUNT_INSET_MM: 10,
  BAG_QTY_WIDTH_MM: 14,
  BAG_QTY_GAP_MM: 1,
  BAG_QTY_LEFT_SHIFT_MM: 20,
  BAG_SECTION_SHIFT_MM: 0,
  CUSTOMER_Y_MM: 25,
  DATE_Y_MM: 25,
  ITEM_START_Y_MM: 44,
  ROW_SPACING_MM: 7,
  BAG_GAP_MM: 0,
  TOTAL_GAP_MM: -1,
  TIME_GAP_MM: 4,
  SIGN_GAP_MM: 8,
  PARTIAL_GAP_MM: 4.5,
  PARTIAL_ROW_SPACING_MM: 4.5,
  FIXED_PRODUCT_ROW_COUNT: 6,
} as const;

export const PREPRINTED_BILL_COLUMNS = {
  COL_QTY_X_MM:
    PREPRINTED_BILL_LAYOUT.CONTENT_LEFT_MM - PREPRINTED_BILL_LAYOUT.ITEM_QTY_SHIFT_LEFT_MM,
  COL_ITEM_X_MM:
    PREPRINTED_BILL_LAYOUT.CONTENT_LEFT_MM +
    17 -
    PREPRINTED_BILL_LAYOUT.ITEM_NAME_SHIFT_LEFT_MM,
  COL_AMOUNT_X_MM:
    PREPRINTED_BILL_LAYOUT.CONTENT_LEFT_MM +
    PREPRINTED_BILL_LAYOUT.PRINTABLE_WIDTH_MM -
    PREPRINTED_BILL_LAYOUT.COL_AMOUNT_WIDTH_MM -
    PREPRINTED_BILL_LAYOUT.RIGHT_AMOUNT_INSET_MM,
  DATE_BLOCK_WIDTH_MM:
    PREPRINTED_BILL_LAYOUT.PRINTABLE_WIDTH_MM -
    PREPRINTED_BILL_LAYOUT.RIGHT_AMOUNT_INSET_MM,
  SIGN_LEFT_X_MM: PREPRINTED_BILL_LAYOUT.CONTENT_LEFT_MM,
} as const;

export const PREPRINTED_BILL_DERIVED = {
  ITEM_LABEL_WIDTH_MM:
    PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM - PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM - 2,
  BAG_QTY_X_MM:
    PREPRINTED_BILL_COLUMNS.COL_AMOUNT_X_MM -
    PREPRINTED_BILL_LAYOUT.BAG_QTY_WIDTH_MM -
    PREPRINTED_BILL_LAYOUT.BAG_QTY_GAP_MM,
} as const;

export const PREPRINTED_BILL_MORE = {
  BAG_ITEM_LABEL_WIDTH_MM:
    PREPRINTED_BILL_DERIVED.BAG_QTY_X_MM - PREPRINTED_BILL_COLUMNS.COL_ITEM_X_MM - 1,
} as const;

function formatThaiDateForPrint(value: string): string {
  try {
    const date = new Date(`${value}T00:00:00`);
    return date.toLocaleDateString("th-TH", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

export function formatPreprintedBillQty(value: number): string {
  if (value === 0) return "0";
  if (Number.isInteger(value)) return `${value}`;
  return value.toFixed(2).replace(/\.00$/, "");
}

export function formatPreprintedBillAmount(value: number, blankIfZero = true): string {
  if (blankIfZero && value === 0) return "";
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function parseExactLine7Marker(clientId: string | null | undefined): {
  productTypeId: number | null;
  productName: string | null;
} {
  if (!clientId) return { productTypeId: null, productName: null };

  const match = /(?:^|-)eb7-(\d+)(?:~(.+))?$/.exec(clientId);
  if (!match) return { productTypeId: null, productName: null };

  const productTypeId = Number.parseInt(match[1], 10);
  let productName: string | null = null;
  if (match[2]) {
    try {
      productName = decodeURIComponent(match[2]);
    } catch {
      productName = null;
    }
  }

  return {
    productTypeId: Number.isFinite(productTypeId) && productTypeId > 0 ? productTypeId : null,
    productName: productName?.trim() || null,
  };
}

export function buildPreprintedBillLayoutMetrics(
  hasPartialSummary: boolean
): PreprintedBillLayoutMetrics {
  const bagStartY =
    PREPRINTED_BILL_LAYOUT.ITEM_START_Y_MM +
    PREPRINTED_BILL_LAYOUT.FIXED_PRODUCT_ROW_COUNT * PREPRINTED_BILL_LAYOUT.ROW_SPACING_MM +
    PREPRINTED_BILL_LAYOUT.BAG_GAP_MM;
  const totalY =
    bagStartY +
    4 * PREPRINTED_BILL_LAYOUT.ROW_SPACING_MM +
    PREPRINTED_BILL_LAYOUT.TOTAL_GAP_MM;
  const partialPaidY = totalY + PREPRINTED_BILL_LAYOUT.PARTIAL_GAP_MM;
  const partialRemainingY =
    partialPaidY + PREPRINTED_BILL_LAYOUT.PARTIAL_ROW_SPACING_MM;
  const timeY =
    totalY +
    PREPRINTED_BILL_LAYOUT.TIME_GAP_MM +
    (hasPartialSummary
      ? PREPRINTED_BILL_LAYOUT.PARTIAL_GAP_MM + PREPRINTED_BILL_LAYOUT.PARTIAL_ROW_SPACING_MM
      : 0);
  const signY = timeY + PREPRINTED_BILL_LAYOUT.SIGN_GAP_MM;

  return {
    bagStartY,
    totalY,
    partialPaidY,
    partialRemainingY,
    timeY,
    signY,
  };
}

export function buildPreprintedBillPrintModel(
  data: PreprintedBillSourceData,
  options?: { hidePrintTotals?: boolean }
): PreprintedBillPrintModel {
  const line7Marker = parseExactLine7Marker(data.clientId);
  const mapped = mapTransactionToPreprintedBill({
    items: data.items || [],
    bagLedgerEntries: data.bagLedgerEntries || [],
    exactLine7ProductTypeId: line7Marker.productTypeId,
    exactLine7ProductName: line7Marker.productName,
    bagBalanceAfter: data.bagBalanceAfter,
  });

  const hidePrintTotals = options?.hidePrintTotals ?? data.hidePrintTotals === true;
  const partialSummary = getSalePrintPaymentSummary({
    transactionKind: data.transactionKind,
    status: data.status,
    totalAmount: Number(data.totalAmount || 0),
    paid: Number(data.paid || 0),
  });
  const normalizeAmount = (amount: number) =>
    normalizeCustomerPrintAmount(amount, data.transactionKind, hidePrintTotals);

  const itemRows: PreprintedBillPrintRow[] = [
    { qty: mapped.line1BlockIceQty, item: "ซอง", amount: normalizeAmount(mapped.line1BlockIceAmount) },
    { qty: mapped.line2Pack20Qty, item: "แพ็ค 20", amount: normalizeAmount(mapped.line2Pack20Amount) },
    {
      qty: mapped.line3LargeTube20KgQty,
      item: "หลอดใหญ่ 20กก.",
      amount: normalizeAmount(mapped.line3LargeTube20KgAmount),
    },
    {
      qty: mapped.line4SmallTubeCrushedQty,
      item: "หลอดเล็ก โม่",
      amount: normalizeAmount(mapped.line4SmallTubeCrushedAmount),
    },
    {
      qty: mapped.line5LargeTubeCrushedQty,
      item: "หลอดใหญ่ โม่",
      amount: normalizeAmount(mapped.line5LargeTubeCrushedAmount),
    },
    {
      qty: mapped.line6SmallTube20KgQty,
      item: "หลอดเล็ก 20กก.",
      amount: normalizeAmount(mapped.line6SmallTube20KgAmount),
    },
  ];

  const bagRows: PreprintedBillPrintRow[] = [
    {
      qty: mapped.line7DisplayQty,
      item: mapped.line7DisplayLabel,
      amount: normalizeAmount(mapped.line7DisplayAmount),
    },
    { qty: mapped.line8BagsOutQty, item: "ถุงออก", amount: 0 },
    { qty: mapped.line9BagsReturnQty, item: "คืนถุง", amount: 0 },
    { qty: mapped.line10NetBagQty, item: "ค้างถุง", amount: 0 },
  ];

  return {
    data,
    hidePrintTotals,
    mapped,
    customerName: data.customer.name,
    formattedDate: formatThaiDateForPrint(data.saleDate),
    timeText: data.saleTime?.slice(0, 5) || "-",
    itemRows,
    bagRows,
    totalAmount: normalizeCustomerPrintAmount(
      Number(data.totalAmount || 0),
      data.transactionKind,
      hidePrintTotals
    ),
    partialPaidAmount: partialSummary
      ? normalizeCustomerPrintAmount(
          partialSummary.paidNow,
          data.transactionKind,
          hidePrintTotals
        )
      : null,
    partialRemainingAmount: partialSummary
      ? normalizeCustomerPrintAmount(
          partialSummary.remainingAmount,
          data.transactionKind,
          hidePrintTotals
        )
      : null,
    layout: buildPreprintedBillLayoutMetrics(Boolean(partialSummary)),
  };
}
