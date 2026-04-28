import { describe, expect, it } from "vitest";
import { computeFinancialTotals } from "@/lib/financial-totals";

describe("computeFinancialTotals", () => {
  it("handles sale-only day", () => {
    const totals = computeFinancialTotals([
      { status: "paid", transactionKind: "sale", totalAmount: 1000, paid: 1000 },
      { status: "partial", transactionKind: "sale", totalAmount: 500, paid: 200 },
    ]);

    expect(totals).toMatchObject({
      rowCount: 2,
      activeCount: 2,
      voidCount: 0,
      grossSales: 1500,
      returnSales: 0,
      netSales: 1500,
      cashIn: 1200,
      cashOut: 0,
      netCash: 1200,
      receivableDelta: 300,
      outstandingDebt: 300,
      refundBalance: 0,
    });
  });

  it("handles return-only day with signed negatives", () => {
    const totals = computeFinancialTotals([
      { status: "paid", transactionKind: "return", totalAmount: -300, paid: -300 },
    ]);

    expect(totals).toMatchObject({
      rowCount: 1,
      activeCount: 1,
      voidCount: 0,
      grossSales: 0,
      returnSales: -300,
      netSales: -300,
      cashIn: 0,
      cashOut: -300,
      netCash: -300,
      receivableDelta: 0,
      outstandingDebt: 0,
      refundBalance: 0,
    });
  });

  it("handles mixed sale + return day", () => {
    const totals = computeFinancialTotals([
      { status: "paid", transactionKind: "sale", totalAmount: 1000, paid: 1000 },
      { status: "paid", transactionKind: "return", totalAmount: -200, paid: -100 },
    ]);

    expect(totals).toMatchObject({
      grossSales: 1000,
      returnSales: -200,
      netSales: 800,
      cashIn: 1000,
      cashOut: -100,
      netCash: 900,
      outstandingDebt: 0,
      refundBalance: 100,
    });
  });

  it("excludes void rows from normal totals but tracks void totals separately", () => {
    const totals = computeFinancialTotals([
      { status: "paid", transactionKind: "sale", totalAmount: 1000, paid: 600 },
      { status: "voided", transactionKind: "sale", totalAmount: 400, paid: 0 },
      { status: "voided", transactionKind: "return", totalAmount: -50, paid: 0 },
    ]);

    expect(totals.rowCount).toBe(3);
    expect(totals.activeCount).toBe(1);
    expect(totals.voidCount).toBe(2);
    expect(totals.voidAmount).toBe(350);
    expect(totals.netSales).toBe(1000);
    expect(totals.netCash).toBe(600);
    expect(totals.outstandingDebt).toBe(400);
  });

  it("produces refundBalance on net-negative day", () => {
    const totals = computeFinancialTotals([
      { status: "paid", transactionKind: "sale", totalAmount: 300, paid: 300 },
      { status: "paid", transactionKind: "return", totalAmount: -600, paid: -600 },
    ]);

    expect(totals.netSales).toBe(-300);
    expect(totals.netCash).toBe(-300);
    expect(totals.receivableDelta).toBe(0);

    const totalsWithOverRefund = computeFinancialTotals([
      { status: "paid", transactionKind: "sale", totalAmount: 300, paid: 300 },
      { status: "paid", transactionKind: "return", totalAmount: -600, paid: -700 },
    ]);

    expect(totalsWithOverRefund.netSales).toBe(-300);
    expect(totalsWithOverRefund.netCash).toBe(-400);
    expect(totalsWithOverRefund.outstandingDebt).toBe(100);
    expect(totalsWithOverRefund.refundBalance).toBe(0);
  });

  it("excludes transfer_out by default and includes when opted-in", () => {
    const rows = [
      { status: "unpaid", transactionKind: "transfer_out", totalAmount: 1000, paid: 0 },
      { status: "paid", transactionKind: "sale", totalAmount: 500, paid: 500 },
    ];

    const excluded = computeFinancialTotals(rows);
    expect(excluded.rowCount).toBe(1);
    expect(excluded.netSales).toBe(500);

    const included = computeFinancialTotals(rows, { includeTransferOut: true });
    expect(included.rowCount).toBe(2);
    expect(included.netSales).toBe(1500);
    expect(included.outstandingDebt).toBe(1000);
  });
});
