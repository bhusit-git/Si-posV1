import { afterEach, describe, expect, it, vi } from "vitest";
import { evaluateTransactionDateTimePolicy } from "@/lib/transaction-backdate";

describe("evaluateTransactionDateTimePolicy", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows admin backdate within 30 days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-02T03:00:00.000Z")); // 10:00 Bangkok

    const result = evaluateTransactionDateTimePolicy({
      saleDate: "2026-02-20",
      saleTime: "08:30:00",
      role: "admin",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.effectiveSaleDate).toBe("2026-02-20");
      expect(result.data.effectiveSaleTime).toBe("08:30:00");
      expect(result.data.isBackdated).toBe(true);
      expect(result.data.backdateMinutes).toBeGreaterThan(0);
    }
  });

  it("rejects future timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-02T03:00:00.000Z")); // 10:00 Bangkok

    const result = evaluateTransactionDateTimePolicy({
      saleDate: "2026-03-02",
      saleTime: "10:05:00",
      role: "admin",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(400);
    }
  });

  it("allows up to one minute of future clock skew", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-02T03:00:00.000Z")); // 10:00 Bangkok

    const result = evaluateTransactionDateTimePolicy({
      saleDate: "2026-03-02",
      saleTime: "10:01:00",
      role: "manager",
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.effectiveSaleDate).toBe("2026-03-02");
      expect(result.data.effectiveSaleTime).toBe("10:01:00");
    }
  });

  it("rejects older than 30 days", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-02T03:00:00.000Z")); // 10:00 Bangkok

    const result = evaluateTransactionDateTimePolicy({
      saleDate: "2026-01-20",
      saleTime: "09:00:00",
      role: "admin",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(400);
    }
  });

  it("blocks office backdate to previous date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-02T03:00:00.000Z")); // 10:00 Bangkok

    const result = evaluateTransactionDateTimePolicy({
      saleDate: "2026-03-01",
      saleTime: "23:30:00",
      role: "office",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.status).toBe(403);
    }
  });

  it("allows manager same-day entry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-02T03:00:00.000Z")); // 10:00 Bangkok

    const result = evaluateTransactionDateTimePolicy({
      saleDate: "2026-03-02",
      saleTime: "07:00:00",
      role: "manager",
    });

    expect(result.ok).toBe(true);
  });
});
