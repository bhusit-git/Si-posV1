import type postgres from "postgres";
import { FK_COL, FK_TABLES, LEGACY_ICE } from "@/lib/product-definitions";

export interface LegacyRenameSnapshotRow {
  id: number;
  name: string;
  name_en: string | null;
  has_bag: boolean;
  decreases_bag: boolean;
  is_active: boolean;
  sort_order: number | null;
}

export interface LegacyRenameProposal {
  id: number;
  legacyName: string;
  currentName: string | null;
  proposedName: string;
  nameEn: string;
  hasBag: boolean;
  needsChange: boolean;
}

export interface LegacyRenamePlan {
  ids: number[];
  proposals: LegacyRenameProposal[];
  missingIds: number[];
  changesNeeded: boolean;
}

export interface LegacyReferenceCount {
  product_id: number;
  count: number;
}

export type LegacyRenameExecutor = Pick<postgres.Sql, "unsafe">;

export const LEGACY_RENAME_IDS = LEGACY_ICE.map((product) => product.newId);

export function buildLegacyRenamePlan(
  rows: Iterable<Record<string, unknown>>
): LegacyRenamePlan {
  const rowMap = new Map<number, LegacyRenameSnapshotRow>();

  for (const row of rows) {
    rowMap.set(Number(row.id), {
      id: Number(row.id),
      name: String(row.name ?? ""),
      name_en: row.name_en == null ? null : String(row.name_en),
      has_bag: Boolean(row.has_bag),
      decreases_bag: Boolean(row.decreases_bag),
      is_active: Boolean(row.is_active),
      sort_order: row.sort_order == null ? null : Number(row.sort_order),
    });
  }

  const proposals = LEGACY_ICE.map((product) => {
    const current = rowMap.get(product.newId);
    return {
      id: product.newId,
      legacyName: product.legacyName,
      currentName: current?.name ?? null,
      proposedName: product.name,
      nameEn: product.nameEn,
      hasBag: product.hasBag,
      needsChange: current != null && current.name !== product.name,
    };
  });

  return {
    ids: [...LEGACY_RENAME_IDS],
    proposals,
    missingIds: proposals.filter((proposal) => proposal.currentName == null).map((proposal) => proposal.id),
    changesNeeded: proposals.some((proposal) => proposal.needsChange),
  };
}

export async function fetchLegacyRenameRows(
  sqlClient: LegacyRenameExecutor
): Promise<ReadonlyArray<Record<string, unknown>>> {
  return sqlClient.unsafe(
    `SELECT id, name, name_en, has_bag, decreases_bag, is_active, sort_order
     FROM product_types
     WHERE id = ANY($1::int[])
     ORDER BY id`,
    [LEGACY_RENAME_IDS]
  );
}

export async function fetchLegacyRenameReferenceCounts(
  sqlClient: LegacyRenameExecutor
): Promise<Record<string, LegacyReferenceCount[]>> {
  const counts = Object.fromEntries(
    FK_TABLES.map((tableName) => [tableName, [] as LegacyReferenceCount[]])
  ) as Record<string, LegacyReferenceCount[]>;

  for (const tableName of FK_TABLES) {
    const rows = await sqlClient.unsafe(
      `SELECT ${FK_COL} AS product_id, COUNT(*)::int AS count
       FROM ${tableName}
       WHERE ${FK_COL} = ANY($1::int[])
       GROUP BY ${FK_COL}
       ORDER BY ${FK_COL}`,
      [LEGACY_RENAME_IDS]
    );
    counts[tableName] = Array.from(rows).map((row) => ({
      product_id: Number(row.product_id),
      count: Number(row.count),
    }));
  }

  return counts;
}
