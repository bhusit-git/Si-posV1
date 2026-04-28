import {
  BEARING_BILL_SLOT_DEFINITIONS,
  DEFAULT_BILL_SLOT_DEFINITIONS,
  type FactoryBillSlotDefinition,
} from "@/lib/factory-profile";

export type SaleEntryViewMode = "default" | "exact_bill" | "bearing_bill";

export interface SaleEntryViewItem {
  productTypeId: number;
  productName: string;
}

export type BillSlotDefinition = FactoryBillSlotDefinition;

export interface BillSlotRow<T extends SaleEntryViewItem> {
  slot: BillSlotDefinition;
  item: T | null;
}

const BEARING_BILL_SLOT_ALIAS_INDEX = BEARING_BILL_SLOT_DEFINITIONS.map((slot) => ({
  slot,
  aliases: slotAliasSet(slot),
}));

const BUY_BAG_ALIASES = [
  "ซื้อกระสอบ",
  "buy bags",
  "buybags",
];

function normalizeForBillMatch(value: string): string {
  return (value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/ดล็ก/g, "เล็ก");
}

function slotAliasSet(slot: BillSlotDefinition): Set<string> {
  return new Set(slot.aliases.map((alias) => normalizeForBillMatch(alias)));
}

const BILL_SLOT_ALIAS_INDEX = DEFAULT_BILL_SLOT_DEFINITIONS.map((slot) => ({
  slot,
  aliases: slotAliasSet(slot),
}));

function getSlotAliasIndex(
  mode: Exclude<SaleEntryViewMode, "default"> = "exact_bill"
) {
  return mode === "bearing_bill" ? BEARING_BILL_SLOT_ALIAS_INDEX : BILL_SLOT_ALIAS_INDEX;
}

function getSlotDefinitions(
  mode: Exclude<SaleEntryViewMode, "default"> = "exact_bill"
): readonly BillSlotDefinition[] {
  return mode === "bearing_bill" ? BEARING_BILL_SLOT_DEFINITIONS : DEFAULT_BILL_SLOT_DEFINITIONS;
}

function isSlotMatch(
  slot: BillSlotDefinition,
  productName: string,
  mode: Exclude<SaleEntryViewMode, "default"> = "exact_bill"
): boolean {
  const normalized = normalizeForBillMatch(productName);
  const index = getSlotAliasIndex(mode).find((entry) => entry.slot.key === slot.key);
  if (!index) return false;
  return index.aliases.has(normalized);
}

export function getBillSlotDefinitions(
  mode: Exclude<SaleEntryViewMode, "default"> = "exact_bill"
): readonly BillSlotDefinition[] {
  return getSlotDefinitions(mode);
}

export function isBillSlotProductName(
  productName: string,
  mode: Exclude<SaleEntryViewMode, "default"> = "exact_bill"
): boolean {
  return getSlotDefinitions(mode).some((slot) => isSlotMatch(slot, productName, mode));
}

export function isBuyBagProductName(productName: string): boolean {
  const normalized = normalizeForBillMatch(productName);
  return BUY_BAG_ALIASES.some((alias) => normalizeForBillMatch(alias) === normalized);
}

export function buildBillRows<T extends SaleEntryViewItem>(
  items: readonly T[],
  mode: Exclude<SaleEntryViewMode, "default"> = "exact_bill"
): {
  rows: BillSlotRow<T>[];
  extraItems: T[];
} {
  const remaining = [...items];
  const usedProductIds = new Set<number>();

  const rows: BillSlotRow<T>[] = getSlotDefinitions(mode).map((slot) => {
    const idx = remaining.findIndex((item) => isSlotMatch(slot, item.productName, mode));
    if (idx === -1) return { slot, item: null };
    const [matched] = remaining.splice(idx, 1);
    usedProductIds.add(matched.productTypeId);
    return { slot, item: matched };
  });

  const extraItems = items.filter((item) => !usedProductIds.has(item.productTypeId));
  return { rows, extraItems };
}

export function buildExactBillRows<T extends SaleEntryViewItem>(items: readonly T[]): {
  rows: BillSlotRow<T>[];
  extraItems: T[];
} {
  return buildBillRows(items, "exact_bill");
}

export function parseSaleEntryViewMode(value: string | null): SaleEntryViewMode {
  if (value === "default" || value === "exact_bill" || value === "bearing_bill") return value;
  return "default";
}
