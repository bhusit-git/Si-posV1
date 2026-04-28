/**
 * Canonical product definitions for the SuperICE POS system.
 *
 * ID scheme:
 *   1-23   Current ice products
 *   41-56  Unified dry goods
 *   91-96  Legacy ice products (from original Access DB)
 *
 * Shared by: scripts/migrate-product-ids-pg.ts, api/migrate route
 */

export interface NewIceProduct {
  id: number;
  catalogCode: number;
  name: string;
  nameEn: string;
  hasBag: boolean;
  isActive: boolean;
  sortOrder: number;
  family: ProductFamily;
  form: ProductForm;
  packageType: ProductPackageType;
  sizeValue: number | null;
  sizeUnit: ProductSizeUnit | null;
  sizeLabel: string | null;
}

export type ProductFamily = "block" | "large_tube" | "small_tube" | "iceberg";
export type ProductForm = "standard" | "crushed";
export type ProductPackageType = "loose" | "returnable_bag" | "clear_bag" | "basket";
export type ProductSizeUnit = "piece" | "kg" | "basket";

export interface DryGood {
  id: number;
  catalogCode: number;
  name: string;
  decreasesBag?: boolean;
}

export interface LegacyIceProduct {
  accessEn: string;
  legacyName: string;
  name: string;
  nameEn: string;
  hasBag: boolean;
  newId: number;
}

export const NEW_ICE_PRODUCTS: NewIceProduct[] = [
  { id: 1, catalogCode: 101, name: "ซอง", nameEn: "Block", hasBag: false, isActive: true, sortOrder: 1, family: "block", form: "standard", packageType: "loose", sizeValue: 160, sizeUnit: "piece", sizeLabel: "160 ก้อน" },
  { id: 2, catalogCode: 103, name: "ซอง (กั๊ก)", nameEn: "Small Block", hasBag: false, isActive: true, sortOrder: 3, family: "block", form: "standard", packageType: "loose", sizeValue: 13, sizeUnit: "piece", sizeLabel: "13 ก้อน" },
  { id: 3, catalogCode: 104, name: "ซอง โม่", nameEn: "Crushed Block", hasBag: true, isActive: true, sortOrder: 4, family: "block", form: "crushed", packageType: "returnable_bag", sizeValue: 20, sizeUnit: "kg", sizeLabel: "20 กก." },
  { id: 4, catalogCode: 303, name: "หลอดใหญ่ โม่", nameEn: "Crushed Large Tube", hasBag: true, isActive: true, sortOrder: 9, family: "large_tube", form: "crushed", packageType: "returnable_bag", sizeValue: 20, sizeUnit: "kg", sizeLabel: "20 กก." },
  { id: 5, catalogCode: 202, name: "หลอดดล็ก โม่", nameEn: "Crushed Small Tube", hasBag: true, isActive: true, sortOrder: 14, family: "small_tube", form: "crushed", packageType: "returnable_bag", sizeValue: 20, sizeUnit: "kg", sizeLabel: "20 กก." },
  { id: 6, catalogCode: 301, name: "หลอดใหญ่ 20กก.", nameEn: "Large Tube 20kg", hasBag: true, isActive: true, sortOrder: 7, family: "large_tube", form: "standard", packageType: "returnable_bag", sizeValue: 20, sizeUnit: "kg", sizeLabel: "20 กก." },
  { id: 7, catalogCode: 201, name: "หลอดดล็ก 20กก.", nameEn: "Small Tube 20kg", hasBag: true, isActive: true, sortOrder: 13, family: "small_tube", form: "standard", packageType: "returnable_bag", sizeValue: 20, sizeUnit: "kg", sizeLabel: "20 กก." },
  { id: 8, catalogCode: 205, name: "แพ็ค 10", nameEn: "Pack 10", hasBag: true, isActive: true, sortOrder: 15, family: "small_tube", form: "standard", packageType: "returnable_bag", sizeValue: 10, sizeUnit: "kg", sizeLabel: "10 กก." },
  { id: 9, catalogCode: 306, name: "แพ็ค 20", nameEn: "Pack 20", hasBag: true, isActive: true, sortOrder: 10, family: "large_tube", form: "standard", packageType: "returnable_bag", sizeValue: 20, sizeUnit: "kg", sizeLabel: "20 กก." },
  { id: 10, catalogCode: 106, name: "ถุงใสป่น 20กก.", nameEn: "Crushed Clear Bag 20kg", hasBag: false, isActive: true, sortOrder: 6, family: "block", form: "crushed", packageType: "clear_bag", sizeValue: 20, sizeUnit: "kg", sizeLabel: "20 กก." },
  { id: 11, catalogCode: 105, name: "ถุงใสป่น 13กก.", nameEn: "Crushed Clear Bag 13kg", hasBag: false, isActive: true, sortOrder: 5, family: "block", form: "crushed", packageType: "clear_bag", sizeValue: 13, sizeUnit: "kg", sizeLabel: "13 กก." },
  { id: 12, catalogCode: 203, name: "ถุงใสหลอดเล็ก 13กก.", nameEn: "Small Tube Clear Bag 13kg", hasBag: false, isActive: true, sortOrder: 16, family: "small_tube", form: "standard", packageType: "clear_bag", sizeValue: 13, sizeUnit: "kg", sizeLabel: "13 กก." },
  { id: 13, catalogCode: 204, name: "ถุงใสหลอดเล็ก 20กก.", nameEn: "Small Tube Clear Bag 20kg", hasBag: false, isActive: true, sortOrder: 17, family: "small_tube", form: "standard", packageType: "clear_bag", sizeValue: 20, sizeUnit: "kg", sizeLabel: "20 กก." },
  { id: 14, catalogCode: 304, name: "ถุงใสหลอดใหญ่ 13กก.", nameEn: "Large Tube Clear Bag 13kg", hasBag: false, isActive: true, sortOrder: 11, family: "large_tube", form: "standard", packageType: "clear_bag", sizeValue: 13, sizeUnit: "kg", sizeLabel: "13 กก." },
  { id: 15, catalogCode: 305, name: "ถุงใสหลอดใหญ่ 20กก.", nameEn: "Large Tube Clear Bag 20kg", hasBag: false, isActive: true, sortOrder: 12, family: "large_tube", form: "standard", packageType: "clear_bag", sizeValue: 20, sizeUnit: "kg", sizeLabel: "20 กก." },
  { id: 16, catalogCode: 401, name: "Iceberg 1กก.ตะกร้า 20 ถุง", nameEn: "Iceberg Basket", hasBag: false, isActive: true, sortOrder: 18, family: "iceberg", form: "standard", packageType: "basket", sizeValue: 20, sizeUnit: "basket", sizeLabel: "1 กก. x 20 ถุง" },
  { id: 17, catalogCode: 402, name: "Iceberg ถุงฟ้า 1.5 นิ้ว 10กก.", nameEn: "Iceberg Blue Bag 1.5'", hasBag: false, isActive: true, sortOrder: 19, family: "iceberg", form: "standard", packageType: "clear_bag", sizeValue: 10, sizeUnit: "kg", sizeLabel: "10 กก." },
  { id: 18, catalogCode: 403, name: "Iceberg ถุงชมพู 1.3 นิ้ว 10กก.", nameEn: "Iceberg Pink Bag 1.3'", hasBag: false, isActive: true, sortOrder: 20, family: "iceberg", form: "standard", packageType: "clear_bag", sizeValue: 10, sizeUnit: "kg", sizeLabel: "10 กก." },
  { id: 19, catalogCode: 102, name: "ซอง (ครึ่ง)", nameEn: "Half-Block", hasBag: false, isActive: true, sortOrder: 2, family: "block", form: "standard", packageType: "loose", sizeValue: 80, sizeUnit: "piece", sizeLabel: "80 ก้อน" },
  { id: 20, catalogCode: 302, name: "หลอดใหญ่ 30kg", nameEn: "Large Tube 30kg", hasBag: true, isActive: true, sortOrder: 8, family: "large_tube", form: "standard", packageType: "returnable_bag", sizeValue: 30, sizeUnit: "kg", sizeLabel: "30 กก." },
  { id: 22, catalogCode: 107, name: "ซอง 2", nameEn: "Block 2", hasBag: false, isActive: true, sortOrder: 21, family: "block", form: "standard", packageType: "loose", sizeValue: null, sizeUnit: null, sizeLabel: null },
  { id: 23, catalogCode: 307, name: "แพ็ค 15", nameEn: "Pack 15", hasBag: true, isActive: false, sortOrder: 99, family: "large_tube", form: "standard", packageType: "returnable_bag", sizeValue: 15, sizeUnit: "kg", sizeLabel: "15 กก." },
];

export const DRY_GOODS: DryGood[] = [
  { id: 41, catalogCode: 901, name: "ซื้อกระสอบ", decreasesBag: true },
  { id: 42, catalogCode: 902, name: "กระสอบเปล่ารวม" },
  { id: 43, catalogCode: 903, name: "ค่าขนส่ง" },
  { id: 44, catalogCode: 904, name: "เงินมัดจำถุง" },
  { id: 45, catalogCode: 905, name: "ถัง" },
  { id: 46, catalogCode: 906, name: "ถุงแพ็คมือ" },
  { id: 47, catalogCode: 907, name: "ถุงแพ็คใส" },
  { id: 48, catalogCode: 908, name: "บิลขาย" },
  { id: 49, catalogCode: 909, name: "ผ้ากันเปื้อน" },
  { id: 50, catalogCode: 910, name: "ผ้าคลุม" },
  { id: 51, catalogCode: 911, name: "ผ้าใบ 3x5" },
  { id: 52, catalogCode: 912, name: "ผ้าใบ 4x6" },
  { id: 53, catalogCode: 913, name: "ผ้าใบ 4x7" },
  { id: 54, catalogCode: 914, name: "รองเท้าบูท" },
  { id: 55, catalogCode: 915, name: "หมวก" },
  { id: 56, catalogCode: 916, name: "ไอซ์เบิร์ก 1.1" },
];

export const LEGACY_ICE: LegacyIceProduct[] = [
  { accessEn: "Pack", legacyName: "แพ็ค", name: "ซอง", nameEn: "Pack", hasBag: false, newId: 91 },
  { accessEn: "Unit", legacyName: "หลอดใหญ่", name: "แพ็ค", nameEn: "Large Tube", hasBag: true, newId: 92 },
  { accessEn: "Bare", legacyName: "เกล็ด", name: "หลอดใหญ่", nameEn: "Bare", hasBag: true, newId: 93 },
  { accessEn: "Unit30", legacyName: "หลอด 30", name: "หลอดดล็ก โม่", nameEn: "Unit30", hasBag: true, newId: 94 },
  { accessEn: "Crack", legacyName: "บด", name: "หลอดใหญ่ โม่", nameEn: "Crack", hasBag: true, newId: 95 },
  { accessEn: "UnitSmall", legacyName: "หลอดเล็ก", name: "หลอดเล็ก", nameEn: "UnitSmall", hasBag: true, newId: 96 },
];

export const LEGACY_BY_ID = new Map(LEGACY_ICE.map((l) => [l.newId, l]));
export const LEGACY_BY_NAME = new Map(LEGACY_ICE.map((l) => [l.legacyName, l]));
export const LEGACY_BY_ACCESS_EN = new Map(LEGACY_ICE.map((l) => [l.accessEn, l]));
export const NEW_ICE_BY_ID = new Map(NEW_ICE_PRODUCTS.map((p) => [p.id, p]));
export const DRY_BY_NAME = new Map(DRY_GOODS.map((d) => [d.name, d]));
export const NEW_ICE_BY_NAME = new Map(NEW_ICE_PRODUCTS.map((p) => [p.name, p]));

export const ALL_FINAL_IDS = new Set([
  ...NEW_ICE_PRODUCTS.map((p) => p.id),
  ...DRY_GOODS.map((d) => d.id),
  ...LEGACY_ICE.map((l) => l.newId),
]);

export const FK_TABLES = [
  "transaction_items",
  "customer_prices",
  "bag_ledger",
  "production_logs",
] as const;

export const FK_COL = "product_type_id";
export const TEMP_OFFSET = 10000;
export const BEARING_SYNC_PRESERVED_IDS = [91, 92, 93, 94, 95, 96] as const;
