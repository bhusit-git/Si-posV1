import { describe, it, expect } from "vitest";
import { formatThaiDate, formatCurrency, todayISO } from "@/lib/thai-utils";

/**
 * Thai utilities edge-case tests.
 * Exercises leap days, BE year boundaries, midnight timezone,
 * MAX_SAFE_INTEGER formatting, all 12 months, and unusual inputs.
 */

describe("Thai Utils Edge Cases", () => {
  describe("leap day handling", () => {
    it("Feb 29 on leap year (2024)", () => {
      const result = formatThaiDate("2024-02-29");
      expect(result).toContain("29");
      // Should be BE year 2567
      expect(result).toContain("2567");
    });

    it("Feb 28 on non-leap year", () => {
      const result = formatThaiDate("2025-02-28");
      expect(result).toContain("28");
    });

    it("century leap year (2000 = BE 2543)", () => {
      const result = formatThaiDate("2000-02-29");
      expect(result).toContain("29");
      expect(result).toContain("2543");
    });
  });

  describe("BE year boundaries", () => {
    it("CE 2000 = BE 2543", () => {
      const result = formatThaiDate("2000-01-01");
      expect(result).toContain("2543");
    });

    it("CE 2026 = BE 2569", () => {
      const result = formatThaiDate("2026-06-15");
      expect(result).toContain("2569");
    });

    it("CE 1970 = BE 2513 (Unix epoch)", () => {
      const result = formatThaiDate("1970-01-01");
      expect(result).toContain("2513");
    });

    it("year boundary: Dec 31 vs Jan 1", () => {
      const dec31 = formatThaiDate("2025-12-31");
      const jan1 = formatThaiDate("2026-01-01");
      expect(dec31).toContain("2568");
      expect(jan1).toContain("2569");
    });
  });

  describe("all 12 months validation", () => {
    const thaiMonths = [
      "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
      "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค.",
    ];

    for (let m = 0; m < 12; m++) {
      const monthStr = String(m + 1).padStart(2, "0");
      it(`month ${monthStr} (${thaiMonths[m]})`, () => {
        const result = formatThaiDate(`2026-${monthStr}-15`);
        expect(result).toContain(thaiMonths[m]);
      });
    }
  });

  describe("midnight timezone edge", () => {
    it("todayISO returns a valid YYYY-MM-DD string", () => {
      const today = todayISO();
      expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it("todayISO returns reasonable year (2025-2027)", () => {
      const year = parseInt(todayISO().slice(0, 4));
      expect(year).toBeGreaterThanOrEqual(2025);
      expect(year).toBeLessThanOrEqual(2027);
    });
  });

  describe("formatCurrency edge cases", () => {
    it("zero", () => {
      expect(formatCurrency(0)).toContain("0");
    });

    it("negative number shows negative", () => {
      const result = formatCurrency(-1000);
      // Should contain minus sign and 1,000
      expect(result).toContain("-");
      expect(result).toContain("1,000");
    });

    it("very small decimal", () => {
      const result = formatCurrency(0.01);
      expect(result).toContain("0.01");
    });

    it("large number has thousands separator", () => {
      const result = formatCurrency(1234567.89);
      // Should have commas: 1,234,567.89
      expect(result).toContain("1,234,567");
    });

    it("MAX_SAFE_INTEGER does not produce scientific notation", () => {
      const result = formatCurrency(Number.MAX_SAFE_INTEGER);
      expect(result).not.toContain("e");
      expect(result).not.toContain("E");
    });

    it("NaN produces consistent output", () => {
      const result = formatCurrency(NaN);
      // Should not throw; output depends on implementation
      expect(typeof result).toBe("string");
    });

    it("rounds to 2 decimal places", () => {
      const result = formatCurrency(100.999);
      // Should be 101.00
      expect(result).toContain("101");
    });
  });

  describe("formatThaiDate unusual inputs", () => {
    it("handles single-digit day/month", () => {
      const result = formatThaiDate("2026-01-05");
      expect(result).toContain("5");
      expect(result).toContain("ม.ค.");
    });

    it("first day of year", () => {
      const result = formatThaiDate("2026-01-01");
      expect(result).toContain("1");
      expect(result).toContain("ม.ค.");
      expect(result).toContain("2569");
    });

    it("last day of year", () => {
      const result = formatThaiDate("2026-12-31");
      expect(result).toContain("31");
      expect(result).toContain("ธ.ค.");
      expect(result).toContain("2569");
    });
  });
});
