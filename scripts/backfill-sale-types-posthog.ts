#!/usr/bin/env tsx
import * as fs from "fs";
import * as path from "path";
import postgres from "postgres";
import { PostHog } from "posthog-node";
import {
  analyticsSaleTypeThaiLabel,
  resolveAnalyticsSaleType,
} from "@/lib/sale-payment";

type Target = {
  label: string;
  envVar: string;
  url: string;
};

type Options = {
  from: string | null;
  to: string | null;
  dryRun: boolean;
  factory: string;
  batchSize: number;
  includeVoided: boolean;
  eventName: string;
  envFile: string;
  posthogFlushAt: number;
  posthogFlushIntervalMs: number;
  posthogFetchRetries: number;
  posthogFetchRetryDelayMs: number;
  posthogRequestTimeoutMs: number;
  posthogShutdownTimeoutMs: number;
  skipPosthogCheck: boolean;
};

type TxRow = {
  id: number;
  customer_id: number | null;
  total_amount: number;
  status: string;
  transaction_kind: string | null;
  transfer_ref: string | null;
  sale_date: string;
  sale_time: string;
  created_at: Date | string | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function loadEnv(envFilePath: string) {
  const envFile = parseEnvFile(path.join(process.cwd(), envFilePath));
  for (const [k, v] of Object.entries(envFile)) {
    if (!process.env[k]) process.env[k] = v;
  }
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const options: Options = {
    from: null,
    to: null,
    dryRun: false,
    factory: "all",
    batchSize: 500,
    includeVoided: false,
    eventName: "sale_completed",
    envFile: ".env.local",
    posthogFlushAt: 100,
    posthogFlushIntervalMs: 10_000,
    posthogFetchRetries: 3,
    posthogFetchRetryDelayMs: 3_000,
    posthogRequestTimeoutMs: 10_000,
    posthogShutdownTimeoutMs: 30_000,
    skipPosthogCheck: false,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--include-voided") {
      options.includeVoided = true;
      continue;
    }
    if (arg === "--from") {
      options.from = args[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === "--to") {
      options.to = args[i + 1] || null;
      i += 1;
      continue;
    }
    if (arg === "--factory") {
      options.factory = (args[i + 1] || "all").toLowerCase();
      i += 1;
      continue;
    }
    if (arg === "--batch-size") {
      options.batchSize = Number.parseInt(args[i + 1] || "500", 10);
      i += 1;
      continue;
    }
    if (arg === "--event-name") {
      options.eventName = args[i + 1] || "sale_completed";
      i += 1;
      continue;
    }
    if (arg === "--env-file") {
      options.envFile = args[i + 1] || ".env.local";
      i += 1;
      continue;
    }
    if (arg === "--posthog-flush-at") {
      options.posthogFlushAt = Number.parseInt(args[i + 1] || "100", 10);
      i += 1;
      continue;
    }
    if (arg === "--posthog-flush-interval-ms") {
      options.posthogFlushIntervalMs = Number.parseInt(args[i + 1] || "10000", 10);
      i += 1;
      continue;
    }
    if (arg === "--posthog-fetch-retries") {
      options.posthogFetchRetries = Number.parseInt(args[i + 1] || "3", 10);
      i += 1;
      continue;
    }
    if (arg === "--posthog-fetch-retry-delay-ms") {
      options.posthogFetchRetryDelayMs = Number.parseInt(args[i + 1] || "3000", 10);
      i += 1;
      continue;
    }
    if (arg === "--posthog-request-timeout-ms") {
      options.posthogRequestTimeoutMs = Number.parseInt(args[i + 1] || "10000", 10);
      i += 1;
      continue;
    }
    if (arg === "--posthog-shutdown-timeout-ms") {
      options.posthogShutdownTimeoutMs = Number.parseInt(args[i + 1] || "30000", 10);
      i += 1;
      continue;
    }
    if (arg === "--skip-posthog-check") {
      options.skipPosthogCheck = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      printHelpAndExit(0);
    }
    console.error(`Unknown arg: ${arg}`);
    printHelpAndExit(1);
  }

  if (options.from && !DATE_RE.test(options.from)) {
    console.error("Invalid --from date. Use YYYY-MM-DD");
    process.exit(1);
  }
  if (options.to && !DATE_RE.test(options.to)) {
    console.error("Invalid --to date. Use YYYY-MM-DD");
    process.exit(1);
  }
  if (options.from && options.to && options.from > options.to) {
    console.error("--from must be <= --to");
    process.exit(1);
  }
  if (!Number.isInteger(options.batchSize) || options.batchSize <= 0) {
    console.error("--batch-size must be a positive integer");
    process.exit(1);
  }
  if (!Number.isInteger(options.posthogFlushAt) || options.posthogFlushAt <= 0) {
    console.error("--posthog-flush-at must be a positive integer");
    process.exit(1);
  }
  if (!Number.isInteger(options.posthogFlushIntervalMs) || options.posthogFlushIntervalMs <= 0) {
    console.error("--posthog-flush-interval-ms must be a positive integer");
    process.exit(1);
  }
  if (!Number.isInteger(options.posthogFetchRetries) || options.posthogFetchRetries < 0) {
    console.error("--posthog-fetch-retries must be a non-negative integer");
    process.exit(1);
  }
  if (!Number.isInteger(options.posthogFetchRetryDelayMs) || options.posthogFetchRetryDelayMs <= 0) {
    console.error("--posthog-fetch-retry-delay-ms must be a positive integer");
    process.exit(1);
  }
  if (!Number.isInteger(options.posthogRequestTimeoutMs) || options.posthogRequestTimeoutMs <= 0) {
    console.error("--posthog-request-timeout-ms must be a positive integer");
    process.exit(1);
  }
  if (!Number.isInteger(options.posthogShutdownTimeoutMs) || options.posthogShutdownTimeoutMs <= 0) {
    console.error("--posthog-shutdown-timeout-ms must be a positive integer");
    process.exit(1);
  }

  return options;
}

function printHelpAndExit(code: number) {
  console.log(`
Backfill PostHog sale_type properties from historical transactions.

Usage:
  npx tsx scripts/backfill-sale-types-posthog.ts [options]

Options:
  --dry-run              Print what would be sent, do not send events
  --from YYYY-MM-DD      Inclusive sale_date lower bound
  --to YYYY-MM-DD        Inclusive sale_date upper bound
  --factory NAME         one of: all, main, si, bearing, ktk
  --batch-size N         batch size (default: 500)
  --include-voided       include voided transactions
  --event-name NAME      event name (default: sale_completed)
  --env-file PATH        env file to load if vars are unset (default: .env.local)
  --posthog-flush-at N   events per flush (default: 100)
  --posthog-flush-interval-ms N      periodic flush interval (default: 10000)
  --posthog-fetch-retries N          retry count for failed PostHog requests (default: 3)
  --posthog-fetch-retry-delay-ms N   retry delay in ms (default: 3000)
  --posthog-request-timeout-ms N     request timeout in ms (default: 10000)
  --posthog-shutdown-timeout-ms N    max wait at shutdown in ms (default: 30000)
  --skip-posthog-check   skip preflight network check to PostHog
  --help                 show this help
`);
  process.exit(code);
}

function collectTargets(factoryFilter: string): Target[] {
  const candidates: Array<{ label: string; envVar: string }> = [
    { label: "main", envVar: "DATABASE_URL" },
    { label: "si", envVar: "DATABASE_URL_SI" },
    { label: "bearing", envVar: "DATABASE_URL_BEARING" },
    { label: "ktk", envVar: "DATABASE_URL_KTK" },
  ];
  const filtered =
    factoryFilter === "all"
      ? candidates
      : candidates.filter((entry) => entry.label === factoryFilter);
  const out: Target[] = [];
  for (const entry of filtered) {
    const url = process.env[entry.envVar];
    if (url) out.push({ ...entry, url });
  }
  return out;
}

function deriveEventTimestamp(row: TxRow): Date {
  const saleIso = `${row.sale_date}T${row.sale_time}+07:00`;
  const saleDate = new Date(saleIso);
  if (!Number.isNaN(saleDate.getTime())) return saleDate;

  if (row.created_at) {
    const createdAtDate = new Date(row.created_at);
    if (!Number.isNaN(createdAtDate.getTime())) return createdAtDate;
  }

  return new Date();
}

function normalizeHost(url: string): string {
  return url.replace(/\/+$/, "");
}

async function assertPosthogReachable(host: string, timeoutMs: number): Promise<void> {
  try {
    await fetch(`${normalizeHost(host)}/batch/`, {
      method: "OPTIONS",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(
      `PostHog host is not reachable (${host}). Check network/firewall before live backfill.`,
      { cause: error }
    );
  }
}

async function runTarget(posthog: PostHog, target: Target, options: Options) {
  const sql = postgres(target.url, { max: 2, connect_timeout: 15 });
  const whereVoided = options.includeVoided
    ? sql`TRUE`
    : sql`t.status <> 'voided'`;
  const whereFrom = options.from ? sql`t.sale_date >= ${options.from}` : sql`TRUE`;
  const whereTo = options.to ? sql`t.sale_date <= ${options.to}` : sql`TRUE`;

  let scanned = 0;
  let sent = 0;
  let lastId = 0;

  try {
    console.log(`\n--- Target: ${target.label} ---`);
    while (true) {
      const rows = await sql<TxRow[]>`
        SELECT
          t.id,
          t.customer_id,
          t.total_amount,
          t.status,
          t.transaction_kind,
          t.transfer_ref,
          t.sale_date::text,
          t.sale_time::text,
          t.created_at
        FROM transactions t
        WHERE
          t.id > ${lastId}
          AND t.transaction_kind IN ('sale', 'transfer_out')
          AND ${whereVoided}
          AND ${whereFrom}
          AND ${whereTo}
        ORDER BY t.id ASC
        LIMIT ${options.batchSize}
      `;

      if (rows.length === 0) break;
      scanned += rows.length;
      lastId = rows[rows.length - 1].id;

      for (const row of rows) {
        const transactionType = row.transaction_kind || "sale";
        const paymentStatus = row.status;
        const saleType = resolveAnalyticsSaleType({
          transactionType,
          paymentStatus,
        });
        const properties = {
          transaction_id: row.id,
          customer_id: row.customer_id,
          total_amount: Number(row.total_amount || 0),
          payment_status: paymentStatus,
          transaction_type: transactionType,
          transfer_ref: row.transfer_ref,
          sale_type: saleType,
          sale_type_th: analyticsSaleTypeThaiLabel(saleType),
          factory_key: target.label,
          backfill: true,
          backfill_source: "scripts/backfill-sale-types-posthog.ts",
        } as const;

        if (options.dryRun) {
          if (sent < 5) {
            console.log("[dry-run sample]", properties);
          }
          sent += 1;
          continue;
        }

        posthog.capture({
          distinctId:
            row.customer_id != null
              ? `customer:${target.label}:${row.customer_id}`
              : `customer:${target.label}:unknown`,
          event: options.eventName,
          properties,
          timestamp: deriveEventTimestamp(row),
          uuid: `${options.eventName}-backfill-${target.label}-${row.id}`,
        });
        sent += 1;
      }
    }

    console.log(
      JSON.stringify(
        {
          target: target.label,
          scanned,
          wouldSendOrSent: sent,
          dryRun: options.dryRun,
        },
        null,
        2
      )
    );
  } finally {
    await sql.end();
  }
}

async function main() {
  const options = parseArgs();
  loadEnv(options.envFile);

  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
  if (!posthogKey) {
    console.error("Missing NEXT_PUBLIC_POSTHOG_KEY");
    process.exit(1);
  }

  const targets = collectTargets(options.factory);
  if (targets.length === 0) {
    console.error(
      `No matching DATABASE_URL found for --factory=${options.factory}. Expected DATABASE_URL[_SI|_BEARING|_KTK].`
    );
    process.exit(1);
  }

  if (!options.dryRun && !options.skipPosthogCheck) {
    console.log(`Checking PostHog connectivity: ${posthogHost}`);
    await assertPosthogReachable(posthogHost, options.posthogRequestTimeoutMs);
  }

  const posthog = new PostHog(posthogKey, {
    host: posthogHost,
    flushAt: options.posthogFlushAt,
    flushInterval: options.posthogFlushIntervalMs,
    fetchRetryCount: options.posthogFetchRetries,
    fetchRetryDelay: options.posthogFetchRetryDelayMs,
    requestTimeout: options.posthogRequestTimeoutMs,
    historicalMigration: true,
  });

  try {
    console.log(
      JSON.stringify(
        {
          mode: options.dryRun ? "dry-run" : "live",
          factory: options.factory,
          from: options.from,
          to: options.to,
          includeVoided: options.includeVoided,
          batchSize: options.batchSize,
          eventName: options.eventName,
          envFile: options.envFile,
          posthogHost,
          posthogFlushAt: options.posthogFlushAt,
          posthogFlushIntervalMs: options.posthogFlushIntervalMs,
          posthogFetchRetries: options.posthogFetchRetries,
          posthogFetchRetryDelayMs: options.posthogFetchRetryDelayMs,
          posthogRequestTimeoutMs: options.posthogRequestTimeoutMs,
          posthogShutdownTimeoutMs: options.posthogShutdownTimeoutMs,
          skipPosthogCheck: options.skipPosthogCheck,
          targets: targets.map((t) => t.label),
        },
        null,
        2
      )
    );

    for (const target of targets) {
      await runTarget(posthog, target, options);
    }
  } finally {
    await posthog.shutdown(options.posthogShutdownTimeoutMs);
  }
}

main().catch((error) => {
  console.error("Backfill failed:", error);
  process.exit(1);
});
