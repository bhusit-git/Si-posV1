import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CURRENT_DIR, "../../../..");
const SUPERICE_ROOT = path.join(REPO_ROOT, "superice-pos");

const SCAN_DIRECTORIES = [
  path.join(SUPERICE_ROOT, "src/app/api"),
  path.join(SUPERICE_ROOT, "src/db"),
];

const SCAN_FILES = [
  path.join(SUPERICE_ROOT, "src/lib/forecast-service.ts"),
  path.join(SUPERICE_ROOT, "src/lib/rate-limit.ts"),
];

function listTypeScriptFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      files.push(...listTypeScriptFiles(fullPath));
      continue;
    }

    if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
    files.push(fullPath);
  }

  return files;
}

describe("server env boundary", () => {
  it("does not allow raw process.env access in centralized server runtime paths", () => {
    const files = [
      ...SCAN_DIRECTORIES.flatMap((directory) => listTypeScriptFiles(directory)),
      ...SCAN_FILES,
    ];

    const offenders = files.filter((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      return /process\.env/.test(source);
    });

    expect(offenders).toEqual([]);
  });
});
