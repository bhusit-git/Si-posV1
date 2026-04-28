export const SHORT_TERM_CREDIT_LABEL = "ค้าง";
export const INVOICE_CREDIT_LABEL = "เครดิต";
export const UNPAID_STATUS_LABEL = "ค้างชำระ";

export function customerCreditLabel(isEnabled: boolean): string {
  return isEnabled ? SHORT_TERM_CREDIT_LABEL : "ปกติ";
}

export function transferCustomerLabel(isEnabled: boolean): string {
  return isEnabled ? INVOICE_CREDIT_LABEL : "ปกติ";
}

export function isInvoiceCreditTransaction(
  transactionKind: string | null | undefined
): boolean {
  return transactionKind === "transfer_out";
}

export function maskCustomerPrintAmount(
  amount: number,
  transactionKind: string | null | undefined,
  hideCustomerTotals = false
): number {
  return isInvoiceCreditTransaction(transactionKind) || hideCustomerTotals ? 0 : amount;
}

export function normalizeCustomerPrintAmount(
  amount: number,
  transactionKind: string | null | undefined,
  hideCustomerTotals = false
): number {
  const normalizedAmount = transactionKind === "return" ? Math.abs(amount) : amount;
  return maskCustomerPrintAmount(normalizedAmount, transactionKind, hideCustomerTotals);
}
