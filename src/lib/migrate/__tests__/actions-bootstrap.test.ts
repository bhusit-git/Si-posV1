import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  postgresFactory: vi.fn(),
  getConfiguredFactoryConnection: vi.fn(),
}));

vi.mock("postgres", () => ({
  default: mocks.postgresFactory,
}));

vi.mock("@/lib/migrate/shared", async () => {
  const actual = await vi.importActual<typeof import("@/lib/migrate/shared")>(
    "@/lib/migrate/shared"
  );
  return {
    ...actual,
    getConfiguredFactoryConnection: mocks.getConfiguredFactoryConnection,
  };
});

import { runInitFactoryAction } from "@/lib/migrate/actions-bootstrap";
import type { MigrateActionContext } from "@/lib/migrate/types";

function createContext(): MigrateActionContext {
  return {
    request: new NextRequest("http://localhost/api/migrate?action=init-factory&factory=bearing", {
      method: "POST",
    }),
    name: "init-factory",
    externalAction: "init-factory",
    factoryKey: "bearing",
    confirmation: null,
    dryRunRequested: false,
    startedAt: new Date("2026-04-18T00:00:00.000Z"),
    callerIp: "127.0.0.1",
  };
}

describe("init factory action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfiguredFactoryConnection.mockReturnValue({
      envVar: "DATABASE_URL_BEARING",
      url: "postgresql://localhost:5432/bearing",
    });
  });

  it("adds taxonomy columns and the catalog-code index for existing factory databases", async () => {
    const unsafe = vi.fn(async () => []);
    const sqlClient = Object.assign(
      vi.fn(async () => [{ tablename: "product_types" }, { tablename: "transactions" }]),
      {
        unsafe,
        end: vi.fn(async () => undefined),
      }
    );

    mocks.postgresFactory.mockReturnValue(sqlClient);

    const result = await runInitFactoryAction(createContext());

    expect(result.status).toBeUndefined();
    expect(result.body.success).toBe(true);
    expect(unsafe).toHaveBeenCalledWith(
      "ALTER TABLE product_types ADD COLUMN IF NOT EXISTS catalog_code integer"
    );
    expect(unsafe).toHaveBeenCalledWith(
      "ALTER TABLE product_types ADD COLUMN IF NOT EXISTS family text"
    );
    expect(unsafe).toHaveBeenCalledWith(
      "ALTER TABLE product_types ADD COLUMN IF NOT EXISTS form text"
    );
    expect(unsafe).toHaveBeenCalledWith(
      "ALTER TABLE product_types ADD COLUMN IF NOT EXISTS package_type text"
    );
    expect(unsafe).toHaveBeenCalledWith(
      "ALTER TABLE product_types ADD COLUMN IF NOT EXISTS size_value integer"
    );
    expect(unsafe).toHaveBeenCalledWith(
      "ALTER TABLE product_types ADD COLUMN IF NOT EXISTS size_unit text"
    );
    expect(unsafe).toHaveBeenCalledWith(
      "ALTER TABLE product_types ADD COLUMN IF NOT EXISTS size_label text"
    );
    expect(unsafe).toHaveBeenCalledWith(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_product_types_catalog_code ON product_types (catalog_code)"
    );
  });
});
