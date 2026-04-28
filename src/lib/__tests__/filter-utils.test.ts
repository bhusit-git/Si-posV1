import { describe, expect, it } from "vitest";
import {
  isInTimeWindowInclusive,
  isValidDateRange,
  matchesCustomerQuery,
  matchesTransactionSearchQuery,
  normalizeTimeInput,
  parseCustomerQuery,
  parseTransactionSearchQuery,
} from "@/lib/filter-utils";

describe("filter-utils", () => {
  it("parses customer id queries", () => {
    expect(parseCustomerQuery("123")).toMatchObject({
      customerId: 123,
      customerIds: [123],
    });
    expect(parseCustomerQuery("#123")).toMatchObject({
      customerId: 123,
      customerIds: [123],
    });
    expect(parseCustomerQuery("  #77 ")).toMatchObject({
      customerId: 77,
      customerIds: [77],
    });
  });

  it("parses comma-separated customer ids", () => {
    expect(parseCustomerQuery("101, 102, #103")).toMatchObject({
      customerId: 101,
      customerIds: [101, 102, 103],
      customerNameQuery: null,
    });
  });

  it("deduplicates repeated customer ids", () => {
    expect(parseCustomerQuery("#77, 77, #77")).toMatchObject({
      customerId: 77,
      customerIds: [77],
    });
  });

  it("parses customer name queries", () => {
    const parsed = parseCustomerQuery("vat store");
    expect(parsed.customerId).toBeNull();
    expect(parsed.customerIds).toEqual([]);
    expect(parsed.customerNameQuery).toBe("vat store");
  });

  it("falls back to the existing single-query behavior for mixed comma input", () => {
    const parsed = parseCustomerQuery("101, Alpha");
    expect(parsed.customerId).toBeNull();
    expect(parsed.customerIds).toEqual([]);
    expect(parsed.customerNameQuery).toBe("101, alpha");
  });

  it("matches customer id and name consistently", () => {
    expect(matchesCustomerQuery(123, "Alpha Co", "123")).toBe(true);
    expect(matchesCustomerQuery(123, "Alpha Co", "#123")).toBe(true);
    expect(matchesCustomerQuery(123, "Alpha Co", "#123, #456")).toBe(true);
    expect(matchesCustomerQuery(456, "Beta Co", "#123, #456")).toBe(true);
    expect(matchesCustomerQuery(789, "Gamma Co", "#123, #456")).toBe(false);
    expect(matchesCustomerQuery(456, "Alpha Co", "alpha")).toBe(true);
    expect(matchesCustomerQuery(456, "Alpha Co", "beta")).toBe(false);
  });

  it("treats exact 4-digit searches as bill-number-only lookups", () => {
    expect(parseTransactionSearchQuery("0042")).toMatchObject({
      printedBillNumber: 42,
      customerQuery: {
        customerId: null,
        customerIds: [],
      },
    });

    expect(parseTransactionSearchQuery("42")).toMatchObject({
      printedBillNumber: null,
    });
  });

  it("matches transactions by printed bill number while keeping non-bill queries unchanged", () => {
    expect(
      matchesTransactionSearchQuery(
        {
          customerId: 999,
          customerName: "Alpha Co",
          printedBillNumber: 42,
        },
        "0042"
      )
    ).toBe(true);

    expect(
      matchesTransactionSearchQuery(
        {
          customerId: 42,
          customerName: "Beta Co",
          printedBillNumber: 7777,
        },
        "0042"
      )
    ).toBe(false);

    expect(
      matchesTransactionSearchQuery(
        {
          customerId: 999,
          customerName: "Gamma Co",
          printedBillNumber: 7777,
        },
        "0042"
      )
    ).toBe(false);

    expect(
      matchesTransactionSearchQuery(
        {
          customerId: 42,
          customerName: "Beta Co",
          printedBillNumber: 7777,
        },
        "42"
      )
    ).toBe(true);
  });

  it("validates date ranges", () => {
    expect(isValidDateRange("2026-02-01", "2026-02-28")).toBe(true);
    expect(isValidDateRange("2026-02-28", "2026-02-01")).toBe(false);
  });

  it("normalizes time and matches cross-midnight windows", () => {
    expect(normalizeTimeInput("08:30")).toBe("08:30:00");
    expect(isInTimeWindowInclusive("23:30:00", "22:00", "02:00")).toBe(true);
    expect(isInTimeWindowInclusive("01:30:00", "22:00", "02:00")).toBe(true);
    expect(isInTimeWindowInclusive("12:00:00", "22:00", "02:00")).toBe(false);
  });
});
