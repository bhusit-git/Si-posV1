import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CURRENT_DIR, "../../../..");
const SUPERICE_ROOT = path.join(REPO_ROOT, "superice-pos");

const SCAN_DIRECTORIES = [
  path.join(SUPERICE_ROOT, "src/app"),
  path.join(SUPERICE_ROOT, "src/components"),
  path.join(SUPERICE_ROOT, "src/db"),
  path.join(SUPERICE_ROOT, "src/lib"),
];

const EXCLUDED_PATH_PARTS = [
  `${path.sep}__tests__${path.sep}`,
  `${path.sep}src${path.sep}lib${path.sep}config${path.sep}`,
  `${path.sep}src${path.sep}lib${path.sep}shared${path.sep}`,
];

function listTypeScriptFiles(directory: string): string[] {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (EXCLUDED_PATH_PARTS.some((segment) => fullPath.includes(segment))) {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(fullPath));
      continue;
    }

    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("superice-pos app boundary", () => {
  it("does not import shared root modules directly outside local boundary wrappers", () => {
    const files = SCAN_DIRECTORIES.flatMap((directory) => listTypeScriptFiles(directory));

    const offenders = files.filter((filePath) => {
      const source = fs.readFileSync(filePath, "utf8");
      return /from\s+["'][^"']*shared\/(config|db)\//.test(source);
    });

    expect(offenders).toEqual([]);
  });
});
