import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import type { MigrateActionContext, MigrateActionResult } from "./types";
import {
  FK_COL,
  FK_TABLES,
  getConfiguredFactoryConnection,
  normalizeProductRefCounts,
  normalizeProducts,
} from "./shared";

export async function runCheckProductsAction(
  context: MigrateActionContext
): Promise<MigrateActionResult> {
  const factoryKey = context.factoryKey;
  if (!factoryKey) {
    return { status: 400, body: { error: "Missing ?factory= parameter" } };
  }

  const connection = getConfiguredFactoryConnection(factoryKey);
  if (!connection) {
    return {
      status: 400,
      body: { error: `No DB configured for factory '${factoryKey}'` },
    };
  }

  try {
    const pg = (await import("postgres")).default;
    const fSql = pg(connection.url, { max: 1, connect_timeout: 15 });

    const products = await fSql`
      SELECT
        id,
        name,
        name_en,
        has_bag,
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

    const fkCounts: Record<string, { product_id: number; count: number }[]> = {};
    for (const tbl of FK_TABLES) {
      const rows = await fSql.unsafe(
        `SELECT ${FK_COL} as pid, COUNT(*)::int as cnt FROM ${tbl} GROUP BY ${FK_COL} ORDER BY ${FK_COL}`
      );
      fkCounts[tbl] = normalizeProductRefCounts(
        rows as Iterable<{ pid: unknown; cnt: unknown }>
      ).map((r) => ({
        product_id: r.pid,
        count: r.cnt,
      }));
    }

    const totalRows: Record<string, number> = {};
    for (const tbl of FK_TABLES) {
      const [row] = await fSql.unsafe(`SELECT COUNT(*)::int as cnt FROM ${tbl}`);
      totalRows[tbl] = Number(row.cnt);
    }

    const typedProducts = normalizeProducts(products as Iterable<Record<string, unknown>>);
    const alreadyMigrated =
      typedProducts.length >= 30 && typedProducts.some((p) => p.id >= 91);
    const productIds = typedProducts.map((p) => p.id);

    await fSql.end();
    return {
      body: {
        factory: factoryKey,
        productCount: typedProducts.length,
        products: typedProducts.map((p) => ({
          id: p.id,
          name: p.name,
          name_en: p.name_en,
          has_bag: p.has_bag,
          is_active: p.is_active,
          catalog_code: p.catalog_code ?? null,
          family: p.family ?? null,
          form: p.form ?? null,
          package_type: p.package_type ?? null,
          size_value: p.size_value ?? null,
          size_unit: p.size_unit ?? null,
          size_label: p.size_label ?? null,
        })),
        fkReferenceCounts: fkCounts,
        totalRows,
        alreadyMigrated,
        idRange: {
          min: productIds.length > 0 ? Math.min(...productIds) : null,
          max: productIds.length > 0 ? Math.max(...productIds) : null,
        },
      },
      auditSummary: {
        factoryKey,
        productCount: typedProducts.length,
        alreadyMigrated,
      },
    };
  } catch (error) {
    return { status: 500, body: { error: String(error) } };
  }
}

export async function runStatusAction(): Promise<MigrateActionResult> {
  try {
    const db = await getDb();
    const enumValues = await db.execute(
      sql`SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'user_role' ORDER BY enumsortorder`
    );
    const createdByCol = await db.execute(
      sql`SELECT 1 as ok FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'created_by'`
    );
    const voidedByCol = await db.execute(
      sql`SELECT 1 as ok FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'voided_by'`
    );
    const voidReasonCol = await db.execute(
      sql`SELECT 1 as ok FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'void_reason'`
    );
    const auditTable = await db.execute(
      sql`SELECT 1 as ok FROM information_schema.tables WHERE table_name = 'audit_log'`
    );
    const migrateAuditTable = await db.execute(
      sql`SELECT 1 as ok FROM information_schema.tables WHERE table_name = 'migrate_audit_log'`
    );
    const prodCreatedBy = await db.execute(
      sql`SELECT 1 as ok FROM information_schema.columns WHERE table_name = 'production_logs' AND column_name = 'created_by'`
    );
    const bagCreatedBy = await db.execute(
      sql`SELECT 1 as ok FROM information_schema.columns WHERE table_name = 'bag_ledger' AND column_name = 'created_by'`
    );
    const counts = await db.execute(sql`
      SELECT 'users' as tbl, COUNT(*)::int as cnt FROM users
      UNION ALL SELECT 'transactions', COUNT(*)::int FROM transactions
      UNION ALL SELECT 'customers', COUNT(*)::int FROM customers
    `);
    const roles = await db.execute(
      sql`SELECT role, COUNT(*)::int as cnt FROM users GROUP BY role ORDER BY role`
    );

    return {
      body: {
        migrationStatus: {
          userRoleEnumValues: Array.from(enumValues as Iterable<{ enumlabel: string }>).map(
            (r) => r.enumlabel
          ),
          transactions_created_by: Array.from(createdByCol).length > 0,
          transactions_voided_by: Array.from(voidedByCol).length > 0,
          transactions_void_reason: Array.from(voidReasonCol).length > 0,
          audit_log_table: Array.from(auditTable).length > 0,
          migrate_audit_log_table: Array.from(migrateAuditTable).length > 0,
          production_logs_created_by: Array.from(prodCreatedBy).length > 0,
          bag_ledger_created_by: Array.from(bagCreatedBy).length > 0,
        },
        rowCounts: Array.from(counts),
        userRoles: Array.from(roles),
      },
      auditSummary: {
        checked: "status",
      },
    };
  } catch (error) {
    return { status: 500, body: { error: String(error) } };
  }
}
