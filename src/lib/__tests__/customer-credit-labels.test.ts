import { describe, expect, it } from "vitest";
import {
  INVOICE_CREDIT_LABEL,
  SHORT_TERM_CREDIT_LABEL,
  customerCreditLabel,
  isInvoiceCreditTransaction,
  maskCustomerPrintAmount,
  normalizeCustomerPrintAmount,
  transferCustomerLabel,
} from "@/lib/customer-credit-labels";

describe("customer credit labels", () => {
  it("keeps the short-term and invoice-later labels distinct", () => {
    expect(SHORT_TERM_CREDIT_LABEL).toBe("ค้าง");
    expect(INVOICE_CREDIT_LABEL).toBe("เครดิต");
  });

  it("maps customer flags to the renamed labels", () => {
    expect(customerCreditLabel(true)).toBe("ค้าง");
    expect(customerCreditLabel(false)).toBe("ปกติ");
    expect(transferCustomerLabel(true)).toBe("เครดิต");
    expect(transferCustomerLabel(false)).toBe("ปกติ");
  });

  it("identifies transfer_out as invoice credit", () => {
    expect(isInvoiceCreditTransaction("transfer_out")).toBe(true);
    expect(isInvoiceCreditTransaction("sale")).toBe(false);
    expect(isInvoiceCreditTransaction("return")).toBe(false);
    expect(isInvoiceCreditTransaction(null)).toBe(false);
    expect(isInvoiceCreditTransaction(undefined)).toBe(false);
  });

  it("masks customer-facing print amounts for invoice credit transactions", () => {
    expect(maskCustomerPrintAmount(1250, "transfer_out")).toBe(0);
    expect(maskCustomerPrintAmount(1250, "sale")).toBe(1250);
    expect(maskCustomerPrintAmount(1250, null)).toBe(1250);
    expect(maskCustomerPrintAmount(-80, "sale")).toBe(-80);
  });

  it("masks customer-facing print amounts when hide-totals print mode is enabled", () => {
    expect(maskCustomerPrintAmount(1250, "sale", true)).toBe(0);
    expect(maskCustomerPrintAmount(-80, "sale", true)).toBe(0);
  });

  it("normalizes return totals for customer-facing print output", () => {
    expect(normalizeCustomerPrintAmount(-1250, "return")).toBe(1250);
    expect(normalizeCustomerPrintAmount(-1250, "return", true)).toBe(0);
    expect(normalizeCustomerPrintAmount(1250, "sale")).toBe(1250);
  });
});
