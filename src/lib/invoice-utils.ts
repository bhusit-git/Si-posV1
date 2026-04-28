import { summarizeBagLedgerEntries } from "@/lib/bag-flow";
import { computeFinancialTotals } from "@/lib/financial-totals";

export type BillKind = "sale" | "return" | "transfer_out" | "adjustment";

export const ALL_BILL_KINDS: BillKind[] = [
  "sale",
  "return",
  "transfer_out",
  "adjustment",
];

export type InvoiceDisplayStatus =
  | "draft"
  | "issued"
  | "partially_paid"
  | "paid"
  | "void";

export interface PreviewSourceTransaction {
  id: number;
  customerName: string;
  saleDate: string;
  saleTime: string;
  pool: number | null;
  row: number | null;
  col: number | null;
  status: "paid" | "unpaid" | "partial" | "voided";
  totalAmount: number;
  paid: number;
  transactionKind: BillKind | null;
  note: string | null;
}

export interface PreviewSourceItem {
  transactionId: number;
  productTypeId: number;
  quantity: number;
}

export interface PreviewSourceBagEntry {
  transactionId: number | null;
  type: "out" | "return" | "adjust";
  quantity: number;
  note?: string | null;
}

export interface PreviewSourceProductColumn {
  id: number;
  name: string;
  sortOrder: number | null;
}

export interface ItemizedPreviewRow {
  transactionId: number;
  customerName: string;
  saleDate: string;
  saleTime: string;
  location: string;
  kind: BillKind;
  transactionStatus: "paid" | "unpaid" | "partial" | "voided";
  quantities: Record<number, number>;
  bagsOut: number;
  bagsReturned: number;
  bagsBought: number;
  bagAdjustDelta: number;
  cashPaid: number;
  creditOwed: number;
  refundBalance: number;
  sumTotal: number;
}

export interface ItemizedPreviewTotals {
  totalsByProduct: Record<number, number>;
  totalCashPaid: number;
  totalCreditOwed: number;
  totalRefundBalance: number;
  totalSum: number;
  totalBagsOut: number;
  totalBagsReturned: number;
  totalBagsBought: number;
  totalBagAdjustDelta: number;
  kindCounts: Record<BillKind, number>;
  rowCount: number;
}

export interface ItemizedPreviewResult {
  productColumns: Array<{ id: number; name: string }>;
  rows: ItemizedPreviewRow[];
  totals: ItemizedPreviewTotals;
}

function normalizeKindValue(value: string | null | undefined): BillKind | null {
  if (value === "sale" || value === "return" || value === "transfer_out" || value === "adjustment") {
    return value;
  }
  return null;
}

export function parseIncludeKinds(input: string | null | undefined): Set<BillKind> {
  if (!input || !input.trim()) {
    return new Set<BillKind>(ALL_BILL_KINDS);
  }

  const next = new Set<BillKind>();
  for (const part of input.split(",")) {
    const normalized = normalizeKindValue(part.trim());
    if (normalized) next.add(normalized);
  }

  return next.size > 0 ? next : new Set<BillKind>(ALL_BILL_KINDS);
}

export function inferBillKind(tx: {
  transactionKind?: string | null;
  totalAmount: number;
  note?: string | null;
}): BillKind {
  const explicit = normalizeKindValue(tx.transactionKind);
  if (explicit) return explicit;
  if ((tx.note || "").trim().startsWith("XFER|")) return "transfer_out";
  if (tx.totalAmount < 0) return "return";
  return "sale";
}

export function inferInvoiceLineType(kind: BillKind, amount: number): "sale" | "return" {
  if (kind === "return" || amount < 0) return "return";
  return "sale";
}

export function computeInvoiceDisplayStatus(
  status: "draft" | "issued" | "paid" | "void",
  paidTotal: number,
  outstandingTotal: number
): InvoiceDisplayStatus {
  if (status === "issued" && paidTotal > 0 && outstandingTotal > 0) {
    return "partially_paid";
  }
  return status;
}

export function computeLocation(
  pool: number | null,
  row: number | null,
  col: number | null
): string {
  const values = [pool, row, col]
    .filter((v) => v !== null && v !== undefined)
    .map((v) => String(v));
  return values.length > 0 ? values.join("-") : "-";
}

function sortProductColumns(
  columns: PreviewSourceProductColumn[]
): PreviewSourceProductColumn[] {
  return [...columns].sort((a, b) => {
    const ao = a.sortOrder ?? Number.MAX_SAFE_INTEGER;
    const bo = b.sortOrder ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name, "th");
  });
}

export function buildItemizedPreview(params: {
  transactions: PreviewSourceTransaction[];
  items: PreviewSourceItem[];
  bagEntries: PreviewSourceBagEntry[];
  productColumns: PreviewSourceProductColumn[];
  includeKinds: Set<BillKind>;
}): ItemizedPreviewResult {
  const { transactions, items, bagEntries, includeKinds } = params;
  const sortedColumns = sortProductColumns(params.productColumns);

  const itemsByTx = new Map<number, PreviewSourceItem[]>();
  for (const item of items) {
    const arr = itemsByTx.get(item.transactionId) || [];
    arr.push(item);
    itemsByTx.set(item.transactionId, arr);
  }

  const bagsByTx = new Map<number, PreviewSourceBagEntry[]>();
  for (const bag of bagEntries) {
    if (!bag.transactionId) continue;
    const arr = bagsByTx.get(bag.transactionId) || [];
    arr.push(bag);
    bagsByTx.set(bag.transactionId, arr);
  }

  const candidateRows = transactions
    .filter((tx) => tx.status !== "voided")
    .map((tx) => {
      const kind = inferBillKind(tx);
      const txItems = itemsByTx.get(tx.id) || [];
      const txBags = bagsByTx.get(tx.id) || [];
      const quantities: Record<number, number> = {};
      for (const item of txItems) {
        quantities[item.productTypeId] = (quantities[item.productTypeId] || 0) + Number(item.quantity || 0);
      }

      const bagSummary = summarizeBagLedgerEntries(txBags);

      const paid = Number(tx.paid || 0);
      const total = Number(tx.totalAmount || 0);
      const rowTotals = computeFinancialTotals(
        [
          {
            status: tx.status,
            transactionKind: kind,
            totalAmount: total,
            paid,
          },
        ],
        { includeTransferOut: true }
      );
      return {
        transactionId: tx.id,
        customerName: tx.customerName,
        saleDate: tx.saleDate,
        saleTime: tx.saleTime,
        location: computeLocation(tx.pool, tx.row, tx.col),
        kind,
        transactionStatus: tx.status,
        quantities,
        bagsOut: bagSummary.bagsOut,
        bagsReturned: bagSummary.bagsReturned,
        bagsBought: bagSummary.bagsBought,
        bagAdjustDelta: bagSummary.bagAdjustDelta,
        cashPaid: rowTotals.netCash,
        creditOwed: rowTotals.outstandingDebt,
        refundBalance: rowTotals.refundBalance,
        sumTotal: rowTotals.netSales,
      } satisfies ItemizedPreviewRow;
    })
    .filter((row) => includeKinds.has(row.kind));

  const usedProductIds = new Set<number>();
  for (const row of candidateRows) {
    for (const [productId, qty] of Object.entries(row.quantities)) {
      if (Number(qty || 0) !== 0) usedProductIds.add(Number(productId));
    }
  }

  const productColumns = sortedColumns
    .filter((col) => usedProductIds.has(col.id))
    .map((col) => ({ id: col.id, name: col.name }));

  const totalsByProduct: Record<number, number> = {};
  for (const col of productColumns) totalsByProduct[col.id] = 0;

  const kindCounts: Record<BillKind, number> = {
    sale: 0,
    return: 0,
    transfer_out: 0,
    adjustment: 0,
  };

  const financialTotals = computeFinancialTotals(
    candidateRows.map((row) => ({
      status: row.transactionStatus,
      transactionKind: row.kind,
      totalAmount: row.sumTotal,
      paid: row.cashPaid,
    })),
    { includeTransferOut: true }
  );
  let totalBagsOut = 0;
  let totalBagsReturned = 0;
  let totalBagsBought = 0;
  let totalBagAdjustDelta = 0;

  for (const row of candidateRows) {
    kindCounts[row.kind] += 1;
    totalBagsOut += row.bagsOut;
    totalBagsReturned += row.bagsReturned;
    totalBagsBought += row.bagsBought;
    totalBagAdjustDelta += row.bagAdjustDelta;

    for (const col of productColumns) {
      totalsByProduct[col.id] += row.quantities[col.id] || 0;
    }
  }

  return {
    productColumns,
    rows: candidateRows.sort((a, b) => {
      const ta = `${a.saleDate} ${a.saleTime}`;
      const tb = `${b.saleDate} ${b.saleTime}`;
      if (ta !== tb) return ta.localeCompare(tb);
      return a.transactionId - b.transactionId;
    }),
    totals: {
      totalsByProduct,
      totalCashPaid: financialTotals.netCash,
      totalCreditOwed: financialTotals.outstandingDebt,
      totalRefundBalance: financialTotals.refundBalance,
      totalSum: financialTotals.netSales,
      totalBagsOut,
      totalBagsReturned,
      totalBagsBought,
      totalBagAdjustDelta,
      kindCounts,
      rowCount: candidateRows.length,
    },
  };
}
