import { describe, expect, it } from "vitest";

import {
  applyFactorySalePricingPolicy,
  getFactoryBehaviorProfile,
  getFactoryDefaultPrintLayoutOffset,
  getFactoryInvoiceStartSeq,
  getFactoryPrintLabel,
  getFactorySalePricingAuditDetailKey,
  getFactorySalePricingPolicy,
  supportsFactoryFeature,
  resolveEffectiveUnitPrice,
  supportsBearingBillView,
} from "@/lib/factory-profile";

function updateTieredSaleItem(params: {
  factoryKey: string | null;
  customerId: number;
  productTypeId: number;
  productCatalogCode: number | null;
  baseUnitPrice: number;
  quantity: number;
}) {
  const unitPrice = resolveEffectiveUnitPrice({
    factoryKey: params.factoryKey,
    customerId: params.customerId,
    productTypeId: params.productTypeId,
    productCatalogCode: params.productCatalogCode,
    quantity: params.quantity,
    baseUnitPrice: params.baseUnitPrice,
  });

  return {
    quantity: params.quantity,
    unitPrice,
    subtotal: params.quantity * unitPrice,
  };
}

describe("Bearing factory profile", () => {
  it("returns canonical profile data for known factories", () => {
    expect(getFactoryBehaviorProfile("bearing")).toEqual(
      expect.objectContaining({
        key: "bearing",
        canonicalKey: "bearing",
        printLabel: "BR",
      })
    );
    expect(getFactoryBehaviorProfile("si")).toEqual(
      expect.objectContaining({
        key: "si",
        canonicalKey: "si",
        printLabel: "SI",
      })
    );
    expect(getFactoryBehaviorProfile("ktk")).toEqual(
      expect.objectContaining({
        key: "ktk",
        canonicalKey: "ktk",
        printLabel: "KTK",
      })
    );
  });

  it("falls back cleanly for unknown factories", () => {
    expect(getFactoryBehaviorProfile("demo")).toEqual(
      expect.objectContaining({
        key: "demo",
        canonicalKey: null,
        printLabel: "DEM",
      })
    );
  });

  it("enables the special bill view only for the Bearing factory", () => {
    expect(supportsBearingBillView("bearing")).toBe(true);
    expect(supportsBearingBillView("si")).toBe(false);
    expect(supportsBearingBillView(null)).toBe(false);
  });

  it("resolves print labels through the profile layer", () => {
    expect(getFactoryPrintLabel("si")).toBe("SI");
    expect(getFactoryPrintLabel("bearing")).toBe("BR");
    expect(getFactoryPrintLabel("ktk")).toBe("KTK");
    expect(getFactoryPrintLabel("demo")).toBe("DEM");
  });

  it("preserves per-factory print offset defaults", () => {
    expect(getFactoryDefaultPrintLayoutOffset("si")).toEqual({ x: 0, y: 2 });
    expect(getFactoryDefaultPrintLayoutOffset("bearing")).toEqual({ x: 0, y: 0 });
    expect(getFactoryDefaultPrintLayoutOffset("demo")).toEqual({ x: 0, y: 0 });
  });

  it("preserves invoice sequence overrides and default fallback", () => {
    expect(getFactoryInvoiceStartSeq("si", 2026)).toBe(1732);
    expect(getFactoryInvoiceStartSeq("si", 2025)).toBe(1);
    expect(getFactoryInvoiceStartSeq("bearing", 2026)).toBe(1);
  });

  it("exposes bearing report/audit behavior via selectors", () => {
    expect(supportsFactoryFeature("bearing", "bearingDiscountsReport")).toBe(true);
    expect(supportsFactoryFeature("si", "bearingDiscountsReport")).toBe(false);
    expect(getFactorySalePricingAuditDetailKey("bearing")).toBe("bearingDiscount");
    expect(getFactorySalePricingAuditDetailKey("si")).toBeNull();
  });
});

describe("Bearing tier pricing", () => {
  it("uses the base band price for 1-5 bags", () => {
    expect(
      resolveEffectiveUnitPrice({
        factoryKey: "bearing",
        customerId: 96,
        productTypeId: 3,
        productCatalogCode: 104,
        quantity: 5,
        baseUnitPrice: 200,
      })
    ).toBe(40);
  });

  it("uses cumulative pricing for 6-10 bags", () => {
    expect(
      resolveEffectiveUnitPrice({
        factoryKey: "bearing",
        customerId: 96,
        productTypeId: 3,
        productCatalogCode: 104,
        quantity: 10,
        baseUnitPrice: 200,
      })
    ).toBeCloseTo(350 / 10, 6);
  });

  it("uses cumulative pricing for 11-15 bags", () => {
    expect(
      resolveEffectiveUnitPrice({
        factoryKey: "bearing",
        customerId: 96,
        productTypeId: 3,
        productCatalogCode: 104,
        quantity: 15,
        baseUnitPrice: 200,
      })
    ).toBeCloseTo(450 / 15, 6);
  });

  it("uses cumulative pricing for 16-20 bags", () => {
    expect(
      resolveEffectiveUnitPrice({
        factoryKey: "bearing",
        customerId: 96,
        productTypeId: 3,
        productCatalogCode: 104,
        quantity: 20,
        baseUnitPrice: 200,
      })
    ).toBeCloseTo(540 / 20, 6);
  });

  it("reaches a 25 average by 25 bags and stays there after that", () => {
    expect(
      resolveEffectiveUnitPrice({
        factoryKey: "bearing",
        customerId: 96,
        productTypeId: 3,
        productCatalogCode: 104,
        quantity: 25,
        baseUnitPrice: 200,
      })
    ).toBeCloseTo(625 / 25, 6);

    expect(
      resolveEffectiveUnitPrice({
        factoryKey: "bearing",
        customerId: 96,
        productTypeId: 3,
        productCatalogCode: 104,
        quantity: 30,
        baseUnitPrice: 200,
      })
    ).toBeCloseTo(750 / 30, 6);
  });

  it("falls back to the base price for other customers, products, or factories", () => {
    expect(
      resolveEffectiveUnitPrice({
        factoryKey: "si",
        customerId: 96,
        productTypeId: 3,
        productCatalogCode: 104,
        quantity: 5,
        baseUnitPrice: 200,
      })
    ).toBe(200);
    expect(
      resolveEffectiveUnitPrice({
        factoryKey: "bearing",
        customerId: 12,
        productTypeId: 3,
        productCatalogCode: 104,
        quantity: 5,
        baseUnitPrice: 200,
      })
    ).toBe(200);
    expect(
      resolveEffectiveUnitPrice({
        factoryKey: "bearing",
        customerId: 96,
        productTypeId: 1,
        productCatalogCode: 101,
        quantity: 5,
        baseUnitPrice: 200,
      })
    ).toBe(200);
  });
});

describe("Bearing tier pricing integration", () => {
  it("recalculates the sale item subtotal from the resolved tier price", () => {
    const result = updateTieredSaleItem({
      factoryKey: "bearing",
      customerId: 96,
      productTypeId: 3,
      productCatalogCode: 104,
      baseUnitPrice: 200,
      quantity: 12,
    });

    expect(result.quantity).toBe(12);
    expect(result.unitPrice).toBeCloseTo(390 / 12, 6);
    expect(result.subtotal).toBeCloseTo(390, 6);
  });

  it("lets the server normalize an incorrect submitted price before save", () => {
    const normalizedUnitPrice = resolveEffectiveUnitPrice({
      factoryKey: "bearing",
      customerId: 96,
      productTypeId: 3,
      productCatalogCode: 104,
      quantity: 7,
      baseUnitPrice: 999,
    });

    expect(normalizedUnitPrice).toBeCloseTo(260 / 7, 6);
  });

  it("keeps total pricing monotonic across the 10-to-11 boundary", () => {
    const qty10 = updateTieredSaleItem({
      factoryKey: "bearing",
      customerId: 96,
      productTypeId: 3,
      productCatalogCode: 104,
      baseUnitPrice: 200,
      quantity: 10,
    });
    const qty11 = updateTieredSaleItem({
      factoryKey: "bearing",
      customerId: 96,
      productTypeId: 3,
      productCatalogCode: 104,
      baseUnitPrice: 200,
      quantity: 11,
    });

    expect(qty10.subtotal).toBeCloseTo(350, 6);
    expect(qty11.subtotal).toBeCloseTo(370, 6);
    expect(qty11.subtotal).toBeGreaterThan(qty10.subtotal);
  });
});

describe("sale pricing policy selectors", () => {
  it("returns the Bearing pricing policy", () => {
    expect(getFactorySalePricingPolicy("bearing")).toEqual(
      expect.objectContaining({
        factoryKey: "bearing",
        minimumBillTotalExclusive: 1500,
        policyKey: "bearing_threshold_discount",
      })
    );
  });

  it("returns null for factories without a custom pricing rule", () => {
    expect(getFactorySalePricingPolicy("si")).toBeNull();
    expect(getFactorySalePricingPolicy("ktk")).toBeNull();
  });

  it("leaves prices unchanged when the factory has no pricing policy", () => {
    const result = applyFactorySalePricingPolicy({
      factoryKey: "si",
      items: [{ productTypeId: 1, quantity: 20, unitPrice: 140 }],
    });

    expect(result.applied).toBe(false);
    expect(result.baseSubtotal).toBe(2800);
    expect(result.effectiveSubtotal).toBe(2800);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        unitPrice: 140,
        subtotal: 2800,
        pricingAdjusted: false,
      })
    );
  });
});
