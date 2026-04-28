import { eq } from "drizzle-orm";
import { billCounters } from "@/db/schema";
import {
  PRINTED_BILL_MAX,
  PRINTED_BILL_MIN,
  formatPrintedBillNumber,
  incrementPrintedBillNumber,
} from "@/lib/bill-number";

type CounterDbLike = any;

export interface BillCounterState {
  factoryKey: string;
  nextBillNumber: number;
  displayBillNumber: string;
  available: boolean;
  updatedAt?: Date;
  createdAt?: Date;
}

function clampBillNumber(value: number): number {
  if (!Number.isInteger(value)) {
    throw new Error("invalid_bill_number");
  }
  if (value < PRINTED_BILL_MIN || value > PRINTED_BILL_MAX) {
    throw new Error("invalid_bill_number");
  }
  return value;
}

function buildUnavailableState(
  factoryKey: string,
  nextBillNumber = 1
): BillCounterState {
  return {
    factoryKey,
    nextBillNumber: clampBillNumber(nextBillNumber),
    displayBillNumber:
      formatPrintedBillNumber(nextBillNumber) || "0001",
    available: false,
  };
}

function isBillCounterSchemaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes("bill_counters") || normalized.includes("bill counter");
}

export async function getOrCreateBillCounter(
  db: CounterDbLike,
  factoryKey: string
): Promise<BillCounterState> {
  try {
    const [existing] = await db
      .select({
        factoryKey: billCounters.factoryKey,
        nextBillNumber: billCounters.nextNumber,
        updatedAt: billCounters.updatedAt,
        createdAt: billCounters.createdAt,
      })
      .from(billCounters)
      .where(eq(billCounters.factoryKey, factoryKey))
      .limit(1);

    if (existing) {
      return {
        factoryKey,
        nextBillNumber: clampBillNumber(existing.nextBillNumber),
        displayBillNumber:
          formatPrintedBillNumber(existing.nextBillNumber) || "0001",
        available: true,
        updatedAt: existing.updatedAt,
        createdAt: existing.createdAt,
      };
    }

    await db
      .insert(billCounters)
      .values({
        factoryKey,
        nextNumber: 1,
        updatedAt: new Date(),
        createdAt: new Date(),
      })
      .onConflictDoNothing();

    const [created] = await db
      .select({
        factoryKey: billCounters.factoryKey,
        nextBillNumber: billCounters.nextNumber,
        updatedAt: billCounters.updatedAt,
        createdAt: billCounters.createdAt,
      })
      .from(billCounters)
      .where(eq(billCounters.factoryKey, factoryKey))
      .limit(1);

    if (!created) {
      throw new Error("bill_counter_init_failed");
    }

    return {
      factoryKey,
      nextBillNumber: clampBillNumber(created.nextBillNumber),
      displayBillNumber:
        formatPrintedBillNumber(created.nextBillNumber) || "0001",
      available: true,
      updatedAt: created.updatedAt,
      createdAt: created.createdAt,
    };
  } catch (error) {
    if (!isBillCounterSchemaError(error)) {
      throw error;
    }
    console.warn("[bill-counter] schema unavailable, falling back", error);
    return buildUnavailableState(factoryKey);
  }
}

export async function setNextBillCounterNumber(
  db: CounterDbLike,
  factoryKey: string,
  nextBillNumber: number
): Promise<BillCounterState> {
  const normalized = clampBillNumber(nextBillNumber);
  const current = await getOrCreateBillCounter(db, factoryKey);
  if (!current.available) {
    return buildUnavailableState(factoryKey, normalized);
  }

  try {
    const [updated] = await db
      .update(billCounters)
      .set({
        nextNumber: normalized,
        updatedAt: new Date(),
      })
      .where(eq(billCounters.factoryKey, factoryKey))
      .returning({
        factoryKey: billCounters.factoryKey,
        nextBillNumber: billCounters.nextNumber,
        updatedAt: billCounters.updatedAt,
        createdAt: billCounters.createdAt,
      });

    if (!updated) {
      throw new Error("bill_counter_update_failed");
    }

    return {
      factoryKey,
      nextBillNumber: clampBillNumber(updated.nextBillNumber),
      displayBillNumber:
        formatPrintedBillNumber(updated.nextBillNumber) || "0001",
      available: true,
      updatedAt: updated.updatedAt,
      createdAt: updated.createdAt,
    };
  } catch (error) {
    if (!isBillCounterSchemaError(error)) {
      throw error;
    }
    console.warn("[bill-counter] update skipped because schema is unavailable", error);
    return buildUnavailableState(factoryKey, normalized);
  }
}

export async function reservePrintedBillNumber(
  db: CounterDbLike,
  factoryKey: string,
  requestedBillNumber?: number | null
): Promise<{
  printedBillNumber: number | null;
  nextBillNumber: number;
}> {
  const counter = await getOrCreateBillCounter(db, factoryKey);
  const normalizedRequestedBillNumber =
    typeof requestedBillNumber === "number"
      ? clampBillNumber(requestedBillNumber)
      : null;
  if (!counter.available) {
    return {
      printedBillNumber: normalizedRequestedBillNumber,
      nextBillNumber:
        normalizedRequestedBillNumber == null
          ? counter.nextBillNumber
          : incrementPrintedBillNumber(normalizedRequestedBillNumber),
    };
  }
  const printedBillNumber = normalizedRequestedBillNumber ?? counter.nextBillNumber;
  const requestedNext = incrementPrintedBillNumber(printedBillNumber);
  const nextBillNumber =
    counter.nextBillNumber === printedBillNumber
      ? requestedNext
      : Math.max(counter.nextBillNumber, requestedNext);

  await setNextBillCounterNumber(db, factoryKey, nextBillNumber);

  return {
    printedBillNumber,
    nextBillNumber,
  };
}
