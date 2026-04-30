export interface SupplyItemSettings {
  units: string[];
  categories: string[];
}

function normalizeList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];

  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const dedupeKey = trimmed.toLocaleLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalized.push(trimmed);
  }

  return normalized;
}

export function mergeSupplySettingOptions(...lists: Array<Array<string | null | undefined>>): string[] {
  return normalizeList(lists.flatMap((list) => list.filter((value): value is string => typeof value === "string")));
}

export function normalizeSupplyItemSettings(
  settings: Partial<SupplyItemSettings> | null | undefined
): SupplyItemSettings {
  return {
    units: normalizeList(settings?.units),
    categories: normalizeList(settings?.categories),
  };
}
