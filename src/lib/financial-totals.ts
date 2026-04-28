export interface FinancialTotalsRow {
  status?: string | null;
  transactionKind?: string | null;
  totalAmount?: number | null;
  paid?: number | null;
}

export interface FinancialTotalsOptions {
  includeTransferOut?: boolean;
}

export interface FinancialTotalsResult {
  rowCount: number;
  activeCount: number;
  voidCount: number;
  voidAmount: number;
  grossSales: number;
  returnSales: number;
  netSales: number;
  cashIn: number;
  cashOut: number;
  netCash: number;
  receivableDelta: number;
  outstandingDebt: number;
  refundBalance: number;
}

function toFiniteNumber(value: number | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function isVoidStatus(status: string | null | undefined): boolean {
  return status === "voided";
}

function isTransferOutKind(kind: string | null | undefined): boolean {
  return kind === "transfer_out";
}

function isReturnRow(row: FinancialTotalsRow): boolean {
  if (row.transactionKind === "return") return true;
  if (!row.transactionKind && toFiniteNumber(row.totalAmount) < 0) return true;
  return false;
}

function toSignedReturnAmount(amount: number): number {
  if (amount === 0) return 0;
  return amount < 0 ? amount : -Math.abs(amount);
}

export function computeFinancialTotals(
  rows: FinancialTotalsRow[],
  options?: FinancialTotalsOptions
): FinancialTotalsResult {
  const includeTransferOut = options?.includeTransferOut ?? false;

  let rowCount = 0;
  let activeCount = 0;
  let voidCount = 0;
  let voidAmount = 0;
  let grossSales = 0;
  let returnSales = 0;
  let cashIn = 0;
  let cashOut = 0;

  for (const row of rows) {
    if (!includeTransferOut && isTransferOutKind(row.transactionKind)) {
      continue;
    }

    rowCount += 1;
    const amount = toFiniteNumber(row.totalAmount);
    const paid = toFiniteNumber(row.paid);

    if (isVoidStatus(row.status)) {
      voidCount += 1;
      voidAmount += amount;
      continue;
    }

    activeCount += 1;

    if (isReturnRow(row)) {
      returnSales += toSignedReturnAmount(amount);
    } else if (amount > 0) {
      grossSales += amount;
    }

    if (paid > 0) {
      cashIn += paid;
    } else if (paid < 0) {
      cashOut += paid;
    }
  }

  const netSales = grossSales + returnSales;
  const netCash = cashIn + cashOut;
  const receivableDelta = netSales - netCash;
  const outstandingDebt = Math.max(receivableDelta, 0);
  const refundBalance = Math.max(-receivableDelta, 0);

  return {
    rowCount,
    activeCount,
    voidCount,
    voidAmount,
    grossSales,
    returnSales,
    netSales,
    cashIn,
    cashOut,
    netCash,
    receivableDelta,
    outstandingDebt,
    refundBalance,
  };
}
