/**
 * Seed users into the main (central) database for all roles and factories.
 *
 * Usage:
 *   npx tsx scripts/seed-factory-users.ts
 *
 * Reads DATABASE_URL from .env.local or environment.
 * Safe to re-run -- uses ON CONFLICT (username) DO NOTHING.
 */

import postgres from "postgres";
import bcrypt from "bcryptjs";
import * as fs from "fs";
import * as path from "path";
import { getScriptSeedUsers, type SeedUser } from "../src/lib/user-seeds";

// Load .env.local if present
const envPath = path.join(__dirname, "..", ".env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("ERROR: DATABASE_URL is required.");
  process.exit(1);
}

const USERS: SeedUser[] = getScriptSeedUsers();

async function main() {
  console.log("Connecting to main database...");
  const sql = postgres(DATABASE_URL!, { max: 1 });

  // Ensure factory_key column exists
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS factory_key text`;

  let created = 0;
  let skipped = 0;

  for (const u of USERS) {
    const hashed = await bcrypt.hash(u.password, 10);
    const result = await sql`
      INSERT INTO users (username, password, role, factory_key)
      VALUES (${u.username}, ${hashed}, ${u.role}, ${u.factoryKey})
      ON CONFLICT (username) DO NOTHING
      RETURNING id
    `;
    if (result.length > 0) {
      console.log(`  + Created: ${u.username} (${u.role}, factory=${u.factoryKey || "all"})`);
      created++;
    } else {
      console.log(`  - Skipped: ${u.username} (already exists)`);
      skipped++;
    }
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped.`);

  // Show final user list
  const allUsers = await sql`SELECT id, username, role, factory_key FROM users ORDER BY id`;
  console.log("\nAll users in main DB:");
  console.table(allUsers);

  await sql.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
