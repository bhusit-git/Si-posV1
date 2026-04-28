import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const cookieStore = {
    set: vi.fn(),
    delete: vi.fn(),
    get: vi.fn(),
  };

  return {
    getMainDb: vi.fn(),
    getFactories: vi.fn(() => [{ key: "si", name: "SI" }]),
    validateBody: vi.fn(),
    setSession: vi.fn(),
    clearSession: vi.fn(),
    getSession: vi.fn(),
    checkRateLimit: vi.fn(),
    getClientIpFromHeaders: vi.fn(),
    getSupericeEnv: vi.fn(),
    getPostHogClient: vi.fn(),
    capture: vi.fn(),
    identify: vi.fn(),
    bcryptCompare: vi.fn(),
    bcryptHash: vi.fn(),
    cookies: vi.fn(async () => cookieStore),
    cookieStore,
  };
});

vi.mock("@/db", () => ({
  FACTORY_COOKIE: "superice_factory",
  getMainDb: mocks.getMainDb,
  getFactories: mocks.getFactories,
}));

vi.mock("@/lib/validations", () => ({
  loginSchema: {},
  validateBody: mocks.validateBody,
}));

vi.mock("@/lib/auth", () => ({
  setSession: mocks.setSession,
  clearSession: mocks.clearSession,
  getSession: mocks.getSession,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock("@/lib/request-security", () => ({
  getClientIpFromHeaders: mocks.getClientIpFromHeaders,
}));

vi.mock("@/lib/config/env", () => ({
  getSupericeEnv: mocks.getSupericeEnv,
}));

vi.mock("@/lib/posthog-server", () => ({
  getPostHogClient: mocks.getPostHogClient,
}));

vi.mock("bcryptjs", () => ({
  default: {
    compare: mocks.bcryptCompare,
    hash: mocks.bcryptHash,
  },
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

import { DELETE, POST } from "@/app/api/auth/route";

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("auth route telemetry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockReturnValue({ limited: false });
    mocks.getClientIpFromHeaders.mockReturnValue("127.0.0.1");
    mocks.getSupericeEnv.mockReturnValue({ isProduction: false });
    mocks.getPostHogClient.mockReturnValue({
      capture: mocks.capture,
      identify: mocks.identify,
    });
    mocks.cookieStore.set.mockReset();
    mocks.cookieStore.delete.mockReset();
    mocks.validateBody.mockReturnValue({
      data: { username: "manager-si", password: "secret" },
    });
    mocks.bcryptCompare.mockResolvedValue(true);
    mocks.bcryptHash.mockResolvedValue("hashed-password");
  });

  it("tracks successful login with canonical user distinct id", async () => {
    mocks.getMainDb.mockReturnValue({
      query: {
        users: {
          findFirst: vi.fn(async () => ({
            id: 7,
            username: "manager-si",
            password: "$2b$10$abcdefghijklmnopqrstuv",
            role: "manager",
            factoryKey: "si",
          })),
        },
      },
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn(async () => undefined),
        })),
      })),
    });

    const res = await POST(makeRequest({ username: "manager-si", password: "secret" }));
    const body = (await res.json()) as {
      id: number;
      username: string;
      role: string;
      factoryKey: string | null;
      factoryName: string | null;
    };

    expect(res.status).toBe(200);
    expect(body).toEqual({
      id: 7,
      username: "manager-si",
      role: "manager",
      factoryKey: "si",
      factoryName: "SI",
    });
    expect(mocks.setSession).toHaveBeenCalledWith({
      id: 7,
      username: "manager-si",
      role: "manager",
      factoryKey: "si",
    });
    expect(mocks.cookieStore.set).toHaveBeenCalledWith(
      "superice_factory",
      "si",
      expect.objectContaining({
        httpOnly: false,
        sameSite: "lax",
        path: "/",
      })
    );
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "user:7",
        event: "auth.login.succeeded",
        properties: expect.objectContaining({
          schema_version: 2,
          app: "superice-pos",
          event_origin: "server",
          factory_key: "si",
          actor_user_id: 7,
          actor_role: "manager",
        }),
      })
    );
    expect(mocks.identify).toHaveBeenCalledWith({
      distinctId: "user:7",
      properties: {
        user_id: 7,
        role: "manager",
        factory_key: "si",
      },
    });
  });

  it("tracks logout with the same canonical distinct id", async () => {
    mocks.getSession.mockResolvedValue({
      id: 7,
      username: "manager-si",
      role: "manager",
      factoryKey: "si",
    });
    mocks.clearSession.mockResolvedValue(undefined);

    const res = await DELETE(new NextRequest("http://localhost/api/auth", { method: "DELETE" }));
    const body = (await res.json()) as { success: boolean };

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true });
    expect(mocks.clearSession).toHaveBeenCalledTimes(1);
    expect(mocks.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "user:7",
        event: "auth.logout",
        properties: expect.objectContaining({
          schema_version: 2,
          app: "superice-pos",
          event_origin: "server",
          factory_key: "si",
          actor_user_id: 7,
          actor_role: "manager",
        }),
      })
    );
  });
});
