import type { NextRequest } from "next/server";

export type FactoryScope = "none" | "single" | "multiple" | "all";
export type DbTarget = "main" | "factory" | "both";
export type MutationType = "read-only" | "additive" | "destructive";
export type DryRunMode = "disabled" | "query-opt-in" | "query-opt-out";

export type MigrateActionName =
  | "status"
  | "check-products"
  | "rename-legacy-products"
  | "v5"
  | "migrate-products"
  | "rollout-product-taxonomy"
  | "seed-bill-counter"
  | "sync-si-products-to-bearing"
  | "migrate-prices"
  | "cleanup-legacy-prices"
  | "wipe-factory-data"
  | "wipe-transactions-data"
  | "wipe-transactions-window"
  | "cleanup-legacy-items-window"
  | "upload"
  | "reset-sequences"
  | "init-factory"
  | "default-migration";

export type MigrateActionResult = {
  status?: number;
  body: Record<string, unknown>;
  auditSummary?: Record<string, unknown> | null;
};

export type MigrateActionContext = {
  request: NextRequest;
  name: MigrateActionName;
  externalAction: string | null;
  factoryKey: string | null;
  confirmation: string | null;
  dryRunRequested: boolean;
  startedAt: Date;
  callerIp: string;
};

export type MigrateActionDefinition = {
  name: MigrateActionName;
  method: "GET" | "POST";
  externalAction: string | null;
  factoryScope: FactoryScope;
  dbTarget: DbTarget;
  mutationType: MutationType;
  requiresConfirmation: false | string;
  supportsDryRun: boolean;
  dryRunMode: DryRunMode;
  failureMode: "single-db-transactional" | "multi-step-best-effort" | "irreversible";
  handler: (context: MigrateActionContext) => Promise<MigrateActionResult>;
};

export type ProductSnapshot = {
  id: number;
  name: string;
  name_en: string | null;
  has_bag: boolean;
  is_active: boolean;
  sort_order?: number;
  catalog_code?: number | null;
  family?: string | null;
  form?: string | null;
  package_type?: string | null;
  size_value?: number | null;
  size_unit?: string | null;
  size_label?: string | null;
};

export type ProductRefCount = { pid: number; cnt: number };
export type TableNameRow = { tablename: string };
export type SqlPrimitive = string | number | boolean | Date | null;
export type SeedPasswordMap = Record<string, string>;

export type UnsafeExecutor = {
  unsafe: (query: string, params?: unknown[]) => Promise<ReadonlyArray<Record<string, unknown>>>;
};
