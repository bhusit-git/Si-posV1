import { describe, it, expect } from "vitest";

/**
 * Tests for the new features:
 * 1. Backup route -- table coverage and data shaping
 * 2. Customer statement -- running balance computation, event ordering, totals
 *
 * These test pure computation logic extracted from the route handlers,
 * without needing Next.js or a real database connection.
 */

// ======================================================================
// PART 1: Backup data shaping
// ======================================================================

interface BackupData {
  exportDate: string;
  version: string;
  tables: Record<string, unknown[]>;
  counts: Record<string, number>;
}

const EXPECTED_TABLES = [
  "customers",
  "productTypes",
  "customerPrices",
  "transactions",
  "transactionItems",
  "bagLedger",
  "productionLogs",
  "auditLog",
  "users",
];

function buildBackup(tables: Record<string, unknown[]>): BackupData {
  const counts: Record<string, number> = {};
  for (const [key, arr] of Object.entries(tables)) {
    counts[key] = arr.length;
  }
  return {
    exportDate: new Date().toISOString(),
    version: "2.0",
    tables,
    counts,
  };
}

function sanitizeUsersForBackup(
  users: { id: number; username: string; password: string; role: string }[]
) {
  return users.map(({ id, username, role }) => ({ id, username, role }));
}

describe("Backup Data Shaping", () => {
  it("version 2.0 includes all 9 tables", () => {
    const tables: Record<string, unknown[]> = {};
    for (const t of EXPECTED_TABLES) {
      tables[t] = [];
    }
    const backup = buildBackup(tables);
    expect(backup.version).toBe("2.0");
    expect(Object.keys(backup.tables)).toEqual(EXPECTED_TABLES);
    expect(Object.keys(backup.counts)).toEqual(EXPECTED_TABLES);
  });

  it("counts match actual array lengths", () => {
    const tables: Record<string, unknown[]> = {
      customers: [{ id: 1 }, { id: 2 }, { id: 3 }],
      productTypes: [{ id: 1 }],
      customerPrices: [],
      transactions: Array.from({ length: 100 }, (_, i) => ({ id: i })),
      transactionItems: Array.from({ length: 250 }, (_, i) => ({ id: i })),
      bagLedger: [{ id: 1 }],
      productionLogs: [{ id: 1 }, { id: 2 }],
      auditLog: Array.from({ length: 50 }, (_, i) => ({ id: i })),
      users: [{ id: 1 }, { id: 2 }],
    };
    const backup = buildBackup(tables);
    expect(backup.counts.customers).toBe(3);
    expect(backup.counts.transactions).toBe(100);
    expect(backup.counts.transactionItems).toBe(250);
    expect(backup.counts.auditLog).toBe(50);
    expect(backup.counts.customerPrices).toBe(0);
  });

  it("sanitizeUsersForBackup strips passwords", () => {
    const users = [
      { id: 1, username: "admin", password: "$2b$10$hashhere", role: "admin" },
      { id: 2, username: "office1", password: "plaintext", role: "office" },
    ];
    const safe = sanitizeUsersForBackup(users);
    expect(safe).toHaveLength(2);
    expect(safe[0]).toEqual({ id: 1, username: "admin", role: "admin" });
    expect(safe[1]).toEqual({ id: 2, username: "office1", role: "office" });
    // Ensure no password field leaks
    for (const u of safe) {
      expect(u).not.toHaveProperty("password");
    }
  });

  it("backup JSON is valid and parseable", () => {
    const tables: Record<string, unknown[]> = {};
    for (const t of EXPECTED_TABLES) {
      tables[t] = [{ id: 1, name: "test" }];
    }
    const backup = buildBackup(tables);
    const json = JSON.stringify(backup, null, 2);
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe("2.0");
    expect(parsed.exportDate).toBeTruthy();
  });

  it("empty database produces valid backup with zero counts", () => {
    const tables: Record<string, unknown[]> = {};
    for (const t of EXPECTED_TABLES) {
      tables[t] = [];
    }
    const backup = buildBackup(tables);
    const totalRows = Object.values(backup.counts).reduce((a, b) => a + b, 0);
    expect(totalRows).toBe(0);
    expect(Object.keys(backup.tables).length).toBe(9);
  });
});

// ======================================================================
// PART 2: Customer Statement Logic
// ======================================================================

type EventType = "SALE" | "PAYMENT" | "RETURN" | "VOID";

interface StatementEvent {
  date: string;
  time: string;
  type: EventType;
  refId: number;
  description: string;
  debit: number;
  credit: number;
}

interface StatementRow extends StatementEvent {
  balance: number;
}

interface Transaction {
  id: number;
  date: string;
  time: string;
  status: "paid" | "unpaid" | "partial" | "voided";
  totalAmount: number;
  paid: number;
  voidReason: string | null;
  items: { productName: string; quantity: number }[];
}

interface PaymentEvent {
  transactionId: number;
  date: string;
  amount: number;
}

/**
 * Builds statement events from transactions and payment events.
 * Mirrors the logic in /api/reports?type=customerStatement
 */
function buildStatementEvents(
  transactions: Transaction[],
  paymentEvents: PaymentEvent[]
): StatementEvent[] {
  const events: StatementEvent[] = [];
  const txInitialPaymentHandled = new Set<number>();

  for (const tx of transactions) {
    const itemDesc = tx.items.map((i) => `${i.productName} x${i.quantity}`).join(", ");

    if (tx.status === "voided") {
      events.push({
        date: tx.date,
        time: tx.time,
        type: "VOID",
        refId: tx.id,
        description: tx.voidReason ? `ยกเลิก: ${tx.voidReason}` : "ยกเลิกรายการ",
        debit: 0,
        credit: tx.totalAmount,
      });
      continue;
    }

    const isReturn = tx.totalAmount < 0;

    if (isReturn) {
      events.push({
        date: tx.date,
        time: tx.time,
        type: "RETURN",
        refId: tx.id,
        description: itemDesc || "คืนสินค้า",
        debit: 0,
        credit: Math.abs(tx.totalAmount),
      });
    } else {
      events.push({
        date: tx.date,
        time: tx.time,
        type: "SALE",
        refId: tx.id,
        description: itemDesc || `ขายสินค้า #${tx.id}`,
        debit: tx.totalAmount,
        credit: 0,
      });

      if (tx.paid > 0 && tx.status === "paid") {
        events.push({
          date: tx.date,
          time: tx.time,
          type: "PAYMENT",
          refId: tx.id,
          description: `ชำระเงิน (บิล #${tx.id})`,
          debit: 0,
          credit: tx.paid,
        });
        txInitialPaymentHandled.add(tx.id);
      }
    }
  }

  for (const pe of paymentEvents) {
    if (txInitialPaymentHandled.has(pe.transactionId)) {
      txInitialPaymentHandled.delete(pe.transactionId);
      continue;
    }
    events.push({
      date: pe.date,
      time: "00:00:00",
      type: "PAYMENT",
      refId: pe.transactionId,
      description: `ชำระเงิน (บิล #${pe.transactionId})`,
      debit: 0,
      credit: pe.amount,
    });
  }

  events.sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    return a.time.localeCompare(b.time);
  });

  return events;
}

function computeRunningBalance(
  openingBalance: number,
  events: StatementEvent[]
): StatementRow[] {
  let balance = openingBalance;
  return events.map((e) => {
    balance += e.debit - e.credit;
    return { ...e, balance };
  });
}

function computeStatementTotals(events: StatementEvent[]) {
  const totalDebits = events.reduce((s, e) => s + e.debit, 0);
  const totalCredits = events.reduce((s, e) => s + e.credit, 0);
  return { totalDebits, totalCredits };
}

// ----- Tests -----

describe("Customer Statement Logic", () => {
  describe("event building", () => {
    it("sale transaction creates a SALE event", () => {
      const txs: Transaction[] = [
        {
          id: 1, date: "2026-02-10", time: "08:00:00", status: "unpaid",
          totalAmount: 1000, paid: 0, voidReason: null,
          items: [{ productName: "น้ำแข็งหลอด", quantity: 10 }],
        },
      ];
      const events = buildStatementEvents(txs, []);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("SALE");
      expect(events[0].debit).toBe(1000);
      expect(events[0].credit).toBe(0);
      expect(events[0].description).toContain("น้ำแข็งหลอด x10");
    });

    it("paid sale creates SALE + PAYMENT events", () => {
      const txs: Transaction[] = [
        {
          id: 1, date: "2026-02-10", time: "08:00:00", status: "paid",
          totalAmount: 500, paid: 500, voidReason: null,
          items: [{ productName: "น้ำแข็งซอง", quantity: 5 }],
        },
      ];
      const events = buildStatementEvents(txs, []);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("SALE");
      expect(events[0].debit).toBe(500);
      expect(events[1].type).toBe("PAYMENT");
      expect(events[1].credit).toBe(500);
    });

    it("voided transaction creates VOID event with reason", () => {
      const txs: Transaction[] = [
        {
          id: 1, date: "2026-02-10", time: "09:00:00", status: "voided",
          totalAmount: 300, paid: 0, voidReason: "ลูกค้าเปลี่ยนใจ",
          items: [{ productName: "น้ำแข็งหลอด", quantity: 3 }],
        },
      ];
      const events = buildStatementEvents(txs, []);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("VOID");
      expect(events[0].credit).toBe(300);
      expect(events[0].description).toContain("ลูกค้าเปลี่ยนใจ");
    });

    it("return transaction (negative amount) creates RETURN event", () => {
      const txs: Transaction[] = [
        {
          id: 5, date: "2026-02-11", time: "10:00:00", status: "paid",
          totalAmount: -200, paid: -200, voidReason: null,
          items: [{ productName: "น้ำแข็งหลอด", quantity: -2 }],
        },
      ];
      const events = buildStatementEvents(txs, []);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("RETURN");
      expect(events[0].credit).toBe(200);
      expect(events[0].debit).toBe(0);
    });

    it("later payment from audit log creates separate PAYMENT event", () => {
      const txs: Transaction[] = [
        {
          id: 1, date: "2026-02-10", time: "08:00:00", status: "unpaid",
          totalAmount: 1000, paid: 0, voidReason: null,
          items: [{ productName: "น้ำแข็ง", quantity: 10 }],
        },
      ];
      const payments: PaymentEvent[] = [
        { transactionId: 1, date: "2026-02-12", amount: 1000 },
      ];
      const events = buildStatementEvents(txs, payments);
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe("SALE");
      expect(events[1].type).toBe("PAYMENT");
      expect(events[1].date).toBe("2026-02-12");
      expect(events[1].credit).toBe(1000);
    });

    it("paid-at-sale + audit payment does not double-count", () => {
      const txs: Transaction[] = [
        {
          id: 1, date: "2026-02-10", time: "08:00:00", status: "paid",
          totalAmount: 500, paid: 500, voidReason: null,
          items: [{ productName: "น้ำแข็ง", quantity: 5 }],
        },
      ];
      // Audit log has the same payment (recorded at sale time)
      const payments: PaymentEvent[] = [
        { transactionId: 1, date: "2026-02-10", amount: 500 },
      ];
      const events = buildStatementEvents(txs, payments);
      // Should be SALE + PAYMENT (not SALE + PAYMENT + PAYMENT)
      expect(events).toHaveLength(2);
      const paymentEvents = events.filter((e) => e.type === "PAYMENT");
      expect(paymentEvents).toHaveLength(1);
      expect(paymentEvents[0].credit).toBe(500);
    });

    it("events are sorted chronologically", () => {
      const txs: Transaction[] = [
        {
          id: 2, date: "2026-02-12", time: "10:00:00", status: "unpaid",
          totalAmount: 300, paid: 0, voidReason: null,
          items: [{ productName: "B", quantity: 3 }],
        },
        {
          id: 1, date: "2026-02-10", time: "08:00:00", status: "unpaid",
          totalAmount: 500, paid: 0, voidReason: null,
          items: [{ productName: "A", quantity: 5 }],
        },
      ];
      const events = buildStatementEvents(txs, []);
      expect(events[0].date).toBe("2026-02-10");
      expect(events[1].date).toBe("2026-02-12");
    });
  });

  describe("running balance", () => {
    it("opening balance of 0 with sales accumulates correctly", () => {
      const events: StatementEvent[] = [
        { date: "2026-02-10", time: "08:00", type: "SALE", refId: 1, description: "", debit: 1000, credit: 0 },
        { date: "2026-02-11", time: "09:00", type: "SALE", refId: 2, description: "", debit: 500, credit: 0 },
      ];
      const rows = computeRunningBalance(0, events);
      expect(rows[0].balance).toBe(1000);
      expect(rows[1].balance).toBe(1500);
    });

    it("opening balance carries forward", () => {
      const events: StatementEvent[] = [
        { date: "2026-02-10", time: "08:00", type: "SALE", refId: 1, description: "", debit: 500, credit: 0 },
      ];
      const rows = computeRunningBalance(2000, events);
      expect(rows[0].balance).toBe(2500);
    });

    it("payment reduces the running balance", () => {
      const events: StatementEvent[] = [
        { date: "2026-02-10", time: "08:00", type: "SALE", refId: 1, description: "", debit: 1000, credit: 0 },
        { date: "2026-02-12", time: "09:00", type: "PAYMENT", refId: 1, description: "", debit: 0, credit: 600 },
      ];
      const rows = computeRunningBalance(0, events);
      expect(rows[0].balance).toBe(1000);
      expect(rows[1].balance).toBe(400);
    });

    it("return reduces the running balance", () => {
      const events: StatementEvent[] = [
        { date: "2026-02-10", time: "08:00", type: "SALE", refId: 1, description: "", debit: 1000, credit: 0 },
        { date: "2026-02-11", time: "10:00", type: "RETURN", refId: 2, description: "", debit: 0, credit: 200 },
      ];
      const rows = computeRunningBalance(0, events);
      expect(rows[1].balance).toBe(800);
    });

    it("void reverses the full amount", () => {
      const events: StatementEvent[] = [
        { date: "2026-02-10", time: "08:00", type: "SALE", refId: 1, description: "", debit: 1000, credit: 0 },
        { date: "2026-02-10", time: "09:00", type: "VOID", refId: 1, description: "", debit: 0, credit: 1000 },
      ];
      const rows = computeRunningBalance(0, events);
      expect(rows[1].balance).toBe(0);
    });

    it("full cycle: sale + partial payment + rest of payment = zero balance", () => {
      const events: StatementEvent[] = [
        { date: "2026-02-10", time: "08:00", type: "SALE", refId: 1, description: "", debit: 1000, credit: 0 },
        { date: "2026-02-12", time: "09:00", type: "PAYMENT", refId: 1, description: "", debit: 0, credit: 400 },
        { date: "2026-02-15", time: "10:00", type: "PAYMENT", refId: 1, description: "", debit: 0, credit: 600 },
      ];
      const rows = computeRunningBalance(0, events);
      expect(rows[0].balance).toBe(1000);
      expect(rows[1].balance).toBe(600);
      expect(rows[2].balance).toBe(0);
    });

    it("balance can go negative (overpayment / credit)", () => {
      const events: StatementEvent[] = [
        { date: "2026-02-10", time: "08:00", type: "SALE", refId: 1, description: "", debit: 500, credit: 0 },
        { date: "2026-02-12", time: "09:00", type: "PAYMENT", refId: 1, description: "", debit: 0, credit: 700 },
      ];
      const rows = computeRunningBalance(0, events);
      expect(rows[1].balance).toBe(-200);
    });

    it("empty events list returns empty rows", () => {
      const rows = computeRunningBalance(500, []);
      expect(rows).toHaveLength(0);
    });
  });

  describe("statement totals", () => {
    it("computes total debits and credits", () => {
      const events: StatementEvent[] = [
        { date: "2026-02-10", time: "08:00", type: "SALE", refId: 1, description: "", debit: 1000, credit: 0 },
        { date: "2026-02-11", time: "09:00", type: "SALE", refId: 2, description: "", debit: 500, credit: 0 },
        { date: "2026-02-12", time: "10:00", type: "PAYMENT", refId: 1, description: "", debit: 0, credit: 800 },
        { date: "2026-02-13", time: "11:00", type: "RETURN", refId: 3, description: "", debit: 0, credit: 200 },
      ];
      const { totalDebits, totalCredits } = computeStatementTotals(events);
      expect(totalDebits).toBe(1500);
      expect(totalCredits).toBe(1000);
    });

    it("closing balance = opening + debits - credits", () => {
      const openingBalance = 3000;
      const events: StatementEvent[] = [
        { date: "2026-02-10", time: "08:00", type: "SALE", refId: 1, description: "", debit: 2000, credit: 0 },
        { date: "2026-02-12", time: "10:00", type: "PAYMENT", refId: 1, description: "", debit: 0, credit: 1500 },
      ];
      const { totalDebits, totalCredits } = computeStatementTotals(events);
      const closingBalance = openingBalance + totalDebits - totalCredits;
      expect(closingBalance).toBe(3500); // 3000 + 2000 - 1500

      // Verify it matches the running balance of the last row
      const rows = computeRunningBalance(openingBalance, events);
      expect(rows[rows.length - 1].balance).toBe(closingBalance);
    });

    it("empty statement has zero totals", () => {
      const { totalDebits, totalCredits } = computeStatementTotals([]);
      expect(totalDebits).toBe(0);
      expect(totalCredits).toBe(0);
    });
  });

  describe("complex scenarios", () => {
    it("mixed week of sales, payments, returns, and voids", () => {
      const txs: Transaction[] = [
        // Monday: credit sale
        { id: 100, date: "2026-02-09", time: "08:00:00", status: "unpaid", totalAmount: 2000, paid: 0, voidReason: null, items: [{ productName: "หลอดใหญ่", quantity: 20 }] },
        // Tuesday: cash sale
        { id: 101, date: "2026-02-10", time: "07:30:00", status: "paid", totalAmount: 800, paid: 800, voidReason: null, items: [{ productName: "หลอดเล็ก", quantity: 16 }] },
        // Wednesday: return
        { id: 102, date: "2026-02-11", time: "09:00:00", status: "paid", totalAmount: -300, paid: -300, voidReason: null, items: [{ productName: "หลอดใหญ่", quantity: -3 }] },
        // Thursday: voided sale
        { id: 103, date: "2026-02-12", time: "10:00:00", status: "voided", totalAmount: 500, paid: 0, voidReason: "ออกบิลผิด", items: [{ productName: "หลอดใหญ่", quantity: 5 }] },
        // Friday: another credit sale
        { id: 104, date: "2026-02-13", time: "08:00:00", status: "unpaid", totalAmount: 1500, paid: 0, voidReason: null, items: [{ productName: "ซอง", quantity: 30 }] },
      ];

      // Payment for bill #100 comes in on Thursday
      const payments: PaymentEvent[] = [
        { transactionId: 100, date: "2026-02-12", amount: 2000 },
      ];

      const events = buildStatementEvents(txs, payments);
      const rows = computeRunningBalance(0, events);

      // Check event count: sale + (sale+payment) + return + void + payment + sale = 7
      expect(events).toHaveLength(7);

      // Check final balance
      // Debits: 2000 + 800 + 1500 = 4300
      // Credits: 800 (cash) + 300 (return) + 500 (void) + 2000 (payment) = 3600
      // Closing: 0 + 4300 - 3600 = 700
      const { totalDebits, totalCredits } = computeStatementTotals(events);
      expect(totalDebits).toBe(4300);
      expect(totalCredits).toBe(3600);
      expect(rows[rows.length - 1].balance).toBe(700);
    });

    it("opening balance + mixed events = correct closing", () => {
      const openingBalance = 5000;
      const txs: Transaction[] = [
        { id: 1, date: "2026-02-10", time: "08:00:00", status: "unpaid", totalAmount: 1000, paid: 0, voidReason: null, items: [{ productName: "A", quantity: 10 }] },
      ];
      const payments: PaymentEvent[] = [
        { transactionId: 1, date: "2026-02-14", amount: 500 },
      ];

      const events = buildStatementEvents(txs, payments);
      const rows = computeRunningBalance(openingBalance, events);

      // Opening: 5000, +1000 sale, -500 payment = 5500
      expect(rows[rows.length - 1].balance).toBe(5500);
    });

    it("multiple partial payments on same bill", () => {
      const txs: Transaction[] = [
        { id: 1, date: "2026-02-10", time: "08:00:00", status: "partial", totalAmount: 1000, paid: 300, voidReason: null, items: [{ productName: "A", quantity: 10 }] },
      ];
      // Partial is not "paid" status, so no initial payment event from buildStatementEvents
      // Two later payments from audit log
      const payments: PaymentEvent[] = [
        { transactionId: 1, date: "2026-02-11", amount: 300 },
        { transactionId: 1, date: "2026-02-14", amount: 400 },
      ];

      const events = buildStatementEvents(txs, payments);
      const rows = computeRunningBalance(0, events);

      expect(events).toHaveLength(3); // SALE + 2 PAYMENTs
      expect(rows[0].balance).toBe(1000);  // after sale
      expect(rows[1].balance).toBe(700);   // after first payment
      expect(rows[2].balance).toBe(300);   // after second payment
    });
  });
});
