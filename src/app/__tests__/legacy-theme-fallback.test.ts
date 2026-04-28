import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("legacy theme fallbacks", () => {
  const globalsCss = fs.readFileSync(
    path.join(process.cwd(), "src/app/globals.css"),
    "utf8"
  );

  it("keeps legacy-safe token fallbacks before oklch values", () => {
    expect(globalsCss).toMatch(
      /--background:\s*#ffffff;\s*--background:\s*oklch\(1 0 0\);/
    );
    expect(globalsCss).toMatch(
      /--popover:\s*#ffffff;\s*--popover:\s*oklch\(1 0 0\);/
    );
    expect(globalsCss).toMatch(
      /--foreground:\s*#1f2937;\s*--foreground:\s*oklch\(0\.145 0 0\);/
    );
    expect(globalsCss).toMatch(
      /--background:\s*#171717;\s*--background:\s*oklch\(0\.145 0 0\);/
    );
    expect(globalsCss).toMatch(
      /--popover:\s*#262626;\s*--popover:\s*oklch\(0\.205 0 0\);/
    );
  });

  it("forces popup surfaces to stay opaque with explicit fallback colors", () => {
    expect(globalsCss).toContain('[data-slot="dialog-content"]');
    expect(globalsCss).toContain('[data-slot="popover-content"]');
    expect(globalsCss).toContain('[data-slot="select-content"]');
    expect(globalsCss).toContain('[data-slot="command"]');
    expect(globalsCss).toContain("background-color: #ffffff;");
    expect(globalsCss).toContain("background-color: var(--popover);");
    expect(globalsCss).toContain("background-color: var(--background);");
  });
});
