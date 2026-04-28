import { describe, expect, it, vi } from "vitest";
import { strFromU8, unzipSync } from "fflate";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getFactories: vi.fn(() => [{ key: "default", name: "Default" }]),
  getSession: vi.fn(async () => null),
  cookies: vi.fn(async () => ({ get: () => undefined })),
}));

vi.mock("@/db", () => ({
  FACTORY_COOKIE: "superice_factory",
  getDb: mocks.getDb,
  getFactories: mocks.getFactories,
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

import {
  createCsvZipBackupDownloadResponse,
  createJsonBackupDownloadResponse,
  type BackupTableDefinition,
  type PlainRow,
} from "@/lib/backup-export";

function makeChunkFetcher(rows: PlainRow[], callLog: number[]) {
  const sorted = [...rows].sort((a, b) => Number(a.id) - Number(b.id));
  return async (_db: unknown, lastId: number, limit: number) => {
    callLog.push(lastId);
    return sorted.filter((row) => Number(row.id) > lastId).slice(0, limit);
  };
}

describe("backup-export", () => {
  it("streams JSON with factoryKey, chunked counts, and optional-table warnings", async () => {
    const fetchCalls: number[] = [];
    const customers = Array.from({ length: 2500 }, (_, index) => ({
      id: index + 1,
      name: `Customer ${index + 1}`,
    }));

    const tableDefinitions: BackupTableDefinition[] = [
      {
        key: "customers",
        tableName: "customers",
        optionalIfMissing: false,
        fetchChunk: makeChunkFetcher(customers, fetchCalls) as BackupTableDefinition["fetchChunk"],
      },
      {
        key: "auditLog",
        tableName: "audit_log",
        optionalIfMissing: true,
        fetchChunk: async () => {
          throw { code: "42P01", message: "relation \"audit_log\" does not exist" };
        },
      },
    ];

    const response = await createJsonBackupDownloadResponse({
      scope: "full",
      version: "2.0",
      filenamePrefix: "backup-test",
      actorUsername: "admin",
      batchSize: 500,
      tableDefinitionsOverride: tableDefinitions,
      dbOverride: {} as never,
      factoryKeyOverride: "si",
      exportDateOverride: "2026-03-26T12:00:00.000Z",
    });

    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(response.headers.get("Content-Disposition")).toContain("backup-test-");

    const payload = JSON.parse(await response.text()) as {
      factoryKey: string;
      counts: Record<string, number>;
      warnings: string[];
      tables: Record<string, unknown[]>;
    };

    expect(payload.factoryKey).toBe("si");
    expect(payload.counts.customers).toBe(2500);
    expect(payload.counts.auditLog).toBe(0);
    expect(payload.tables.customers).toHaveLength(2500);
    expect(payload.tables.auditLog).toEqual([]);
    expect(payload.warnings).toHaveLength(1);
    expect(payload.warnings[0]).toContain("audit_log");

    // 2500 rows with batch size 500 requires multiple paged reads + final empty read.
    expect(fetchCalls.length).toBeGreaterThan(3);
    expect(fetchCalls[0]).toBe(0);
  });

  it("returns CSV ZIP with per-table files and manifest metadata", async () => {
    const customers: PlainRow[] = [
      { id: 1, name: "A, Co.", status: "active" },
      { id: 2, name: "B \"Quoted\"", status: "inactive" },
    ];
    const transactions: PlainRow[] = [
      { id: 10, totalAmount: 1200, paymentStatus: "paid" },
    ];

    const tableDefinitions: BackupTableDefinition[] = [
      {
        key: "customers",
        tableName: "customers",
        optionalIfMissing: false,
        fetchChunk: makeChunkFetcher(customers, []) as BackupTableDefinition["fetchChunk"],
      },
      {
        key: "transactions",
        tableName: "transactions",
        optionalIfMissing: false,
        fetchChunk: makeChunkFetcher(transactions, []) as BackupTableDefinition["fetchChunk"],
      },
      {
        key: "paymentEvents",
        tableName: "payment_events",
        optionalIfMissing: true,
        fetchChunk: async () => {
          throw { code: "42P01", message: "relation \"payment_events\" does not exist" };
        },
      },
    ];

    const response = await createCsvZipBackupDownloadResponse({
      scope: "full",
      version: "csv-export.v1",
      filenamePrefix: "csv-test",
      actorUsername: "admin",
      tableDefinitionsOverride: tableDefinitions,
      dbOverride: {} as never,
      factoryKeyOverride: "bearing",
      exportDateOverride: "2026-03-26T12:00:00.000Z",
    });

    expect(response.headers.get("Content-Type")).toContain("application/zip");
    expect(response.headers.get("Content-Disposition")).toContain("csv-test-");

    const bytes = new Uint8Array(await response.arrayBuffer());
    const zip = unzipSync(bytes);

    expect(Object.keys(zip)).toContain("customers.csv");
    expect(Object.keys(zip)).toContain("transactions.csv");
    expect(Object.keys(zip)).toContain("paymentEvents.csv");
    expect(Object.keys(zip)).toContain("manifest.json");

    const customersCsv = strFromU8(zip["customers.csv"]);
    expect(customersCsv).toContain("id,name,status");
    expect(customersCsv).toContain('"A, Co."');
    expect(customersCsv).toContain('"B ""Quoted"""');

    const manifest = JSON.parse(strFromU8(zip["manifest.json"])) as {
      factoryKey: string;
      counts: Record<string, number>;
      warnings: string[];
    };

    expect(manifest.factoryKey).toBe("bearing");
    expect(manifest.counts.customers).toBe(2);
    expect(manifest.counts.transactions).toBe(1);
    expect(manifest.counts.paymentEvents).toBe(0);
    expect(manifest.warnings).toHaveLength(1);
    expect(manifest.warnings[0]).toContain("payment_events");
  });
});
