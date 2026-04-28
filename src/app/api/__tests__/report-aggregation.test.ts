import { describe, it, expect } from "vitest";

/**
 * Report aggregation logic tests.
 * Tests credit aging, invoice math, orphan filtering, stock calculations,
 * and completion percentages used by reporting endpoints.
 */

type TxStatus = "paid" | "unpaid" | "partial" | "voided";
type TxKind = "sale" | "transfer_out" | "return" | "adjustment";

interface Transaction {
  id: number;
  customerId: number;
  totalAmount: number;
  paid: number;
  status: TxStatus;
  saleDate: string;
  transactionKind?: TxKind;
}

// ---- Credit aging buckets ----

function computeAgingBucket(saleDate: string, today: string): string {
  const sale = new Date(saleDate);
  const now = new Date(today);
  const diffDays = Math.floor((now.getTime() - sale.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays <= 7) return "0-7 วัน";
  if (diffDays <= 14) return "8-14 วัน";
  if (diffDays <= 30) return "15-30 วัน";
  return "มากกว่า 30 วัน";
}

function computeCreditSummary(transactions: Transaction[], today: string) {
  const outstanding = transactions.filter(
    (tx) =>
      tx.status !== "voided" &&
      tx.status !== "paid" &&
      tx.transactionKind !== "transfer_out"
  );
  const byCustomer: Record<number, { total: number; oldest: string }> = {};

  for (const tx of outstanding) {
    const owed = tx.totalAmount - tx.paid;
    if (owed <= 0) continue;
    if (!byCustomer[tx.customerId]) {
      byCustomer[tx.customerId] = { total: 0, oldest: tx.saleDate };
    }
    byCustomer[tx.customerId].total += owed;
    if (tx.saleDate < byCustomer[tx.customerId].oldest) {
      byCustomer[tx.customerId].oldest = tx.saleDate;
    }
  }

  return Object.entries(byCustomer).map(([customerId, data]) => ({
    customerId: parseInt(customerId),
    totalOutstanding: data.total,
    agingBucket: computeAgingBucket(data.oldest, today),
  }));
}

// ---- Invoice math invariants ----

function computeInvoiceSummary(transactions: Transaction[]) {
  const active = transactions.filter(
    (tx) => tx.status !== "voided" && tx.transactionKind !== "transfer_out"
  );
  const totalSales = active.reduce((sum, tx) => sum + tx.totalAmount, 0);
  const totalPaid = active.reduce((sum, tx) => sum + tx.paid, 0);
  const totalOutstanding = totalSales - totalPaid;
  return { totalSales, totalPaid, totalOutstanding };
}

// ---- Stock calculation ----

interface ProductionLog {
  productTypeId: number;
  quantity: number;
}

interface SaleItem {
  productTypeId: number;
  quantity: number;
  transactionStatus: TxStatus;
}

function computeStock(production: ProductionLog[], sales: SaleItem[]) {
  const produced: Record<number, number> = {};
  const sold: Record<number, number> = {};

  for (const p of production) {
    produced[p.productTypeId] = (produced[p.productTypeId] || 0) + p.quantity;
  }

  for (const s of sales) {
    if (s.transactionStatus === "voided") continue;
    if (s.quantity > 0) {
      sold[s.productTypeId] = (sold[s.productTypeId] || 0) + s.quantity;
    } else {
      // Negative = return, reduces sold count
      sold[s.productTypeId] = (sold[s.productTypeId] || 0) + s.quantity;
    }
  }

  const allProducts = new Set([...Object.keys(produced), ...Object.keys(sold)].map(Number));
  return Array.from(allProducts).map((ptId) => ({
    productTypeId: ptId,
    totalProduced: produced[ptId] || 0,
    netSold: sold[ptId] || 0,
    currentStock: (produced[ptId] || 0) - (sold[ptId] || 0),
  }));
}

// ---- Loading completion percentage ----

function computeLoadingCompletion(items: { quantity: number; loadedQty: number }[]): number {
  const totalOrdered = items.reduce((sum, i) => sum + i.quantity, 0);
  if (totalOrdered === 0) return 100;
  const totalLoaded = items.reduce((sum, i) => sum + i.loadedQty, 0);
  return Math.round((totalLoaded / totalOrdered) * 100);
}

describe("Report Aggregation", () => {
  describe("credit aging buckets", () => {
    it("same-day sale is 0-7 days", () => {
      expect(computeAgingBucket("2026-02-14", "2026-02-14")).toBe("0-7 วัน");
    });

    it("7-day-old sale is 0-7 days", () => {
      expect(computeAgingBucket("2026-02-07", "2026-02-14")).toBe("0-7 วัน");
    });

    it("8-day-old sale is 8-14 days", () => {
      expect(computeAgingBucket("2026-02-06", "2026-02-14")).toBe("8-14 วัน");
    });

    it("14-day-old sale is 8-14 days", () => {
      expect(computeAgingBucket("2026-01-31", "2026-02-14")).toBe("8-14 วัน");
    });

    it("15-day-old sale is 15-30 days", () => {
      expect(computeAgingBucket("2026-01-30", "2026-02-14")).toBe("15-30 วัน");
    });

    it("31-day-old sale is >30 days", () => {
      expect(computeAgingBucket("2026-01-14", "2026-02-14")).toBe("มากกว่า 30 วัน");
    });

    it("year-old sale is >30 days", () => {
      expect(computeAgingBucket("2025-02-14", "2026-02-14")).toBe("มากกว่า 30 วัน");
    });
  });

  describe("credit summary aggregation", () => {
    it("aggregates outstanding by customer", () => {
      const txs: Transaction[] = [
        { id: 1, customerId: 10, totalAmount: 1000, paid: 500, status: "partial", saleDate: "2026-02-10" },
        { id: 2, customerId: 10, totalAmount: 800, paid: 0, status: "unpaid", saleDate: "2026-02-08" },
        { id: 3, customerId: 20, totalAmount: 500, paid: 0, status: "unpaid", saleDate: "2026-02-14" },
      ];
      const result = computeCreditSummary(txs, "2026-02-14");
      expect(result).toHaveLength(2);

      const c10 = result.find((r) => r.customerId === 10);
      expect(c10?.totalOutstanding).toBe(1300);
      expect(c10?.agingBucket).toBe("0-7 วัน"); // oldest is Feb 8

      const c20 = result.find((r) => r.customerId === 20);
      expect(c20?.totalOutstanding).toBe(500);
    });

    it("excludes voided transactions", () => {
      const txs: Transaction[] = [
        { id: 1, customerId: 10, totalAmount: 1000, paid: 0, status: "voided", saleDate: "2026-02-10" },
      ];
      const result = computeCreditSummary(txs, "2026-02-14");
      expect(result).toHaveLength(0);
    });

    it("excludes fully paid transactions", () => {
      const txs: Transaction[] = [
        { id: 1, customerId: 10, totalAmount: 1000, paid: 1000, status: "paid", saleDate: "2026-02-10" },
      ];
      const result = computeCreditSummary(txs, "2026-02-14");
      expect(result).toHaveLength(0);
    });

    it("excludes transfer_out transactions", () => {
      const txs: Transaction[] = [
        {
          id: 1,
          customerId: 10,
          totalAmount: 1000,
          paid: 0,
          status: "unpaid",
          saleDate: "2026-02-10",
          transactionKind: "transfer_out",
        },
      ];
      const result = computeCreditSummary(txs, "2026-02-14");
      expect(result).toHaveLength(0);
    });
  });

  describe("invoice math invariants", () => {
    it("totalOutstanding = totalSales - totalPaid", () => {
      const txs: Transaction[] = [
        { id: 1, customerId: 1, totalAmount: 1000, paid: 600, status: "partial", saleDate: "2026-02-14" },
        { id: 2, customerId: 2, totalAmount: 500, paid: 500, status: "paid", saleDate: "2026-02-14" },
        { id: 3, customerId: 3, totalAmount: 300, paid: 0, status: "unpaid", saleDate: "2026-02-14" },
      ];
      const summary = computeInvoiceSummary(txs);
      expect(summary.totalOutstanding).toBe(summary.totalSales - summary.totalPaid);
      expect(summary.totalSales).toBe(1800);
      expect(summary.totalPaid).toBe(1100);
      expect(summary.totalOutstanding).toBe(700);
    });

    it("voided transactions are excluded from totals", () => {
      const txs: Transaction[] = [
        { id: 1, customerId: 1, totalAmount: 1000, paid: 1000, status: "paid", saleDate: "2026-02-14" },
        { id: 2, customerId: 1, totalAmount: 500, paid: 0, status: "voided", saleDate: "2026-02-14" },
      ];
      const summary = computeInvoiceSummary(txs);
      expect(summary.totalSales).toBe(1000);
    });

    it("transfer_out transactions are excluded from invoice totals", () => {
      const txs: Transaction[] = [
        { id: 1, customerId: 1, totalAmount: 1000, paid: 0, status: "unpaid", saleDate: "2026-02-14", transactionKind: "transfer_out" },
        { id: 2, customerId: 1, totalAmount: 500, paid: 500, status: "paid", saleDate: "2026-02-14", transactionKind: "sale" },
      ];
      const summary = computeInvoiceSummary(txs);
      expect(summary.totalSales).toBe(500);
      expect(summary.totalPaid).toBe(500);
      expect(summary.totalOutstanding).toBe(0);
    });

    it("empty list produces zero totals", () => {
      const summary = computeInvoiceSummary([]);
      expect(summary.totalSales).toBe(0);
      expect(summary.totalPaid).toBe(0);
      expect(summary.totalOutstanding).toBe(0);
    });
  });

  describe("stock calculation", () => {
    it("stock = produced - sold", () => {
      const production = [{ productTypeId: 1, quantity: 100 }];
      const sales = [{ productTypeId: 1, quantity: 40, transactionStatus: "paid" as TxStatus }];
      const stock = computeStock(production, sales);
      expect(stock[0].currentStock).toBe(60);
    });

    it("returns increase stock (negative sale)", () => {
      const production = [{ productTypeId: 1, quantity: 100 }];
      const sales: SaleItem[] = [
        { productTypeId: 1, quantity: 50, transactionStatus: "paid" },
        { productTypeId: 1, quantity: -10, transactionStatus: "paid" },
      ];
      const stock = computeStock(production, sales);
      expect(stock[0].netSold).toBe(40);
      expect(stock[0].currentStock).toBe(60);
    });

    it("voided sales do not reduce stock", () => {
      const production = [{ productTypeId: 1, quantity: 100 }];
      const sales: SaleItem[] = [
        { productTypeId: 1, quantity: 30, transactionStatus: "voided" },
      ];
      const stock = computeStock(production, sales);
      expect(stock[0].currentStock).toBe(100);
    });

    it("product with no production has negative stock if sold", () => {
      const production: ProductionLog[] = [];
      const sales: SaleItem[] = [
        { productTypeId: 1, quantity: 20, transactionStatus: "paid" },
      ];
      const stock = computeStock(production, sales);
      expect(stock[0].currentStock).toBe(-20);
    });
  });

  describe("loading completion percentage", () => {
    it("fully loaded is 100%", () => {
      expect(
        computeLoadingCompletion([
          { quantity: 10, loadedQty: 10 },
          { quantity: 5, loadedQty: 5 },
        ])
      ).toBe(100);
    });

    it("half loaded is 50%", () => {
      expect(
        computeLoadingCompletion([{ quantity: 10, loadedQty: 5 }])
      ).toBe(50);
    });

    it("nothing loaded is 0%", () => {
      expect(
        computeLoadingCompletion([{ quantity: 10, loadedQty: 0 }])
      ).toBe(0);
    });

    it("empty items is 100%", () => {
      expect(computeLoadingCompletion([])).toBe(100);
    });

    it("rounds to nearest integer", () => {
      expect(
        computeLoadingCompletion([{ quantity: 3, loadedQty: 1 }])
      ).toBe(33);
    });
  });
});
