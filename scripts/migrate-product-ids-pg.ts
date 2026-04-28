/**
 * Product ID Migration for PostgreSQL (local test)
 *
 * Reorganises product_types across all factory databases to a unified scheme:
 *   1-18   New ice products
 *   41-56  Unified dry goods (SI list)
 *   91-96  Legacy ice products
 *
 * Usage:
 *   npx tsx scripts/migrate-product-ids-pg.ts            # execute
 *   npx tsx scripts/migrate-product-ids-pg.ts --dry-run   # preview only
 */

import postgres from "postgres";
import * as fs from "fs";
import * as path from "path";
import {
  NEW_ICE_PRODUCTS,
  DRY_GOODS,
  LEGACY_ICE,
  LEGACY_BY_ID,
  LEGACY_BY_NAME,
  DRY_BY_NAME,
  NEW_ICE_BY_NAME,
  ALL_FINAL_IDS,
  FK_TABLES,
  FK_COL,
  TEMP_OFFSET,
} from "../src/lib/product-definitions";

// ── CLI flags ────────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes("--dry-run");

// ── Factory DB config ────────────────────────────────────────────────────────
const FACTORY_ENV = [
  { key: "si", envVar: "DATABASE_URL_SI" },
  { key: "bearing", envVar: "DATABASE_URL_BEARING" },
  { key: "ktk", envVar: "DATABASE_URL_KTK" },
];

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const text = fs.readFileSync(filePath, "utf8");
  const out: Record<string, string> = {};
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}

function loadDatabaseUrls(): Record<string, string> {
  const envFromFile = parseEnvFile(path.join(process.cwd(), ".env.local"));
  const getVar = (name: string) => process.env[name] || envFromFile[name];
  const urls: Record<string, string> = {};
  for (const f of FACTORY_ENV) {
    const url = getVar(f.envVar);
    if (url) urls[f.key] = url;
  }
  return urls;
}

// ── Types ────────────────────────────────────────────────────────────────────

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
  category: "legacy" | "dry" | "new_ice" | "orphan_dry";
}

// ── Core migration logic ─────────────────────────────────────────────────────

async function migrateFactory(factoryKey: string, dbUrl: string) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`  Factory: ${factoryKey.toUpperCase()}`);
  console.log(`${"=".repeat(70)}\n`);

  const sql = postgres(dbUrl, { max: 3 });

  try {
    // ── 1. Query current state ───────────────────────────────────────────
    const currentProducts: ExistingProduct[] = await sql`
      SELECT id, name, name_en, has_bag, is_active, sort_order
      FROM product_types ORDER BY id
    `;
    console.log(`Current product_types: ${currentProducts.length} rows`);
    for (const p of currentProducts) {
      console.log(`  ID ${String(p.id).padStart(3)}: ${p.name} (${p.name_en || "-"}) bag=${p.has_bag ? "Y" : "N"}`);
    }

    // Pre-migration FK reference counts per product
    const preCounts: Record<string, { table: string; productId: number; count: number }[]> = {};
    for (const tbl of FK_TABLES) {
      const rows = await sql.unsafe(
        `SELECT ${FK_COL} as pid, COUNT(*)::int as cnt FROM ${tbl} GROUP BY ${FK_COL} ORDER BY ${FK_COL}`
      );
      preCounts[tbl] = rows.map((r: any) => ({ table: tbl, productId: r.pid, count: r.cnt }));
    }

    console.log("\nPre-migration FK reference counts:");
    for (const tbl of FK_TABLES) {
      const total = preCounts[tbl].reduce((s, r) => s + r.count, 0);
      console.log(`  ${tbl}: ${total} total rows`);
      for (const r of preCounts[tbl]) {
        const pName = currentProducts.find((p) => p.id === r.productId)?.name || "???";
        console.log(`    product_id=${r.productId} (${pName}): ${r.count}`);
      }
    }

    // ── 2. Build mapping ─────────────────────────────────────────────────
    const mappings: IdMapping[] = [];
    const usedNewIds = new Set<number>();
    const unmappedProducts: ExistingProduct[] = [];

    for (const p of currentProducts) {
      // Check legacy ice by name
      const legacy = LEGACY_BY_ID.get(p.id) ?? LEGACY_BY_NAME.get(p.name);
      if (legacy) {
        mappings.push({ oldId: p.id, newId: legacy.newId, name: p.name, category: "legacy" });
        usedNewIds.add(legacy.newId);
        continue;
      }

      // Check new ice by name (already at correct ID?)
      const newIce = NEW_ICE_BY_NAME.get(p.name);
      if (newIce) {
        mappings.push({ oldId: p.id, newId: newIce.id, name: p.name, category: "new_ice" });
        usedNewIds.add(newIce.id);
        continue;
      }

      // Check dry goods by name
      const dry = DRY_BY_NAME.get(p.name);
      if (dry) {
        mappings.push({ oldId: p.id, newId: dry.id, name: p.name, category: "dry" });
        usedNewIds.add(dry.id);
        continue;
      }

      // Unmatched -- factory-specific dry good or unknown
      unmappedProducts.push(p);
    }

    // Assign orphan dry goods to IDs 57+ (preserving data, marking inactive)
    let orphanId = 57;
    for (const p of unmappedProducts) {
      // Check if this product has any FK references at all
      let hasRefs = false;
      for (const tbl of FK_TABLES) {
        const refRow = preCounts[tbl].find((r) => r.productId === p.id);
        if (refRow && refRow.count > 0) { hasRefs = true; break; }
      }
      if (hasRefs) {
        while (ALL_FINAL_IDS.has(orphanId) || usedNewIds.has(orphanId)) orphanId++;
        mappings.push({ oldId: p.id, newId: orphanId, name: p.name, category: "orphan_dry" });
        usedNewIds.add(orphanId);
        orphanId++;
      } else {
        console.log(`  Dropping unreferenced product ID ${p.id}: ${p.name}`);
      }
    }

    console.log("\nID Mapping:");
    for (const m of mappings) {
      const arrow = m.oldId === m.newId ? " (no change)" : ` -> ${m.newId}`;
      console.log(`  [${m.category.padEnd(10)}] ID ${String(m.oldId).padStart(3)}${arrow}  ${m.name}`);
    }

    if (DRY_RUN) {
      console.log("\n  *** DRY RUN — no changes applied ***\n");
      await sql.end();
      return;
    }

    // ── 3. Execute migration in a transaction ────────────────────────────
    await sql.begin(async (tx) => {
      // Disable FK triggers so we can freely update IDs
      await tx.unsafe("SET session_replication_role = 'replica'");

      // Phase 1: move all FK references from old_id -> temp_id (old+TEMP_OFFSET)
      console.log("\nPhase 1: Remapping FK refs to temp IDs...");
      for (const m of mappings) {
        const tempId = m.oldId + TEMP_OFFSET;
        for (const tbl of FK_TABLES) {
          const result = await tx.unsafe(
            `UPDATE ${tbl} SET ${FK_COL} = $1 WHERE ${FK_COL} = $2`,
            [tempId, m.oldId]
          );
          if (result.count > 0) {
            console.log(`  ${tbl}: ${m.oldId} -> ${tempId} (${result.count} rows)`);
          }
        }
      }

      // Delete all existing product_types
      console.log("\nDeleting all existing product_types...");
      const deleted = await tx`DELETE FROM product_types`;
      console.log(`  Deleted ${deleted.count} product_types rows`);

      // Insert canonical products
      console.log("\nInserting canonical product_types...");

      // New ice (1-18)
      for (const p of NEW_ICE_PRODUCTS) {
        await tx`
          INSERT INTO product_types (id, name, name_en, has_bag, is_active, sort_order)
          VALUES (${p.id}, ${p.name}, ${p.nameEn}, ${p.hasBag}, true, ${p.sortOrder})
        `;
      }
      console.log(`  Inserted ${NEW_ICE_PRODUCTS.length} new ice products (1-18)`);

      // Dry goods (41-56)
      for (const d of DRY_GOODS) {
        await tx`
          INSERT INTO product_types (id, name, name_en, has_bag, decreases_bag, is_active, sort_order)
          VALUES (${d.id}, ${d.name}, ${null}, false, ${d.decreasesBag ?? false}, true, ${d.id})
        `;
      }
      console.log(`  Inserted ${DRY_GOODS.length} dry goods (41-56)`);

      // Legacy ice (91-96)
      for (const l of LEGACY_ICE) {
        await tx`
          INSERT INTO product_types (id, name, name_en, has_bag, is_active, sort_order)
          VALUES (${l.newId}, ${l.name}, ${l.nameEn}, ${l.hasBag}, true, ${l.newId})
        `;
      }
      console.log(`  Inserted ${LEGACY_ICE.length} legacy ice products (91-96)`);

      // Orphan dry goods (57+)
      const orphans = mappings.filter((m) => m.category === "orphan_dry");
      for (const o of orphans) {
        const orig = currentProducts.find((p) => p.id === o.oldId)!;
        await tx`
          INSERT INTO product_types (id, name, name_en, has_bag, is_active, sort_order)
          VALUES (${o.newId}, ${orig.name}, ${orig.name_en}, ${orig.has_bag}, false, ${o.newId})
        `;
      }
      if (orphans.length > 0) {
        console.log(`  Inserted ${orphans.length} orphan dry goods (57+, inactive)`);
      }

      // Phase 2: remap FK refs from temp_id -> final_id
      console.log("\nPhase 2: Remapping FK refs from temp -> final IDs...");
      for (const m of mappings) {
        const tempId = m.oldId + TEMP_OFFSET;
        for (const tbl of FK_TABLES) {
          const result = await tx.unsafe(
            `UPDATE ${tbl} SET ${FK_COL} = $1 WHERE ${FK_COL} = $2`,
            [m.newId, tempId]
          );
          if (result.count > 0) {
            console.log(`  ${tbl}: ${tempId} -> ${m.newId} (${result.count} rows)`);
          }
        }
      }

      // Re-enable FK triggers
      await tx.unsafe("SET session_replication_role = 'origin'");

      // Reset sequence
      const [maxRow] = await tx`SELECT COALESCE(MAX(id), 0) + 1 as next_val FROM product_types`;
      await tx.unsafe(
        `SELECT setval(pg_get_serial_sequence('product_types', 'id'), $1, false)`,
        [maxRow.next_val]
      );
      console.log(`\nSequence reset: next auto-ID = ${maxRow.next_val}`);

      // ── 4. Verification ──────────────────────────────────────────────
      console.log("\n--- Verification ---");
      let allGood = true;

      // 4a. Total FK row counts must be unchanged
      for (const tbl of FK_TABLES) {
        const preTotal = preCounts[tbl].reduce((s, r) => s + r.count, 0);
        const [postRow] = await tx.unsafe(`SELECT COUNT(*)::int as cnt FROM ${tbl}`);
        const postTotal = postRow.cnt;
        const ok = preTotal === postTotal;
        if (!ok) allGood = false;
        console.log(`  ${tbl}: before=${preTotal} after=${postTotal} ${ok ? "OK" : "MISMATCH!"}`);
      }

      // 4b. Per-product reference counts: old ID X count must equal new ID Y count
      console.log("\n  Per-product reference verification:");
      for (const m of mappings) {
        for (const tbl of FK_TABLES) {
          const preRef = preCounts[tbl].find((r) => r.productId === m.oldId);
          const preCount = preRef ? preRef.count : 0;
          if (preCount === 0) continue;

          const [postRow] = await tx.unsafe(
            `SELECT COUNT(*)::int as cnt FROM ${tbl} WHERE ${FK_COL} = $1`,
            [m.newId]
          );
          const postCount = postRow.cnt;
          const ok = preCount === postCount;
          if (!ok) allGood = false;
          console.log(
            `    ${tbl} ID ${m.oldId}->${m.newId} (${m.name}): ${preCount} -> ${postCount} ${ok ? "OK" : "MISMATCH!"}`
          );
        }
      }

      // 4c. No orphan FK references (all product_type_ids exist in product_types)
      console.log("\n  FK integrity checks:");
      for (const tbl of FK_TABLES) {
        const [orphanRow] = await tx.unsafe(
          `SELECT COUNT(*)::int as cnt FROM ${tbl} t
           LEFT JOIN product_types pt ON t.${FK_COL} = pt.id
           WHERE pt.id IS NULL`
        );
        const orphanCount = orphanRow.cnt;
        const ok = orphanCount === 0;
        if (!ok) allGood = false;
        console.log(`    ${tbl} -> product_types: ${ok ? "OK" : `${orphanCount} orphans!`}`);
      }

      // 4d. No temp IDs remaining
      console.log("\n  Temp ID leak check:");
      for (const tbl of FK_TABLES) {
        const [leakRow] = await tx.unsafe(
          `SELECT COUNT(*)::int as cnt FROM ${tbl} WHERE ${FK_COL} >= $1`,
          [TEMP_OFFSET]
        );
        const ok = leakRow.cnt === 0;
        if (!ok) allGood = false;
        console.log(`    ${tbl}: ${ok ? "OK" : `${leakRow.cnt} rows with temp IDs!`}`);
      }

      // 4e. Final product list
      const finalProducts = await tx`
        SELECT id, name, name_en, has_bag, is_active, sort_order
        FROM product_types ORDER BY sort_order, id
      `;
      console.log(`\n  Final product list (${finalProducts.length} total):`);
      for (const p of finalProducts) {
        const cat = p.id <= 18 ? "ICE " : p.id <= 60 ? "DRY " : p.id <= 96 ? "LEGACY" : "OTHER";
        const active = p.is_active ? "" : " [INACTIVE]";
        console.log(
          `    [${cat}] ID ${String(p.id).padStart(3)}: ${p.name} (${p.name_en || "-"}) bag=${p.has_bag ? "Y" : "N"}${active}`
        );
      }

      if (!allGood) {
        throw new Error("Verification FAILED — rolling back transaction");
      }

      console.log("\n  All verifications PASSED.");
    });

    console.log(`\n  Factory ${factoryKey.toUpperCase()} migration COMMITTED successfully.\n`);
  } catch (err: any) {
    console.error(`\n  !!! Factory ${factoryKey.toUpperCase()} FAILED: ${err.message}`);
    console.error("  Transaction rolled back — no changes applied.\n");
    throw err;
  } finally {
    await sql.end();
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  SuperICE Product ID Migration (Local PostgreSQL)       ║");
  console.log("║  Scheme: 1-18 ice · 41-56 dry · 91-96 legacy           ║");
  console.log(`║  Mode: ${DRY_RUN ? "DRY RUN (no changes)" : "LIVE EXECUTION"}${" ".repeat(DRY_RUN ? 16 : 20)}║`);
  console.log("╚══════════════════════════════════════════════════════════╝");

  const dbUrls = loadDatabaseUrls();
  const factories = Object.keys(dbUrls);

  if (factories.length === 0) {
    console.error("No factory DB URLs found. Set DATABASE_URL_SI / _BEARING / _KTK in .env.local");
    process.exit(1);
  }

  console.log(`\nFound ${factories.length} factory databases: ${factories.join(", ")}`);

  let failCount = 0;
  for (const factory of factories) {
    try {
      await migrateFactory(factory, dbUrls[factory]);
    } catch {
      failCount++;
    }
  }

  console.log("\n" + "=".repeat(70));
  if (failCount > 0) {
    console.log(`  DONE with ${failCount} failure(s). Check output above.`);
    process.exit(1);
  } else {
    console.log("  ALL FACTORIES MIGRATED SUCCESSFULLY.");
  }
  console.log("=".repeat(70) + "\n");
}

main();
