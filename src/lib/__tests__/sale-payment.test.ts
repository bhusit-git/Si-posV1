import { describe, expect, it } from "vitest";
import {
  analyticsSaleTypeThaiLabel,
  getSalePrintPaymentSummary,
  resolveAnalyticsSaleType,
  resolveSalePayment,
} from "@/lib/sale-payment";

describe("resolveSalePayment", () => {
  it("returns paid sentinel for full payment", () => {
    expect(
      resolveSalePayment({
        paymentStatus: "paid",
        grandTotal: 500,
        hasSaleItems: true,
        isTransferMode: false,
        partialPaidAmount: null,
      })
    ).toEqual({
      effectiveStatus: "paid",
      payloadPaid: -1,
      printPaid: 500,
      remainingAmount: 0,
      isValid: true,
    });
  });

  it("returns unpaid payload for unpaid sales", () => {
    expect(
      resolveSalePayment({
        paymentStatus: "unpaid",
        grandTotal: 500,
        hasSaleItems: true,
        isTransferMode: false,
        partialPaidAmount: null,
      })
    ).toEqual({
      effectiveStatus: "unpaid",
      payloadPaid: 0,
      printPaid: 0,
      remainingAmount: 500,
      isValid: true,
    });
  });

  it("returns real paid amount for valid partial sales", () => {
    expect(
      resolveSalePayment({
        paymentStatus: "partial",
        grandTotal: 500,
        hasSaleItems: true,
        isTransferMode: false,
        partialPaidAmount: 125,
      })
    ).toEqual({
      effectiveStatus: "partial",
      payloadPaid: 125,
      printPaid: 125,
      remainingAmount: 375,
      isValid: true,
    });
  });

  it("marks partial invalid when amount is missing or zero", () => {
    expect(
      resolveSalePayment({
        paymentStatus: "partial",
        grandTotal: 500,
        hasSaleItems: true,
        isTransferMode: false,
        partialPaidAmount: 0,
      }).isValid
    ).toBe(false);
  });

  it("auto-converts partial equal to total into paid", () => {
    expect(
      resolveSalePayment({
        paymentStatus: "partial",
        grandTotal: 500,
        hasSaleItems: true,
        isTransferMode: false,
        partialPaidAmount: 500,
      })
    ).toEqual({
      effectiveStatus: "paid",
      payloadPaid: -1,
      printPaid: 500,
      remainingAmount: 0,
      isValid: true,
    });
  });

  it("auto-converts partial above total into paid", () => {
    expect(
      resolveSalePayment({
        paymentStatus: "partial",
        grandTotal: 500,
        hasSaleItems: true,
        isTransferMode: false,
        partialPaidAmount: 700,
      })
    ).toEqual({
      effectiveStatus: "paid",
      payloadPaid: -1,
      printPaid: 500,
      remainingAmount: 0,
      isValid: true,
    });
  });

  it("forces bag-return-only saves to paid", () => {
    expect(
      resolveSalePayment({
        paymentStatus: "partial",
        grandTotal: 0,
        hasSaleItems: false,
        isTransferMode: false,
        partialPaidAmount: 50,
      }).effectiveStatus
    ).toBe("paid");
  });

  it("keeps transfer mode fully paid", () => {
    expect(
      resolveSalePayment({
        paymentStatus: "partial",
        grandTotal: 500,
        hasSaleItems: true,
        isTransferMode: true,
        partialPaidAmount: 125,
      }).effectiveStatus
    ).toBe("paid");
  });
});

describe("getSalePrintPaymentSummary", () => {
  it("returns partial print values for normal sale prints", () => {
    expect(
      getSalePrintPaymentSummary({
        transactionKind: "sale",
        status: "partial",
        totalAmount: 500,
        paid: 125,
      })
    ).toEqual({
      paidNow: 125,
      remainingAmount: 375,
      totalAmount: 500,
    });
  });

  it("returns null for invoice-credit prints", () => {
    expect(
      getSalePrintPaymentSummary({
        transactionKind: "transfer_out",
        status: "partial",
        totalAmount: 500,
        paid: 125,
      })
    ).toBeNull();
  });

  it("returns null for non-partial prints", () => {
    expect(
      getSalePrintPaymentSummary({
        transactionKind: "sale",
        status: "unpaid",
        totalAmount: 500,
        paid: 0,
      })
    ).toBeNull();
  });

  it("caps paid-now at total and floors remaining at zero", () => {
    expect(
      getSalePrintPaymentSummary({
        transactionKind: "sale",
        status: "partial",
        totalAmount: 500,
        paid: 900,
      })
    ).toEqual({
      paidNow: 500,
      remainingAmount: 0,
      totalAmount: 500,
    });
  });

  it("floors negative paid amounts to zero in print summary", () => {
    expect(
      getSalePrintPaymentSummary({
        transactionKind: "sale",
        status: "partial",
        totalAmount: 500,
        paid: -100,
      })
    ).toEqual({
      paidNow: 0,
      remainingAmount: 500,
      totalAmount: 500,
    });
  });
});

describe("resolveAnalyticsSaleType", () => {
  it("classifies transfer_out as long_term_credit", () => {
    expect(
      resolveAnalyticsSaleType({
        transactionType: "transfer_out",
        paymentStatus: "paid",
      })
    ).toBe("long_term_credit");
  });

  it("classifies unpaid sale as short_term_credit", () => {
    expect(
      resolveAnalyticsSaleType({
        transactionType: "sale",
        paymentStatus: "unpaid",
      })
    ).toBe("short_term_credit");
  });

  it("classifies partial sale as short_term_credit", () => {
    expect(
      resolveAnalyticsSaleType({
        transactionType: "sale",
        paymentStatus: "partial",
      })
    ).toBe("short_term_credit");
  });

  it("classifies paid sale as cash", () => {
    expect(
      resolveAnalyticsSaleType({
        transactionType: "sale",
        paymentStatus: "paid",
      })
    ).toBe("cash");
  });
});

describe("analyticsSaleTypeThaiLabel", () => {
  it("maps sale types to Thai labels", () => {
    expect(analyticsSaleTypeThaiLabel("cash")).toBe("เงินสด");
    expect(analyticsSaleTypeThaiLabel("short_term_credit")).toBe("ค้าง");
    expect(analyticsSaleTypeThaiLabel("long_term_credit")).toBe("เครดิต");
  });
});
