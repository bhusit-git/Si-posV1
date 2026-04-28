import { describe, expect, it } from "vitest";

import { compareProductsByDisplayOrder } from "@/lib/product-order";
import type { ProductType } from "@/lib/types";

function buildProduct(overrides: Partial<ProductType>): ProductType {
  return {
    id: 1,
    name: "สินค้า",
    nameEn: null,
    hasBag: false,
    decreasesBag: false,
    isActive: true,
    sortOrder: 99,
    catalogCode: null,
    ...overrides,
  };
}

describe("compareProductsByDisplayOrder", () => {
  it("prefers catalog code before sort order", () => {
    const products = [
      buildProduct({ id: 1, name: "A", sortOrder: 1, catalogCode: 200 }),
      buildProduct({ id: 2, name: "B", sortOrder: 99, catalogCode: 12 }),
    ];

    const sorted = [...products].sort(compareProductsByDisplayOrder);

    expect(sorted.map((product) => product.id)).toEqual([2, 1]);
  });

  it("falls back to sort order when catalog code is missing", () => {
    const products = [
      buildProduct({ id: 1, name: "A", sortOrder: 2, catalogCode: null }),
      buildProduct({ id: 2, name: "B", sortOrder: 1, catalogCode: null }),
    ];

    const sorted = [...products].sort(compareProductsByDisplayOrder);

    expect(sorted.map((product) => product.id)).toEqual([2, 1]);
  });
});
