import { describe, expect, it } from "vitest";
import { PREPRINTED_BILL_TEST_FIELD_SPECS } from "@/lib/preprinted-bill-test-layout";

describe("preprinted-bill-test-layout", () => {
  it("uses stable ids for every draggable bill element", () => {
    const ids = PREPRINTED_BILL_TEST_FIELD_SPECS.map((field) => field.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        "customer",
        "date",
        "productQty1",
        "productQty6",
        "productAmount1",
        "productAmount6",
        "bagLabel1",
        "bagQty1",
        "bagQty4",
        "bagAmount1",
        "bagAmount4",
        "totalAmount",
        "time",
      ])
    );
  });

  it("allows amount and date fields to be width-edited in the layout editor", () => {
    const productAmount1 = PREPRINTED_BILL_TEST_FIELD_SPECS.find((field) => field.id === "productAmount1");
    const bagAmount1 = PREPRINTED_BILL_TEST_FIELD_SPECS.find((field) => field.id === "bagAmount1");
    const date = PREPRINTED_BILL_TEST_FIELD_SPECS.find((field) => field.id === "date");

    expect(productAmount1?.widthEditable).toBe(true);
    expect(bagAmount1?.widthEditable).toBe(true);
    expect(date?.widthEditable).toBe(true);
  });
});
