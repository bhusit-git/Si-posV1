import { describe, expect, it } from "vitest";
import {
  getInvoiceCreditEligibilityState,
  isActiveInvoiceCreditCustomer,
} from "@/lib/invoice-credit-rollout";

describe("invoice credit rollout", () => {
  it("uses only the saved transferCustomer flag for active eligibility", () => {
    expect(
      getInvoiceCreditEligibilityState({ id: 96, name: "XFER->BEARING", transferCustomer: false })
    ).toBe("none");
    expect(
      isActiveInvoiceCreditCustomer({ id: 96, name: "XFER->BEARING", transferCustomer: false })
    ).toBe(false);
    expect(
      getInvoiceCreditEligibilityState({ id: 96, name: "XFER->BEARING", transferCustomer: true })
    ).toBe("saved");
  });
});
