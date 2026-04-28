import { describe, expect, it } from "vitest";

import { buildBootstrapSeedUsers, getScriptSeedUsers } from "@/lib/user-seeds";

describe("user seeds", () => {
  it("includes the legacy Admin/lion account in script seeds", () => {
    expect(getScriptSeedUsers()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          username: "Admin",
          password: "lion",
          role: "admin",
          factoryKey: null,
        }),
      ])
    );
  });

  it("includes the legacy Admin/lion account in bootstrap seeds", () => {
    const seeds = buildBootstrapSeedUsers({
      admin: "superice@2026",
      office: "office@2026!!",
      "manager-si": "manager@2026",
      "factory-si": "factory@2026",
      "manager-bearing": "manager-bearing@2026",
      "factory-bearing": "factory-bearing@2026",
    });

    expect(seeds).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          username: "Admin",
          password: "lion",
          role: "admin",
          factoryKey: null,
        }),
        expect.objectContaining({
          username: "admin",
          password: "superice@2026",
          role: "admin",
          factoryKey: null,
        }),
      ])
    );
  });

  it("requires configured passwords with at least 4 chars for modern bootstrap users", () => {
    expect(() =>
      buildBootstrapSeedUsers({
        admin: "1234",
        office: "abcd",
        "manager-si": "a1b2",
        "factory-si": "4321",
        "manager-bearing": "5678",
        "factory-bearing": "pass",
      })
    ).not.toThrow();

    expect(() =>
      buildBootstrapSeedUsers({
        admin: "123",
      })
    ).toThrow("Missing password with at least 4 chars for 'admin'");
  });
});
