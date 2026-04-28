import { describe, it, expect } from "vitest";
import {
  formatThaiDate,
  formatThaiDateFull,
  formatThaiTime,
  formatCurrency,
  formatNumber,
  todayISO,
  formatThaiMonth,
  formatShortMonth,
  nowTimeISO,
} from "../thai-utils";

// ====================== formatThaiDate ======================
describe("formatThaiDate", () => {
  it("formats a standard date to Thai Buddhist Era", () => {
    // 2024-01-15 -> 15 ม.ค. 2567
    const result = formatThaiDate("2024-01-15");
    expect(result).toBe("15 ม.ค. 2567");
  });

  it("formats December correctly", () => {
    const result = formatThaiDate("2025-12-31");
    expect(result).toBe("31 ธ.ค. 2568");
  });

  it("formats February correctly", () => {
    const result = formatThaiDate("2026-02-14");
    expect(result).toBe("14 ก.พ. 2569");
  });

  it("returns '-' for empty string", () => {
    expect(formatThaiDate("")).toBe("-");
  });

  it("returns the original string for invalid date", () => {
    expect(formatThaiDate("not-a-date")).toBe("not-a-date");
  });

  it("handles month boundaries (Jan = index 0)", () => {
    const result = formatThaiDate("2023-01-01");
    expect(result).toBe("1 ม.ค. 2566");
  });

  it("handles month boundaries (Dec = index 11)", () => {
    const result = formatThaiDate("2023-12-01");
    expect(result).toBe("1 ธ.ค. 2566");
  });
});

// ====================== formatThaiDateFull ======================
describe("formatThaiDateFull", () => {
  it("formats a date to full Thai Buddhist Era", () => {
    const result = formatThaiDateFull("2024-06-15");
    expect(result).toBe("15 มิถุนายน พ.ศ. 2567");
  });

  it("returns '-' for empty string", () => {
    expect(formatThaiDateFull("")).toBe("-");
  });

  it("returns original string for invalid date", () => {
    expect(formatThaiDateFull("xyz")).toBe("xyz");
  });
});

// ====================== formatThaiTime ======================
describe("formatThaiTime", () => {
  it("formats HH:MM:SS to Thai format", () => {
    expect(formatThaiTime("14:30:00")).toBe("14:30 น.");
  });

  it("formats HH:MM (no seconds)", () => {
    expect(formatThaiTime("09:05")).toBe("09:05 น.");
  });

  it("returns '-' for empty string", () => {
    expect(formatThaiTime("")).toBe("-");
  });

  it("returns original for single segment", () => {
    expect(formatThaiTime("invalid")).toBe("invalid");
  });
});

// ====================== formatCurrency ======================
describe("formatCurrency", () => {
  it("formats a positive number with 2 decimal places", () => {
    expect(formatCurrency(1234.5)).toBe("1,234.50");
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("0.00");
  });

  it("formats negative numbers", () => {
    expect(formatCurrency(-500)).toBe("-500.00");
  });

  it("formats large numbers with commas", () => {
    expect(formatCurrency(1000000)).toBe("1,000,000.00");
  });

  it("formats fractional numbers", () => {
    expect(formatCurrency(99.99)).toBe("99.99");
  });
});

// ====================== formatNumber ======================
describe("formatNumber", () => {
  it("formats with commas", () => {
    expect(formatNumber(12345)).toBe("12,345");
  });

  it("formats zero", () => {
    expect(formatNumber(0)).toBe("0");
  });

  it("formats negative numbers", () => {
    expect(formatNumber(-1000)).toBe("-1,000");
  });
});

// ====================== todayISO ======================
describe("todayISO", () => {
  it("returns a YYYY-MM-DD string", () => {
    const result = todayISO();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns the correct date", () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(todayISO()).toBe(expected);
  });
});

// ====================== formatThaiMonth ======================
describe("formatThaiMonth", () => {
  it("formats YYYY-MM to Thai month with BE year", () => {
    expect(formatThaiMonth("2024-06")).toBe("มิถุนายน พ.ศ. 2567");
  });

  it("formats January", () => {
    expect(formatThaiMonth("2025-01")).toBe("มกราคม พ.ศ. 2568");
  });

  it("formats December", () => {
    expect(formatThaiMonth("2025-12")).toBe("ธันวาคม พ.ศ. 2568");
  });

  it("returns '-' for empty string", () => {
    expect(formatThaiMonth("")).toBe("-");
  });

  it("returns original for invalid format", () => {
    expect(formatThaiMonth("abc")).toBe("abc");
  });

  it("returns original for month out of range", () => {
    expect(formatThaiMonth("2024-13")).toBe("2024-13");
    expect(formatThaiMonth("2024-00")).toBe("2024-00");
  });
});

// ====================== formatShortMonth ======================
describe("formatShortMonth", () => {
  it("formats YYYY-MM to short Thai month + 2-digit BE year", () => {
    expect(formatShortMonth("2024-06")).toBe("มิ.ย. 67");
  });

  it("formats January 2025", () => {
    expect(formatShortMonth("2025-01")).toBe("ม.ค. 68");
  });

  it("returns '-' for empty string", () => {
    expect(formatShortMonth("")).toBe("-");
  });

  it("can parse full date strings", () => {
    // "2024-01-15" should also work via YYYY-MM parsing
    const result = formatShortMonth("2024-01-15");
    expect(result).toBe("ม.ค. 67");
  });
});

// ====================== nowTimeISO ======================
describe("nowTimeISO", () => {
  it("returns a HH:MM:SS string", () => {
    const result = nowTimeISO();
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });

  it("returns a time close to current time", () => {
    const before = new Date();
    const result = nowTimeISO();
    const after = new Date();

    const [h, m] = result.split(":").map(Number);
    expect(h).toBe(before.getHours());
    // minutes could tick over between calls, so accept either
    expect([before.getMinutes(), after.getMinutes()]).toContain(m);
  });
});
