import { describe, expect, it } from "vitest";
import {
  buildBagLedgerWrites,
  buildRefundBagAdjustNote,
  getBagBalanceFromEntries,
  isBuyBagsLedgerNote,
  reverseBagLedgerEntry,
  summarizeBagLedgerEntries,
  summarizeRefundBagFlow,
  summarizeSaleBagFlow,
  withRunningBagBalance,
} from "@/lib/bag-flow";
import { mapTransactionToPreprintedBill } from "@/lib/preprinted-bill-mapper";
import { buildItemizedPreview, parseIncludeKinds, type PreviewSourceProductColumn, type PreviewSourceTransaction } from "@/lib/invoice-utils";

const productColumns: PreviewSourceProductColumn[] = [
  { id: 1, name: "ซอง", sortOrder: 1 },
  { id: 41, name: "ซื้อกระสอบ", sortOrder: 41 },
];

function makeTx(id: number, kind: PreviewSourceTransaction["transactionKind"], totalAmount: number): PreviewSourceTransaction {
  return {
    id,
    customerName: "ลูกค้า A",
    saleDate: "2026-03-23",
    saleTime: "09:00:00",
    pool: null,
    row: null,
    col: null,
    status: "paid",
    totalAmount,
    paid: totalAmount,
    transactionKind: kind,
    note: kind === "return" ? `คืนสินค้า อ้างอิงบิล #${id - 1}` : null,
  };
}

describe("bag chaos scenarios", () => {
  it("handles sale with only bagged items", () => {
    const summary = summarizeSaleBagFlow({
      items: [{ quantity: 10, productType: { hasBag: true, decreasesBag: false } }],
    });

    expect(summary).toEqual({
      bagsOut: 10,
      bagsReturned: 0,
      bagsBought: 0,
      bagAdjustDelta: 0,
      balanceDelta: 10,
    });
  });

  it("handles sale with only buy-bags items", () => {
    const summary = summarizeSaleBagFlow({
      items: [{ quantity: 3, productType: { hasBag: false, decreasesBag: true } }],
    });

    expect(summary).toEqual({
      bagsOut: 0,
      bagsReturned: 0,
      bagsBought: 3,
      bagAdjustDelta: 0,
      balanceDelta: -3,
    });
  });

  it("handles sale with manual bag return only", () => {
    const summary = summarizeSaleBagFlow({
      items: [],
      manualBagReturnQty: 4,
    });

    expect(summary).toEqual({
      bagsOut: 0,
      bagsReturned: 4,
      bagsBought: 0,
      bagAdjustDelta: 0,
      balanceDelta: -4,
    });
  });

  it("handles sale with bagged items, buy-bags, and manual return together", () => {
    const summary = summarizeSaleBagFlow({
      items: [
        { quantity: 10, productType: { hasBag: true, decreasesBag: false } },
        { quantity: 3, productType: { hasBag: false, decreasesBag: true } },
      ],
      manualBagReturnQty: 2,
    });

    expect(summary.balanceDelta).toBe(5);
    expect(buildBagLedgerWrites(summary)).toEqual([
      { type: "out", quantity: 10, note: null },
      { type: "return", quantity: 3, note: "ซื้อกระสอบ" },
      { type: "return", quantity: 2, note: null },
    ]);
  });

  it("handles refund of bagged items only", () => {
    const summary = summarizeRefundBagFlow({
      items: [{ quantity: 10, productType: { hasBag: true, decreasesBag: false } }],
    });

    expect(summary).toEqual({
      bagsOut: 0,
      bagsReturned: 0,
      bagsBought: 0,
      bagAdjustDelta: -10,
      balanceDelta: -10,
    });
  });

  it("handles refund of buy-bags only", () => {
    const summary = summarizeRefundBagFlow({
      items: [{ quantity: 3, productType: { hasBag: false, decreasesBag: true } }],
    });

    expect(summary).toEqual({
      bagsOut: 0,
      bagsReturned: 0,
      bagsBought: 0,
      bagAdjustDelta: 3,
      balanceDelta: 3,
    });
  });

  it("handles refund with manual bag return only", () => {
    const summary = summarizeRefundBagFlow({
      items: [],
      manualBagReturnQty: 5,
    });

    expect(summary).toEqual({
      bagsOut: 0,
      bagsReturned: 5,
      bagsBought: 0,
      bagAdjustDelta: 0,
      balanceDelta: -5,
    });
  });

  it("handles refund with bagged items, refunded buy-bags, and manual bag return together", () => {
    const summary = summarizeRefundBagFlow({
      items: [
        { quantity: 10, productType: { hasBag: true, decreasesBag: false } },
        { quantity: 3, productType: { hasBag: false, decreasesBag: true } },
      ],
      manualBagReturnQty: 2,
    });

    expect(summary).toEqual({
      bagsOut: 0,
      bagsReturned: 2,
      bagsBought: 0,
      bagAdjustDelta: -7,
      balanceDelta: -9,
    });
  });

  it("round-trips sale -> refund -> void refund back to the original balance", () => {
    const saleEntries = buildBagLedgerWrites(
      summarizeSaleBagFlow({
        items: [
          { quantity: 10, productType: { hasBag: true, decreasesBag: false } },
          { quantity: 3, productType: { hasBag: false, decreasesBag: true } },
        ],
        manualBagReturnQty: 2,
      })
    );
    const refundEntries = buildBagLedgerWrites(
      summarizeRefundBagFlow({
        items: [
          { quantity: 10, productType: { hasBag: true, decreasesBag: false } },
          { quantity: 3, productType: { hasBag: false, decreasesBag: true } },
        ],
        manualBagReturnQty: 0,
      }),
      { adjustNote: buildRefundBagAdjustNote(1001) }
    );
    const voidRefundEntries = refundEntries.map((entry) => ({
      ...reverseBagLedgerEntry(entry),
      note: "ยกเลิกบิล #1002",
    }));

    expect(getBagBalanceFromEntries(saleEntries)).toBe(5);
    expect(getBagBalanceFromEntries([...saleEntries, ...refundEntries])).toBe(-2);
    expect(getBagBalanceFromEntries([...saleEntries, ...refundEntries, ...voidRefundEntries])).toBe(5);
  });

  it("keeps repeated refunds additive so route-level guards must stop duplicates", () => {
    const refundEntries = buildBagLedgerWrites(
      summarizeRefundBagFlow({
        items: [{ quantity: 4, productType: { hasBag: true, decreasesBag: false } }],
      }),
      { adjustNote: buildRefundBagAdjustNote(222) }
    );

    expect(getBagBalanceFromEntries([...refundEntries, ...refundEntries])).toBe(-8);
  });

  it("treats buy-bag notes with spacing and case variations as buy-bags, but not typos", () => {
    expect(isBuyBagsLedgerNote("ซื้อกระสอบ")).toBe(true);
    expect(isBuyBagsLedgerNote("  ซื้อ   กระสอบ  ")).toBe(true);
    expect(isBuyBagsLedgerNote("ซื้อกระสอบไม่ติดตาม")).toBe(false);
    expect(isBuyBagsLedgerNote("ซื้อกระสอบs")).toBe(false);
  });

  it("documents malformed raw ledger behavior for negative out/return and unknown types", () => {
    const summary = summarizeBagLedgerEntries([
      { type: "out", quantity: -10, note: null },
      { type: "return", quantity: -5, note: null },
      { type: "weird", quantity: 99, note: null },
      { type: "adjust", quantity: -2, note: "manual" },
    ]);

    expect(summary).toEqual({
      bagsOut: 0,
      bagsReturned: 0,
      bagsBought: 0,
      bagAdjustDelta: -2,
      balanceDelta: -2,
    });
  });

  it("counts items with both hasBag and decreasesBag flags in both buckets", () => {
    const summary = summarizeSaleBagFlow({
      items: [{ quantity: 5, productType: { hasBag: true, decreasesBag: true } }],
    });

    expect(summary).toEqual({
      bagsOut: 5,
      bagsReturned: 0,
      bagsBought: 5,
      bagAdjustDelta: 0,
      balanceDelta: 0,
    });
  });

  it("aggregates duplicate refund product rows additively", () => {
    const summary = summarizeRefundBagFlow({
      items: [
        { quantity: 2, productType: { hasBag: true, decreasesBag: false } },
        { quantity: 3, productType: { hasBag: true, decreasesBag: false } },
      ],
    });

    expect(summary.bagAdjustDelta).toBe(-5);
    expect(summary.balanceDelta).toBe(-5);
  });

  it("allows bag-only refund scenarios with no original bill in helper semantics", () => {
    const writes = buildBagLedgerWrites(
      summarizeRefundBagFlow({
        items: [],
        manualBagReturnQty: 6,
      }),
      { manualReturnNote: "คืนสินค้า" }
    );

    expect(writes).toEqual([{ type: "return", quantity: 6, note: "คืนสินค้า" }]);
  });

  it("allows manual bag return greater than original bagged count as an explicit separate effect", () => {
    const saleEntries = buildBagLedgerWrites(
      summarizeSaleBagFlow({
        items: [{ quantity: 4, productType: { hasBag: true, decreasesBag: false } }],
      })
    );
    const refundEntries = buildBagLedgerWrites(
      summarizeRefundBagFlow({
        items: [{ quantity: 4, productType: { hasBag: true, decreasesBag: false } }],
        manualBagReturnQty: 10,
      }),
      {
        adjustNote: buildRefundBagAdjustNote(909),
        manualReturnNote: "คืนสินค้า อ้างอิงบิล #909",
      }
    );

    expect(getBagBalanceFromEntries([...saleEntries, ...refundEntries])).toBe(-10);
  });

  it("keeps running balance aligned with signed deltas for legacy mixed ledger rows", () => {
    const entries = [
      { id: 5, type: "adjust", quantity: -1, note: "ยกเลิกบิล #44" },
      { id: 4, type: "return", quantity: 2, note: null },
      { id: 3, type: "return", quantity: 3, note: "ซื้อกระสอบ" },
      { id: 2, type: "adjust", quantity: 4, note: "manual" },
      { id: 1, type: "out", quantity: 10, note: null },
    ];

    const rows = withRunningBagBalance(entries);
    expect(rows.map((row) => row.balanceDelta)).toEqual([-1, -2, -3, 4, 10]);
    expect(rows.map((row) => row.runningBalance)).toEqual([8, 9, 11, 14, 10]);
  });

  it("keeps helper, preprinted mapper, invoice preview, and ledger running balance consistent for the same bag data", () => {
    const bagEntries = [
      { transactionId: 1, type: "out" as const, quantity: 10, note: null },
      { transactionId: 1, type: "return" as const, quantity: 2, note: null },
      { transactionId: 1, type: "return" as const, quantity: 3, note: "ซื้อกระสอบ" },
      { transactionId: 1, type: "adjust" as const, quantity: -4, note: "ยกเลิกบิล #1" },
    ];

    const helperSummary = summarizeBagLedgerEntries(bagEntries);
    const mapper = mapTransactionToPreprintedBill({
      items: [],
      bagLedgerEntries: bagEntries,
      bagBalanceAfter: helperSummary.balanceDelta,
    });
    const preview = buildItemizedPreview({
      transactions: [makeTx(1, "return", -100)],
      items: [],
      bagEntries,
      productColumns,
      includeKinds: parseIncludeKinds("return"),
    });
    const running = withRunningBagBalance(
      bagEntries.map((entry, idx) => ({ ...entry, id: idx + 1 }))
    );

    expect(helperSummary).toEqual({
      bagsOut: 10,
      bagsReturned: 2,
      bagsBought: 3,
      bagAdjustDelta: -4,
      balanceDelta: 1,
    });
    expect(mapper.line7BuyBagsQty).toBe(3);
    expect(mapper.line8BagsOutQty).toBe(10);
    expect(mapper.line9BagsReturnQty).toBe(2);
    expect(mapper.line10NetBagQty).toBe(1);
    expect(preview.rows[0].bagsOut).toBe(10);
    expect(preview.rows[0].bagsReturned).toBe(2);
    expect(preview.rows[0].bagsBought).toBe(3);
    expect(preview.rows[0].bagAdjustDelta).toBe(-4);
    expect(running[0].runningBalance).toBe(1);
  });
});
