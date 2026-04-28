import { isTransferCustomerName, TRANSFER_ALLOWLIST_CUSTOMER_IDS } from "@/lib/transfer-utils";
import { FACTORY_CONFIGS, type FactoryDbKey } from "@/lib/shared/db-runtime";

export const TRANSFER_CUSTOMER_BACKFILL_REASON =
  "invoice_credit_unification_backfill";
export const TRANSFER_CUSTOMER_BACKFILL_AUDIT_ACTION =
  "customer.backfill_transfer_customer";
export const TRANSFER_CUSTOMER_BACKFILL_AUDIT_USERNAME =
  "system:backfill-transfer-customer-flag";

export interface TransferCustomerBackfillRow {
  id: number;
  name: string | null;
  transfer_customer: boolean;
}

export type TransferCustomerBackfillSource =
  | "allowlist"
  | "xfer_prefix"
  | "allowlist+xfer_prefix";

export interface TransferCustomerBackfillCandidate extends TransferCustomerBackfillRow {
  source: TransferCustomerBackfillSource;
}

export interface TransferCustomerBackfillTarget {
  factoryKey: FactoryDbKey;
  envVar: string;
  url: string;
}

export interface ParsedTransferCustomerBackfillArgs {
  apply: boolean;
  factorySelection: FactoryDbKey | "all";
}

const FACTORY_CONFIG_BY_KEY = new Map(FACTORY_CONFIGS.map((config) => [config.key, config]));

export function classifyTransferCustomerBackfillSource(
  row: Pick<TransferCustomerBackfillRow, "id" | "name">
): TransferCustomerBackfillSource | null {
  const matchesAllowlist = TRANSFER_ALLOWLIST_CUSTOMER_IDS.has(row.id);
  const matchesPrefix = isTransferCustomerName(row.name);
  if (matchesAllowlist && matchesPrefix) return "allowlist+xfer_prefix";
  if (matchesAllowlist) return "allowlist";
  if (matchesPrefix) return "xfer_prefix";
  return null;
}

export function collectTransferCustomerBackfillCandidates(
  rows: TransferCustomerBackfillRow[]
): TransferCustomerBackfillCandidate[] {
  return rows.flatMap((row) => {
    const source = classifyTransferCustomerBackfillSource(row);
    if (!source) return [];
    return [{ ...row, source }];
  });
}

export function parseTransferCustomerBackfillArgs(
  argv: string[]
): ParsedTransferCustomerBackfillArgs {
  let apply = false;
  let factorySelection: ParsedTransferCustomerBackfillArgs["factorySelection"] = "all";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg === "--dry-run") {
      apply = false;
      continue;
    }
    if (arg === "--factory") {
      const value = argv[index + 1];
      if (!value) throw new Error("Missing value for --factory");
      index += 1;
      factorySelection = normalizeFactorySelection(value);
      continue;
    }
    if (arg.startsWith("--factory=")) {
      factorySelection = normalizeFactorySelection(arg.slice("--factory=".length));
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { apply, factorySelection };
}

function normalizeFactorySelection(value: string): ParsedTransferCustomerBackfillArgs["factorySelection"] {
  const normalized = value.trim().toLowerCase();
  if (normalized === "all") return "all";
  if (FACTORY_CONFIG_BY_KEY.has(normalized as FactoryDbKey)) {
    return normalized as FactoryDbKey;
  }
  throw new Error(`Unknown factory "${value}". Use si, bearing, ktk, or all.`);
}

export function collectTransferCustomerBackfillTargets(
  selection: ParsedTransferCustomerBackfillArgs["factorySelection"],
  env: Record<string, string | undefined>
): TransferCustomerBackfillTarget[] {
  const configs =
    selection === "all"
      ? FACTORY_CONFIGS
      : [FACTORY_CONFIG_BY_KEY.get(selection)!];

  return configs.map((config) => {
    const url = env[config.envVar];
    if (!url) {
      throw new Error(
        `Missing ${config.envVar} for factory "${config.key}". Backfill must target factory operational DBs only.`
      );
    }
    return {
      factoryKey: config.key,
      envVar: config.envVar,
      url,
    };
  });
}

export function buildTransferCustomerBackfillAuditDetails(candidate: {
  factoryKey: FactoryDbKey;
  customerId: number;
  customerName: string | null;
  source: TransferCustomerBackfillSource;
  apply: boolean;
}) {
  return {
    reason: TRANSFER_CUSTOMER_BACKFILL_REASON,
    factoryKey: candidate.factoryKey,
    customerId: candidate.customerId,
    customerName: candidate.customerName,
    source: candidate.source,
    oldTransferCustomer: false,
    newTransferCustomer: true,
    runMode: candidate.apply ? "apply" : "dry-run",
  };
}
