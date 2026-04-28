import { describe, expect, it } from "vitest";
import { mapTransactionToPreprintedBill } from "@/lib/preprinted-bill-mapper";

describe("preprinted-bill-mapper", () => {
  it("maps fixed lines and computes net bag from out-return-buy", () => {
    const result = mapTransactionToPreprintedBill({
      items: [
        { quantity: 795, subtotal: 7950, productType: { name: "ซอง", hasBag: true } },
        { quantity: 373, subtotal: 7460, productType: { name: "แพ็ค 20" } },
        { quantity: 3832, subtotal: 114960, productType: { name: "หลอดใหญ่ 20กก.", hasBag: true } },
        { quantity: 71, subtotal: 2130, productType: { name: "หลอดดล็ก โม่", hasBag: true } },
        { quantity: 479, subtotal: 14370, productType: { name: "หลอดใหญ่ โม่", hasBag: true } },
        { quantity: 1873, subtotal: 56190, productType: { name: "หลอดดล็ก 20กก.", hasBag: true } },
        { quantity: 13, subtotal: 130, productType: { name: "ซื้อกระสอบ", decreasesBag: true } },
        { quantity: 1, subtotal: 10, productType: { name: "แพ็ค 10" } },
        { quantity: 20, subtotal: 200, productType: { name: "ซื้อกระสอบ ไม่ติดตาม" } },
        { quantity: 2, subtotal: 80, productType: { name: "ค่าขนส่ง" } },
        { quantity: 1, subtotal: 50, productType: { name: "ค่าผ่อน" } },
        { quantity: 42, subtotal: 42, productType: { name: "ถุงแพ็คใส" } },
      ],
      bagLedgerEntries: [
        { type: "out", quantity: 6629, note: null },
        { type: "return", quantity: 53, note: null },
        { type: "return", quantity: 13, note: "ซื้อกระสอบ" },
      ],
    });

    expect(result.line1BlockIceQty).toBe(795);
    expect(result.line2Pack20Qty).toBe(373);
    expect(result.line3LargeTube20KgQty).toBe(3832);
    expect(result.line4SmallTubeCrushedQty).toBe(71);
    expect(result.line5LargeTubeCrushedQty).toBe(479);
    expect(result.line6SmallTube20KgQty).toBe(1873);
    expect(result.line7BuyBagsQty).toBe(13);
    expect(result.line8BagsOutQty).toBe(6629);
    expect(result.line9BagsReturnQty).toBe(53);
    expect(result.line10NetBagQty).toBe(6563);
    expect(result.line1BlockIceAmount).toBe(7950);
    expect(result.line2Pack20Amount).toBe(7460);
    expect(result.line3LargeTube20KgAmount).toBe(114960);
    expect(result.line4SmallTubeCrushedAmount).toBe(2130);
    expect(result.line5LargeTubeCrushedAmount).toBe(14370);
    expect(result.line6SmallTube20KgAmount).toBe(56190);
    expect(result.line7BuyBagsAmount).toBe(130);
    expect(result.extraDetailText).toContain("แพ็ค 10 1 (10.00)");
    expect(result.extraDetailText).toContain("ซื้อกระสอบ ไม่ติดตาม 20 (200.00)");
    expect(result.extraDetailText).toContain("ค่าขนส่ง 2 (80.00)");
    expect(result.extraDetailText).toContain("ค่าผ่อน 1 (50.00)");
    expect(result.extraDetailText).toContain("ถุงแพ็คใส 42 (42.00)");
  });

  it("routes non-line items into extra detail text", () => {
    const result = mapTransactionToPreprintedBill({
      items: [
        { quantity: 1, productType: { name: "แพ็ค 10" } },
        { quantity: 2, productType: { name: "ค่าขนส่ง" } },
        { quantity: 6, productType: { name: "ถุงแพ็คใส" } },
      ],
      bagLedgerEntries: [],
    });

    expect(result.extraDetailText).toContain("แพ็ค 10 1");
    expect(result.extraDetailText).toContain("ค่าขนส่ง 2");
    expect(result.extraDetailText).toContain("ถุงแพ็คใส 6");
  });

  it("prefers explicit bag balance after when provided for printed carry-forward totals", () => {
    const result = mapTransactionToPreprintedBill({
      items: [
        { quantity: 5, subtotal: 50, productType: { name: "ซอง", hasBag: true } },
      ],
      bagLedgerEntries: [
        { type: "out", quantity: 5, note: null },
        { type: "return", quantity: 2, note: null },
      ],
      bagBalanceAfter: 55,
    });

    expect(result.line8BagsOutQty).toBe(5);
    expect(result.line9BagsReturnQty).toBe(2);
    expect(result.line10NetBagQty).toBe(55);
  });

  it("does not classify refund adjustments as manual bag returns", () => {
    const result = mapTransactionToPreprintedBill({
      items: [],
      bagLedgerEntries: [
        { type: "adjust", quantity: -5, note: "ยกเลิกบิล #88" },
        { type: "return", quantity: 2, note: "ซื้อกระสอบ" },
      ],
      bagBalanceAfter: 40,
    });

    expect(result.line7BuyBagsQty).toBe(2);
    expect(result.line8BagsOutQty).toBe(0);
    expect(result.line9BagsReturnQty).toBe(0);
    expect(result.line10NetBagQty).toBe(40);
  });
});
