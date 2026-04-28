export interface SyncableProduct {
  id: number;
  name: string;
  name_en: string | null;
  has_bag: boolean;
  decreases_bag: boolean;
  is_active: boolean;
  sort_order: number;
  catalog_code: number | null;
  family: string | null;
  form: string | null;
  package_type: string | null;
  size_value: number | null;
  size_unit: string | null;
  size_label: string | null;
}

export interface ProductFieldChange {
  field: keyof Omit<SyncableProduct, "id">;
  source: string | number | boolean | null;
  target: string | number | boolean | null;
}

export interface ProductDiffEntry {
  id: number;
  kind: "insert" | "update" | "delete";
  source: SyncableProduct | null;
  target: SyncableProduct | null;
  changes: ProductFieldChange[];
}

export interface ProductSyncPlan {
  sourceCount: number;
  targetCount: number;
  inserts: ProductDiffEntry[];
  updates: ProductDiffEntry[];
  deletes: ProductDiffEntry[];
  affectedIds: number[];
  diffs: ProductDiffEntry[];
  matchesExactly: boolean;
}

export interface ProductReferenceCountRow {
  product_id: number;
  count: number;
}

export type ProductReferenceCounts = Record<string, ProductReferenceCountRow[]>;

export interface ReferencedProductDeleteEntry {
  id: number;
  diff: ProductDiffEntry;
  totalReferences: number;
  references: Array<{
    tableName: string;
    count: number;
  }>;
}

export interface ClassifiedProductSyncPlan {
  plan: ProductSyncPlan;
  deletes: ProductDiffEntry[];
  referencedDeletes: ReferencedProductDeleteEntry[];
  deactivations: ReferencedProductDeleteEntry[];
}

const PRODUCT_FIELDS: Array<keyof Omit<SyncableProduct, "id">> = [
  "name",
  "name_en",
  "has_bag",
  "decreases_bag",
  "is_active",
  "sort_order",
  "catalog_code",
  "family",
  "form",
  "package_type",
  "size_value",
  "size_unit",
  "size_label",
];

function toNullableString(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

function toBoolean(value: unknown): boolean {
  return value === true || value === "t" || value === "true" || value === 1 || value === "1";
}

function toNumber(value: unknown): number {
  return Number(value ?? 0);
}

export function normalizeSyncableProducts(
  rows: Iterable<Record<string, unknown>>
): SyncableProduct[] {
  return Array.from(rows)
    .map((row) => ({
      id: toNumber(row.id),
      name: String(row.name ?? ""),
      name_en: toNullableString(row.name_en ?? row.nameEn),
      has_bag: toBoolean(row.has_bag ?? row.hasBag),
      decreases_bag: toBoolean(row.decreases_bag ?? row.decreasesBag),
      is_active: toBoolean(row.is_active ?? row.isActive),
      sort_order: toNumber(row.sort_order ?? row.sortOrder),
      catalog_code:
        row.catalog_code == null && row.catalogCode == null
          ? null
          : toNumber(row.catalog_code ?? row.catalogCode),
      family: toNullableString(row.family),
      form: toNullableString(row.form),
      package_type: toNullableString(row.package_type ?? row.packageType),
      size_value:
        row.size_value == null && row.sizeValue == null
          ? null
          : toNumber(row.size_value ?? row.sizeValue),
      size_unit: toNullableString(row.size_unit ?? row.sizeUnit),
      size_label: toNullableString(row.size_label ?? row.sizeLabel),
    }))
    .sort((left, right) => left.id - right.id);
}

function buildFieldChanges(
  source: SyncableProduct,
  target: SyncableProduct
): ProductFieldChange[] {
  const changes: ProductFieldChange[] = [];
  for (const field of PRODUCT_FIELDS) {
    if (source[field] !== target[field]) {
      changes.push({
        field,
        source: source[field],
        target: target[field],
      });
    }
  }
  return changes;
}

export function buildProductSyncPlan(
  sourceRows: SyncableProduct[],
  targetRows: SyncableProduct[]
): ProductSyncPlan {
  const sourceById = new Map(sourceRows.map((row) => [row.id, row]));
  const targetById = new Map(targetRows.map((row) => [row.id, row]));

  const inserts: ProductDiffEntry[] = [];
  const updates: ProductDiffEntry[] = [];
  const deletes: ProductDiffEntry[] = [];

  for (const source of sourceRows) {
    const target = targetById.get(source.id);
    if (!target) {
      inserts.push({
        id: source.id,
        kind: "insert",
        source,
        target: null,
        changes: PRODUCT_FIELDS.map((field) => ({
          field,
          source: source[field],
          target: null,
        })),
      });
      continue;
    }

    const changes = buildFieldChanges(source, target);
    if (changes.length > 0) {
      updates.push({
        id: source.id,
        kind: "update",
        source,
        target,
        changes,
      });
    }
  }

  for (const target of targetRows) {
    if (!sourceById.has(target.id)) {
      deletes.push({
        id: target.id,
        kind: "delete",
        source: null,
        target,
        changes: PRODUCT_FIELDS.map((field) => ({
          field,
          source: null,
          target: target[field],
        })),
      });
    }
  }

  const diffs = [...inserts, ...updates, ...deletes].sort((left, right) => left.id - right.id);
  const affectedIds = diffs.map((diff) => diff.id);

  return {
    sourceCount: sourceRows.length,
    targetCount: targetRows.length,
    inserts,
    updates,
    deletes,
    affectedIds,
    diffs,
    matchesExactly: diffs.length === 0,
  };
}

export function classifyProductSyncPlan(
  plan: ProductSyncPlan,
  referenceCounts: ProductReferenceCounts
): ClassifiedProductSyncPlan {
  const deletes: ProductDiffEntry[] = [];
  const referencedDeletes: ReferencedProductDeleteEntry[] = [];

  for (const diff of plan.deletes) {
    const references = Object.entries(referenceCounts)
      .map(([tableName, rows]) => {
        const row = rows.find((candidate) => candidate.product_id === diff.id);
        return row && row.count > 0
          ? {
              tableName,
              count: row.count,
            }
          : null;
      })
      .filter((entry): entry is { tableName: string; count: number } => entry !== null);

    const totalReferences = references.reduce((sum, entry) => sum + entry.count, 0);
    if (totalReferences > 0) {
      referencedDeletes.push({
        id: diff.id,
        diff,
        totalReferences,
        references,
      });
      continue;
    }

    deletes.push(diff);
  }

  return {
    plan,
    deletes,
    referencedDeletes,
    deactivations: referencedDeletes.map((entry) => ({ ...entry })),
  };
}
