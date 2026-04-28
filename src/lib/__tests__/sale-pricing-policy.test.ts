import { describe, expect, it } from "vitest";

import {
  applyFactorySalePricingPolicy,
  getFactorySalePricingPolicy,
} from "@/lib/sale-pricing-policy";

describe("getFactorySalePricingPolicy", () => {
  it("returns the Bearing pricing policy", () => {
    expect(getFactorySalePricingPolicy("bearing")).toEqual(
      expect.objectContaining({
        factoryKey: "bearing",
        minimumBillTotalExclusive: 1500,
      })
    );
  });

  it("returns null for factories without a custom pricing rule", () => {
    expect(getFactorySalePricingPolicy("si")).toBeNull();
    expect(getFactorySalePricingPolicy("ktk")).toBeNull();
  });
});

describe("applyFactorySalePricingPolicy", () => {
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

  it("does not apply the Bearing discount at exactly 1,500 baht", () => {
    const result = applyFactorySalePricingPolicy({
      factoryKey: "bearing",
      items: [{ productTypeId: 1, productCatalogCode: 101, quantity: 10, unitPrice: 150 }],
    });

    expect(result.applied).toBe(false);
    expect(result.baseSubtotal).toBe(1500);
    expect(result.effectiveSubtotal).toBe(1500);
  });

  it("applies the Bearing threshold discount above 1,500 baht by catalog code", () => {
    const result = applyFactorySalePricingPolicy({
      factoryKey: "bearing",
      items: [
        { productTypeId: 91, productCatalogCode: 101, quantity: 10, unitPrice: 140 },
        { productTypeId: 96, productCatalogCode: 301, quantity: 5, unitPrice: 26 },
        { productTypeId: 97, productCatalogCode: 201, quantity: 5, unitPrice: 28 },
      ],
    });

    expect(result.applied).toBe(true);
    expect(result.baseSubtotal).toBe(1670);
    expect(result.effectiveSubtotal).toBe(1430);
    expect(result.discountAmount).toBe(240);
    expect(result.adjustedProductTypeIds).toEqual([91, 96, 97]);
    expect(result.items.map((item) => item.unitPrice)).toEqual([120, 22, 24]);
  });

  it("does not apply the Bearing threshold discount for exempt customer 2", () => {
    const result = applyFactorySalePricingPolicy({
      factoryKey: "bearing",
      customerId: 2,
      items: [
        { productTypeId: 1, productCatalogCode: 101, quantity: 10, unitPrice: 140 },
        { productTypeId: 6, productCatalogCode: 301, quantity: 5, unitPrice: 26 },
        { productTypeId: 7, productCatalogCode: 201, quantity: 5, unitPrice: 28 },
      ],
    });

    expect(result.applied).toBe(false);
    expect(result.baseSubtotal).toBe(1670);
    expect(result.effectiveSubtotal).toBe(1670);
    expect(result.discountAmount).toBe(0);
    expect(result.adjustedProductTypeIds).toEqual([]);
    expect(result.items.map((item) => item.unitPrice)).toEqual([140, 26, 28]);
  });

  it("does not apply the Bearing threshold discount for exempt customer 3", () => {
    const result = applyFactorySalePricingPolicy({
      factoryKey: "bearing",
      customerId: 3,
      items: [
        { productTypeId: 1, productCatalogCode: 101, quantity: 10, unitPrice: 140 },
        { productTypeId: 6, productCatalogCode: 301, quantity: 5, unitPrice: 26 },
        { productTypeId: 7, productCatalogCode: 201, quantity: 5, unitPrice: 28 },
      ],
    });

    expect(result.applied).toBe(false);
    expect(result.baseSubtotal).toBe(1670);
    expect(result.effectiveSubtotal).toBe(1670);
    expect(result.discountAmount).toBe(0);
    expect(result.adjustedProductTypeIds).toEqual([]);
    expect(result.items.map((item) => item.unitPrice)).toEqual([140, 26, 28]);
  });

  it("does not apply the Bearing threshold discount for exempt customer 42", () => {
    const result = applyFactorySalePricingPolicy({
      factoryKey: "bearing",
      customerId: 42,
      items: [
        { productTypeId: 1, productCatalogCode: 101, quantity: 10, unitPrice: 140 },
        { productTypeId: 6, productCatalogCode: 301, quantity: 5, unitPrice: 26 },
        { productTypeId: 7, productCatalogCode: 201, quantity: 5, unitPrice: 28 },
      ],
    });

    expect(result.applied).toBe(false);
    expect(result.baseSubtotal).toBe(1670);
    expect(result.effectiveSubtotal).toBe(1670);
    expect(result.discountAmount).toBe(0);
    expect(result.adjustedProductTypeIds).toEqual([]);
    expect(result.items.map((item) => item.unitPrice)).toEqual([140, 26, 28]);
  });

  it("does not apply the Bearing threshold discount for exempt customer 43", () => {
    const result = applyFactorySalePricingPolicy({
      factoryKey: "bearing",
      customerId: 43,
      items: [
        { productTypeId: 1, productCatalogCode: 101, quantity: 10, unitPrice: 140 },
        { productTypeId: 6, productCatalogCode: 301, quantity: 5, unitPrice: 26 },
        { productTypeId: 7, productCatalogCode: 201, quantity: 5, unitPrice: 28 },
      ],
    });

    expect(result.applied).toBe(false);
    expect(result.baseSubtotal).toBe(1670);
    expect(result.effectiveSubtotal).toBe(1670);
    expect(result.discountAmount).toBe(0);
    expect(result.adjustedProductTypeIds).toEqual([]);
    expect(result.items.map((item) => item.unitPrice)).toEqual([140, 26, 28]);
  });

  it("does not apply the Bearing threshold discount for exempt customer 09", () => {
    const result = applyFactorySalePricingPolicy({
      factoryKey: "bearing",
      customerId: 9,
      items: [
        { productTypeId: 1, productCatalogCode: 101, quantity: 10, unitPrice: 140 },
        { productTypeId: 6, productCatalogCode: 301, quantity: 5, unitPrice: 26 },
        { productTypeId: 7, productCatalogCode: 201, quantity: 5, unitPrice: 28 },
      ],
    });

    expect(result.applied).toBe(false);
    expect(result.baseSubtotal).toBe(1670);
    expect(result.effectiveSubtotal).toBe(1670);
    expect(result.discountAmount).toBe(0);
    expect(result.adjustedProductTypeIds).toEqual([]);
    expect(result.items.map((item) => item.unitPrice)).toEqual([140, 26, 28]);
  });

  it("does not apply the Bearing threshold discount for exempt customer 96", () => {
    const result = applyFactorySalePricingPolicy({
      factoryKey: "bearing",
      customerId: 96,
      items: [
        { productTypeId: 1, productCatalogCode: 101, quantity: 10, unitPrice: 140 },
        { productTypeId: 6, productCatalogCode: 301, quantity: 5, unitPrice: 26 },
        { productTypeId: 7, productCatalogCode: 201, quantity: 5, unitPrice: 28 },
      ],
    });

    expect(result.applied).toBe(false);
    expect(result.baseSubtotal).toBe(1670);
    expect(result.effectiveSubtotal).toBe(1670);
    expect(result.discountAmount).toBe(0);
    expect(result.adjustedProductTypeIds).toEqual([]);
    expect(result.items.map((item) => item.unitPrice)).toEqual([140, 26, 28]);
  });

  it("does not apply the Bearing threshold discount for exempt customer 150", () => {
    const result = applyFactorySalePricingPolicy({
      factoryKey: "bearing",
      customerId: 150,
      items: [
        { productTypeId: 1, productCatalogCode: 101, quantity: 10, unitPrice: 140 },
        { productTypeId: 6, productCatalogCode: 301, quantity: 5, unitPrice: 26 },
        { productTypeId: 7, productCatalogCode: 201, quantity: 5, unitPrice: 28 },
      ],
    });

    expect(result.applied).toBe(false);
    expect(result.baseSubtotal).toBe(1670);
    expect(result.effectiveSubtotal).toBe(1670);
    expect(result.discountAmount).toBe(0);
    expect(result.adjustedProductTypeIds).toEqual([]);
    expect(result.items.map((item) => item.unitPrice)).toEqual([140, 26, 28]);
  });

  it("keeps customer 96 submitted special prices while skipping only the threshold discount", () => {
    const result = applyFactorySalePricingPolicy({
      factoryKey: "bearing",
      customerId: 96,
      items: [
        { productTypeId: 3, quantity: 50, unitPrice: 25 },
        { productTypeId: 1, productCatalogCode: 101, quantity: 10, unitPrice: 140 },
      ],
      baseUnitPriceByProductTypeId: new Map([
        [3, 200],
        [1, 140],
      ]),
    });

    expect(result.applied).toBe(false);
    expect(result.baseSubtotal).toBe(11400);
    expect(result.effectiveSubtotal).toBe(2650);
    expect(result.discountAmount).toBe(8750);
    expect(result.items.map((item) => item.unitPrice)).toEqual([25, 140]);
  });

  it("uses base customer prices to evaluate the threshold even when the submitted prices are already discounted", () => {
    const result = applyFactorySalePricingPolicy({
      factoryKey: "bearing",
      items: [
        { productTypeId: 1, productCatalogCode: 101, quantity: 10, unitPrice: 120 },
        { productTypeId: 6, productCatalogCode: 301, quantity: 5, unitPrice: 22 },
      ],
      baseUnitPriceByProductTypeId: new Map([
        [1, 140],
        [6, 26],
      ]),
    });

    expect(result.applied).toBe(true);
    expect(result.baseSubtotal).toBe(1530);
    expect(result.effectiveSubtotal).toBe(1310);
    expect(result.discountAmount).toBe(220);
  });

  it("never raises an already-lower customer price", () => {
    const result = applyFactorySalePricingPolicy({
      factoryKey: "bearing",
      items: [
        { productTypeId: 1, productCatalogCode: 101, quantity: 10, unitPrice: 115 },
        { productTypeId: 6, productCatalogCode: 301, quantity: 20, unitPrice: 26 },
      ],
    });

    expect(result.applied).toBe(true);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        unitPrice: 115,
        pricingAdjusted: false,
      })
    );
    expect(result.items[1]).toEqual(
      expect.objectContaining({
        unitPrice: 22,
        pricingAdjusted: true,
      })
    );
  });
});
