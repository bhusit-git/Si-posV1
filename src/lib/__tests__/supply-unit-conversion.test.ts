import { describe, expect, it } from "vitest";

import {
  convertDisplayQuantity,
  convertToBaseQuantity,
  formatBaseQuantityWithPack,
  formatSelectedQuantity,
  getMaxDisplayQuantity,
  hasPackUnit,
  normalizeQuantityUnit,
  parseQuantityUnit,
  parseWholeQuantity,
} from "@/lib/supply/unit-conversion";

describe("supply unit conversion", () => {
  it("detects when an item can be handled as a pack", () => {
    expect(hasPackUnit(1)).toBe(false);
    expect(hasPackUnit(12)).toBe(true);
  });

  it("normalizes quantity units from request payloads", () => {
    expect(normalizeQuantityUnit("pack")).toBe("pack");
    expect(normalizeQuantityUnit("base")).toBe("base");
    expect(normalizeQuantityUnit("unknown")).toBe("base");
  });

  it("validates quantity units strictly before normalization", () => {
    expect(parseQuantityUnit("pack")).toBe("pack");
    expect(parseQuantityUnit("base")).toBe("base");
    expect(parseQuantityUnit(undefined)).toBe("base");
    expect(parseQuantityUnit("packs")).toBeNull();
  });

  it("rejects fractional quantities", () => {
    expect(parseWholeQuantity(3)).toBe(3);
    expect(parseWholeQuantity("4")).toBe(4);
    expect(parseWholeQuantity(1.5)).toBeNull();
    expect(parseWholeQuantity("2.25")).toBeNull();
  });

  it("converts pack quantities into base units", () => {
    expect(convertToBaseQuantity(3, "pack", 12)).toBe(36);
    expect(convertToBaseQuantity(5, "base", 12)).toBe(5);
  });

  it("computes max quantity per selected display unit", () => {
    expect(getMaxDisplayQuantity(25, "base", 12)).toBe(25);
    expect(getMaxDisplayQuantity(25, "pack", 12)).toBe(2);
  });

  it("formats stock balances with their pack equivalent", () => {
    expect(formatBaseQuantityWithPack(24, "อัน", 12)).toBe("24 อัน (2 แพ็ค)");
    expect(formatBaseQuantityWithPack(18, "อัน", 12)).toBe("18 อัน (1.5 แพ็ค)");
    expect(formatBaseQuantityWithPack(8, "ขวด", 1)).toBe("8 ขวด");
  });

  it("formats selected request quantities in the chosen unit", () => {
    expect(formatSelectedQuantity(2, "pack", "อัน", 12)).toBe("2 แพ็ค (24 อัน)");
    expect(formatSelectedQuantity(5, "base", "อัน", 12)).toBe("5 อัน");
  });

  it("preserves equivalent quantity when switching units", () => {
    expect(convertDisplayQuantity(24, "base", "pack", 12)).toBe(2);
    expect(convertDisplayQuantity(2, "pack", "base", 12)).toBe(24);
    expect(convertDisplayQuantity(13, "base", "pack", 12)).toBe(1);
  });
});
