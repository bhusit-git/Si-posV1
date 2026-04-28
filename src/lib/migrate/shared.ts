import { NextResponse, type NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import type { Sql } from "postgres";
import { getMainDb } from "@/db";
import {
  FK_COL,
  FK_TABLES,
  TEMP_OFFSET,
} from "@/lib/product-definitions";
import {
  normalizeSyncableProducts,
  type SyncableProduct,
} from "@/lib/product-sync";
import { getClientIpFromHeaders } from "@/lib/request-security";
import { getSupericeMigrateEnv } from "@/lib/config/env";
import { DiagnosticError } from "@/lib/diagnostic-error";
import { FACTORY_CONFIGS, type FactoryDbKey } from "@/lib/shared/db-runtime";
import type {
  MigrateActionContext,
  MigrateActionDefinition,
  ProductRefCount,
  ProductSnapshot,
  SeedPasswordMap,
  TableNameRow,
} from "./types";

export const FACTORY_KEYS: readonly FactoryDbKey[] = FACTORY_CONFIGS.map((factory) => factory.key);

export const USER_FK_DROP_TARGETS = [
  { table: "transactions", constraint: "transactions_created_by_users_id_fk" },
  { table: "transactions", constraint: "transactions_voided_by_users_id_fk" },
  { table: "production_logs", constraint: "production_logs_created_by_users_id_fk" },
  { table: "bag_ledger", constraint: "bag_ledger_created_by_users_id_fk" },
  { table: "audit_log", constraint: "audit_log_user_id_users_id_fk" },
  { table: "invoices", constraint: "invoices_issued_by_users_id_fk" },
  { table: "invoices", constraint: "invoices_voided_by_users_id_fk" },
  { table: "invoices", constraint: "invoices_created_by_users_id_fk" },
  { table: "invoice_payments", constraint: "invoice_payments_created_by_users_id_fk" },
  { table: "payment_events", constraint: "payment_events_created_by_users_id_fk" },
  { table: "idempotency_keys", constraint: "idempotency_keys_created_by_users_id_fk" },
] as const;

export function normalizeProducts(rows: Iterable<Record<string, unknown>>): ProductSnapshot[] {
  return Array.from(rows).map((row) => ({
    id: Number(row.id),
    name: String(row.name ?? ""),
    name_en: row.name_en == null ? null : String(row.name_en),
    has_bag: Boolean(row.has_bag),
    is_active: Boolean(row.is_active),
    sort_order: row.sort_order == null ? undefined : Number(row.sort_order),
    catalog_code: row.catalog_code == null ? null : Number(row.catalog_code),
    family: row.family == null ? null : String(row.family),
    form: row.form == null ? null : String(row.form),
    package_type: row.package_type == null ? null : String(row.package_type),
    size_value: row.size_value == null ? null : Number(row.size_value),
    size_unit: row.size_unit == null ? null : String(row.size_unit),
    size_label: row.size_label == null ? null : String(row.size_label),
  }));
}

export function normalizeProductRefCounts(
  rows: Iterable<{ pid: unknown; cnt: unknown }>
): ProductRefCount[] {
  return Array.from(rows).map((row) => ({
    pid: Number(row.pid),
    cnt: Number(row.cnt),
  }));
}

export function normalizeTableNames(rows: Iterable<Record<string, unknown>>): TableNameRow[] {
  return Array.from(rows).map((row) => ({
    tablename: String(row.tablename ?? ""),
  }));
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function fetchFactoryProducts(sqlClient: Sql): Promise<SyncableProduct[]> {
  const rows = await sqlClient`
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

export async function fetchFactoryProductsUnsafe(sqlClient: {
  unsafe: (query: string, params?: ReadonlyArray<unknown>) => Promise<ReadonlyArray<Record<string, unknown>>>;
}): Promise<SyncableProduct[]> {
  const rows = await sqlClient.unsafe(
    `SELECT
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
     ORDER BY id`
  );
  return normalizeSyncableProducts(rows as Iterable<Record<string, unknown>>);
}

export async function fetchProductReferenceCounts(
  sqlClient: Sql,
  ids: number[]
): Promise<Record<string, { product_id: number; count: number }[]>> {
  const counts = Object.fromEntries(FK_TABLES.map((tableName) => [tableName, []])) as Record<
    string,
    { product_id: number; count: number }[]
  >;

  if (ids.length === 0) return counts;

  for (const tableName of FK_TABLES) {
    const rows = await sqlClient.unsafe(
      `SELECT ${FK_COL} AS product_id, COUNT(*)::int AS count
       FROM ${tableName}
       WHERE ${FK_COL} = ANY($1::int[])
       GROUP BY ${FK_COL}
       ORDER BY ${FK_COL}`,
      [ids]
    );
    counts[tableName] = Array.from(rows as Iterable<Record<string, unknown>>).map((row) => ({
      product_id: Number(row.product_id),
      count: Number(row.count),
    }));
  }

  return counts;
}

export function isIsoDate(value: string | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

export function isIsoTime(value: string | null): value is string {
  return Boolean(value && /^\d{2}:\d{2}:\d{2}$/.test(value));
}

export function authorizeMigrationRequest(
  request: NextRequest
): { ok: true; callerIp: string } | { ok: false; response: NextResponse } {
  const migrateEnv = getSupericeMigrateEnv();
  if (!migrateEnv.migrateKey) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Migration endpoint is disabled" }, { status: 403 }),
    };
  }
  if (migrateEnv.isProduction && !migrateEnv.migrateEnabled) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Migration endpoint is disabled in production" },
        { status: 403 }
      ),
    };
  }

  const callerIp = getClientIpFromHeaders(request.headers);
  if (migrateEnv.migrateAllowedIps.length > 0 && !migrateEnv.migrateAllowedIps.includes(callerIp)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "IP address is not allowed" }, { status: 403 }),
    };
  }

  const authHeader = request.headers.get("authorization");
  const token =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : null;
  if (!token || token !== migrateEnv.migrateKey) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true, callerIp };
}

export function getSeedPasswords(): SeedPasswordMap {
  const migrateEnv = getSupericeMigrateEnv();
  if (!migrateEnv.migrateV5SeedPasswordsJson) {
    throw new DiagnosticError("Missing MIGRATE_V5_SEED_PASSWORDS_JSON", {
      code: "SRV-CONFIG-1002",
      category: "server.config",
      source: "migrate.config",
      operation: "read-seed-passwords",
      title: "Migration seed passwords are not configured",
      hint: "ตั้งค่า MIGRATE_V5_SEED_PASSWORDS_JSON ก่อนเรียกใช้งาน migration นี้",
      retryable: false,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(migrateEnv.migrateV5SeedPasswordsJson);
  } catch {
    throw new DiagnosticError("MIGRATE_V5_SEED_PASSWORDS_JSON must be valid JSON", {
      code: "SRV-CONFIG-1003",
      category: "server.config",
      source: "migrate.config",
      operation: "parse-seed-passwords",
      title: "Migration seed password config is invalid",
      hint: "ตรวจสอบว่า MIGRATE_V5_SEED_PASSWORDS_JSON เป็น JSON ที่ถูกต้อง",
      retryable: false,
    });
  }
  if (!parsed || typeof parsed !== "object") {
    throw new DiagnosticError("MIGRATE_V5_SEED_PASSWORDS_JSON must be an object", {
      code: "SRV-CONFIG-1004",
      category: "server.config",
      source: "migrate.config",
      operation: "validate-seed-passwords",
      title: "Migration seed password config has the wrong shape",
      hint: "ตั้งค่า MIGRATE_V5_SEED_PASSWORDS_JSON เป็น object map ของรหัสผ่าน",
      retryable: false,
    });
  }
  return parsed as SeedPasswordMap;
}

export function getConfiguredFactoryConnection(factoryKey: string): {
  envVar: string;
  url: string;
} | null {
  const migrateEnv = getSupericeMigrateEnv();
  const envVar = migrateEnv.getFactoryEnvVarName(factoryKey);
  const url = migrateEnv.getFactoryDatabaseUrl(factoryKey);
  if (!envVar || !url) return null;
  return { envVar, url };
}

export async function dropUserForeignKeysOnFactoryDbs(): Promise<string[]> {
  const pg = (await import("postgres")).default;
  const logs: string[] = [];
  const migrateEnv = getSupericeMigrateEnv();

  for (const factoryKey of FACTORY_KEYS) {
    const envVar = migrateEnv.getFactoryEnvVarName(factoryKey);
    const url = migrateEnv.getFactoryDatabaseUrl(factoryKey);
    if (!url) {
      logs.push(`Skip factory '${factoryKey}': ${envVar || "DATABASE_URL_?"} is not configured`);
      continue;
    }

    const fSql = pg(url, { max: 1, connect_timeout: 15 });
    try {
      for (const target of USER_FK_DROP_TARGETS) {
        const [tableExistsRow] = await fSql`
          SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = ${target.table}
          ) AS present
        `;

        if (!tableExistsRow?.present) {
          logs.push(`Factory '${factoryKey}': table '${target.table}' does not exist`);
          continue;
        }

        await fSql.unsafe(
          `ALTER TABLE "${target.table}" DROP CONSTRAINT IF EXISTS "${target.constraint}"`
        );
        logs.push(
          `Factory '${factoryKey}': dropped ${target.table}.${target.constraint} if present`
        );
      }
    } finally {
      await fSql.end();
    }
  }

  return logs;
}

export function parseQueryDryRun(mode: "query-opt-in" | "query-opt-out", request: NextRequest): boolean {
  if (mode === "query-opt-out") {
    return request.nextUrl.searchParams.get("dryRun") !== "0";
  }
  return request.nextUrl.searchParams.get("dryRun") === "1";
}

export function createMigrateContext(
  request: NextRequest,
  action: MigrateActionDefinition,
  callerIp: string
): MigrateActionContext {
  return {
    request,
    name: action.name,
    externalAction: action.externalAction,
    factoryKey: request.nextUrl.searchParams.get("factory"),
    confirmation: request.nextUrl.searchParams.get("confirm"),
    dryRunRequested:
      action.dryRunMode === "disabled"
        ? false
        : parseQueryDryRun(action.dryRunMode, request),
    startedAt: new Date(),
    callerIp,
  };
}

export function requireFactoryActionParam(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("factory");
}

export function requireConfirmation(
  request: NextRequest,
  expectedValue: string
): { ok: true } | { ok: false; response: NextResponse } {
  const confirm = request.nextUrl.searchParams.get("confirm");
  if (confirm !== expectedValue) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `Missing or invalid ?confirm=${expectedValue}` },
        { status: 400 }
      ),
    };
  }
  return { ok: true };
}

export function getFactoryKeysForAudit(definition: MigrateActionDefinition, context: MigrateActionContext): string[] {
  if (definition.factoryScope === "single") {
    return context.factoryKey ? [context.factoryKey] : [];
  }
  if (definition.name === "sync-si-products-to-bearing") {
    return ["si", "bearing"];
  }
  if (definition.factoryScope === "all") {
    return [...FACTORY_KEYS];
  }
  return [];
}

export async function hashSeedPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export function getMainDatabase() {
  return getMainDb();
}

export { getSupericeMigrateEnv };
export { FK_COL, FK_TABLES, TEMP_OFFSET };
