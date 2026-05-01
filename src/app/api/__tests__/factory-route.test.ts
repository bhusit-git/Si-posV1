import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const cookieStore = {
    get: vi.fn(),
    set: vi.fn(),
  };

  return {
    getSession: vi.fn(),
    getFactories: vi.fn(),
    isMultiFactory: vi.fn(),
    getSupericeEnv: vi.fn(),
    cookies: vi.fn(async () => cookieStore),
    cookieStore,
  };
});

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/db", () => ({
  FACTORY_COOKIE: "superice_factory",
  getFactories: mocks.getFactories,
  isMultiFactory: mocks.isMultiFactory,
}));

vi.mock("@/lib/config/env", () => ({
  getSupericeEnv: mocks.getSupericeEnv,
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

import { GET } from "@/app/api/factory/route";

describe("GET /api/factory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue(null);
    mocks.getFactories.mockReturnValue([
      { key: "si", name: "SI" },
      { key: "bearing", name: "Bearing" },
    ]);
    mocks.isMultiFactory.mockReturnValue(true);
    mocks.getSupericeEnv.mockReturnValue({ isProduction: false });
  });

  it("falls back to the first valid factory when the cookie contains a legacy key", async () => {
    mocks.cookieStore.get.mockReturnValue({ value: "fac_1" });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.current).toBe("si");
    expect(mocks.cookieStore.set).toHaveBeenCalledWith(
      "superice_factory",
      "si",
      expect.objectContaining({
        httpOnly: false,
        sameSite: "lax",
        path: "/",
      })
    );
  });

  it("prefers the locked session factory over a stale cookie", async () => {
    mocks.getSession.mockResolvedValue({
      id: 7,
      username: "manager-si",
      role: "manager",
      factoryKey: "si",
    });
    mocks.cookieStore.get.mockReturnValue({ value: "bearing" });

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.current).toBe("si");
    expect(mocks.cookieStore.set).toHaveBeenCalledWith(
      "superice_factory",
      "si",
      expect.objectContaining({
        httpOnly: false,
        sameSite: "lax",
        path: "/",
      })
    );
  });
});
