import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getDbForFactory: vi.fn(),
  getFactories: vi.fn(),
}));

vi.mock("@/db", () => ({
  FACTORY_COOKIE: "superice_factory",
  getDbForFactory: mocks.getDbForFactory,
  getFactories: mocks.getFactories,
}));

import { requireFactoryReadContext, requireFactoryWriteContext } from "@/lib/factory-context";

function makeRequest(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/api/write", {
    headers: cookie ? { Cookie: cookie } : undefined,
  });
}

describe("requireFactoryWriteContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFactories.mockReturnValue([
      { key: "si", name: "SI" },
      { key: "bearing", name: "Bearing" },
    ]);
    mocks.getDbForFactory.mockImplementation((factoryKey: string) => ({
      factoryKey,
      tag: `${factoryKey}-db`,
    }));
  });

  it("uses the locked session factory for multi-factory writes", () => {
    const result = requireFactoryWriteContext(makeRequest("superice_factory=bearing"), {
      factoryKey: "si",
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.factoryKey).toBe("si");
    expect(result.db).toMatchObject({ tag: "si-db" });
    expect(mocks.getDbForFactory).toHaveBeenCalledWith("si");
  });

  it("uses the active factory cookie when the session is not factory-locked", () => {
    const result = requireFactoryWriteContext(makeRequest("superice_factory=bearing"), {
      factoryKey: null,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.factoryKey).toBe("bearing");
    expect(mocks.getDbForFactory).toHaveBeenCalledWith("bearing");
  });

  it("rejects missing multi-factory context instead of falling back", async () => {
    const result = requireFactoryWriteContext(makeRequest(), { factoryKey: null });

    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error.status).toBe(400);
    expect(await result.error.json()).toEqual({
      error: "กรุณาเลือกโรงงานก่อนบันทึกข้อมูล",
    });
    expect(mocks.getDbForFactory).not.toHaveBeenCalled();
  });

  it("rejects invalid session factory keys", async () => {
    const result = requireFactoryWriteContext(makeRequest(), { factoryKey: "unknown" });

    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error.status).toBe(403);
    expect(await result.error.json()).toEqual({
      error: "โรงงานของผู้ใช้นี้ไม่ได้ถูกตั้งค่า",
    });
    expect(mocks.getDbForFactory).not.toHaveBeenCalled();
  });

  it("uses the only configured factory without requiring a cookie", () => {
    mocks.getFactories.mockReturnValue([{ key: "si", name: "SI" }]);

    const result = requireFactoryWriteContext(makeRequest(), { factoryKey: null });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.factoryKey).toBe("si");
    expect(mocks.getDbForFactory).toHaveBeenCalledWith("si");
  });
});

describe("requireFactoryReadContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFactories.mockReturnValue([
      { key: "si", name: "SI" },
      { key: "bearing", name: "Bearing" },
    ]);
    mocks.getDbForFactory.mockImplementation((factoryKey: string) => ({
      factoryKey,
      tag: `${factoryKey}-db`,
    }));
  });

  it("uses the active factory cookie for factory-scoped reports", () => {
    const result = requireFactoryReadContext(makeRequest("superice_factory=bearing"), {
      factoryKey: null,
    });

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.factoryKey).toBe("bearing");
    expect(result.db).toMatchObject({ tag: "bearing-db" });
  });

  it("rejects missing multi-factory report context instead of silently using the default DB", async () => {
    const result = requireFactoryReadContext(makeRequest(), { factoryKey: null });

    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.error.status).toBe(400);
    expect(await result.error.json()).toEqual({
      error: "กรุณาเลือกโรงงานก่อนบันทึกข้อมูล",
    });
    expect(mocks.getDbForFactory).not.toHaveBeenCalled();
  });
});
