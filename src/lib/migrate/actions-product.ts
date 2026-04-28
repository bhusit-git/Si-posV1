import {
  ALL_FINAL_IDS,
  BEARING_SYNC_PRESERVED_IDS,
  DRY_BY_NAME,
  DRY_GOODS,
  FK_TABLES,
  LEGACY_BY_ID,
  LEGACY_BY_NAME,
  LEGACY_ICE,
  NEW_ICE_BY_NAME,
  NEW_ICE_PRODUCTS,
  TEMP_OFFSET,
} from "@/lib/product-definitions";
import { buildProductSyncPlan, classifyProductSyncPlan } from "@/lib/product-sync";
import {
  buildLegacyRenamePlan,
  fetchLegacyRenameReferenceCounts,
  fetchLegacyRenameRows,
} from "./legacy-rename";
import type { MigrateActionContext, MigrateActionResult, UnsafeExecutor } from "./types";
import {
  FK_COL,
  fetchFactoryProducts,
  fetchFactoryProductsUnsafe,
  fetchProductReferenceCounts,
  getConfiguredFactoryConnection,
  getSupericeMigrateEnv,
  normalizeProductRefCounts,
} from "./shared";

const TAXONOMY_COLUMNS = [
  { name: "catalog_code", def: "integer" },
  { name: "family", def: "text" },
  { name: "form", def: "text" },
  { name: "package_type", def: "text" },
  { name: "size_value", def: "integer" },
  { name: "size_unit", def: "text" },
  { name: "size_label", def: "text" },
] as const;

const CANONICAL_ICE_PRODUCT_IDS = NEW_ICE_PRODUCTS.map((product) => product.id);
const CANONICAL_ICE_PRODUCT_NAMES = NEW_ICE_PRODUCTS.map((product) => product.name);
const PREVIOUS_ROLLOUT_PACK10_ID = 21;
const CANONICAL_PACK10_ID = 8;
const STALE_PRICE_PRODUCT_IDS = [91, 92, 93, 94, 95, 96, 98, PREVIOUS_ROLLOUT_PACK10_ID];
const BEARING_SYNC_PRESERVED_ID_SET = new Set<number>(BEARING_SYNC_PRESERVED_IDS);

function parseRequestedBillCounterValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value >= 0 && value <= 9999 ? value : null;
  }

  if (typeof value === "string" && /^\d{1,4}$/.test(value.trim())) {
    const parsed = Number.parseInt(value, 10);
    return parsed >= 0 && parsed <= 9999 ? parsed : null;
  }

  return null;
}

async function buildProductTaxonomyVerification(sqlClient: UnsafeExecutor) {
  const [canonicalCounts] = await sqlClient.unsafe(
    `SELECT
       COUNT(*)::int AS canonical_row_count,
       COUNT(*) FILTER (WHERE catalog_code IS NOT NULL)::int AS catalog_code_populated_count,
       COUNT(*) FILTER (WHERE family IS NOT NULL)::int AS family_populated_count,
       COUNT(*) FILTER (WHERE package_type IS NOT NULL)::int AS package_type_populated_count,
       COUNT(*) FILTER (WHERE size_label IS NOT NULL)::int AS size_label_populated_count
     FROM product_types
     WHERE id = ANY($1::int[])`,
    [CANONICAL_ICE_PRODUCT_IDS]
  );
  const [legacyCounts] = await sqlClient.unsafe(
    `SELECT COUNT(*) FILTER (WHERE is_active = true)::int AS legacy_rows_active_count
     FROM product_types
     WHERE id BETWEEN 91 AND 96`
  );
  const duplicateRows = await sqlClient.unsafe(
    `SELECT name, array_agg(id ORDER BY id) AS ids, COUNT(*)::int AS count
     FROM product_types
     WHERE is_active = true
     GROUP BY name
     HAVING COUNT(*) > 1
     ORDER BY name`
  );

  return {
    canonicalRowCount: Number(canonicalCounts?.canonical_row_count ?? 0),
    catalogCodePopulatedCount: Number(canonicalCounts?.catalog_code_populated_count ?? 0),
    familyPopulatedCount: Number(canonicalCounts?.family_populated_count ?? 0),
    packageTypePopulatedCount: Number(canonicalCounts?.package_type_populated_count ?? 0),
    sizeLabelPopulatedCount: Number(canonicalCounts?.size_label_populated_count ?? 0),
    duplicateActiveNames: Array.from(duplicateRows).map((row) => ({
      name: String(row.name ?? ""),
      ids: Array.isArray(row.ids) ? row.ids.map((id) => Number(id)) : [],
      count: Number(row.count ?? 0),
    })),
    legacyRowsActiveCount: Number(legacyCounts?.legacy_rows_active_count ?? 0),
  };
}

async function remapPreviousRolloutPack10(
  tx: UnsafeExecutor,
  log: string[]
) {
  const mergedCustomerPrices = await tx.unsafe(
    `INSERT INTO customer_prices (customer_id, product_type_id, unit_price, bag_deposit)
     SELECT customer_id, $1, unit_price, bag_deposit
     FROM customer_prices
     WHERE product_type_id = $2
     ON CONFLICT (customer_id, product_type_id) DO UPDATE
       SET unit_price = EXCLUDED.unit_price,
           bag_deposit = EXCLUDED.bag_deposit`,
    [CANONICAL_PACK10_ID, PREVIOUS_ROLLOUT_PACK10_ID]
  ) as { count?: unknown };
  log.push(
    `Merged customer_prices ${PREVIOUS_ROLLOUT_PACK10_ID} -> ${CANONICAL_PACK10_ID}: ${Number(mergedCustomerPrices.count ?? 0)}`
  );

  for (const table of FK_TABLES) {
    if (table === "customer_prices") continue;
    const result = await tx.unsafe(
      `UPDATE ${table}
       SET ${FK_COL} = $1
       WHERE ${FK_COL} = $2`,
      [CANONICAL_PACK10_ID, PREVIOUS_ROLLOUT_PACK10_ID]
    ) as { count?: unknown };
    log.push(
      `Remapped ${table}.${FK_COL} ${PREVIOUS_ROLLOUT_PACK10_ID} -> ${CANONICAL_PACK10_ID}: ${Number(result.count ?? 0)}`
    );
  }

  const deletedStalePrices = await tx.unsafe(
    `DELETE FROM customer_prices WHERE product_type_id = $1`,
    [PREVIOUS_ROLLOUT_PACK10_ID]
  ) as { count?: unknown };
  log.push(
    `Deleted stale customer_prices for ${PREVIOUS_ROLLOUT_PACK10_ID}: ${Number(deletedStalePrices.count ?? 0)}`
  );

  const retiredDuplicate = await tx.unsafe(
    `UPDATE product_types
     SET is_active = false,
         sort_order = GREATEST(COALESCE(sort_order, 0), 900 + id),
         catalog_code = NULL
     WHERE id = $1`,
    [PREVIOUS_ROLLOUT_PACK10_ID]
  ) as { count?: unknown };
  log.push(
    `Retired previous rollout duplicate ${PREVIOUS_ROLLOUT_PACK10_ID}: ${Number(retiredDuplicate.count ?? 0)}`
  );
}

export async function runRolloutProductTaxonomyAction(
  context: MigrateActionContext
): Promise<MigrateActionResult> {
  const factoryKey = context.factoryKey;
  if (!factoryKey) return { status: 400, body: { error: "Missing ?factory= parameter" } };

  const connection = getConfiguredFactoryConnection(factoryKey);
  if (!connection) {
    return { status: 400, body: { error: `No DB configured for factory '${factoryKey}'` } };
  }

  const log: string[] = [];

  try {
    const pg = (await import("postgres")).default;
    const fSql = pg(connection.url, { max: 1, connect_timeout: 15 });

    const verification = await fSql.begin(async (tx) => {
      for (const column of TAXONOMY_COLUMNS) {
        await tx.unsafe(
          `ALTER TABLE product_types ADD COLUMN IF NOT EXISTS ${column.name} ${column.def}`
        );
        log.push(`Ensured product_types.${column.name}`);
      }
      await remapPreviousRolloutPack10(tx as unknown as UnsafeExecutor, log);
      await tx.unsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_product_types_catalog_code ON product_types (catalog_code)`
      );
      log.push("Ensured idx_product_types_catalog_code");

      for (const product of NEW_ICE_PRODUCTS) {
        await tx.unsafe(
          `INSERT INTO product_types (
             id, name, name_en, has_bag, decreases_bag, is_active, sort_order,
             catalog_code, family, form, package_type, size_value, size_unit, size_label
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
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
             size_label = EXCLUDED.size_label`,
          [
            product.id,
            product.name,
            product.nameEn,
            product.hasBag,
            false,
            product.isActive,
            product.sortOrder,
            product.catalogCode,
            product.family,
            product.form,
            product.packageType,
            product.sizeValue,
            product.sizeUnit,
            product.sizeLabel,
          ]
        );
      }
      log.push(`Upserted canonical product rows: ${NEW_ICE_PRODUCTS.length}`);

      for (const product of DRY_GOODS) {
        await tx.unsafe(
          `UPDATE product_types
           SET catalog_code = $1
           WHERE id = $2`,
          [product.catalogCode, product.id]
        );
      }
      log.push(`Updated dry-good catalog codes: ${DRY_GOODS.length}`);

      const legacyDeactivate = await tx.unsafe(
        `UPDATE product_types
         SET is_active = false,
             sort_order = 900 + id
         WHERE id BETWEEN 91 AND 96`
      );
      log.push(`Deactivated legacy rows 91-96: ${Number(legacyDeactivate.count ?? 0)}`);

      const duplicateDeactivate = await tx.unsafe(
        `UPDATE product_types p
         SET is_active = false,
             sort_order = COALESCE(sort_order, 900) + 1000
         WHERE p.id <> ALL($1::int[])
           AND p.name = ANY($2::text[])
           AND EXISTS (
             SELECT 1
             FROM product_types c
             WHERE c.id = ANY($1::int[])
               AND c.name = p.name
           )`,
        [CANONICAL_ICE_PRODUCT_IDS, CANONICAL_ICE_PRODUCT_NAMES]
      );
      log.push(`Deactivated duplicate non-canonical rows: ${Number(duplicateDeactivate.count ?? 0)}`);

      return buildProductTaxonomyVerification(tx as unknown as UnsafeExecutor);
    });

    await fSql.end();

    return {
      body: {
        success: true,
        factory: factoryKey,
        verification,
        log,
      },
      auditSummary: {
        factoryKey,
        canonicalRowCount: verification.canonicalRowCount,
        duplicateActiveNameCount: verification.duplicateActiveNames.length,
        legacyRowsActiveCount: verification.legacyRowsActiveCount,
      },
    };
  } catch (error) {
    return { status: 500, body: { error: String(error), log } };
  }
}

export async function runSeedBillCounterAction(
  context: MigrateActionContext
): Promise<MigrateActionResult> {
  const factoryKey = context.factoryKey;
  if (!factoryKey) return { status: 400, body: { error: "Missing ?factory= parameter" } };

  const connection = getConfiguredFactoryConnection(factoryKey);
  if (!connection) {
    return { status: 400, body: { error: `No DB configured for factory '${factoryKey}'` } };
  }

  const body = await context.request.json().catch(() => null);
  const nextNumber = parseRequestedBillCounterValue(body?.nextNumber);
  if (nextNumber == null) {
    return {
      status: 400,
      body: { error: "Body must include nextNumber as an integer between 0000 and 9999" },
    };
  }

  const log: string[] = [];

  try {
    const pg = (await import("postgres")).default;
    const fSql = pg(connection.url, { max: 1, connect_timeout: 15 });

    const seeded = await fSql.begin(async (tx) => {
      await tx.unsafe(
        `CREATE TABLE IF NOT EXISTS bill_counters (
           id serial PRIMARY KEY,
           factory_key text NOT NULL,
           next_number integer NOT NULL DEFAULT 1,
           updated_at timestamptz NOT NULL DEFAULT now(),
           created_at timestamptz NOT NULL DEFAULT now()
         )`
      );
      await tx.unsafe(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_bill_counters_factory ON bill_counters (factory_key)`
      );
      log.push("Ensured bill_counters table and unique index");

      const rows = await tx.unsafe(
        `INSERT INTO bill_counters (factory_key, next_number, updated_at, created_at)
         VALUES ($1, $2, now(), now())
         ON CONFLICT (factory_key) DO UPDATE
           SET next_number = EXCLUDED.next_number,
               updated_at = now()
         RETURNING id, factory_key, next_number, updated_at, created_at`,
        [factoryKey, nextNumber]
      );
      const row = rows[0];
      if (!row) {
        throw new Error("bill_counter_seed_failed");
      }

      const [countRow] = await tx.unsafe(
        `SELECT COUNT(*)::int AS cnt FROM bill_counters WHERE factory_key = $1`,
        [factoryKey]
      );

      return {
        id: Number(row.id),
        factoryKey: String(row.factory_key ?? factoryKey),
        nextNumber: Number(row.next_number ?? nextNumber),
        updatedAt: row.updated_at,
        createdAt: row.created_at,
        rowCountForFactory: Number(countRow?.cnt ?? 0),
      };
    });

    await fSql.end();

    return {
      body: {
        success: true,
        factory: factoryKey,
        billCounter: seeded,
        log,
      },
      auditSummary: {
        factoryKey,
        nextNumber: seeded.nextNumber,
        rowCountForFactory: seeded.rowCountForFactory,
      },
    };
  } catch (error) {
    return { status: 500, body: { error: String(error), log } };
  }
}

export async function runMigrateProductsAction(
  context: MigrateActionContext
): Promise<MigrateActionResult> {
  const factoryKey = context.factoryKey;
  if (!factoryKey) return { status: 400, body: { error: "Missing ?factory= parameter" } };

  const connection = getConfiguredFactoryConnection(factoryKey);
  if (!connection) {
    return { status: 400, body: { error: `No DB configured for factory '${factoryKey}'` } };
  }

  const dryRun = context.dryRunRequested;
  const log: string[] = [];
  try {
    const pg = (await import("postgres")).default;
    const fSql = pg(connection.url, { max: 3, connect_timeout: 15 });

    interface ExistingProduct {
      id: number;
      name: string;
      name_en: string | null;
      has_bag: boolean;
      is_active: boolean;
      sort_order: number;
    }
    interface IdMapping {
      oldId: number;
      newId: number;
      name: string;
      category: string;
    }

    const currentProducts: ExistingProduct[] = await fSql`
      SELECT id, name, name_en, has_bag, is_active, sort_order FROM product_types ORDER BY id
    `;
    log.push(`Current products: ${currentProducts.length} rows`);

    const preCounts: Record<string, { pid: number; cnt: number }[]> = {};
    for (const tbl of FK_TABLES) {
      const rows = await fSql.unsafe(
        `SELECT ${FK_COL} as pid, COUNT(*)::int as cnt FROM ${tbl} GROUP BY ${FK_COL} ORDER BY ${FK_COL}`
      );
      preCounts[tbl] = normalizeProductRefCounts(rows as Iterable<{ pid: unknown; cnt: unknown }>).map((r) => ({
        pid: r.pid,
        cnt: r.cnt,
      }));
    }

    const mappings: IdMapping[] = [];
    const usedNewIds = new Set<number>();
    const unmapped: ExistingProduct[] = [];

    for (const p of currentProducts) {
      const legacy = LEGACY_BY_ID.get(p.id) ?? LEGACY_BY_NAME.get(p.name);
      if (legacy) {
        mappings.push({ oldId: p.id, newId: legacy.newId, name: p.name, category: "legacy" });
        usedNewIds.add(legacy.newId);
        continue;
      }
      const newIce = NEW_ICE_BY_NAME.get(p.name);
      if (newIce) {
        mappings.push({ oldId: p.id, newId: newIce.id, name: p.name, category: "new_ice" });
        usedNewIds.add(newIce.id);
        continue;
      }
      const dry = DRY_BY_NAME.get(p.name);
      if (dry) {
        mappings.push({ oldId: p.id, newId: dry.id, name: p.name, category: "dry" });
        usedNewIds.add(dry.id);
        continue;
      }
      unmapped.push(p);
    }

    let orphanId = 57;
    for (const p of unmapped) {
      let hasRefs = false;
      for (const tbl of FK_TABLES) {
        const ref = preCounts[tbl].find((r) => r.pid === p.id);
        if (ref && ref.cnt > 0) {
          hasRefs = true;
          break;
        }
      }
      if (hasRefs) {
        while (ALL_FINAL_IDS.has(orphanId) || usedNewIds.has(orphanId)) orphanId++;
        mappings.push({ oldId: p.id, newId: orphanId, name: p.name, category: "orphan_dry" });
        usedNewIds.add(orphanId);
        orphanId++;
      } else {
        log.push(`Dropping unreferenced: ID ${p.id} ${p.name}`);
      }
    }

    const changesNeeded = mappings.some((m) => m.oldId !== m.newId);
    const newProductsMissing = NEW_ICE_PRODUCTS.some((p) => !usedNewIds.has(p.id));

    for (const m of mappings) {
      const arrow = m.oldId === m.newId ? "(no change)" : `-> ${m.newId}`;
      log.push(`[${m.category}] ID ${m.oldId} ${arrow} ${m.name}`);
    }

    if (dryRun) {
      await fSql.end();
      return {
        body: {
          factory: factoryKey,
          dryRun: true,
          changesNeeded,
          newProductsMissing,
          mappings,
          preCounts,
          log,
        },
        auditSummary: {
          factoryKey,
          dryRun: true,
          changesNeeded,
          mappingCount: mappings.length,
        },
      };
    }

    const verificationResults: Record<string, unknown> = {};

    await fSql.begin(async (tx) => {
      const fkConstraints = await tx.unsafe(`
        SELECT tc.table_name, tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_name = 'product_types'
          AND ccu.column_name = 'id'
      `);
      for (const fk of fkConstraints as unknown as Array<{
        table_name: string;
        constraint_name: string;
      }>) {
        await tx.unsafe(`ALTER TABLE ${fk.table_name} DROP CONSTRAINT ${fk.constraint_name}`);
        log.push(`Dropped FK: ${fk.table_name}.${fk.constraint_name}`);
      }

      log.push("Phase 1: FK refs -> temp IDs");
      for (const m of mappings) {
        const tempId = m.oldId + TEMP_OFFSET;
        for (const tbl of FK_TABLES) {
          const result = await tx.unsafe(`UPDATE ${tbl} SET ${FK_COL} = $1 WHERE ${FK_COL} = $2`, [
            tempId,
            m.oldId,
          ]);
          if (result.count && result.count > 0) {
            log.push(`  ${tbl}: ${m.oldId} -> ${tempId} (${result.count})`);
          }
        }
      }

      const deleted = await tx.unsafe("DELETE FROM product_types");
      log.push(`Deleted ${deleted.count} product_types rows`);

      for (const p of NEW_ICE_PRODUCTS) {
        await tx.unsafe(
          `INSERT INTO product_types (
            id, name, name_en, has_bag, is_active, sort_order, catalog_code,
            family, form, package_type, size_value, size_unit, size_label
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [p.id, p.name, p.nameEn, p.hasBag, p.isActive, p.sortOrder, p.catalogCode, p.family, p.form, p.packageType, p.sizeValue, p.sizeUnit, p.sizeLabel]
        );
      }
      for (const d of DRY_GOODS) {
        await tx.unsafe(
          `INSERT INTO product_types (
            id, name, name_en, has_bag, decreases_bag, is_active, sort_order, catalog_code,
            family, form, package_type, size_value, size_unit, size_label
          ) VALUES ($1,$2,NULL,false,$3,true,$4,$5,NULL,NULL,NULL,NULL,NULL,NULL)`,
          [d.id, d.name, d.decreasesBag ?? false, d.id, d.catalogCode]
        );
      }
      for (const l of LEGACY_ICE) {
        await tx.unsafe(
          `INSERT INTO product_types (
            id, name, name_en, has_bag, is_active, sort_order, catalog_code,
            family, form, package_type, size_value, size_unit, size_label
          ) VALUES ($1,$2,$3,$4,false,$5,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`,
          [l.newId, l.name, l.nameEn, l.hasBag, 900 + l.newId]
        );
      }

      const orphans = mappings.filter((m) => m.category === "orphan_dry");
      for (const o of orphans) {
        const orig = currentProducts.find((p) => p.id === o.oldId)!;
        await tx.unsafe(
          `INSERT INTO product_types (
            id, name, name_en, has_bag, is_active, sort_order, catalog_code,
            family, form, package_type, size_value, size_unit, size_label
          ) VALUES ($1,$2,$3,$4,false,$5,NULL,NULL,NULL,NULL,NULL,NULL,NULL)`,
          [o.newId, orig.name, orig.name_en, orig.has_bag, o.newId]
        );
      }

      log.push("Phase 2: temp IDs -> final IDs");
      for (const m of mappings) {
        const tempId = m.oldId + TEMP_OFFSET;
        for (const tbl of FK_TABLES) {
          const result = await tx.unsafe(`UPDATE ${tbl} SET ${FK_COL} = $1 WHERE ${FK_COL} = $2`, [
            m.newId,
            tempId,
          ]);
          if (result.count && result.count > 0) {
            log.push(`  ${tbl}: ${tempId} -> ${m.newId} (${result.count})`);
          }
        }
      }

      for (const fk of fkConstraints as unknown as Array<{
        table_name: string;
        constraint_name: string;
      }>) {
        await tx.unsafe(
          `ALTER TABLE ${fk.table_name} ADD CONSTRAINT ${fk.constraint_name} FOREIGN KEY (${FK_COL}) REFERENCES product_types(id)`
        );
        log.push(`Restored FK: ${fk.table_name}.${fk.constraint_name}`);
      }

      const [maxRow] = await tx.unsafe("SELECT COALESCE(MAX(id), 0) + 1 as next_val FROM product_types");
      await tx.unsafe(`SELECT setval(pg_get_serial_sequence('product_types', 'id'), $1, false)`, [
        maxRow.next_val,
      ]);

      let allGood = true;
      for (const tbl of FK_TABLES) {
        const preTotal = preCounts[tbl].reduce((s, r) => s + r.cnt, 0);
        const [postRow] = await tx.unsafe(`SELECT COUNT(*)::int as cnt FROM ${tbl}`);
        const ok = preTotal === Number(postRow.cnt);
        if (!ok) allGood = false;
      }
      for (const tbl of FK_TABLES) {
        const [orphanRow] = await tx.unsafe(
          `SELECT COUNT(*)::int as cnt FROM ${tbl} t LEFT JOIN product_types pt ON t.${FK_COL} = pt.id WHERE pt.id IS NULL`
        );
        if (Number(orphanRow.cnt) > 0) allGood = false;
      }
      for (const tbl of FK_TABLES) {
        const [leak] = await tx.unsafe(`SELECT COUNT(*)::int as cnt FROM ${tbl} WHERE ${FK_COL} >= $1`, [
          TEMP_OFFSET,
        ]);
        if (Number(leak.cnt) > 0) allGood = false;
      }

      const finalProducts = await tx.unsafe("SELECT id, name FROM product_types ORDER BY id");
      verificationResults.finalProductCount = finalProducts.length;
      verificationResults.allGood = allGood;
      if (!allGood) throw new Error("Verification FAILED — rolling back");
    });

    await fSql.end();
    return {
      body: {
        factory: factoryKey,
        dryRun: false,
        success: true,
        ...verificationResults,
        mappings,
        log,
      },
      auditSummary: {
        factoryKey,
        dryRun: false,
        changesNeeded,
        mappingCount: mappings.length,
        success: true,
      },
    };
  } catch (error) {
    return { status: 500, body: { error: String(error), log } };
  }
}

export async function runSyncSiProductsToBearingAction(
  context: MigrateActionContext
): Promise<MigrateActionResult> {
  const dryRun = context.dryRunRequested;
  const migrateEnv = getSupericeMigrateEnv();
  const sourceUrl = migrateEnv.getFactoryDatabaseUrl("si");
  const targetUrl = migrateEnv.getFactoryDatabaseUrl("bearing");
  if (!sourceUrl || !targetUrl) {
    return {
      status: 400,
      body: { error: "DATABASE_URL_SI and DATABASE_URL_BEARING must both be configured" },
    };
  }

  const log: string[] = [];
  try {
    const pg = (await import("postgres")).default;
    const sourceSql = pg(sourceUrl, { max: 1, connect_timeout: 15 });
    const targetSql = pg(targetUrl, { max: 1, connect_timeout: 15 });

    const sourceProducts = await fetchFactoryProducts(sourceSql);
    const targetProducts = await fetchFactoryProducts(targetSql);
    const managedSourceProducts = sourceProducts.filter(
      (product) => !BEARING_SYNC_PRESERVED_ID_SET.has(product.id)
    );
    const managedTargetProducts = targetProducts.filter(
      (product) => !BEARING_SYNC_PRESERVED_ID_SET.has(product.id)
    );
    const plan = buildProductSyncPlan(managedSourceProducts, managedTargetProducts);
    const referenceCounts = await fetchProductReferenceCounts(targetSql, plan.affectedIds);
    const classifiedPlan = classifyProductSyncPlan(plan, referenceCounts);

    log.push(`Source SI managed products: ${plan.sourceCount}`);
    log.push(`Target Bearing managed products: ${plan.targetCount}`);
    log.push(`Preserved Bearing legacy IDs: ${BEARING_SYNC_PRESERVED_IDS.join(", ")}`);
    log.push(`Planned inserts: ${plan.inserts.length}`);
    log.push(`Planned updates: ${plan.updates.length}`);
    log.push(`Planned hard deletes: ${classifiedPlan.deletes.length}`);
    log.push(`Planned deactivations: ${classifiedPlan.deactivations.length}`);

    if (dryRun) {
      await sourceSql.end();
      await targetSql.end();
      return {
        body: {
          success: true,
          dryRun: true,
          sourceFactory: "si",
          targetFactory: "bearing",
          plan,
          deletes: classifiedPlan.deletes,
          referencedDeletes: classifiedPlan.referencedDeletes,
          deactivations: classifiedPlan.deactivations,
          referenceCounts,
          verification: {
            managedCatalogMatchesExactly: plan.matchesExactly,
            hardDeleteCount: classifiedPlan.deletes.length,
            deactivationCount: classifiedPlan.deactivations.length,
          },
          log,
        },
        auditSummary: {
          dryRun: true,
          sourceFactory: "si",
          targetFactory: "bearing",
          affectedIds: plan.affectedIds.length,
        },
      };
    }

    let verification: Record<string, unknown> | null = null;

    await targetSql.begin(async (tx) => {
      const deleteIds = classifiedPlan.deletes.map((entry) => entry.id);
      if (deleteIds.length > 0) {
        await tx.unsafe(`DELETE FROM product_types WHERE id = ANY($1::int[])`, [deleteIds]);
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
        await tx.unsafe(
          `INSERT INTO product_types (
             id, name, name_en, has_bag, decreases_bag, is_active, sort_order, catalog_code,
             family, form, package_type, size_value, size_unit, size_label
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
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
             size_label = EXCLUDED.size_label`,
          [
            product.id,
            product.name,
            product.name_en,
            product.has_bag,
            product.decreases_bag,
            product.is_active,
            product.sort_order,
            product.catalog_code,
            product.family,
            product.form,
            product.package_type,
            product.size_value,
            product.size_unit,
            product.size_label,
          ]
        );
      }

      const [maxRow] = await tx.unsafe(
        `SELECT COALESCE(MAX(id), 0) + 1 AS next_val FROM product_types`
      );
      await tx.unsafe(
        `SELECT setval(pg_get_serial_sequence('product_types', 'id'), $1, false)`,
        [Number(maxRow.next_val)]
      );

      const syncedProducts = await fetchFactoryProductsUnsafe(
        tx as unknown as {
          unsafe: (query: string, params?: ReadonlyArray<unknown>) => Promise<
            ReadonlyArray<Record<string, unknown>>
          >;
        }
      );
      const sourceIds = new Set(managedSourceProducts.map((product) => product.id));
      const managedProducts = syncedProducts.filter((product) => sourceIds.has(product.id));
      const verificationPlan = buildProductSyncPlan(managedSourceProducts, managedProducts);
      if (!verificationPlan.matchesExactly) {
        throw new Error(
          `Verification failed after sync: ${verificationPlan.diffs
            .map((entry) => `id=${entry.id}:${entry.kind}`)
            .join(", ")}`
        );
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

      const orphanCounts: Record<string, number> = {};
      for (const tableName of FK_TABLES) {
        const [orphanRow] = await tx.unsafe(
          `SELECT COUNT(*)::int AS cnt
           FROM ${tableName} t
           LEFT JOIN product_types pt ON t.${FK_COL} = pt.id
           WHERE pt.id IS NULL`
        );
        const count = Number(orphanRow.cnt);
        orphanCounts[tableName] = count;
        if (count > 0) {
          throw new Error(`Verification failed: ${tableName} has ${count} orphan rows`);
        }
      }

        verification = {
        managedCatalogMatchesExactly: true,
        managedDiffCount: 0,
        hardDeletedIds: deleteIds,
        deactivatedIds: deactivateIds,
        activeExtraIds: [],
        preservedIds: [...BEARING_SYNC_PRESERVED_IDS],
        orphanCounts,
      };
    });

    await sourceSql.end();
    await targetSql.end();
    return {
      body: {
        success: true,
        dryRun: false,
        sourceFactory: "si",
        targetFactory: "bearing",
        plan,
        deletes: classifiedPlan.deletes,
        referencedDeletes: classifiedPlan.referencedDeletes,
        deactivations: classifiedPlan.deactivations,
        referenceCounts,
        verification,
        log,
      },
      auditSummary: {
        dryRun: false,
        sourceFactory: "si",
        targetFactory: "bearing",
        affectedIds: plan.affectedIds.length,
      },
    };
  } catch (error) {
    return { status: 500, body: { error: String(error), log } };
  }
}

export async function runMigratePricesAction(
  context: MigrateActionContext
): Promise<MigrateActionResult> {
  const factoryKey = context.factoryKey;
  if (!factoryKey) return { status: 400, body: { error: "Missing ?factory= parameter" } };
  const connection = getConfiguredFactoryConnection(factoryKey);
  if (!connection) {
    return { status: 400, body: { error: `No DB configured for factory '${factoryKey}'` } };
  }

  const PRICE_MAP: [number, number][] = [
    [91, 1],
    [95, 4],
    [94, 5],
    [93, 6],
    [96, 7],
    [92, 9],
    [98, 19],
  ];
  const log: string[] = [];
  try {
    const pg = (await import("postgres")).default;
    const fSql = pg(connection.url, { max: 1, connect_timeout: 15 });

    for (const [legacyId, newId] of PRICE_MAP) {
      const result = await fSql.unsafe(
        `INSERT INTO customer_prices (customer_id, product_type_id, unit_price, bag_deposit)
         SELECT cp.customer_id, $1, cp.unit_price, cp.bag_deposit
         FROM customer_prices cp
         WHERE cp.product_type_id = $2 AND cp.unit_price > 0
         ON CONFLICT (customer_id, product_type_id) DO UPDATE
           SET unit_price = EXCLUDED.unit_price, bag_deposit = EXCLUDED.bag_deposit`,
        [newId, legacyId]
      );
      log.push(`Copied product ${legacyId} -> ${newId}: ${result.count} rows`);
    }

    const p41Result = await fSql.unsafe(
      `INSERT INTO customer_prices (customer_id, product_type_id, unit_price, bag_deposit)
       SELECT id, 41, 10, 0 FROM customers
       ON CONFLICT (customer_id, product_type_id) DO UPDATE
         SET unit_price = 10`
    );
    log.push(`Set product 41 price=10: ${p41Result.count} rows`);

    const [counts] = await fSql.unsafe(
      `SELECT
         (SELECT COUNT(*)::int FROM customer_prices WHERE product_type_id IN (1,4,5,6,7,9,19) AND unit_price > 0) as new_prices,
         (SELECT COUNT(*)::int FROM customer_prices WHERE product_type_id IN (91,92,93,94,95,96,98) AND unit_price > 0) as legacy_prices,
         (SELECT COUNT(*)::int FROM customer_prices WHERE product_type_id = 41 AND unit_price = 10) as p41_prices`
    );
    await fSql.end();

    return {
      body: {
        success: true,
        factory: factoryKey,
        log,
        verification: {
          newProductPrices: counts.new_prices,
          legacyProductPrices: counts.legacy_prices,
          product41Prices: counts.p41_prices,
        },
      },
      auditSummary: {
        factoryKey,
        verification: counts,
      },
    };
  } catch (error) {
    return { status: 500, body: { error: String(error), log } };
  }
}

export async function runRenameLegacyProductsAction(
  context: MigrateActionContext
): Promise<MigrateActionResult> {
  const factoryKey = context.factoryKey;
  if (!factoryKey) return { status: 400, body: { error: "Missing ?factory= parameter" } };

  const connection = getConfiguredFactoryConnection(factoryKey);
  if (!connection) {
    return { status: 400, body: { error: `No DB configured for factory '${factoryKey}'` } };
  }

  const dryRun = context.request.method === "GET" || context.dryRunRequested;
  const log: string[] = [];

  try {
    const pg = (await import("postgres")).default;
    const fSql = pg(connection.url, { max: 1, connect_timeout: 15 });

    const currentRows = await fetchLegacyRenameRows(fSql);
    const renamePlan = buildLegacyRenamePlan(currentRows);
    const fkReferenceCounts = await fetchLegacyRenameReferenceCounts(fSql);

    if (renamePlan.missingIds.length > 0) {
      await fSql.end();
      return {
        status: dryRun ? 200 : 409,
        body: {
          factory: factoryKey,
          dryRun,
          error: dryRun ? undefined : "Legacy product rows are missing",
          proposals: renamePlan.proposals,
          missingIds: renamePlan.missingIds,
          changesNeeded: renamePlan.changesNeeded,
          fkReferenceCounts,
          log,
        },
        auditSummary: {
          factoryKey,
          dryRun,
          missingIds: renamePlan.missingIds,
        },
      };
    }

    if (dryRun) {
      await fSql.end();
      return {
        body: {
          factory: factoryKey,
          dryRun: true,
          proposals: renamePlan.proposals,
          missingIds: [],
          changesNeeded: renamePlan.changesNeeded,
          fkReferenceCounts,
          log,
        },
        auditSummary: {
          factoryKey,
          dryRun: true,
          changesNeeded: renamePlan.changesNeeded,
        },
      };
    }

    const proposalsToChange = renamePlan.proposals.filter((proposal) => proposal.needsChange);
    const before = renamePlan.proposals;

    await fSql.begin(async (tx) => {
      for (const proposal of proposalsToChange) {
        const result = await tx.unsafe(
          `UPDATE product_types SET name = $1 WHERE id = $2`,
          [proposal.proposedName, proposal.id]
        );
        log.push(`Updated legacy product ${proposal.id}: ${proposal.currentName} -> ${proposal.proposedName} (${result.count ?? 0})`);
      }

      const verifyRows = await fetchLegacyRenameRows(tx);
      const verifyPlan = buildLegacyRenamePlan(verifyRows);
      if (verifyPlan.missingIds.length > 0 || verifyPlan.changesNeeded) {
        throw new Error("Legacy rename verification failed");
      }
    });

    const afterRows = await fetchLegacyRenameRows(fSql);
    const afterPlan = buildLegacyRenamePlan(afterRows);
    await fSql.end();

    return {
      body: {
        success: true,
        factory: factoryKey,
        dryRun: false,
        changedCount: proposalsToChange.length,
        before,
        after: afterPlan.proposals,
        fkReferenceCounts,
        log,
      },
      auditSummary: {
        factoryKey,
        changedCount: proposalsToChange.length,
      },
    };
  } catch (error) {
    return { status: 500, body: { error: String(error), log } };
  }
}

export async function runCleanupLegacyPricesAction(
  context: MigrateActionContext
): Promise<MigrateActionResult> {
  const factoryKey = context.factoryKey;
  if (!factoryKey) return { status: 400, body: { error: "Missing ?factory= parameter" } };
  const connection = getConfiguredFactoryConnection(factoryKey);
  if (!connection) {
    return { status: 400, body: { error: `No DB configured for factory '${factoryKey}'` } };
  }

  const legacyIds = STALE_PRICE_PRODUCT_IDS;
  const log: string[] = [];
  try {
    const pg = (await import("postgres")).default;
    const fSql = pg(connection.url, { max: 1, connect_timeout: 15 });

    const before = await fSql`SELECT product_type_id as pid, COUNT(*)::int as cnt FROM customer_prices WHERE product_type_id = ANY(${legacyIds}) GROUP BY product_type_id ORDER BY product_type_id`;
    for (const r of before) {
      log.push(`Before: product ${r.pid} has ${r.cnt} price rows`);
    }
    const totalBefore = normalizeProductRefCounts(before as Iterable<{ pid: unknown; cnt: unknown }>).reduce(
      (sum, row) => sum + row.cnt,
      0
    );
    const deleted = await fSql`DELETE FROM customer_prices WHERE product_type_id = ANY(${legacyIds})`;
    const [remaining] = await fSql`SELECT COUNT(*)::int as cnt FROM customer_prices`;
    await fSql.end();

    return {
      body: {
        success: true,
        factory: factoryKey,
        deletedRows: deleted.count,
        remainingRows: remaining.cnt,
        log,
      },
      auditSummary: {
        factoryKey,
        deletedRows: Number(deleted.count ?? 0),
        totalBefore,
      },
    };
  } catch (error) {
    return { status: 500, body: { error: String(error), log } };
  }
}
