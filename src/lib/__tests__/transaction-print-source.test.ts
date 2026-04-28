import { describe, expect, it, vi } from "vitest";
import {
  buildTransactionPrintSource,
  deriveTransactionBagSnapshot,
  type TransactionPrintSourceDb,
} from "@/lib/transaction-print-source";

function collectNestedValues(value: unknown, seen = new WeakSet<object>()): unknown[] {
  if (value == null || typeof value !== "object") return [value];
  if (seen.has(value)) return [];
  seen.add(value);

  return Object.values(value).flatMap((entry) => collectNestedValues(entry, seen));
}

describe("transaction-print-source", () => {
  it("derives bag balances before and after the transaction", () => {
    const snapshot = deriveTransactionBagSnapshot({
      ledgerEntriesBeforeOrAtTransaction: [
        { id: 1, type: "out", quantity: 8, note: null },
        { id: 2, type: "return", quantity: 2, note: null },
        { id: 3, type: "out", quantity: 4, note: null },
      ],
      transactionBagLedgerEntries: [
        { id: 3, type: "out", quantity: 4, note: null },
      ],
    });

    expect(snapshot).toEqual({
      bagBalanceBefore: 6,
      bagBalanceAfter: 10,
    });
  });

  it("builds a presented print source with bag snapshot fields", async () => {
    const txRecord = {
      id: 100,
      customerId: 7,
      createdAt: new Date("2026-04-18T10:00:00.000Z"),
      printedBillNumber: 12,
      transactionKind: "sale",
      transferRef: null,
      saleDate: "2026-04-18",
      saleTime: "17:00:00",
      totalAmount: 150,
      paid: 150,
      status: "paid",
      customer: { id: 7, name: "ร้านทดสอบ" },
      items: [],
      bagLedgerEntries: [
        {
          id: 11,
          type: "out",
          quantity: 4,
          note: null,
          createdAt: new Date("2026-04-18T10:00:01.000Z"),
          transactionId: 100,
        },
      ],
    };

    const db = {
      query: {
        transactions: {
          findFirst: async () => txRecord,
        },
      },
      select: () => ({
        from: () => ({
          where: async () => [
            { id: 1, type: "out", quantity: 6, note: null },
            { id: 11, type: "out", quantity: 4, note: null },
          ],
        }),
      }),
    };

    const result = await buildTransactionPrintSource(
      db as unknown as TransactionPrintSourceDb,
      100
    );

    expect(result).toMatchObject({
      id: 100,
      bagBalanceBefore: 6,
      bagBalanceAfter: 10,
      billNumber: "0012",
      internalReference: "Tx #100",
      printedBillNumberDisplay: "0012",
    });
  });

  it("returns null when the transaction is not found", async () => {
    const db = {
      query: {
        transactions: {
          findFirst: async () => undefined,
        },
      },
      select: () => ({
        from: () => ({
          where: async () => [],
        }),
      }),
    };

    const result = await buildTransactionPrintSource(
      db as unknown as TransactionPrintSourceDb,
      999
    );
    expect(result).toBeNull();
  });

  it("uses an int32-safe bag-ledger cutoff when the transaction has no bag entries", async () => {
    const where = vi.fn(async () => []);
    const txRecord = {
      id: 200,
      customerId: 121,
      createdAt: new Date("2026-04-18T12:05:03.123Z"),
      printedBillNumber: null,
      transactionKind: "sale",
      transferRef: null,
      saleDate: "2026-04-18",
      saleTime: "19:05:03",
      totalAmount: 0,
      paid: 0,
      status: "paid",
      customer: { id: 121, name: "ร้านทดสอบ 2" },
      items: [],
      bagLedgerEntries: [],
    };

    const db = {
      query: {
        transactions: {
          findFirst: async () => txRecord,
        },
      },
      select: () => ({
        from: () => ({
          where,
        }),
      }),
    };

    await buildTransactionPrintSource(db as unknown as TransactionPrintSourceDb, 200);

    const mockCalls = (where as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const firstWhereArg = mockCalls[0]?.[0];
    expect(collectNestedValues(firstWhereArg)).toContain(2147483647);
  });
});
