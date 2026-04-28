import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  getAvailableSaleEntryViewOptions,
  normalizeSaleEntryViewModeForSession,
  SALE_ENTRY_VIEW_MODE_KEY,
  loadInitialPrintMode,
  loadInitialSaleEntryViewMode,
} from "@/app/(dashboard)/sale/sale-page-utils";

describe("sale-page-utils storage resilience", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("loads persisted preferences when storage is healthy", () => {
    window.localStorage.setItem("superice-print-mode", "receipt");
    window.localStorage.setItem(SALE_ENTRY_VIEW_MODE_KEY, "bearing_bill");

    expect(loadInitialPrintMode()).toBe("receipt");
    expect(loadInitialSaleEntryViewMode()).toBe("bearing_bill");
  });

  it("falls back to safe defaults when storage reads throw", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });

    expect(loadInitialPrintMode()).toBe("none");
    expect(loadInitialSaleEntryViewMode()).toBe("default");
  });
});

describe("sale-page-utils view visibility", () => {
  it("shows Exact Bill View and Bearing Bill for Bearing managers", () => {
    expect(
      getAvailableSaleEntryViewOptions("manager", "bearing").map((option) => option.mode)
    ).toEqual(["exact_bill", "bearing_bill"]);
  });

  it("shows Exact Bill View and Bearing Bill for other Bearing roles too", () => {
    expect(
      getAvailableSaleEntryViewOptions("factory", "bearing").map((option) => option.mode)
    ).toEqual(["exact_bill", "bearing_bill"]);
  });

  it("keeps standard views for non-Bearing sessions", () => {
    expect(
      getAvailableSaleEntryViewOptions("manager", "si").map((option) => option.mode)
    ).toEqual(["default", "exact_bill"]);
  });

  it("normalizes disallowed saved modes to Exact Bill View for Bearing sessions", () => {
    expect(
      normalizeSaleEntryViewModeForSession("default", "manager", "bearing")
    ).toBe("exact_bill");
    expect(
      normalizeSaleEntryViewModeForSession("bearing_bill", "manager", "bearing")
    ).toBe("bearing_bill");
    expect(
      normalizeSaleEntryViewModeForSession("default", "factory", "bearing")
    ).toBe("exact_bill");
  });
});
