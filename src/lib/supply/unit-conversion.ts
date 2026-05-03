export type SupplyQuantityUnit = "base" | "pack";

function toSafeInteger(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return 0;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function normalizePackSize(packSize: unknown): number {
  return Math.max(1, toSafeInteger(packSize));
}

export function hasPackUnit(packSize: unknown): boolean {
  return normalizePackSize(packSize) > 1;
}

export function parseQuantityUnit(value: unknown): SupplyQuantityUnit | null {
  if (value == null || value === "") return "base";
  if (value === "base" || value === "pack") return value;
  return null;
}

export function normalizeQuantityUnit(value: unknown): SupplyQuantityUnit {
  return parseQuantityUnit(value) ?? "base";
}

export function parseWholeQuantity(value: unknown): number | null {
  const parsed = toFiniteNumber(value);
  if (parsed == null || !Number.isInteger(parsed)) return null;
  return parsed;
}

export function convertToBaseQuantity(
  quantity: unknown,
  quantityUnit: SupplyQuantityUnit,
  packSize: unknown
): number {
  const safeQuantity = toSafeInteger(quantity);
  const safePackSize = normalizePackSize(packSize);

  if (quantityUnit === "pack") {
    return safeQuantity * safePackSize;
  }

  return safeQuantity;
}

export function calculateProjectedBaseBalance(
  currentBaseQuantity: unknown,
  enteredQuantity: unknown,
  quantityUnit: SupplyQuantityUnit,
  packSize: unknown
): number {
  const safeCurrentBaseQuantity = Math.max(0, toSafeInteger(currentBaseQuantity));
  const addedBaseQuantity = Math.max(0, convertToBaseQuantity(enteredQuantity, quantityUnit, packSize));
  return safeCurrentBaseQuantity + addedBaseQuantity;
}

export function getMaxDisplayQuantity(
  availableBaseQuantity: unknown,
  quantityUnit: SupplyQuantityUnit,
  packSize: unknown
): number {
  const safeAvailable = Math.max(0, toSafeInteger(availableBaseQuantity));
  const safePackSize = normalizePackSize(packSize);

  if (quantityUnit === "pack") {
    return Math.floor(safeAvailable / safePackSize);
  }

  return safeAvailable;
}

export function convertDisplayQuantity(
  quantity: unknown,
  fromUnit: SupplyQuantityUnit,
  toUnit: SupplyQuantityUnit,
  packSize: unknown
): number {
  const safePackSize = normalizePackSize(packSize);
  const baseQuantity = convertToBaseQuantity(quantity, fromUnit, safePackSize);
  if (toUnit === fromUnit) return Math.max(0, toSafeInteger(quantity));
  if (toUnit === "base") return baseQuantity;
  if (safePackSize <= 1) return baseQuantity;

  const exactPackQuantity = baseQuantity / safePackSize;
  if (Number.isInteger(exactPackQuantity)) {
    return exactPackQuantity;
  }

  return Math.max(1, Math.floor(exactPackQuantity));
}

export function formatPackUnitLabel(unit: string, packSize: unknown): string {
  return `แพ็ค (${normalizePackSize(packSize)} ${unit})`;
}

function formatPackCount(packCount: number): string {
  if (Number.isInteger(packCount)) return String(packCount);
  return packCount.toFixed(2).replace(/\.?0+$/, "");
}

export function formatBaseQuantityWithPack(
  quantity: unknown,
  unit: string,
  packSize: unknown
): string {
  const safeQuantity = Math.max(0, toSafeInteger(quantity));
  const safePackSize = normalizePackSize(packSize);

  if (safePackSize <= 1) {
    return `${safeQuantity} ${unit}`;
  }

  const packCount = safeQuantity / safePackSize;
  return `${safeQuantity} ${unit} (${formatPackCount(packCount)} แพ็ค)`;
}

export function formatSelectedQuantity(
  quantity: unknown,
  quantityUnit: SupplyQuantityUnit,
  unit: string,
  packSize: unknown
): string {
  const safeQuantity = Math.max(0, toSafeInteger(quantity));

  if (quantityUnit === "pack" && hasPackUnit(packSize)) {
    const baseQuantity = convertToBaseQuantity(safeQuantity, quantityUnit, packSize);
    return `${safeQuantity} แพ็ค (${baseQuantity} ${unit})`;
  }

  return `${safeQuantity} ${unit}`;
}
