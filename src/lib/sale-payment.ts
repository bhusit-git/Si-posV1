import { isInvoiceCreditTransaction } from "@/lib/customer-credit-labels";

export type SalePaymentStatus = "paid" | "unpaid" | "partial";
export type AnalyticsSaleType = "cash" | "short_term_credit" | "long_term_credit";

interface ResolveSalePaymentOptions {
  paymentStatus: SalePaymentStatus;
  grandTotal: number;
  hasSaleItems: boolean;
  isTransferMode: boolean;
  partialPaidAmount: number | null;
}

interface SalePrintPaymentSummaryOptions {
  transactionKind?: "sale" | "transfer_out" | "return" | "adjustment" | null;
  status: string;
  totalAmount: number;
  paid: number;
}

interface ResolveAnalyticsSaleTypeOptions {
  transactionType?: string | null;
  paymentStatus?: string | null;
}

export interface ResolvedSalePayment {
  effectiveStatus: SalePaymentStatus;
  payloadPaid: number;
  printPaid: number;
  remainingAmount: number;
  isValid: boolean;
}

export interface SalePrintPaymentSummary {
  paidNow: number;
  remainingAmount: number;
  totalAmount: number;
}

export function resolveAnalyticsSaleType({
  transactionType,
  paymentStatus,
}: ResolveAnalyticsSaleTypeOptions): AnalyticsSaleType {
  if (transactionType === "transfer_out") return "long_term_credit";
  const normalizedStatus = `${paymentStatus || ""}`.trim().toLowerCase();
  if (normalizedStatus === "unpaid" || normalizedStatus === "partial") {
    return "short_term_credit";
  }
  return "cash";
}

export function analyticsSaleTypeThaiLabel(saleType: AnalyticsSaleType): string {
  if (saleType === "long_term_credit") return "เครดิต";
  if (saleType === "short_term_credit") return "ค้าง";
  return "เงินสด";
}

export function resolveSalePayment({
  paymentStatus,
  grandTotal,
  hasSaleItems,
  isTransferMode,
  partialPaidAmount,
}: ResolveSalePaymentOptions): ResolvedSalePayment {
  const safeGrandTotal = Math.max(0, grandTotal || 0);

  if (isTransferMode || !hasSaleItems || safeGrandTotal <= 0) {
    return {
      effectiveStatus: "paid",
      payloadPaid: -1,
      printPaid: safeGrandTotal,
      remainingAmount: 0,
      isValid: true,
    };
  }

  if (paymentStatus === "paid") {
    return {
      effectiveStatus: "paid",
      payloadPaid: -1,
      printPaid: safeGrandTotal,
      remainingAmount: 0,
      isValid: true,
    };
  }

  if (paymentStatus === "unpaid") {
    return {
      effectiveStatus: "unpaid",
      payloadPaid: 0,
      printPaid: 0,
      remainingAmount: safeGrandTotal,
      isValid: true,
    };
  }

  if (!Number.isFinite(partialPaidAmount) || partialPaidAmount === null || partialPaidAmount <= 0) {
    return {
      effectiveStatus: "partial",
      payloadPaid: 0,
      printPaid: 0,
      remainingAmount: safeGrandTotal,
      isValid: false,
    };
  }

  if (partialPaidAmount >= safeGrandTotal) {
    return {
      effectiveStatus: "paid",
      payloadPaid: -1,
      printPaid: safeGrandTotal,
      remainingAmount: 0,
      isValid: true,
    };
  }

  return {
    effectiveStatus: "partial",
    payloadPaid: partialPaidAmount,
    printPaid: partialPaidAmount,
    remainingAmount: Math.max(0, safeGrandTotal - partialPaidAmount),
    isValid: true,
  };
}

export function getSalePrintPaymentSummary({
  transactionKind,
  status,
  totalAmount,
  paid,
}: SalePrintPaymentSummaryOptions): SalePrintPaymentSummary | null {
  if (status !== "partial" || isInvoiceCreditTransaction(transactionKind)) {
    return null;
  }

  const safeTotal = Math.max(0, Number(totalAmount || 0));
  const paidNow = Math.min(safeTotal, Math.max(0, Number(paid || 0)));

  return {
    paidNow,
    remainingAmount: Math.max(0, safeTotal - paidNow),
    totalAmount: safeTotal,
  };
}
