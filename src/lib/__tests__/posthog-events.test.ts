import { describe, expect, it } from "vitest";
import {
  buildAnalyticsBaseProperties,
  buildAuthenticatedDistinctId,
  buildCustomerCreatedProperties,
  buildInvoiceDraftCreatedProperties,
  buildInvoiceIssuedProperties,
  buildInvoicePaymentRecordedProperties,
  buildInvoiceVoidedProperties,
  buildSalePaymentRecordedProperties,
  buildSaleReturnCompletedProperties,
} from "@/lib/posthog-events";

describe("posthog event builders", () => {
  it("builds shared analytics context and authenticated distinct ids", () => {
    expect(buildAuthenticatedDistinctId(42)).toBe("user:42");
    expect(
      buildAnalyticsBaseProperties({
        eventOrigin: "server",
        actorUserId: 42,
        actorRole: "manager",
        factoryKey: "si",
      })
    ).toEqual({
      schema_version: 2,
      app: "superice-pos",
      event_origin: "server",
      factory_key: "si",
      actor_user_id: 42,
      actor_role: "manager",
    });
  });

  it("builds structured sale and customer payloads without free-text PII", () => {
    expect(
      buildCustomerCreatedProperties({
        actorUserId: 8,
        actorRole: "office",
        factoryKey: "si",
        customerId: 77,
        creditEnabled: true,
        transferCustomer: false,
        priceRowsCount: 5,
        pricedProductCount: 2,
      })
    ).toMatchObject({
      schema_version: 2,
      app: "superice-pos",
      event_origin: "server",
      factory_key: "si",
      actor_user_id: 8,
      actor_role: "office",
      customer_id: 77,
      credit_enabled: true,
      transfer_customer: false,
      price_rows_count: 5,
      priced_product_count: 2,
    });

    expect(
      buildSalePaymentRecordedProperties({
        actorUserId: 5,
        actorRole: "office",
        factoryKey: "si",
        transactionId: 901,
        customerId: 12,
        paymentAmount: 300,
        previousPaid: 100,
        newPaid: 400,
        newStatus: "partial",
        outstandingAfterPayment: 600,
        paymentDirection: "manual_payment",
        backToCredit: false,
      })
    ).toMatchObject({
      transaction_id: 901,
      customer_id: 12,
      payment_amount: 300,
      previous_paid: 100,
      new_paid: 400,
      new_status: "partial",
      outstanding_after_payment: 600,
      payment_direction: "manual_payment",
      back_to_credit: false,
    });

    expect(
      buildSaleReturnCompletedProperties({
        actorUserId: 5,
        actorRole: "manager",
        factoryKey: "si",
        returnTransactionId: 777,
        customerId: 12,
        totalRefund: 500,
        returnedItemQty: 5,
        returnedItemLines: 1,
        bagsReversedFromItems: 0,
        bagsReturnedManual: 2,
        refundAppliedToOutstanding: 100,
        unappliedRefundCredit: 400,
        originalBillId: 88,
        originalBillKind: "transfer_out",
        invoiceCreditReturn: true,
        allocationCount: 1,
        printedBillNumber: 1234,
        billNumber: "1234",
      })
    ).toMatchObject({
      return_transaction_id: 777,
      customer_id: 12,
      total_refund: 500,
      returned_item_qty: 5,
      returned_item_lines: 1,
      bags_reversed_from_items: 0,
      bags_returned_manual: 2,
      refund_applied_to_outstanding: 100,
      unapplied_refund_credit: 400,
      original_bill_id: 88,
      original_bill_kind: "transfer_out",
      invoice_credit_return: true,
      allocation_count: 1,
      printed_bill_number: 1234,
      bill_number: "1234",
    });
  });

  it("builds invoice lifecycle payloads with idempotency state", () => {
    expect(
      buildInvoiceDraftCreatedProperties({
        actorUserId: 8,
        actorRole: "office",
        factoryKey: "si",
        invoiceId: 101,
        customerId: 12,
        periodStart: "2026-03-01",
        periodEnd: "2026-03-31",
        includeKinds: ["sale", "return"],
        lineCount: 3,
        subtotal: 1000,
        vatEnabled: false,
        vatAmount: 0,
        grandTotal: 1000,
        selectedTransactionCount: 3,
        idempotentReplay: false,
      })
    ).toMatchObject({
      invoice_id: 101,
      customer_id: 12,
      period_start: "2026-03-01",
      period_end: "2026-03-31",
      include_kinds: ["sale", "return"],
      line_count: 3,
      subtotal: 1000,
      vat_enabled: false,
      vat_amount: 0,
      grand_total: 1000,
      selected_transaction_count: 3,
      idempotent_replay: false,
    });

    expect(
      buildInvoiceIssuedProperties({
        actorUserId: 8,
        actorRole: "office",
        factoryKey: "si",
        invoiceId: 101,
        invoiceNo: "INV-SI-2026-00001",
        issueDate: "2026-03-02",
        dueDate: "2026-03-09",
        idempotentReplay: true,
      })
    ).toMatchObject({
      invoice_id: 101,
      invoice_no: "INV-SI-2026-00001",
      issue_date: "2026-03-02",
      due_date: "2026-03-09",
      idempotent_replay: true,
    });

    expect(
      buildInvoicePaymentRecordedProperties({
        actorUserId: 8,
        actorRole: "office",
        factoryKey: "si",
        invoiceId: 101,
        paymentId: 55,
        amount: 500,
        method: "cash",
        paidTotalAfter: 500,
        outstandingAfter: 500,
        invoiceStatusAfter: "issued",
        allocationCount: 2,
        unallocatedAmount: 0,
        idempotentReplay: false,
      })
    ).toMatchObject({
      invoice_id: 101,
      payment_id: 55,
      amount: 500,
      method: "cash",
      paid_total_after: 500,
      outstanding_after: 500,
      invoice_status_after: "issued",
      allocation_count: 2,
      unallocated_amount: 0,
      idempotent_replay: false,
    });

    expect(
      buildInvoiceVoidedProperties({
        actorUserId: 8,
        actorRole: "office",
        factoryKey: "si",
        invoiceId: 101,
        paidTotalBeforeReversal: 500,
        reversalPaymentCount: 2,
        allocationReversalCount: 3,
        idempotentReplay: true,
      })
    ).toMatchObject({
      invoice_id: 101,
      paid_total_before_reversal: 500,
      reversal_payment_count: 2,
      allocation_reversal_count: 3,
      idempotent_replay: true,
    });
  });
});
