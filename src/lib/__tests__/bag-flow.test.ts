import { describe, expect, it } from "vitest";
import {
  BUY_BAGS_LEDGER_NOTE,
  buildBagLedgerWrites,
  buildRefundBagAdjustNote,
  getBagDisplayQuantities,
  getBagBalanceFromEntries,
  getBagEntryBalanceDelta,
  reverseBagLedgerEntry,
  summarizeBagLedgerEntries,
  summarizeRefundBagFlow,
  summarizeSaleBagFlow,
  withRunningBagBalance,
} from "@/lib/bag-flow";

describe("bag-flow", () => {
  it("summarizes sale bag flow from bagged products, buy bags, and manual returns", () => {
    const summary = summarizeSaleBagFlow({
      items: [
        { quantity: 10, productType: { hasBag: true, decreasesBag: false } },
        { quantity: 3, productType: { hasBag: false, decreasesBag: true } },
      ],
      manualBagReturnQty: 2,
    });

    expect(summary).toEqual({
      bagsOut: 10,
      bagsReturned: 2,
      bagsBought: 3,
      bagAdjustDelta: 0,
      balanceDelta: 5,
    });
  });

  it("summarizes refund bag flow for bagged products and refunded buy bags", () => {
    const summary = summarizeRefundBagFlow({
      items: [
        { quantity: 8, productType: { hasBag: true, decreasesBag: false } },
        { quantity: 2, productType: { hasBag: false, decreasesBag: true } },
      ],
      manualBagReturnQty: 1,
    });

    expect(summary).toEqual({
      bagsOut: 0,
      bagsReturned: 1,
      bagsBought: 0,
      bagAdjustDelta: -6,
      balanceDelta: -7,
    });
  });

  it("builds ledger writes with distinct buy-bag and adjustment notes", () => {
    const writes = buildBagLedgerWrites(
      {
        bagsOut: 7,
        bagsReturned: 2,
        bagsBought: 3,
        bagAdjustDelta: -4,
        balanceDelta: -2,
      },
      {
        adjustNote: buildRefundBagAdjustNote(123),
        manualReturnNote: "คืนสินค้า อ้างอิงบิล #123",
      }
    );

    expect(writes).toEqual([
      { type: "out", quantity: 7, note: null },
      { type: "return", quantity: 3, note: BUY_BAGS_LEDGER_NOTE },
      { type: "return", quantity: 2, note: "คืนสินค้า อ้างอิงบิล #123" },
      { type: "adjust", quantity: -4, note: "ยกเลิกบิล #123" },
    ]);
  });

  it("summarizes bag ledger entries with signed adjustments", () => {
    const summary = summarizeBagLedgerEntries([
      { type: "out", quantity: 10, note: null },
      { type: "return", quantity: 4, note: null },
      { type: "return", quantity: 3, note: BUY_BAGS_LEDGER_NOTE },
      { type: "adjust", quantity: -2, note: "ยกเลิกบิล #99" },
      { type: "adjust", quantity: 5, note: "ยกเลิกบิล #88" },
    ]);

    expect(summary).toEqual({
      bagsOut: 10,
      bagsReturned: 4,
      bagsBought: 3,
      bagAdjustDelta: 3,
      balanceDelta: 6,
    });
  });

  it("computes bag balance and running balance from mixed entries", () => {
    const entries = [
      { id: 3, type: "adjust", quantity: -5, note: "ยกเลิกบิล #10" },
      { id: 2, type: "return", quantity: 2, note: null },
      { id: 1, type: "out", quantity: 10, note: null },
    ];

    expect(getBagBalanceFromEntries(entries)).toBe(3);

    const withRunning = withRunningBagBalance(entries);
    expect(withRunning.map((entry) => ({
      id: entry.id,
      balanceDelta: entry.balanceDelta,
      runningBalance: entry.runningBalance,
    }))).toEqual([
      { id: 3, balanceDelta: -5, runningBalance: 3 },
      { id: 2, balanceDelta: -2, runningBalance: 8 },
      { id: 1, balanceDelta: 10, runningBalance: 10 },
    ]);
  });

  it("reverses out, return, and signed adjust entries correctly", () => {
    expect(reverseBagLedgerEntry({ type: "out", quantity: 6 })).toEqual({
      type: "return",
      quantity: 6,
    });
    expect(reverseBagLedgerEntry({ type: "return", quantity: 4 })).toEqual({
      type: "out",
      quantity: 4,
    });
    expect(reverseBagLedgerEntry({ type: "adjust", quantity: -3 })).toEqual({
      type: "adjust",
      quantity: 3,
    });
  });

  it("exposes display delta matching the balance effect", () => {
    expect(getBagEntryBalanceDelta({ type: "out", quantity: 5 })).toBe(5);
    expect(getBagEntryBalanceDelta({ type: "return", quantity: 5 })).toBe(-5);
    expect(getBagEntryBalanceDelta({ type: "adjust", quantity: -5 })).toBe(-5);
  });

  it("converts signed bag summaries into invoice-friendly display columns", () => {
    expect(
      getBagDisplayQuantities({
        bagsOut: 10,
        bagsReturned: 2,
        bagsBought: 3,
        bagAdjustDelta: -4,
      })
    ).toEqual({
      bagsOut: 6,
      bagsReturned: 5,
    });

    expect(
      getBagDisplayQuantities({
        bagsOut: 0,
        bagsReturned: 0,
        bagsBought: 0,
        bagAdjustDelta: 6,
      })
    ).toEqual({
      bagsOut: 6,
      bagsReturned: 0,
    });
  });

  it("nets returned-item bag reversals back out of the bags-out column", () => {
    expect(
      getBagDisplayQuantities({
        bagsOut: 0,
        bagsReturned: 0,
        bagsBought: 0,
        bagAdjustDelta: -254,
      })
    ).toEqual({
      bagsOut: -254,
      bagsReturned: 0,
    });
  });

  it("simulates sale then refund of the same bagged items and buy-bags back to zero", () => {
    const saleSummary = summarizeSaleBagFlow({
      items: [
        { quantity: 10, productType: { hasBag: true, decreasesBag: false } },
        { quantity: 3, productType: { hasBag: false, decreasesBag: true } },
      ],
      manualBagReturnQty: 0,
    });
    const refundSummary = summarizeRefundBagFlow({
      items: [
        { quantity: 10, productType: { hasBag: true, decreasesBag: false } },
        { quantity: 3, productType: { hasBag: false, decreasesBag: true } },
      ],
      manualBagReturnQty: 0,
    });

    const entries = [
      ...buildBagLedgerWrites(saleSummary),
      ...buildBagLedgerWrites(refundSummary, { adjustNote: buildRefundBagAdjustNote(101) }),
    ];

    expect(saleSummary.balanceDelta).toBe(7);
    expect(refundSummary.balanceDelta).toBe(-7);
    expect(getBagBalanceFromEntries(entries)).toBe(0);
  });

  it("simulates refund plus extra manual bag return as separate effects", () => {
    const refundSummary = summarizeRefundBagFlow({
      items: [
        { quantity: 6, productType: { hasBag: true, decreasesBag: false } },
      ],
      manualBagReturnQty: 2,
    });

    const writes = buildBagLedgerWrites(refundSummary, {
      adjustNote: buildRefundBagAdjustNote(202),
      manualReturnNote: "คืนสินค้า อ้างอิงบิล #202",
    });

    expect(refundSummary.balanceDelta).toBe(-8);
    expect(writes).toEqual([
      { type: "return", quantity: 2, note: "คืนสินค้า อ้างอิงบิล #202" },
      { type: "adjust", quantity: -6, note: "ยกเลิกบิล #202" },
    ]);
    expect(getBagBalanceFromEntries(writes)).toBe(-8);
  });

  it("simulates voiding a refund with signed adjustments and restores the previous balance", () => {
    const refundWrites = buildBagLedgerWrites(
      summarizeRefundBagFlow({
        items: [
          { quantity: 8, productType: { hasBag: true, decreasesBag: false } },
          { quantity: 2, productType: { hasBag: false, decreasesBag: true } },
        ],
        manualBagReturnQty: 1,
      }),
      {
        adjustNote: buildRefundBagAdjustNote(303),
        manualReturnNote: "คืนสินค้า อ้างอิงบิล #303",
      }
    );

    const voidWrites = refundWrites.map((entry) => ({
      ...reverseBagLedgerEntry(entry),
      note: "ยกเลิกบิล #404",
    }));

    expect(getBagBalanceFromEntries(refundWrites)).toBe(-7);
    expect(getBagBalanceFromEntries([...refundWrites, ...voidWrites])).toBe(0);
  });
});
