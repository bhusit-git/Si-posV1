import { describe, it, expect } from "vitest";

/**
 * Input validation edge cases.
 * Tests boundary values, malicious strings, parseInt gotchas,
 * date edge cases, negative quantities, and unicode handling.
 */

// ---- Input sanitization helpers (mirror route patterns) ----

function parseId(raw: string | null): number | null {
  if (!raw) return null;
  const parsed = parseInt(raw);
  if (isNaN(parsed)) return null;
  return parsed;
}

function isValidQuantity(qty: unknown): boolean {
  if (typeof qty !== "number") return false;
  if (!Number.isFinite(qty)) return false;
  if (qty < 0) return false;
  return true;
}

function isValidPrice(price: unknown): boolean {
  if (typeof price !== "number") return false;
  if (!Number.isFinite(price)) return false;
  if (price < 0) return false;
  return true;
}

function isValidDateString(date: string): boolean {
  // Expected: YYYY-MM-DD
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  // Construct a Date and verify the components match (catches overflow like Feb 30 → Mar 2)
  const parsed = new Date(y, m - 1, d);
  return (
    parsed.getFullYear() === y &&
    parsed.getMonth() === m - 1 &&
    parsed.getDate() === d
  );
}

function sanitizeName(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  return trimmed;
}

describe("Input Validation Edge Cases", () => {
  describe("boundary values", () => {
    it("parseInt with leading zeros", () => {
      expect(parseId("007")).toBe(7);
    });

    it("parseInt with trailing garbage", () => {
      // parseInt("123abc") returns 123 in JS -- potential injection
      expect(parseInt("123abc")).toBe(123);
      expect(parseId("123abc")).toBe(123);
    });

    it("parseInt with negative ID", () => {
      expect(parseId("-1")).toBe(-1);
      // Negative IDs should be caught by further validation
    });

    it("parseInt with float string", () => {
      expect(parseId("3.14")).toBe(3); // truncates decimal
    });

    it("parseInt with empty string", () => {
      expect(parseId("")).toBe(null);
    });

    it("parseInt with very large number", () => {
      expect(parseId("99999999999")).toBe(99999999999);
      // Beyond SQL int range -- should be caught by DB constraint
    });

    it("parseInt with hex string", () => {
      expect(parseInt("0xFF")).toBe(255);
      // parseInt without explicit radix auto-detects 0x prefix as hex
      expect(parseId("0xFF")).toBe(255);
    });

    it("parseInt with scientific notation", () => {
      expect(parseId("1e5")).toBe(1); // parseInt stops at 'e'
    });
  });

  describe("malicious strings", () => {
    it("SQL injection attempt in name", () => {
      const name = "'; DROP TABLE users; --";
      const sanitized = sanitizeName(name);
      // Our system uses parameterized queries, so this is safe
      // but the name itself is valid (non-empty after trim)
      expect(sanitized).toBe("'; DROP TABLE users; --");
    });

    it("XSS attempt in name", () => {
      const name = '<script>alert("xss")</script>';
      const sanitized = sanitizeName(name);
      // React auto-escapes, but the name passes validation
      expect(sanitized).toBe('<script>alert("xss")</script>');
    });

    it("null byte in string", () => {
      const name = "test\0inject";
      const sanitized = sanitizeName(name);
      expect(sanitized).not.toBeNull();
    });

    it("extremely long string (potential buffer overflow)", () => {
      const name = "a".repeat(10000);
      const sanitized = sanitizeName(name);
      expect(sanitized).not.toBeNull();
      expect(sanitized?.length).toBe(10000);
    });

    it("unicode control characters", () => {
      const name = "test\u200Binvisible\u200B";
      const sanitized = sanitizeName(name);
      expect(sanitized).not.toBeNull();
    });

    it("RTL override character", () => {
      const name = "test\u202Eevil";
      const sanitized = sanitizeName(name);
      expect(sanitized).not.toBeNull();
    });
  });

  describe("parseInt gotchas", () => {
    it("parseInt returns NaN for non-numeric strings", () => {
      expect(isNaN(parseInt("abc"))).toBe(true);
    });

    it("parseInt with radix matters", () => {
      expect(parseInt("10", 2)).toBe(2); // binary
      expect(parseInt("10", 8)).toBe(8); // octal
      expect(parseInt("10", 16)).toBe(16); // hex
    });

    it("Number() vs parseInt() on whitespace", () => {
      expect(parseInt("  42  ")).toBe(42);
      expect(Number("  42  ")).toBe(42);
      expect(parseInt("  ")).toBe(NaN);
      expect(Number("  ")).toBe(0); // Different!
    });

    it("parseFloat precision", () => {
      expect(parseFloat("0.1") + parseFloat("0.2")).not.toBe(0.3);
      expect(parseFloat("0.1") + parseFloat("0.2")).toBeCloseTo(0.3);
    });
  });

  describe("date edge cases", () => {
    it("valid ISO date", () => {
      expect(isValidDateString("2026-02-14")).toBe(true);
    });

    it("invalid month", () => {
      expect(isValidDateString("2026-13-01")).toBe(false);
    });

    it("invalid day", () => {
      expect(isValidDateString("2026-02-30")).toBe(false);
    });

    it("leap day on leap year", () => {
      expect(isValidDateString("2024-02-29")).toBe(true);
    });

    it("leap day on non-leap year", () => {
      expect(isValidDateString("2026-02-29")).toBe(false);
    });

    it("wrong format (DD-MM-YYYY)", () => {
      expect(isValidDateString("14-02-2026")).toBe(false);
    });

    it("wrong format (YYYY/MM/DD)", () => {
      expect(isValidDateString("2026/02/14")).toBe(false);
    });

    it("empty string", () => {
      expect(isValidDateString("")).toBe(false);
    });

    it("year 9999", () => {
      expect(isValidDateString("9999-12-31")).toBe(true);
    });

    it("year 0001 fails (JS Date treats years 0-99 as 1900s)", () => {
      // new Date(1, 0, 1) creates 1901-01-01, not 0001-01-01
      expect(isValidDateString("0001-01-01")).toBe(false);
    });
  });

  describe("negative quantities", () => {
    it("negative quantity is invalid for sales", () => {
      expect(isValidQuantity(-5)).toBe(false);
    });

    it("zero quantity is valid", () => {
      expect(isValidQuantity(0)).toBe(true);
    });

    it("NaN quantity is invalid", () => {
      expect(isValidQuantity(NaN)).toBe(false);
    });

    it("Infinity quantity is invalid", () => {
      expect(isValidQuantity(Infinity)).toBe(false);
    });

    it("string quantity is invalid", () => {
      expect(isValidQuantity("5")).toBe(false);
    });

    it("null quantity is invalid", () => {
      expect(isValidQuantity(null)).toBe(false);
    });

    it("fractional quantity is valid (ice can be weighed)", () => {
      expect(isValidQuantity(2.5)).toBe(true);
    });
  });

  describe("negative prices", () => {
    it("negative price is invalid", () => {
      expect(isValidPrice(-100)).toBe(false);
    });

    it("zero price is valid (free item)", () => {
      expect(isValidPrice(0)).toBe(true);
    });

    it("NaN price is invalid", () => {
      expect(isValidPrice(NaN)).toBe(false);
    });
  });

  describe("return quantity validation", () => {
    function validateReturnQty(
      returnQty: number,
      originalQty: number
    ): boolean {
      return returnQty > 0 && returnQty <= originalQty;
    }

    it("return quantity equal to original is valid", () => {
      expect(validateReturnQty(10, 10)).toBe(true);
    });

    it("return quantity less than original is valid", () => {
      expect(validateReturnQty(5, 10)).toBe(true);
    });

    it("return quantity exceeding original is invalid", () => {
      expect(validateReturnQty(11, 10)).toBe(false);
    });

    it("return quantity of 0 is invalid", () => {
      expect(validateReturnQty(0, 10)).toBe(false);
    });

    it("return quantity negative is invalid", () => {
      expect(validateReturnQty(-5, 10)).toBe(false);
    });

    it("return when original is 0", () => {
      expect(validateReturnQty(1, 0)).toBe(false);
    });
  });
});
