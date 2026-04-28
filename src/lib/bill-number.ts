export const PRINTED_BILL_MIN = 0;
export const PRINTED_BILL_MAX = 9999;

export interface BillPresentationSource {
  id: number;
  transactionKind?: string | null;
  printedBillNumber?: number | null;
  transferRef?: string | null;
}

export function formatPrintedBillNumber(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < PRINTED_BILL_MIN || value > PRINTED_BILL_MAX) return null;
  return String(value).padStart(4, "0");
}

export function incrementPrintedBillNumber(value: number): number {
  if (!Number.isInteger(value)) return 1;
  return value >= PRINTED_BILL_MAX ? PRINTED_BILL_MIN : value + 1;
}

export function buildTransactionInternalReference(tx: BillPresentationSource): string {
  if (tx.transactionKind === "transfer_out" && tx.transferRef) {
    return tx.transferRef;
  }
  return `Tx #${tx.id}`;
}

export function buildTransactionBillNumber(tx: BillPresentationSource): string {
  const printed = formatPrintedBillNumber(tx.printedBillNumber);
  if (printed) return printed;
  if (tx.transactionKind === "transfer_out" && tx.transferRef) {
    return tx.transferRef;
  }
  return `#${tx.id}`;
}

export function withBillPresentation<T extends BillPresentationSource>(
  tx: T
): T & {
  billNumber: string;
  internalReference: string;
  printedBillNumberDisplay: string | null;
} {
  return {
    ...tx,
    billNumber: buildTransactionBillNumber(tx),
    internalReference: buildTransactionInternalReference(tx),
    printedBillNumberDisplay: formatPrintedBillNumber(tx.printedBillNumber),
  };
}
