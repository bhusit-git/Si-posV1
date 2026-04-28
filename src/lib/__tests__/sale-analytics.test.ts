import { describe, expect, it } from "vitest";
import { BUY_BAGS_LEDGER_NOTE } from "@/lib/bag-flow";
import {
  buildSaleAnalyticsProperties,
  buildSaleAnalyticsSnapshotDistinctId,
  buildSaleAnalyticsSnapshotUuid,
  deriveHistoricalSaleAnalyticsMetrics,
  deriveLiveSaleAnalyticsMetrics,
} from "@/lib/sale-analytics";

describe("sale-analytics", () => {
  it("derives live metrics from positive-quantity items and sale bag summary", () => {
    const metrics = deriveLiveSaleAnalyticsMetrics({
      items: [
        { quantity: 10, productType: { hasBag: true, decreasesBag: false } },
        { quantity: 0, productType: { hasBag: true, decreasesBag: false } },
        { quantity: 2, productType: { hasBag: false, decreasesBag: true } },
      ],
      saleBagSummary: {
        bagsOut: 10,
        bagsReturned: 3,
        bagsBought: 2,
      },
    });

    expect(metrics).toEqual({
      itemsCount: 2,
      quantityTotal: 12,
      bagsOut: 10,
      bagsReturned: 3,
      bagsBought: 2,
    });
  });

  it("derives historical metrics with bag returns and buy-bags split from ledger notes", () => {
    const metrics = deriveHistoricalSaleAnalyticsMetrics({
      items: [
        { quantity: 8, productType: { hasBag: true, decreasesBag: false } },
        { quantity: 3, productType: { hasBag: false, decreasesBag: true } },
        { quantity: 0, productType: { hasBag: true, decreasesBag: false } },
      ],
      bagLedgerEntries: [
        { type: "out", quantity: 8, note: null },
        { type: "return", quantity: 2, note: null },
        { type: "return", quantity: 3, note: BUY_BAGS_LEDGER_NOTE },
      ],
    });

    expect(metrics).toEqual({
      itemsCount: 2,
      quantityTotal: 11,
      bagsOut: 8,
      bagsReturned: 2,
      bagsBought: 3,
    });
  });

  it("builds sale analytics properties with derived sale type labels", () => {
    const properties = buildSaleAnalyticsProperties({
      transactionId: 9001,
      customerId: 88,
      totalAmount: 500,
      paidAmount: 200,
      outstandingAmount: 300,
      paymentStatus: "partial",
      transactionType: "sale",
      transferRef: null,
      factoryKey: "si",
      metrics: {
        itemsCount: 2,
        quantityTotal: 11,
        bagsOut: 8,
        bagsReturned: 2,
        bagsBought: 3,
      },
      printedBillNumber: 1234,
      billNumber: "1234",
      internalReference: "Tx #9001",
      saleDate: "2026-03-26",
      saleTime: "10:00:00",
      isBackdated: true,
      warningCount: 2,
      sourceSystem: "app_pos",
      actorUserId: 7,
      actorRole: "manager",
      eventOrigin: "server",
      eventSource: "server",
    });

    expect(properties).toEqual({
      schema_version: 2,
      app: "superice-pos",
      event_origin: "server",
      factory_key: "si",
      actor_user_id: 7,
      actor_role: "manager",
      transaction_id: 9001,
      customer_id: 88,
      total_amount: 500,
      paid_amount: 200,
      outstanding_amount: 300,
      payment_status: "partial",
      transaction_type: "sale",
      transfer_ref: null,
      sale_type: "short_term_credit",
      sale_type_th: "ค้าง",
      items_count: 2,
      quantity_total: 11,
      bags_out: 8,
      bags_returned: 2,
      bags_bought: 3,
      printed_bill_number: 1234,
      bill_number: "1234",
      internal_reference: "Tx #9001",
      sale_date: "2026-03-26",
      sale_time: "10:00:00",
      is_backdated: true,
      warning_count: 2,
      source_system: "app_pos",
      event_source: "server",
    });
  });

  it("builds deterministic snapshot identifiers for rerun-safe backfills", () => {
    expect(buildSaleAnalyticsSnapshotDistinctId("si", 88)).toBe("customer:si:88");
    expect(buildSaleAnalyticsSnapshotDistinctId("si", null)).toBe("customer:si:unknown");
    expect(buildSaleAnalyticsSnapshotUuid("si", 9001)).toBe(
      "sale_analytics_snapshot-si-9001"
    );
  });
});
