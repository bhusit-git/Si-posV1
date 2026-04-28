import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { asc, gt } from "drizzle-orm";
import { zipSync, type ZipOptions } from "fflate";
import {
  FACTORY_COOKIE,
  getDb,
  getFactories,
  type DrizzleDB,
} from "@/db";
import {
  auditLog,
  bagLedger,
  customerPrices,
  customers,
  paymentEvents,
  productionLogs,
  productTypes,
  transactionItems,
  transactions,
  users,
} from "@/db/schema";
import { getSession } from "@/lib/auth";
import { asDiagnosticError, DiagnosticError } from "@/lib/diagnostic-error";
import { logDiagnosticEvent } from "@/lib/error-logging";

export type PlainRow = Record<string, unknown>;
type TableChunkFetcher = (
  db: DrizzleDB,
  lastId: number,
  limit: number
) => Promise<PlainRow[]>;

export type BackupScope = "full" | "transactions" | "customers";

export interface BackupTableDefinition {
  key: string;
  tableName: string;
  optionalIfMissing: boolean;
  fetchChunk: TableChunkFetcher;
  sanitizeRow?: (row: PlainRow) => PlainRow;
}

interface TableIterationResult {
  count: number;
  warning?: string;
}

interface BackupDownloadOptions {
  scope: BackupScope;
  version: string;
  filenamePrefix: string;
  actorUsername: string;
  batchSize?: number;
  tableDefinitionsOverride?: BackupTableDefinition[];
  dbOverride?: DrizzleDB;
  factoryKeyOverride?: string;
  exportDateOverride?: string;
}

const DEFAULT_BATCH_SIZE = 1000;

function createChunkFetcher(table: {
  id: unknown;
}): TableChunkFetcher {
  return async (db, lastId, limit) => {
    const rows = await db
      .select()
      .from(table as never)
      .where(gt(table.id as never, lastId))
      .orderBy(asc(table.id as never))
      .limit(limit);
    return rows as PlainRow[];
  };
}

const USERS_CHUNK_FETCHER: TableChunkFetcher = async (db, lastId, limit) => {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      factoryKey: users.factoryKey,
    })
    .from(users)
    .where(gt(users.id, lastId))
    .orderBy(asc(users.id))
    .limit(limit);
  return rows as PlainRow[];
};

function getTablesForScope(scope: BackupScope): BackupTableDefinition[] {
  const allTables: Record<string, BackupTableDefinition> = {
    customers: {
      key: "customers",
      tableName: "customers",
      optionalIfMissing: false,
      fetchChunk: createChunkFetcher(customers),
    },
    productTypes: {
      key: "productTypes",
      tableName: "product_types",
      optionalIfMissing: false,
      fetchChunk: createChunkFetcher(productTypes),
    },
    customerPrices: {
      key: "customerPrices",
      tableName: "customer_prices",
      optionalIfMissing: false,
      fetchChunk: createChunkFetcher(customerPrices),
    },
    transactions: {
      key: "transactions",
      tableName: "transactions",
      optionalIfMissing: false,
      fetchChunk: createChunkFetcher(transactions),
    },
    transactionItems: {
      key: "transactionItems",
      tableName: "transaction_items",
      optionalIfMissing: false,
      fetchChunk: createChunkFetcher(transactionItems),
    },
    bagLedger: {
      key: "bagLedger",
      tableName: "bag_ledger",
      optionalIfMissing: false,
      fetchChunk: createChunkFetcher(bagLedger),
    },
    productionLogs: {
      key: "productionLogs",
      tableName: "production_logs",
      optionalIfMissing: true,
      fetchChunk: createChunkFetcher(productionLogs),
    },
    auditLog: {
      key: "auditLog",
      tableName: "audit_log",
      optionalIfMissing: true,
      fetchChunk: createChunkFetcher(auditLog),
    },
    users: {
      key: "users",
      tableName: "users",
      optionalIfMissing: true,
      fetchChunk: USERS_CHUNK_FETCHER,
    },
    paymentEvents: {
      key: "paymentEvents",
      tableName: "payment_events",
      optionalIfMissing: true,
      fetchChunk: createChunkFetcher(paymentEvents),
    },
  };

  if (scope === "customers") {
    return [allTables.customers, allTables.customerPrices, allTables.productTypes];
  }
  if (scope === "transactions") {
    return [
      allTables.transactions,
      allTables.transactionItems,
      allTables.bagLedger,
      allTables.paymentEvents,
    ];
  }
  return [
    allTables.customers,
    allTables.productTypes,
    allTables.customerPrices,
    allTables.transactions,
    allTables.transactionItems,
    allTables.bagLedger,
    allTables.productionLogs,
    allTables.auditLog,
    allTables.users,
  ];
}

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const errorCode = (error as { code?: unknown }).code;
  if (errorCode === "42P01") return true;
  const message = `${(error as { message?: unknown }).message || ""}`.toLowerCase();
  return message.includes("does not exist") && message.includes("relation");
}

function toCsvValue(value: unknown): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
  return value;
}

function rowToCsvLine(row: PlainRow, headers: string[]): string {
  return headers
    .map((header) => escapeCsv(toCsvValue(row[header])))
    .join(",");
}

function normalizeRow(row: PlainRow, sanitizeRow?: (row: PlainRow) => PlainRow): PlainRow {
  return sanitizeRow ? sanitizeRow(row) : row;
}

function buildOptionalTableWarning(tableName: string): string {
  return `Skipped optional table '${tableName}' because it does not exist in this factory database.`;
}

async function iterateTableRows(params: {
  db: DrizzleDB;
  tableDef: BackupTableDefinition;
  batchSize: number;
  onRow: (row: PlainRow) => void;
}): Promise<TableIterationResult> {
  const { db, tableDef, batchSize, onRow } = params;
  let count = 0;
  let lastId = 0;

  try {
    while (true) {
      const rows = await tableDef.fetchChunk(db, lastId, batchSize);
      if (rows.length === 0) break;

      for (const row of rows) {
        onRow(normalizeRow(row, tableDef.sanitizeRow));
        count += 1;
      }

      const tailId = Number(rows[rows.length - 1].id);
      if (!Number.isFinite(tailId) || tailId <= lastId) {
        throw new DiagnosticError(
          `Invalid chunk cursor for table '${tableDef.tableName}'. Expected ascending numeric id.`,
          {
            code: "BACKUP-IO-1002",
            category: "backup.io",
            source: "backup.export",
            operation: "iterate-table",
            title: "Backup export cursor became invalid",
            hint: "ข้อมูลสำรองอ่านต่อไม่ได้เพราะลำดับ id ของตารางไม่เป็นไปตามที่คาดไว้",
            retryable: false,
            safeContext: {
              tableName: tableDef.tableName,
            },
          }
        );
      }
      lastId = tailId;
    }

    return { count };
  } catch (error) {
    if (tableDef.optionalIfMissing && isMissingRelationError(error)) {
      return { count: 0, warning: buildOptionalTableWarning(tableDef.tableName) };
    }
    throw error;
  }
}

export async function resolveBackupFactoryKey(): Promise<string> {
  const session = await getSession();
  if (session?.factoryKey) return session.factoryKey;

  const availableFactories = getFactories();
  const validKeys = new Set(availableFactories.map((factory) => factory.key));
  const cookieStore = await cookies();
  const cookieFactory = cookieStore.get(FACTORY_COOKIE)?.value;
  if (cookieFactory && validKeys.has(cookieFactory)) return cookieFactory;

  return availableFactories[0]?.key || "default";
}

export async function createJsonBackupDownloadResponse({
  scope,
  version,
  filenamePrefix,
  actorUsername,
  batchSize = DEFAULT_BATCH_SIZE,
  tableDefinitionsOverride,
  dbOverride,
  factoryKeyOverride,
  exportDateOverride,
}: BackupDownloadOptions): Promise<NextResponse> {
  const startedAt = Date.now();
  const exportDate = exportDateOverride || new Date().toISOString();
  const factoryKey = factoryKeyOverride || (await resolveBackupFactoryKey());
  const db = dbOverride || (await getDb());
  const tables = tableDefinitionsOverride || getTablesForScope(scope);
  const warnings: string[] = [];
  const counts: Record<string, number> = {};
  const encoder = new TextEncoder();
  let outputBytes = 0;

  console.info("[backup] json export started", {
    actorUsername,
    scope,
    factoryKey,
    tableKeys: tables.map((table) => table.key),
  });

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void (async () => {
        try {
          const enqueueChunk = (chunk: string) => {
            const bytes = encoder.encode(chunk);
            outputBytes += bytes.byteLength;
            controller.enqueue(bytes);
          };

          enqueueChunk(
            `{"exportDate":"${exportDate}","version":"${version}","factoryKey":"${factoryKey}","tables":{`
          );

          for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
            const tableDef = tables[tableIndex];
            enqueueChunk(`${tableIndex > 0 ? "," : ""}"${tableDef.key}":[`);
            let rowWritten = false;

            const result = await iterateTableRows({
              db,
              tableDef,
              batchSize,
              onRow: (row) => {
                enqueueChunk(`${rowWritten ? "," : ""}${JSON.stringify(row)}`);
                rowWritten = true;
              },
            });
            counts[tableDef.key] = result.count;
            if (result.warning) {
              warnings.push(result.warning);
            }

            enqueueChunk("]");
          }

          enqueueChunk(`},"counts":${JSON.stringify(counts)},"warnings":${JSON.stringify(warnings)}}`);
          controller.close();

          console.info("[backup] json export completed", {
            actorUsername,
            scope,
            factoryKey,
            counts,
            warningsCount: warnings.length,
            durationMs: Date.now() - startedAt,
            outputBytes,
          });
        } catch (error) {
          logDiagnosticEvent({
            level: "error",
            message: "[backup] json export failed",
            error,
            source: "backup.export",
            operation: "json-stream",
            context: {
              actorUsername,
              scope,
              factoryKey,
              durationMs: Date.now() - startedAt,
              outputBytes,
            },
          });
          controller.error(error);
        }
      })();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}

export async function createCsvZipBackupDownloadResponse({
  scope,
  version,
  filenamePrefix,
  actorUsername,
  batchSize = DEFAULT_BATCH_SIZE,
  tableDefinitionsOverride,
  dbOverride,
  factoryKeyOverride,
  exportDateOverride,
}: BackupDownloadOptions): Promise<NextResponse> {
  const startedAt = Date.now();
  const exportDate = exportDateOverride || new Date().toISOString();
  const factoryKey = factoryKeyOverride || (await resolveBackupFactoryKey());
  const db = dbOverride || (await getDb());
  const tables = tableDefinitionsOverride || getTablesForScope(scope);
  const warnings: string[] = [];
  const counts: Record<string, number> = {};

  console.info("[backup] csv zip export started", {
    actorUsername,
    scope,
    factoryKey,
    tableKeys: tables.map((table) => table.key),
  });

  try {
    const files: Record<string, [Uint8Array, ZipOptions]> = {};
    const encoder = new TextEncoder();

    for (const tableDef of tables) {
      let headerWritten = false;
      let headers: string[] = [];
      const lines: string[] = [];

      const result = await iterateTableRows({
        db,
        tableDef,
        batchSize,
        onRow: (row) => {
          if (!headerWritten) {
            headers = Object.keys(row);
            if (headers.length > 0) {
              lines.push(`${headers.join(",")}\n`);
            }
            headerWritten = true;
          }

          if (headers.length > 0) {
            lines.push(`${rowToCsvLine(row, headers)}\n`);
          }
        },
      });
      counts[tableDef.key] = result.count;
      if (result.warning) {
        warnings.push(result.warning);
      }

      files[`${tableDef.key}.csv`] = [encoder.encode(lines.join("")), {}];
    }

    files["manifest.json"] = [
      encoder.encode(
        JSON.stringify(
          {
            exportDate,
            version,
            scope,
            factoryKey,
            counts,
            warnings,
          },
          null,
          2
        )
      ),
      {},
    ];

    const zipped = zipSync(files);
    const body = new Uint8Array(zipped.byteLength);
    body.set(zipped);

    console.info("[backup] csv zip export completed", {
      actorUsername,
      scope,
      factoryKey,
      counts,
      warningsCount: warnings.length,
      durationMs: Date.now() - startedAt,
      outputBytes: zipped.byteLength,
    });

    return new NextResponse(body.buffer, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.zip"`,
      },
    });
  } catch (error) {
    logDiagnosticEvent({
      level: "error",
      message: "[backup] csv zip export failed",
      error,
      source: "backup.export",
      operation: "csv-zip",
      context: {
        actorUsername,
        scope,
        factoryKey,
        durationMs: Date.now() - startedAt,
      },
    });
    throw asDiagnosticError(error, {
      code: "BACKUP-IO-1001",
      category: "backup.io",
      source: "backup.export",
      operation: "csv-zip",
      title: "Backup export failed",
      hint: "การสร้างไฟล์สำรองล้มเหลว ให้ตรวจสอบ log และสภาพฐานข้อมูล",
      retryable: false,
      safeContext: {
        actorUsername,
        scope,
        factoryKey,
      },
    });
  }
}
