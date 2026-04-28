import { describe, expect, it } from "vitest";
import {
  detectAuditFindingsFromData,
  type DetectionAuditRow,
  type DetectionDataset,
  type DetectionItemRow,
  type DetectionTxRow,
} from "@/lib/fraud-detection";

function tx(overrides: Partial<DetectionTxRow>): DetectionTxRow {
  return {
    id: overrides.id ?? 1,
    customerId: overrides.customerId ?? 10,
    totalAmount: overrides.totalAmount ?? 100,
    paid: overrides.paid ?? 100,
    outstandingAmount: overrides.outstandingAmount ?? 0,
    status: overrides.status ?? "paid",
    transactionKind: overrides.transactionKind ?? "sale",
    saleDate: overrides.saleDate ?? "2026-03-15",
    saleTime: overrides.saleTime ?? "09:00:00",
    createdAt: overrides.createdAt ?? new Date("2026-03-15T09:05:00.000Z"),
    createdBy: overrides.createdBy ?? 7,
    voidedBy: overrides.voidedBy ?? null,
    voidReason: overrides.voidReason ?? null,
  };
}

function item(overrides: Partial<DetectionItemRow>): DetectionItemRow {
  return {
    transactionId: overrides.transactionId ?? 1,
    productTypeId: overrides.productTypeId ?? 1,
    quantity: overrides.quantity ?? 10,
    unitPrice: overrides.unitPrice ?? 10,
  };
}

function audit(overrides: Partial<DetectionAuditRow>): DetectionAuditRow {
  return {
    id: overrides.id ?? 1,
    userId: overrides.userId ?? 7,
    username: overrides.username ?? "cashier-a",
    action: overrides.action ?? "transaction.create",
    entityId: overrides.entityId ?? 1,
    details: overrides.details ?? null,
    createdAt: overrides.createdAt ?? new Date("2026-03-15T09:05:00.000Z"),
  };
}

function detect(dataset: Partial<DetectionDataset>) {
  return detectAuditFindingsFromData({
    transactions: dataset.transactions || [],
    items: dataset.items || [],
    audits: dataset.audits || [],
    targetTransactionIds: dataset.targetTransactionIds || [],
    targetCustomerIds: dataset.targetCustomerIds || [],
  });
}

describe("detectAuditFindingsFromData", () => {
  it("flags suspicious cancellation bursts and weak reasons", () => {
    const transactions = [
      tx({
        id: 101,
        customerId: 20,
        totalAmount: 1200,
        paid: 1200,
        status: "voided",
        saleDate: "2026-03-15",
        voidedBy: 9,
        voidReason: "ผิด",
      }),
      tx({ id: 90, customerId: 18, totalAmount: 800, status: "voided", voidedBy: 9, voidReason: "ลูกค้ายกเลิก" }),
      tx({ id: 91, customerId: 19, totalAmount: 700, status: "voided", voidedBy: 9, voidReason: "ลูกค้ายกเลิก" }),
      tx({ id: 30, customerId: 20, totalAmount: 300, status: "paid", saleDate: "2026-03-01" }),
      tx({ id: 31, customerId: 20, totalAmount: 280, status: "paid", saleDate: "2026-03-03" }),
      tx({ id: 32, customerId: 20, totalAmount: 320, status: "paid", saleDate: "2026-03-05" }),
    ];

    const audits = [
      audit({ id: 1, action: "transaction.void", entityId: 90, userId: 9, username: "admin-void", createdAt: new Date("2026-03-15T01:00:00.000Z") }),
      audit({ id: 2, action: "transaction.void", entityId: 91, userId: 9, username: "admin-void", createdAt: new Date("2026-03-15T04:00:00.000Z") }),
      audit({ id: 3, action: "transaction.void", entityId: 101, userId: 9, username: "admin-void", createdAt: new Date("2026-03-15T08:00:00.000Z") }),
      audit({ id: 4, action: "transaction.payment", entityId: 101, userId: 9, username: "admin-void", details: { amount: 1200 }, createdAt: new Date("2026-03-15T07:50:00.000Z") }),
    ];

    const findings = detect({
      transactions,
      items: [],
      audits,
      targetTransactionIds: [101],
      targetCustomerIds: [20],
    });

    expect(findings.map((finding) => finding.ruleKey)).toEqual(
      expect.arrayContaining([
        "void_frequency_high",
        "void_reason_generic",
        "void_after_payment",
        "void_amount_spike",
      ])
    );
  });

  it("flags order amount and price anomalies against customer history", () => {
    const transactions = [
      tx({ id: 1, customerId: 50, totalAmount: 100, saleDate: "2026-03-01" }),
      tx({ id: 2, customerId: 50, totalAmount: 110, saleDate: "2026-03-03" }),
      tx({ id: 3, customerId: 50, totalAmount: 90, saleDate: "2026-03-06" }),
      tx({
        id: 4,
        customerId: 50,
        totalAmount: 600,
        saleDate: "2026-03-15",
        createdAt: new Date("2026-03-15T03:00:00.000Z"),
      }),
    ];

    const items = [
      item({ transactionId: 1, productTypeId: 1, quantity: 10, unitPrice: 10 }),
      item({ transactionId: 2, productTypeId: 1, quantity: 11, unitPrice: 10 }),
      item({ transactionId: 3, productTypeId: 1, quantity: 9, unitPrice: 10 }),
      item({ transactionId: 4, productTypeId: 1, quantity: 30, unitPrice: 20 }),
    ];

    const audits = [
      audit({ id: 10, action: "transaction.create", entityId: 4, username: "cashier-b" }),
    ];

    const findings = detect({
      transactions,
      items,
      audits,
      targetTransactionIds: [4],
      targetCustomerIds: [50],
    });

    expect(findings.map((finding) => finding.ruleKey)).toEqual(
      expect.arrayContaining([
        "order_amount_anomaly",
        "order_price_deviation",
      ])
    );
  });

  it("keeps only suspicious payment behavior and not general credit exposure", () => {
    const transactions = [
      tx({ id: 10, customerId: 77, totalAmount: 25000, paid: 0, outstandingAmount: 25000, status: "unpaid", saleDate: "2026-02-20" }),
      tx({ id: 11, customerId: 77, totalAmount: 24000, paid: 2000, outstandingAmount: 22000, status: "partial", saleDate: "2026-03-01" }),
      tx({ id: 12, customerId: 77, totalAmount: 26000, paid: 3000, outstandingAmount: 23000, status: "partial", saleDate: "2026-03-08" }),
      tx({ id: 13, customerId: 77, totalAmount: 28000, paid: 2500, outstandingAmount: 25500, status: "partial", saleDate: "2026-03-15" }),
    ];

    const audits = [
      audit({ id: 20, action: "transaction.create", entityId: 13, userId: 3, username: "office-c", createdAt: new Date("2026-03-15T09:00:00.000Z") }),
      audit({ id: 21, action: "transaction.payment", entityId: 13, userId: 3, username: "office-c", details: { amount: 100 }, createdAt: new Date("2026-03-15T11:00:00.000Z") }),
      audit({ id: 22, action: "transaction.payment", entityId: 13, userId: 3, username: "office-c", details: { amount: 50 }, createdAt: new Date("2026-03-15T13:00:00.000Z") }),
      audit({ id: 23, action: "transaction.payment", entityId: 13, userId: 3, username: "office-c", details: { amount: 100 }, createdAt: new Date("2026-03-15T15:00:00.000Z") }),
    ];

    const findings = detect({
      transactions,
      items: [],
      audits,
      targetTransactionIds: [13],
      targetCustomerIds: [77],
    });

    expect(findings.map((finding) => finding.ruleKey)).toEqual(
      expect.arrayContaining([
        "partial_payment_repeat",
        "micro_payment_sequence",
      ])
    );
    expect(findings.map((finding) => finding.ruleKey)).not.toEqual(
      expect.arrayContaining(["credit_pattern_shift", "outstanding_concentration"])
    );
  });

  it("does not over-trigger on healthy routine sales", () => {
    const transactions = [
      tx({ id: 1, customerId: 80, totalAmount: 100, saleDate: "2026-03-01" }),
      tx({ id: 2, customerId: 80, totalAmount: 95, saleDate: "2026-03-03" }),
      tx({ id: 3, customerId: 80, totalAmount: 102, saleDate: "2026-03-05" }),
      tx({
        id: 4,
        customerId: 80,
        totalAmount: 99,
        saleDate: "2026-03-15",
        createdAt: new Date("2026-03-15T02:05:00.000Z"),
      }),
    ];

    const items = [
      item({ transactionId: 1, quantity: 10, unitPrice: 10 }),
      item({ transactionId: 2, quantity: 10, unitPrice: 9.5 }),
      item({ transactionId: 3, quantity: 10, unitPrice: 10.2 }),
      item({ transactionId: 4, quantity: 10, unitPrice: 9.9 }),
    ];

    const audits = [audit({ action: "transaction.create", entityId: 4 })];
    const findings = detect({
      transactions,
      items,
      audits,
      targetTransactionIds: [4],
      targetCustomerIds: [80],
    });

    expect(findings).toHaveLength(0);
  });

  it("does not flag repeated credit balances by themselves", () => {
    const transactions = [
      tx({ id: 100, customerId: 44, totalAmount: 1800, paid: 0, outstandingAmount: 1800, status: "unpaid", saleDate: "2026-02-20" }),
      tx({ id: 101, customerId: 44, totalAmount: 2100, paid: 0, outstandingAmount: 2100, status: "unpaid", saleDate: "2026-02-28" }),
      tx({ id: 102, customerId: 44, totalAmount: 1950, paid: 0, outstandingAmount: 1950, status: "unpaid", saleDate: "2026-03-06" }),
      tx({
        id: 103,
        customerId: 44,
        totalAmount: 2000,
        paid: 0,
        outstandingAmount: 2000,
        status: "unpaid",
        saleDate: "2026-03-15",
        createdAt: new Date("2026-03-15T02:05:00.000Z"),
      }),
    ];

    const audits = [
      audit({ id: 31, action: "transaction.create", entityId: 103, userId: 3, username: "office-c" }),
    ];

    const findings = detect({
      transactions,
      items: [],
      audits,
      targetTransactionIds: [103],
      targetCustomerIds: [44],
    });

    expect(findings).toEqual([]);
  });
});
