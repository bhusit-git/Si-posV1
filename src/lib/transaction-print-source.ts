import { and, eq, lt, lte, or } from "drizzle-orm";
import type { DrizzleDB } from "@/db";
import { bagLedger, transactions } from "@/db/schema";
import { getBagBalanceFromEntries } from "@/lib/bag-flow";
import { withBillPresentation } from "@/lib/bill-number";

type TimestampLike = Date | string;

interface BagLedgerEntryRecord {
  id: number;
  type: string;
  quantity: number;
  note: string | null;
  createdAt?: TimestampLike | null;
  transactionId?: number | null;
}

interface ProductTypeRecord {
  id: number;
  name: string | null;
  hasBag: boolean;
  decreasesBag: boolean;
}

interface TransactionItemRecord {
  id?: number;
  transactionId?: number;
  productTypeId?: number | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  productType?: ProductTypeRecord | null;
}

interface CustomerRecord {
  id: number;
  name: string;
}

interface TransactionRecord {
  id: number;
  customerId: number;
  createdAt: TimestampLike;
  printedBillNumber?: number | null;
  transactionKind?: string | null;
  transferRef?: string | null;
  customer: CustomerRecord;
  items: TransactionItemRecord[];
  bagLedgerEntries: BagLedgerEntryRecord[];
  [key: string]: unknown;
}

export type TransactionPrintSourceDb = Pick<DrizzleDB, "query" | "select">;

export interface TransactionBagSnapshot {
  bagBalanceBefore: number;
  bagBalanceAfter: number;
}

const MAX_POSTGRES_INT32 = 2147483647;

function toDate(value: TimestampLike | null | undefined): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(value || 0);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(0);
}

function compareLedgerEntries(a: BagLedgerEntryRecord, b: BagLedgerEntryRecord): number {
  const timeDiff = toDate(a.createdAt).getTime() - toDate(b.createdAt).getTime();
  if (timeDiff !== 0) return timeDiff;
  return a.id - b.id;
}

function getCutoffForTransaction(tx: TransactionRecord): {
  cutoffAt: Date;
  cutoffId: number;
} {
  const sortedEntries = [...(tx.bagLedgerEntries || [])].sort(compareLedgerEntries);
  const lastEntry = sortedEntries.at(-1);
  if (lastEntry) {
    return {
      cutoffAt: toDate(lastEntry.createdAt),
      cutoffId: lastEntry.id,
    };
  }

  return {
    cutoffAt: toDate(tx.createdAt),
    cutoffId: MAX_POSTGRES_INT32,
  };
}

export function deriveTransactionBagSnapshot(params: {
  ledgerEntriesBeforeOrAtTransaction: BagLedgerEntryRecord[];
  transactionBagLedgerEntries: BagLedgerEntryRecord[];
}): TransactionBagSnapshot {
  const bagBalanceAfter = getBagBalanceFromEntries(params.ledgerEntriesBeforeOrAtTransaction);
  const transactionDelta = getBagBalanceFromEntries(params.transactionBagLedgerEntries);
  return {
    bagBalanceBefore: bagBalanceAfter - transactionDelta,
    bagBalanceAfter,
  };
}

export async function buildTransactionPrintSource(
  db: TransactionPrintSourceDb,
  transactionId: number
) {
  const tx = await db.query.transactions.findFirst({
    where: eq(transactions.id, transactionId),
    with: {
      customer: true,
      items: {
        with: { productType: true },
      },
      bagLedgerEntries: {
        with: { productType: true },
      },
    },
  });

  if (!tx) return null;

  const { cutoffAt, cutoffId } = getCutoffForTransaction(tx);
  const ledgerEntriesBeforeOrAtTransaction = await db
    .select({
      id: bagLedger.id,
      type: bagLedger.type,
      quantity: bagLedger.quantity,
      note: bagLedger.note,
      createdAt: bagLedger.createdAt,
      transactionId: bagLedger.transactionId,
    })
    .from(bagLedger)
    .where(
      and(
        eq(bagLedger.customerId, tx.customerId),
        or(
          eq(bagLedger.transactionId, tx.id),
          lt(bagLedger.createdAt, cutoffAt),
          and(eq(bagLedger.createdAt, cutoffAt), lte(bagLedger.id, cutoffId))
        )
      )
    );

  const bagSnapshot = deriveTransactionBagSnapshot({
    ledgerEntriesBeforeOrAtTransaction,
    transactionBagLedgerEntries: tx.bagLedgerEntries || [],
  });

  return withBillPresentation({
    ...tx,
    ...bagSnapshot,
  });
}
