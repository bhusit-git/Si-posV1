#!/usr/bin/env npx tsx
/**
 * Automated backup script -- exports all database tables as JSON
 * and pushes to a private GitHub repository.
 *
 * Required environment variables:
 *   DATABASE_URL          -- PostgreSQL connection string
 *   GITHUB_BACKUP_TOKEN   -- GitHub Personal Access Token (fine-grained, Contents read/write)
 *   GITHUB_BACKUP_REPO    -- owner/repo  (e.g. "myorg/superice-backups")
 *
 * Optional:
 *   BACKUP_RETENTION_DAYS -- how many days of backups to keep (default 30)
 *
 * Usage:
 *   npx tsx scripts/backup-to-github.ts
 *
 * Designed to run as a Render Cron Job at 0 2 * * * (daily 2 AM).
 */

import { createHash } from "crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";

// --------------- Config ---------------

const DATABASE_URL = process.env.DATABASE_URL;
const GITHUB_TOKEN = process.env.GITHUB_BACKUP_TOKEN;
const GITHUB_REPO = process.env.GITHUB_BACKUP_REPO; // "owner/repo"
const RETENTION_DAYS = parseInt(process.env.BACKUP_RETENTION_DAYS || "30", 10);
const GITHUB_API = "https://api.github.com";

if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is required");
  process.exit(1);
}
if (!GITHUB_TOKEN) {
  console.error("ERROR: GITHUB_BACKUP_TOKEN is required");
  process.exit(1);
}
if (!GITHUB_REPO) {
  console.error("ERROR: GITHUB_BACKUP_REPO is required (e.g. owner/repo)");
  process.exit(1);
}

// --------------- Database ---------------

const client = postgres(DATABASE_URL, {
  max: 3,
  idle_timeout: 10,
  connect_timeout: 15,
});
const db = drizzle(client, { schema });

async function exportAllTables() {
  console.log("Exporting database tables...");

  const [
    allCustomers,
    allProducts,
    allPrices,
    allTransactions,
    allItems,
    allBagLedger,
    allProductionLogs,
    allAuditLog,
    allUsers,
  ] = await Promise.all([
    db.select().from(schema.customers),
    db.select().from(schema.productTypes),
    db.select().from(schema.customerPrices),
    db.select().from(schema.transactions),
    db.select().from(schema.transactionItems),
    db.select().from(schema.bagLedger),
    db.select().from(schema.productionLogs),
    db.select().from(schema.auditLog),
    db.select({
      id: schema.users.id,
      username: schema.users.username,
      role: schema.users.role,
    }).from(schema.users),
  ]);

  const backup = {
    exportDate: new Date().toISOString(),
    version: "2.0",
    tables: {
      customers: allCustomers,
      productTypes: allProducts,
      customerPrices: allPrices,
      transactions: allTransactions,
      transactionItems: allItems,
      bagLedger: allBagLedger,
      productionLogs: allProductionLogs,
      auditLog: allAuditLog,
      users: allUsers,
    },
    counts: {
      customers: allCustomers.length,
      productTypes: allProducts.length,
      customerPrices: allPrices.length,
      transactions: allTransactions.length,
      transactionItems: allItems.length,
      bagLedger: allBagLedger.length,
      productionLogs: allProductionLogs.length,
      auditLog: allAuditLog.length,
      users: allUsers.length,
    },
  };

  const json = JSON.stringify(backup, null, 2);
  const checksum = createHash("sha256").update(json).digest("hex");

  console.log(
    `Export complete: ${Object.values(backup.counts).reduce((a, b) => a + b, 0)} total rows across ${Object.keys(backup.tables).length} tables`
  );
  console.log(`Checksum (SHA-256): ${checksum}`);

  return { json, checksum, counts: backup.counts };
}

// --------------- GitHub API helpers ---------------

async function githubRequest(path: string, options: RequestInit = {}) {
  const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers || {}),
    },
  });
  return res;
}

async function pushToGitHub(filename: string, content: string, checksum: string) {
  const path = `/repos/${GITHUB_REPO}/contents/backups/${filename}`;

  // Check if file already exists (to get its sha for update)
  const existing = await githubRequest(path);
  let sha: string | undefined;
  if (existing.ok) {
    const data = await existing.json();
    sha = data.sha;
    console.log(`File already exists, will update (sha: ${sha?.slice(0, 8)})`);
  }

  const body: Record<string, string> = {
    message: `backup: ${filename} (checksum: ${checksum.slice(0, 12)})`,
    content: Buffer.from(content).toString("base64"),
  };
  if (sha) body.sha = sha;

  const res = await githubRequest(path, {
    method: "PUT",
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`GitHub API error ${res.status}: ${errBody}`);
  }

  console.log(`Pushed ${filename} to ${GITHUB_REPO}`);
}

async function pruneOldBackups() {
  console.log(`Pruning backups older than ${RETENTION_DAYS} days...`);

  const path = `/repos/${GITHUB_REPO}/contents/backups`;
  const res = await githubRequest(path);

  if (!res.ok) {
    if (res.status === 404) {
      console.log("No backups directory found, skipping prune");
      return;
    }
    console.warn(`Could not list backups: ${res.status}`);
    return;
  }

  const files: { name: string; sha: string; type: string }[] = await res.json();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS);

  let deleted = 0;
  for (const file of files) {
    if (file.type !== "file") continue;

    // Extract date from filename: superice-backup-YYYY-MM-DD.json
    const match = file.name.match(/superice-backup-(\d{4}-\d{2}-\d{2})\.json/);
    if (!match) continue;

    const fileDate = new Date(match[1] + "T00:00:00Z");
    if (fileDate < cutoffDate) {
      console.log(`Deleting old backup: ${file.name}`);
      const delRes = await githubRequest(
        `/repos/${GITHUB_REPO}/contents/backups/${file.name}`,
        {
          method: "DELETE",
          body: JSON.stringify({
            message: `prune: remove ${file.name} (older than ${RETENTION_DAYS} days)`,
            sha: file.sha,
          }),
        }
      );
      if (delRes.ok) {
        deleted++;
      } else {
        console.warn(`Failed to delete ${file.name}: ${delRes.status}`);
      }
    }
  }

  console.log(`Pruned ${deleted} old backup(s)`);
}

// --------------- Main ---------------

async function main() {
  const startTime = Date.now();
  console.log("=== SuperIce Automated Backup ===");
  console.log(`Time: ${new Date().toISOString()}`);
  console.log(`Target repo: ${GITHUB_REPO}`);

  try {
    const { json, checksum, counts } = await exportAllTables();

    const today = new Date().toISOString().slice(0, 10);
    const filename = `superice-backup-${today}.json`;

    await pushToGitHub(filename, json, checksum);
    await pruneOldBackups();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\nBackup complete in ${elapsed}s`);
    console.log("Rows:", JSON.stringify(counts));
  } catch (err) {
    console.error("BACKUP FAILED:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
