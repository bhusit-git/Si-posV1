import { describe, expect, it } from "vitest";
import {
  createTransactionSchema,
  createReturnSchema,
  payTransactionSchema,
  userPasswordSchema,
  updateTransferAccountingStatusSchema,
} from "@/lib/validations";

describe("Validation contracts", () => {
  describe("payTransactionSchema", () => {
    it("accepts payment action with positive amount", () => {
      const parsed = payTransactionSchema.safeParse({
        id: 123,
        action: "payment",
        amount: 100,
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts payment action with negative amount", () => {
      const parsed = payTransactionSchema.safeParse({
        id: 123,
        action: "payment",
        amount: -100,
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects zero payment amount", () => {
      expect(
        payTransactionSchema.safeParse({ id: 1, action: "payment", amount: 0 }).success
      ).toBe(false);
    });

    it("rejects unsupported action names", () => {
      expect(
        payTransactionSchema.safeParse({ id: 1, action: "pay", amount: 100 }).success
      ).toBe(false);
    });
  });

  describe("createReturnSchema", () => {
    it("accepts product return payload", () => {
      const parsed = createReturnSchema.safeParse({
        customerId: 1,
        saleDate: "2026-02-17",
        saleTime: "10:30:00",
        items: [{ productTypeId: 1, quantity: 2, unitPrice: 120 }],
        bagReturns: [],
        note: "test",
        originalBill: 100,
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts bag-only return payload", () => {
      const parsed = createReturnSchema.safeParse({
        customerId: 1,
        saleDate: "2026-02-17",
        saleTime: "10:30:00",
        items: [],
        bagReturns: [{ productTypeId: 1, quantity: 5 }],
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects product return payload without original bill", () => {
      const parsed = createReturnSchema.safeParse({
        customerId: 1,
        saleDate: "2026-02-17",
        saleTime: "10:30:00",
        items: [{ productTypeId: 1, quantity: 2, unitPrice: 120 }],
        bagReturns: [],
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects payload with no items and no bag returns", () => {
      const parsed = createReturnSchema.safeParse({
        customerId: 1,
        saleDate: "2026-02-17",
        saleTime: "10:30:00",
        items: [],
        bagReturns: [],
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("createTransactionSchema", () => {
    it("accepts sale payload with items", () => {
      const parsed = createTransactionSchema.safeParse({
        customerId: 1,
        saleDate: "2026-02-17",
        saleTime: "10:30:00",
        items: [{ productTypeId: 1, quantity: 2, unitPrice: 120 }],
        bagReturns: [],
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts partial sale payload with explicit paid amount", () => {
      const parsed = createTransactionSchema.safeParse({
        customerId: 1,
        saleDate: "2026-02-17",
        saleTime: "10:30:00",
        items: [{ productTypeId: 1, quantity: 2, unitPrice: 120 }],
        bagReturns: [],
        status: "partial",
        paid: 100,
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts bag-only sale payload", () => {
      const parsed = createTransactionSchema.safeParse({
        customerId: 1,
        saleDate: "2026-02-17",
        saleTime: "10:30:00",
        items: [],
        bagReturns: [{ productTypeId: 1, quantity: 5 }],
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts unpaid sale payload with explicit zero paid amount", () => {
      const parsed = createTransactionSchema.safeParse({
        customerId: 1,
        saleDate: "2026-02-17",
        saleTime: "10:30:00",
        items: [{ productTypeId: 1, quantity: 2, unitPrice: 120 }],
        bagReturns: [],
        status: "unpaid",
        paid: 0,
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects payload with no sale items and no bag returns", () => {
      const parsed = createTransactionSchema.safeParse({
        customerId: 1,
        saleDate: "2026-02-17",
        saleTime: "10:30:00",
        items: [],
        bagReturns: [],
      });
      expect(parsed.success).toBe(false);
    });

    it("accepts transfer payload when ref is valid", () => {
      const parsed = createTransactionSchema.safeParse({
        customerId: 1,
        saleDate: "2026-02-17",
        saleTime: "10:30:00",
        items: [{ productTypeId: 1, quantity: 2, unitPrice: 120 }],
        bagReturns: [],
        transactionType: "transfer_out",
        transferRef: "TRF-20260217-001",
        transferDestination: "BEARING",
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts transfer payload with bag return only", () => {
      const parsed = createTransactionSchema.safeParse({
        customerId: 1,
        saleDate: "2026-02-17",
        saleTime: "10:30:00",
        items: [],
        bagReturns: [{ productTypeId: 1, quantity: 5 }],
        transactionType: "transfer_out",
        transferRef: "TRF-20260217-004",
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts transfer payload without destination/truck and without note", () => {
      const parsed = createTransactionSchema.safeParse({
        customerId: 1,
        saleDate: "2026-02-17",
        saleTime: "10:30:00",
        items: [{ productTypeId: 1, quantity: 2, unitPrice: 120 }],
        bagReturns: [],
        transactionType: "transfer_out",
        transferRef: "TRF-20260217-002",
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts transfer payload with optional note", () => {
      const parsed = createTransactionSchema.safeParse({
        customerId: 1,
        saleDate: "2026-02-17",
        saleTime: "10:30:00",
        items: [{ productTypeId: 1, quantity: 2, unitPrice: 120 }],
        bagReturns: [],
        transactionType: "transfer_out",
        transferRef: "TRF-20260217-003",
        note: "reconcile later",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects transfer payload when ref is invalid", () => {
      const parsed = createTransactionSchema.safeParse({
        customerId: 1,
        saleDate: "2026-02-17",
        saleTime: "10:30:00",
        items: [{ productTypeId: 1, quantity: 2, unitPrice: 120 }],
        bagReturns: [],
        transactionType: "transfer_out",
        transferRef: "bad-ref",
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("userPasswordSchema", () => {
    it("accepts a 4-digit PIN-style password", () => {
      const parsed = userPasswordSchema.safeParse("1234");
      expect(parsed.success).toBe(true);
    });

    it("accepts letters-only password with at least 4 chars", () => {
      expect(userPasswordSchema.safeParse("abcd").success).toBe(true);
    });

    it("accepts mixed password with at least 4 chars", () => {
      expect(userPasswordSchema.safeParse("a1b2").success).toBe(true);
    });

    it("rejects passwords shorter than 4 chars", () => {
      expect(userPasswordSchema.safeParse("123").success).toBe(false);
    });
  });

  describe("updateTransferAccountingStatusSchema", () => {
    it("accepts open and closed values", () => {
      expect(
        updateTransferAccountingStatusSchema.safeParse({ id: 123, accountingStatus: "open" }).success
      ).toBe(true);
      expect(
        updateTransferAccountingStatusSchema.safeParse({ id: 123, accountingStatus: "closed" }).success
      ).toBe(true);
    });

    it("rejects unsupported status values", () => {
      expect(
        updateTransferAccountingStatusSchema.safeParse({ id: 123, accountingStatus: "pending" }).success
      ).toBe(false);
    });
  });
});
