import type { ProductFamily } from "@/lib/types";

type CatalogCodeRange = {
  start: number;
  end: number;
};

export const CATALOG_CODE_RANGES: Record<ProductFamily, CatalogCodeRange> = {
  block: { start: 101, end: 199 },
  small_tube: { start: 201, end: 299 },
  large_tube: { start: 301, end: 399 },
  iceberg: { start: 401, end: 499 },
};

export function isCatalogCodeInFamilyRange(
  catalogCode: number,
  family: ProductFamily
): boolean {
  const range = CATALOG_CODE_RANGES[family];
  return catalogCode >= range.start && catalogCode <= range.end;
}

export function suggestNextCatalogCode(
  usedCodes: Iterable<number | null | undefined>,
  family: ProductFamily
): number | null {
  const range = CATALOG_CODE_RANGES[family];
  const codes = Array.from(usedCodes)
    .filter((code): code is number => Number.isInteger(code))
    .filter((code) => code >= range.start && code <= range.end)
    .sort((left, right) => left - right);

  let next = range.start;
  for (const code of codes) {
    if (code >= next) next = code + 1;
  }

  return next <= range.end ? next : null;
}
