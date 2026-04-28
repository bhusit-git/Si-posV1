import { FACTORY_CONFIGS, type FactoryDbKey } from "@/shared/db/runtime/factories";

export type BillSlotKey = "line1" | "line2" | "line3" | "line4" | "line5" | "line6";
export type FactorySaleEntryViewMode = "default" | "exact_bill" | "bearing_bill";
export type FactoryFeature = "bearingDiscountsReport";

export interface FactoryBillSlotDefinition {
  key: BillSlotKey;
  label: string;
  aliases: readonly string[];
}

export interface PrintLayoutOffset {
  x: number;
  y: number;
}

export interface FactorySaleEntryViewOption {
  mode: FactorySaleEntryViewMode;
  label: string;
}

export interface SalePricingPolicyItemInput {
  productTypeId: number;
  productCatalogCode?: number | null;
  catalogCode?: number | null;
  quantity: number;
  unitPrice: number;
}

export interface SalePricingPolicyDefinition {
  factoryKey: string;
  minimumBillTotalExclusive: number;
  discountedUnitPriceByCatalogCode: Readonly<Record<number, number>>;
  exemptCustomerIds: readonly number[];
  description: string;
  policyKey: string;
  auditDetailKey: string | null;
}

export type SalePricingPolicyAppliedItem<T extends SalePricingPolicyItemInput> = T & {
  unitPrice: number;
  subtotal: number;
  pricingBaseUnitPrice: number;
  pricingAdjusted: boolean;
};

export interface SalePricingPolicyEvaluation<T extends SalePricingPolicyItemInput> {
  applied: boolean;
  baseSubtotal: number;
  effectiveSubtotal: number;
  discountAmount: number;
  adjustedProductTypeIds: number[];
  description: string | null;
  items: Array<SalePricingPolicyAppliedItem<T>>;
}

export interface ResolveEffectiveUnitPriceParams {
  factoryKey: string | null | undefined;
  customerId: number | null | undefined;
  productTypeId?: number | null | undefined;
  productCatalogCode?: number | null | undefined;
  quantity: number;
  baseUnitPrice: number;
}

interface TieredUnitPriceBand {
  minQty: number;
  maxQty: number | null;
  unitPrice: number;
}

interface TieredUnitPriceRuleDefinition {
  customerId: number;
  productTypeId: number;
  productCatalogCode: number;
  bands: readonly TieredUnitPriceBand[];
}

export interface FactoryBehaviorProfile {
  key: string;
  canonicalKey: FactoryDbKey | null;
  printLabel: string;
  defaultPrintLayoutOffset: PrintLayoutOffset;
  saleEntryViewOptions: readonly FactorySaleEntryViewOption[];
  billSlotDefinitionsByMode: Readonly<
    Partial<Record<Exclude<FactorySaleEntryViewMode, "default">, readonly FactoryBillSlotDefinition[]>>
  >;
  features: Readonly<Partial<Record<FactoryFeature, boolean>>>;
  invoiceStartSequenceByYear: Readonly<Record<number, number>>;
  salePricingPolicy: SalePricingPolicyDefinition | null;
  tieredUnitPriceRules: readonly TieredUnitPriceRuleDefinition[];
}

const DEFAULT_PRINT_LAYOUT_OFFSET: PrintLayoutOffset = { x: 0, y: 0 };

export const DEFAULT_SALE_ENTRY_VIEW_OPTIONS = [
  { mode: "default", label: "Default View" },
  { mode: "exact_bill", label: "Exact Bill View" },
] as const satisfies readonly FactorySaleEntryViewOption[];

export const BEARING_SALE_ENTRY_VIEW_OPTIONS = [
  { mode: "exact_bill", label: "Exact Bill View" },
  { mode: "bearing_bill", label: "Bearing Bill" },
] as const satisfies readonly FactorySaleEntryViewOption[];

export const DEFAULT_BILL_SLOT_DEFINITIONS = [
  {
    key: "line1",
    label: "ซอง",
    aliases: ["ซอง", "น้ำแข็งซอง", "block ice", "blockice"],
  },
  {
    key: "line2",
    label: "แพ็ค 20",
    aliases: ["แพ็ค 20", "แพ็ค20", "pack 20", "pack20"],
  },
  {
    key: "line3",
    label: "หลอดใหญ่ 20กก.",
    aliases: ["หลอดใหญ่ 20กก.", "หลอดใหญ่20กก.", "large tube 20kg", "largetube20kg"],
  },
  {
    key: "line4",
    label: "หลอดเล็ก โม่",
    aliases: ["หลอดเล็ก โม่", "หลอดเล็กโม่", "หลอดดล็ก โม่", "หลอดดล็กโม่", "small tube crushed", "smalltubecrushed"],
  },
  {
    key: "line5",
    label: "หลอดใหญ่ โม่",
    aliases: ["หลอดใหญ่ โม่", "หลอดใหญ่โม่", "large tube crushed", "largetubecrushed"],
  },
  {
    key: "line6",
    label: "หลอดเล็ก 20กก.",
    aliases: ["หลอดเล็ก 20กก.", "หลอดเล็ก20กก.", "หลอดดล็ก 20กก.", "หลอดดล็ก20กก.", "small tube 20kg", "smalltube20kg"],
  },
] as const satisfies readonly FactoryBillSlotDefinition[];

export const BEARING_BILL_SLOT_DEFINITIONS = [
  {
    key: "line1",
    label: "ซอง โม่",
    aliases: ["ซอง โม่", "ซองโม่", "crushed block", "block crushed"],
  },
  {
    key: "line2",
    label: "แพ็ค 20",
    aliases: ["แพ็ค 20", "แพ็ค20", "pack 20", "pack20"],
  },
  {
    key: "line3",
    label: "หลอดใหญ่ 20กก.",
    aliases: ["หลอดใหญ่ 20กก.", "หลอดใหญ่20กก.", "large tube 20kg", "largetube20kg"],
  },
  {
    key: "line4",
    label: "หลอดเล็ก โม่",
    aliases: ["หลอดเล็ก โม่", "หลอดเล็กโม่", "หลอดดล็ก โม่", "หลอดดล็กโม่", "small tube crushed", "smalltubecrushed"],
  },
  {
    key: "line5",
    label: "หลอดใหญ่ โม่",
    aliases: ["หลอดใหญ่ โม่", "หลอดใหญ่โม่", "large tube crushed", "largetubecrushed"],
  },
  {
    key: "line6",
    label: "หลอดเล็ก 20กก.",
    aliases: ["หลอดเล็ก 20กก.", "หลอดเล็ก20กก.", "หลอดดล็ก 20กก.", "หลอดดล็ก20กก.", "small tube 20kg", "smalltube20kg"],
  },
] as const satisfies readonly FactoryBillSlotDefinition[];

const BEARING_104_TIER_BANDS = [
  { minQty: 1, maxQty: 5, unitPrice: 40 },
  { minQty: 6, maxQty: 10, unitPrice: 30 },
  { minQty: 11, maxQty: 15, unitPrice: 20 },
  { minQty: 16, maxQty: 20, unitPrice: 18 },
  { minQty: 21, maxQty: 25, unitPrice: 17 },
  { minQty: 26, maxQty: null, unitPrice: 25 },
] as const satisfies readonly TieredUnitPriceBand[];

const BEARING_THRESHOLD_DISCOUNT_POLICY: SalePricingPolicyDefinition = {
  factoryKey: "bearing",
  minimumBillTotalExclusive: 1500,
  discountedUnitPriceByCatalogCode: {
    101: 120,
    301: 22,
    201: 24,
  },
  exemptCustomerIds: [2, 3, 9, 42, 43, 96, 150],
  description: "Bearing bulk discount for bills above 1,500 baht",
  policyKey: "bearing_threshold_discount",
  auditDetailKey: "bearingDiscount",
};

const BASE_BEHAVIOR_PROFILE = {
  defaultPrintLayoutOffset: DEFAULT_PRINT_LAYOUT_OFFSET,
  saleEntryViewOptions: DEFAULT_SALE_ENTRY_VIEW_OPTIONS,
  billSlotDefinitionsByMode: {
    exact_bill: DEFAULT_BILL_SLOT_DEFINITIONS,
  },
  features: {},
  invoiceStartSequenceByYear: {},
  salePricingPolicy: null,
  tieredUnitPriceRules: [],
} as const;

const FACTORY_BEHAVIOR_PROFILES: Record<FactoryDbKey, FactoryBehaviorProfile> = {
  si: {
    ...BASE_BEHAVIOR_PROFILE,
    key: "si",
    canonicalKey: "si",
    printLabel: "SI",
    defaultPrintLayoutOffset: { x: 0, y: 2 },
    invoiceStartSequenceByYear: { 2026: 1732 },
  },
  bearing: {
    ...BASE_BEHAVIOR_PROFILE,
    key: "bearing",
    canonicalKey: "bearing",
    printLabel: "BR",
    saleEntryViewOptions: BEARING_SALE_ENTRY_VIEW_OPTIONS,
    billSlotDefinitionsByMode: {
      exact_bill: DEFAULT_BILL_SLOT_DEFINITIONS,
      bearing_bill: BEARING_BILL_SLOT_DEFINITIONS,
    },
    features: {
      bearingDiscountsReport: true,
    },
    salePricingPolicy: BEARING_THRESHOLD_DISCOUNT_POLICY,
    tieredUnitPriceRules: [
      {
        customerId: 96,
        productTypeId: 3,
        productCatalogCode: 104,
        bands: BEARING_104_TIER_BANDS,
      },
    ],
  },
  ktk: {
    ...BASE_BEHAVIOR_PROFILE,
    key: "ktk",
    canonicalKey: "ktk",
    printLabel: "KTK",
  },
};

const FACTORY_BEHAVIOR_PROFILE_MAP = new Map<string, FactoryBehaviorProfile>(
  FACTORY_CONFIGS.map((factory) => [factory.key, FACTORY_BEHAVIOR_PROFILES[factory.key]])
);

function normalizeFactoryKey(factoryKey: string | null | undefined): string {
  return String(factoryKey || "").trim().toLowerCase();
}

function buildFallbackPrintLabel(factoryKey: string): string {
  return factoryKey ? factoryKey.toUpperCase().slice(0, 3) : "";
}

function buildFallbackFactoryBehaviorProfile(factoryKey: string): FactoryBehaviorProfile {
  return {
    ...BASE_BEHAVIOR_PROFILE,
    key: factoryKey,
    canonicalKey: null,
    printLabel: buildFallbackPrintLabel(factoryKey),
  };
}

function toPositiveNumber(value: unknown): number {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return 0;
  return numericValue;
}

function resolveBaseUnitPrice(
  productTypeId: number,
  fallbackUnitPrice: number,
  baseUnitPriceByProductTypeId?: ReadonlyMap<number, number> | Readonly<Record<number, number>>
): number {
  if (!baseUnitPriceByProductTypeId) return fallbackUnitPrice;
  if (baseUnitPriceByProductTypeId instanceof Map) {
    return baseUnitPriceByProductTypeId.get(productTypeId) ?? fallbackUnitPrice;
  }
  const record = baseUnitPriceByProductTypeId as Readonly<Record<number, number>>;
  return record[productTypeId] ?? fallbackUnitPrice;
}

function computeCumulativeTierAverageUnitPrice(
  quantity: number,
  bands: readonly TieredUnitPriceBand[]
): number {
  let total = 0;
  let remaining = quantity;

  for (const band of bands) {
    if (remaining <= 0) break;
    const bandCapacity =
      band.maxQty === null ? remaining : Math.max(0, band.maxQty - band.minQty + 1);
    const unitsInBand = Math.min(remaining, bandCapacity);
    if (unitsInBand <= 0) continue;
    total += unitsInBand * band.unitPrice;
    remaining -= unitsInBand;
  }

  return total / quantity;
}

export function getFactoryBehaviorProfile(
  factoryKey: string | null | undefined
): FactoryBehaviorProfile {
  const normalizedFactoryKey = normalizeFactoryKey(factoryKey);
  return (
    FACTORY_BEHAVIOR_PROFILE_MAP.get(normalizedFactoryKey) ||
    buildFallbackFactoryBehaviorProfile(normalizedFactoryKey)
  );
}

export function getFactoryPrintLabel(factoryKey: string | null | undefined): string {
  return getFactoryBehaviorProfile(factoryKey).printLabel;
}

export function getFactoryDefaultPrintLayoutOffset(
  factoryKey: string | null | undefined
): PrintLayoutOffset {
  return getFactoryBehaviorProfile(factoryKey).defaultPrintLayoutOffset;
}

export function getFactorySaleEntryViewOptions(
  factoryKey: string | null | undefined
): readonly FactorySaleEntryViewOption[] {
  return getFactoryBehaviorProfile(factoryKey).saleEntryViewOptions;
}

export function getFactoryBillSlotDefinitions(
  factoryKey: string | null | undefined,
  mode: Exclude<FactorySaleEntryViewMode, "default">
): readonly FactoryBillSlotDefinition[] {
  const profile = getFactoryBehaviorProfile(factoryKey);
  return (
    profile.billSlotDefinitionsByMode[mode] ||
    BASE_BEHAVIOR_PROFILE.billSlotDefinitionsByMode.exact_bill
  );
}

export function supportsFactoryFeature(
  factoryKey: string | null | undefined,
  feature: FactoryFeature
): boolean {
  return Boolean(getFactoryBehaviorProfile(factoryKey).features[feature]);
}

export function getFactoryInvoiceStartSeq(
  factoryKey: string | null | undefined,
  year: number
): number {
  return getFactoryBehaviorProfile(factoryKey).invoiceStartSequenceByYear[year] ?? 1;
}

export function getFactorySalePricingPolicy(
  factoryKey: string | null | undefined
): SalePricingPolicyDefinition | null {
  return getFactoryBehaviorProfile(factoryKey).salePricingPolicy;
}

export function getFactorySalePricingAuditDetailKey(
  factoryKey: string | null | undefined
): string | null {
  return getFactorySalePricingPolicy(factoryKey)?.auditDetailKey ?? null;
}

export function supportsBearingBillView(factoryKey: string | null | undefined): boolean {
  return getFactorySaleEntryViewOptions(factoryKey).some((option) => option.mode === "bearing_bill");
}

export function resolveEffectiveUnitPrice({
  factoryKey,
  customerId,
  productTypeId,
  productCatalogCode,
  quantity,
  baseUnitPrice,
}: ResolveEffectiveUnitPriceParams): number {
  const profile = getFactoryBehaviorProfile(factoryKey);
  if (quantity <= 0) return baseUnitPrice;

  const matchingRule = profile.tieredUnitPriceRules.find(
    (rule) =>
      customerId === rule.customerId &&
      (productCatalogCode === rule.productCatalogCode || productTypeId === rule.productTypeId)
  );
  if (!matchingRule) return baseUnitPrice;

  return computeCumulativeTierAverageUnitPrice(quantity, matchingRule.bands);
}

export function applyFactorySalePricingPolicy<T extends SalePricingPolicyItemInput>(params: {
  factoryKey: string | null | undefined;
  customerId?: number | null | undefined;
  items: readonly T[];
  baseUnitPriceByProductTypeId?: ReadonlyMap<number, number> | Readonly<Record<number, number>>;
}): SalePricingPolicyEvaluation<T> {
  const policy = getFactorySalePricingPolicy(params.factoryKey);
  const isCustomerExempt =
    !!policy &&
    typeof params.customerId === "number" &&
    policy.exemptCustomerIds.includes(params.customerId);
  const normalizedItems = params.items.map((item) => {
    const quantity = toPositiveNumber(item.quantity);
    const baseUnitPrice = resolveBaseUnitPrice(
      item.productTypeId,
      Number(item.unitPrice || 0),
      params.baseUnitPriceByProductTypeId
    );

    return {
      item,
      quantity,
      baseUnitPrice,
      baseSubtotal: quantity * baseUnitPrice,
    };
  });

  const baseSubtotal = normalizedItems.reduce((sum, item) => sum + item.baseSubtotal, 0);
  const isPolicyActive =
    !!policy && !isCustomerExempt && baseSubtotal > policy.minimumBillTotalExclusive;

  const adjustedProductTypeIds = new Set<number>();
  const items = normalizedItems.map(({ item, quantity, baseUnitPrice }) => {
    const catalogCode =
      typeof item.productCatalogCode === "number"
        ? item.productCatalogCode
        : typeof item.catalogCode === "number"
          ? item.catalogCode
          : null;
    const discountedUnitPrice =
      catalogCode == null ? undefined : policy?.discountedUnitPriceByCatalogCode[catalogCode];
    const effectiveUnitPrice =
      isPolicyActive && discountedUnitPrice != null
        ? Math.min(baseUnitPrice, discountedUnitPrice)
        : Number(item.unitPrice || 0);
    const pricingAdjusted =
      isPolicyActive && discountedUnitPrice != null && effectiveUnitPrice !== baseUnitPrice;

    if (pricingAdjusted) {
      adjustedProductTypeIds.add(item.productTypeId);
    }

    return {
      ...item,
      unitPrice: effectiveUnitPrice,
      subtotal: quantity * effectiveUnitPrice,
      pricingBaseUnitPrice: baseUnitPrice,
      pricingAdjusted,
    };
  });

  const effectiveSubtotal = items.reduce((sum, item) => sum + item.subtotal, 0);

  return {
    applied: adjustedProductTypeIds.size > 0,
    baseSubtotal,
    effectiveSubtotal,
    discountAmount: Math.max(0, baseSubtotal - effectiveSubtotal),
    adjustedProductTypeIds: Array.from(adjustedProductTypeIds),
    description: isPolicyActive ? policy?.description ?? null : null,
    items,
  };
}
