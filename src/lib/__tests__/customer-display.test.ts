import { beforeEach, describe, expect, it } from "vitest";

import {
  formatCustomerDisplay,
  readShowCustomerIdWithName,
  writeShowCustomerIdWithName,
} from "@/lib/customer-display";

describe("customer display preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("defaults to true when no preference is stored", () => {
    expect(readShowCustomerIdWithName()).toBe(true);
  });

  it("reads and writes preference value", () => {
    writeShowCustomerIdWithName(false);
    expect(readShowCustomerIdWithName()).toBe(false);

    writeShowCustomerIdWithName(true);
    expect(readShowCustomerIdWithName()).toBe(true);
  });

  it("formats customer display with id when enabled", () => {
    expect(formatCustomerDisplay(123, "บริษัท A", true)).toBe("123 | บริษัท A");
  });

  it("formats customer display as name only when disabled", () => {
    expect(formatCustomerDisplay(123, "บริษัท A", false)).toBe("บริษัท A");
  });

  it("uses fallback id when id is missing", () => {
    expect(formatCustomerDisplay(null, "บริษัท A", true)).toBe("- | บริษัท A");
  });
});
