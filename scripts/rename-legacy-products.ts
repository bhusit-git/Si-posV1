import * as fs from "fs";
import * as path from "path";
import postgres from "postgres";

import {
  buildLegacyRenamePlan,
  fetchLegacyRenameReferenceCounts,
  fetchLegacyRenameRows,
} from "../src/lib/migrate/legacy-rename";

type Mode = "dry-run" | "apply" | "render-dry-run";

const FACTORY_DB_VARS: Record<string, string> = {
  si: "DATABASE_URL_SI",
  bearing: "DATABASE_URL_BEARING",
  ktk: "DATABASE_URL_KTK",
};

function readEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  const text = fs.readFileSync(filePath, "utf8");
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    out[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return out;
}

function parseArgs(argv: string[]) {
  const flags = new Map<string, string | boolean>();
  for (const arg of argv) {
    if (arg.startsWith("--factory=")) flags.set("factory", arg.slice("--factory=".length));
    else if (arg.startsWith("--db-url=")) flags.set("db-url", arg.slice("--db-url=".length));
    else if (arg === "--dry-run") flags.set("dry-run", true);
    else if (arg === "--apply") flags.set("apply", true);
    else if (arg === "--render-dry-run") flags.set("render-dry-run", true);
  }
  return flags;
}

function resolveMode(flags: Map<string, string | boolean>): Mode {
  if (flags.get("render-dry-run")) return "render-dry-run";
  if (flags.get("apply")) return "apply";
  return "dry-run";
}

function resolveDbUrl(factoryKey: string, explicitDbUrl?: string): string {
  if (explicitDbUrl) return explicitDbUrl;

  const envVar = FACTORY_DB_VARS[factoryKey];
  if (!envVar) throw new Error(`Unknown factory '${factoryKey}'`);

  const envFromCwd = readEnvFile(path.join(process.cwd(), ".env.local"));
  const envFromApp = readEnvFile(path.join(__dirname, "..", ".env.local"));
  return process.env[envVar] || envFromCwd[envVar] || envFromApp[envVar] || "";
}

function printProposalTable(
  proposals: Array<{
    id: number;
    legacyName: string;
    currentName: string | null;
    proposedName: string;
    needsChange: boolean;
  }>
): void {
  for (const proposal of proposals) {
    console.log(
      `  ${proposal.id}: legacy='${proposal.legacyName}' current='${proposal.currentName ?? "-"}' proposed='${proposal.proposedName}'${proposal.needsChange ? " *" : ""}`
    );
  }
}

async function runLocal(factoryKey: string, dbUrl: string, mode: Exclude<Mode, "render-dry-run">) {
  if (!dbUrl) throw new Error(`No DB URL found for factory '${factoryKey}'`);

  const sql = postgres(dbUrl, { max: 1, connect_timeout: 10 });
  try {
    const currentRows = await fetchLegacyRenameRows(sql);
    const renamePlan = buildLegacyRenamePlan(currentRows);
    const fkReferenceCounts = await fetchLegacyRenameReferenceCounts(sql);

    console.log(`Factory: ${factoryKey.toUpperCase()} | Mode: ${mode}`);
    printProposalTable(renamePlan.proposals);
    console.log(`  missingIds: ${renamePlan.missingIds.join(", ") || "-"}`);
    console.log(`  changesNeeded: ${renamePlan.changesNeeded}`);

    if (mode === "dry-run") {
      return { renamePlan, fkReferenceCounts };
    }

    if (renamePlan.missingIds.length > 0) {
      throw new Error(`Missing legacy product rows: ${renamePlan.missingIds.join(", ")}`);
    }

    const toChange = renamePlan.proposals.filter((proposal) => proposal.needsChange);
    await sql.begin(async (tx) => {
      for (const proposal of toChange) {
        await tx.unsafe(`UPDATE product_types SET name = $1 WHERE id = $2`, [
          proposal.proposedName,
          proposal.id,
        ]);
      }

      const verifyPlan = buildLegacyRenamePlan(await fetchLegacyRenameRows(tx));
      if (verifyPlan.missingIds.length > 0 || verifyPlan.changesNeeded) {
        throw new Error("Legacy rename verification failed");
      }
    });

    const afterPlan = buildLegacyRenamePlan(await fetchLegacyRenameRows(sql));
    console.log("Applied changes:");
    printProposalTable(afterPlan.proposals);

    return { renamePlan: afterPlan, fkReferenceCounts };
  } finally {
    await sql.end();
  }
}

async function runRenderDryRun(factoryKey: string): Promise<void> {
  const renderUrl = process.env.RENDER_URL || "https://superice-pos.onrender.com";
  const migrateKey = process.env.MIGRATE_KEY || "superice2026migrate";
  const url = `${renderUrl}/api/migrate?action=rename-legacy-products&factory=${factoryKey}&dryRun=1`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${migrateKey}`,
    },
  });
  const body = await response.text();
  console.log(`Render dry-run status: ${response.status}`);
  console.log(body);
  if (!response.ok) {
    throw new Error(`Render dry-run failed (${response.status})`);
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const factoryKey = String(flags.get("factory") || "").trim().toLowerCase();
  if (!factoryKey) {
    throw new Error("Missing --factory=<si|bearing|ktk>");
  }

  const mode = resolveMode(flags);
  if (mode === "render-dry-run") {
    await runRenderDryRun(factoryKey);
    return;
  }

  const dbUrl = resolveDbUrl(factoryKey, typeof flags.get("db-url") === "string" ? String(flags.get("db-url")) : undefined);
  await runLocal(factoryKey, dbUrl, mode);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
