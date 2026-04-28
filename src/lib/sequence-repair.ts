import { sql } from "drizzle-orm";

const REPAIRABLE_SEQUENCE_TABLES = {
  transactions: "transactions_id_seq",
  transaction_items: "transaction_items_id_seq",
  bag_ledger: "bag_ledger_id_seq",
  audit_log: "audit_log_id_seq",
  bill_counters: "bill_counters_id_seq",
} as const;

type RepairableSequenceTable = keyof typeof REPAIRABLE_SEQUENCE_TABLES;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function extractDuplicateKeyConstraint(error: unknown): string | null {
  const record = asRecord(error);
  if (!record) return null;

  const code = typeof record.code === "string" ? record.code : null;
  const constraint =
    typeof record.constraint_name === "string"
      ? record.constraint_name
      : typeof record.constraint === "string"
        ? record.constraint
        : null;

  if (code === "23505" && constraint) {
    return constraint;
  }

  if ("cause" in record) {
    return extractDuplicateKeyConstraint(record.cause);
  }

  return null;
}

export function getRepairableSequenceTableFromError(
  error: unknown
): RepairableSequenceTable | null {
  const constraint = extractDuplicateKeyConstraint(error);
  if (!constraint || !constraint.endsWith("_pkey")) return null;

  const table = constraint.slice(0, -"_pkey".length);
  return table in REPAIRABLE_SEQUENCE_TABLES
    ? (table as RepairableSequenceTable)
    : null;
}

export async function repairSequenceForTable(
  db: { execute: (query: ReturnType<typeof sql.raw>) => Promise<unknown> },
  table: RepairableSequenceTable
): Promise<void> {
  const sequence = REPAIRABLE_SEQUENCE_TABLES[table];
  await db.execute(
    sql.raw(
      `SELECT setval('${sequence}', COALESCE((SELECT MAX(id) FROM ${table}), 1), true)`
    )
  );
}

export async function withSequenceRepairRetry<T>(
  db: { execute: (query: ReturnType<typeof sql.raw>) => Promise<unknown> },
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const table = getRepairableSequenceTableFromError(error);
    if (!table) throw error;

    console.warn(
      `[sequence-repair] repairing ${table} after duplicate primary key`,
      error
    );
    await repairSequenceForTable(db, table);
    return operation();
  }
}
