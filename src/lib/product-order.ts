import type { ProductType } from "@/lib/types";

const DEFAULT_PRODUCT_ORDER = Number.MAX_SAFE_INTEGER;

function normalizeCatalogCode(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : DEFAULT_PRODUCT_ORDER;
}

export function compareProductsByDisplayOrder(a: ProductType, b: ProductType): number {
  const aCatalogCode = normalizeCatalogCode(a.catalogCode);
  const bCatalogCode = normalizeCatalogCode(b.catalogCode);
  if (aCatalogCode !== bCatalogCode) return aCatalogCode - bCatalogCode;

  const aSortOrder = typeof a.sortOrder === "number" ? a.sortOrder : DEFAULT_PRODUCT_ORDER;
  const bSortOrder = typeof b.sortOrder === "number" ? b.sortOrder : DEFAULT_PRODUCT_ORDER;
  if (aSortOrder !== bSortOrder) return aSortOrder - bSortOrder;

  return (a.name || "").localeCompare(b.name || "", "th");
}
