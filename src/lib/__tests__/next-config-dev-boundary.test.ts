import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CURRENT_DIR, "../../..");
const NEXT_CONFIG_PATH = path.join(REPO_ROOT, "next.config.ts");

describe("next config development boundary", () => {
  it("keeps next-pwa off the development critical path", () => {
    const source = fs.readFileSync(NEXT_CONFIG_PATH, "utf8");

    expect(source).toContain('const isDevelopment = process.env.NODE_ENV === "development"');
    expect(source).toContain('if (!isDevelopment)');
    expect(source).toContain('require("next-pwa")');
    expect(source).toContain('require("./src/lib/pwa/runtime-caching")');
    expect(source).not.toContain('import nextPwa from "next-pwa"');
    expect(source).not.toContain(
      'import { pwaRuntimeCaching } from "./src/lib/pwa/runtime-caching"'
    );
  });
});
