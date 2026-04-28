/**
 * One-off product sync to make Bearing match SI exactly.
 *
 * Safe default:
 *   npx tsx scripts/sync-si-products-to-bearing.ts
 *
 * Apply locally:
 *   APPLY=1 npx tsx scripts/sync-si-products-to-bearing.ts
 *
 * Preview local + live:
 *   MODE=both npx tsx scripts/sync-si-products-to-bearing.ts
 *
 * Apply local + live:
 *   MODE=both APPLY=1 MIGRATE_KEY="..." RENDER_URL="https://superice-pos.onrender.com" \
 *   npx tsx scripts/sync-si-products-to-bearing.ts
 */

import * as fs from "fs";
import * as path from "path";
import postgres from "postgres";
import type { Sql } from "postgres";

import {
  buildProductSyncPlan,
  classifyProductSyncPlan,
  normalizeSyncableProducts,
  type ClassifiedProductSyncPlan,
  type ProductDiffEntry,
  type ProductSyncPlan,
  type SyncableProduct,
} from "../src/lib/product-sync";
import {
  BEARING_SYNC_PRESERVED_IDS,
  FK_COL,
  FK_TABLES,
} from "../src/lib/product-definitions";

type Mode = "local" | "render" | "both";

type ReferenceCounts = Record<string, { product_id: number; count: number }[]>;

const APPLY = process.env.APPLY === "1";
const MODE = (process.env.MODE || "local") as Mode;
const RENDER_URL = (process.env.RENDER_URL || "https://superice-pos.onrender.com").replace(/\/$/, "");
const MIGRATE_KEY = process.env.MIGRATE_KEY || "superice2026migrate";
const SOURCE_API_URL = process.env.SOURCE_API_URL?.replace(/\/$/, "") || "";
const SOURCE_PRODUCTS_FILE = process.env.SOURCE_PRODUCTS_FILE || "";
const TARGET_DATABASE_URL = process.env.TARGET_DATABASE_URL || "";
const BEARING_SYNC_PRESERVED_ID_SET = new Set<number>(BEARING_SYNC_PRESERVED_IDS);

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const lineRaw of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function getDatabaseUrl(name: string): string {
  const envFromFile = parseEnvFile(path.join(process.cwd(), ".env.local"));
  const value = process.env[name] || envFromFile[name];
  if (!value) {
    throw new Error(`Missing ${name} in environment or .env.local`);
  }
  return value;
}

function formatChange(entry: ProductDiffEntry): string {
  if (entry.kind === "insert") {
    return `insert id=${entry.id} ${entry.source?.name || ""}`.trim();
  }
  if (entry.kind === "delete") {
    return `delete id=${entry.id} ${entry.target?.name || ""}`.trim();
  }
  const changeSummary = entry.changes
    .map((change) => `${change.field}: ${JSON.stringify(change.target)} -> ${JSON.stringify(change.source)}`)
    .join(", ");
  return `update id=${entry.id} ${entry.source?.name || entry.target?.name || ""} [${changeSummary}]`;
}

function printPlan(
  label: string,
  plan: ProductSyncPlan,
  referenceCounts: ReferenceCounts,
  classifiedPlan: ClassifiedProductSyncPlan,
  verification?: Record<string, unknown> | null
) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  ${label}`);
  console.log(`${"=".repeat(70)}`);
  console.log(`Source count: ${plan.sourceCount}`);
  console.log(`Target count: ${plan.targetCount}`);
  console.log(`Inserts: ${plan.inserts.length}`);
  console.log(`Updates: ${plan.updates.length}`);
  console.log(`Hard deletes: ${classifiedPlan.deletes.length}`);
  console.log(`Referenced deletes: ${classifiedPlan.referencedDeletes.length}`);
  console.log(`Deactivations: ${classifiedPlan.deactivations.length}`);
  console.log(`Matches exactly: ${plan.matchesExactly ? "yes" : "no"}`);

  if (plan.inserts.length > 0) {
    console.log("\nInserts:");
    for (const diff of plan.inserts) {
      console.log(`  - ${formatChange(diff)}`);
    }
  }

  if (plan.updates.length > 0) {
    console.log("\nUpdates:");
    for (const diff of plan.updates) {
      console.log(`  - ${formatChange(diff)}`);
    }
  }

  if (classifiedPlan.deletes.length > 0) {
    console.log("\nHard deletes:");
    for (const diff of classifiedPlan.deletes) {
      console.log(`  - ${formatChange(diff)}`);
    }
  }

  if (classifiedPlan.referencedDeletes.length > 0) {
    console.log("\nReferenced deletes (will deactivate instead):");
    for (const entry of classifiedPlan.referencedDeletes) {
      const references = entry.references
        .map((reference) => `${reference.tableName}:${reference.count}`)
        .join(", ");
      console.log(
        `  - ${formatChange(entry.diff)} [refs=${entry.totalReferences}; ${references}]`
      );
    }
  }

  const impactedTables = Object.entries(referenceCounts).filter(([, rows]) => rows.length > 0);
  if (impactedTables.length > 0) {
    console.log("\nAffected FK rows:");
    for (const [tableName, rows] of impactedTables) {
      for (const row of rows) {
        console.log(`  - ${tableName}: product_id=${row.product_id} rows=${row.count}`);
      }
    }
  }

  if (verification) {
    console.log("\nVerification:");
    for (const [key, value] of Object.entries(verification)) {
      console.log(`  - ${key}: ${JSON.stringify(value)}`);
    }
  }
}

async function fetchProducts(sql: Sql): Promise<SyncableProduct[]> {
  const rows = await sql`
    SELECT
      id,
      name,
      name_en,
      has_bag,
      decreases_bag,
      is_active,
      sort_order,
      catalog_code,
      family,
      form,
      package_type,
      size_value,
      size_unit,
      size_label
    FROM product_types
    ORDER BY id
  `;
  return normalizeSyncableProducts(rows as Iterable<Record<string, unknown>>);
}

async function fetchProductsFromApi(): Promise<SyncableProduct[]> {
  const url = `${SOURCE_API_URL}/api/migrate?action=check-products&factory=si`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${MIGRATE_KEY}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Source API fetch failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
  }

  const data = (await res.json()) as { products?: Record<string, unknown>[] };
  return normalizeSyncableProducts(data.products ?? []);
}

function fetchProductsFromFile(): SyncableProduct[] {
  const raw = fs.readFileSync(SOURCE_PRODUCTS_FILE, "utf8");
  const data = JSON.parse(raw) as unknown;
  if (!Array.isArray(data)) {
    throw new Error(`Expected SOURCE_PRODUCTS_FILE to contain a JSON array: ${SOURCE_PRODUCTS_FILE}`);
  }
  return normalizeSyncableProducts(data as Record<string, unknown>[]);
}

async function fetchReferenceCounts(
  sql: Sql,
  ids: number[]
): Promise<ReferenceCounts> {
  const result: ReferenceCounts = Object.fromEntries(FK_TABLES.map((tableName) => [tableName, []]));
  if (ids.length === 0) return result;

  for (const tableName of FK_TABLES) {
    const rows = await sql.unsafe(
      `SELECT ${FK_COL} AS product_id, COUNT(*)::int AS count
       FROM ${tableName}
       WHERE ${FK_COL} = ANY($1::int[])
       GROUP BY ${FK_COL}
       ORDER BY ${FK_COL}`,
      [ids]
    );
    result[tableName] = Array.from(rows as Iterable<Record<string, unknown>>).map((row) => ({
      product_id: Number(row.product_id),
      count: Number(row.count),
    }));
  }

  return result;
}

async function applyLocalSync() {
  const sourceUrl = SOURCE_API_URL || SOURCE_PRODUCTS_FILE ? "" : getDatabaseUrl("DATABASE_URL_SI");
  const targetUrl = TARGET_DATABASE_URL || getDatabaseUrl("DATABASE_URL_BEARING");
  const sourceSql =
    SOURCE_API_URL || SOURCE_PRODUCTS_FILE ? null : postgres(sourceUrl, { max: 1, connect_timeout: 10 });
  const targetSql = postgres(targetUrl, { max: 1, connect_timeout: 10 });

  try {
    const [sourceProducts, targetProducts] = await Promise.all([
      SOURCE_PRODUCTS_FILE
        ? Promise.resolve(fetchProductsFromFile())
        : SOURCE_API_URL
          ? fetchProductsFromApi()
          : fetchProducts(sourceSql as Sql),
      fetchProducts(targetSql),
    ]);
    const managedSourceProducts = sourceProducts.filter(
      (product) => !BEARING_SYNC_PRESERVED_ID_SET.has(product.id)
    );
    const managedTargetProducts = targetProducts.filter(
      (product) => !BEARING_SYNC_PRESERVED_ID_SET.has(product.id)
    );
    const plan = buildProductSyncPlan(managedSourceProducts, managedTargetProducts);
    const referenceCounts = await fetchReferenceCounts(targetSql, plan.affectedIds);
    const classifiedPlan = classifyProductSyncPlan(plan, referenceCounts);

    const sourceLabel = SOURCE_PRODUCTS_FILE
      ? `Source file ${path.basename(SOURCE_PRODUCTS_FILE)}`
      : SOURCE_API_URL
        ? "Live SI API"
        : "Local SI";
    const targetLabel = TARGET_DATABASE_URL ? "Direct Bearing DB" : "Bearing";
    printPlan(
      `${sourceLabel} -> ${targetLabel}${APPLY ? " (APPLY)" : " (DRY RUN)"}`,
      plan,
      referenceCounts,
      classifiedPlan,
      { preservedIds: [...BEARING_SYNC_PRESERVED_IDS] }
    );

    if (!APPLY) return;

    await targetSql.begin(async (tx) => {
      const deleteIds = classifiedPlan.deletes.map((entry) => entry.id);
      if (deleteIds.length > 0) {
        await tx`DELETE FROM product_types WHERE id = ANY(${deleteIds})`;
      }

      const deactivateIds = classifiedPlan.deactivations.map((entry) => entry.id);
      if (deactivateIds.length > 0) {
        await tx.unsafe(
          `UPDATE product_types
           SET is_active = false,
               sort_order = CASE
                 WHEN sort_order IS NULL THEN 1900
                 WHEN sort_order < 900 THEN sort_order + 1000
                 ELSE sort_order + 100
               END
           WHERE id = ANY($1::int[])`,
          [deactivateIds]
        );
      }

      for (const product of sourceProducts) {
        if (BEARING_SYNC_PRESERVED_ID_SET.has(product.id)) continue;
        await tx`
          INSERT INTO product_types (
            id, name, name_en, has_bag, decreases_bag, is_active, sort_order,
            catalog_code, family, form, package_type, size_value, size_unit, size_label
          )
          VALUES (
            ${product.id}, ${product.name}, ${product.name_en}, ${product.has_bag},
            ${product.decreases_bag}, ${product.is_active}, ${product.sort_order},
            ${product.catalog_code}, ${product.family}, ${product.form}, ${product.package_type},
            ${product.size_value}, ${product.size_unit}, ${product.size_label}
          )
          ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            name_en = EXCLUDED.name_en,
            has_bag = EXCLUDED.has_bag,
            decreases_bag = EXCLUDED.decreases_bag,
            is_active = EXCLUDED.is_active,
            sort_order = EXCLUDED.sort_order,
            catalog_code = EXCLUDED.catalog_code,
            family = EXCLUDED.family,
            form = EXCLUDED.form,
            package_type = EXCLUDED.package_type,
            size_value = EXCLUDED.size_value,
            size_unit = EXCLUDED.size_unit,
            size_label = EXCLUDED.size_label
        `;
      }

      const [maxRow] = await tx`SELECT COALESCE(MAX(id), 0) + 1 AS next_val FROM product_types`;
      await tx`SELECT setval(pg_get_serial_sequence('product_types', 'id'), ${Number(maxRow.next_val)}, false)`;

      const syncedProducts = await fetchProducts(tx);
      const sourceIds = new Set(managedSourceProducts.map((product) => product.id));
      const managedProducts = syncedProducts.filter((product) => sourceIds.has(product.id));
      const verificationPlan = buildProductSyncPlan(managedSourceProducts, managedProducts);
      if (!verificationPlan.matchesExactly) {
        throw new Error(`Verification failed after local sync: ${verificationPlan.diffs.map(formatChange).join("; ")}`);
      }

      const activeExtraProducts = syncedProducts.filter(
        (product) =>
          !sourceIds.has(product.id) &&
          !BEARING_SYNC_PRESERVED_ID_SET.has(product.id) &&
          product.is_active
      );
      if (activeExtraProducts.length > 0) {
        throw new Error(
          `Verification failed: extra active Bearing products remain: ${activeExtraProducts
            .map((product) => `${product.id}`)
            .join(", ")}`
        );
      }

      const failedDeactivations = classifiedPlan.deactivations.filter((entry) => {
        const product = syncedProducts.find((candidate) => candidate.id === entry.id);
        return !product || product.is_active;
      });
      if (failedDeactivations.length > 0) {
        throw new Error(
          `Verification failed: expected deactivated product IDs still active or missing: ${failedDeactivations
            .map((entry) => `${entry.id}`)
            .join(", ")}`
        );
      }

      for (const tableName of FK_TABLES) {
        const [orphanRow] = await tx.unsafe(
          `SELECT COUNT(*)::int AS cnt
           FROM ${tableName} t
           LEFT JOIN product_types pt ON t.${FK_COL} = pt.id
           WHERE pt.id IS NULL`
        );
        if (Number(orphanRow.cnt) > 0) {
          throw new Error(`Verification failed: ${tableName} has ${orphanRow.cnt} orphan rows`);
        }
      }
    });

    console.log("\nLocal Bearing active catalog now matches SI.");
  } finally {
    await sourceSql?.end();
    await targetSql.end();
  }
}

async function runRenderSync() {
  const url = `${RENDER_URL}/api/migrate?action=sync-si-products-to-bearing${APPLY ? "" : "&dryRun=1"}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${MIGRATE_KEY}`,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Render sync failed (${res.status}): ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  const plan = data.plan as ProductSyncPlan;
  const referenceCounts = data.referenceCounts as ReferenceCounts;
  const classifiedPlan =
    data.deletes && data.referencedDeletes && data.deactivations
      ? {
          plan,
          deletes: data.deletes as ProductDiffEntry[],
          referencedDeletes: data.referencedDeletes as ClassifiedProductSyncPlan["referencedDeletes"],
          deactivations: data.deactivations as ClassifiedProductSyncPlan["deactivations"],
        }
      : classifyProductSyncPlan(plan, referenceCounts);
  printPlan(
    `Render SI -> Bearing${APPLY ? " (APPLY)" : " (DRY RUN)"}`,
    plan,
    referenceCounts,
    classifiedPlan,
    (data.verification as Record<string, unknown> | undefined) ?? null
  );

  if (data.log?.length) {
    console.log("\nRender log:");
    for (const line of data.log as string[]) {
      console.log(`  - ${line}`);
    }
  }
}

async function main() {
  if (!["local", "render", "both"].includes(MODE)) {
    throw new Error(`Invalid MODE='${MODE}'. Use local, render, or both.`);
  }

  if (MODE === "local" || MODE === "both") {
    await applyLocalSync();
  }

  if (MODE === "render" || MODE === "both") {
    await runRenderSync();
  }
}

main().catch((error) => {
  console.error("\nFATAL:", error);
  process.exit(1);
});
