import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getSession: vi.fn(),
  getClientIpFromHeaders: vi.fn(),
}));

vi.mock("@/db", () => ({
  getDb: mocks.getDb,
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/lib/request-security", () => ({
  getClientIpFromHeaders: mocks.getClientIpFromHeaders,
}));

import { GET as getSetup } from "@/app/api/setup/route";
import { POST as postDisplay } from "@/app/api/display/route";

function setEnv(name: string, value: string) {
  Reflect.set(process.env, name, value);
}

describe("setup and display env integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    delete process.env.SETUP_KEY;
    delete process.env.SETUP_ENABLED;
    delete process.env.SETUP_ALLOWED_IPS;
    delete process.env.DISPLAY_API_KEY;
    setEnv("NODE_ENV", "test");

    mocks.getSession.mockResolvedValue(null);
    mocks.getClientIpFromHeaders.mockReturnValue("127.0.0.1");
  });

  it("returns 403 when setup is disabled because no setup key is configured", async () => {
    const req = new NextRequest("http://localhost/api/setup");
    const res = await getSetup(req);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(403);
    expect(body.error).toBe("Setup endpoint is disabled");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("enforces production setup gating and allowlisted IPs", async () => {
    setEnv("NODE_ENV", "production");
    process.env.SETUP_KEY = "setup-secret";
    process.env.SETUP_ENABLED = "true";
    process.env.SETUP_ALLOWED_IPS = "10.0.0.1";
    mocks.getClientIpFromHeaders.mockReturnValue("10.0.0.9");

    const req = new NextRequest("http://localhost/api/setup", {
      headers: { authorization: "Bearer setup-secret" },
    });
    const res = await getSetup(req);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(403);
    expect(body.error).toBe("IP address is not allowed");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("returns a structured 500 when setup health queries fail", async () => {
    process.env.SETUP_KEY = "setup-secret";
    mocks.getDb.mockRejectedValueOnce(new Error("db unavailable"));

    const req = new NextRequest("http://localhost/api/setup", {
      headers: { authorization: "Bearer setup-secret" },
    });
    const res = await getSetup(req);
    const body = (await res.json()) as {
      error: string;
      requestId?: string;
      diagnostic?: { source?: string; operation?: string };
    };

    expect(res.status).toBe(500);
    expect(body.error).toBe("เกิดข้อผิดพลาดภายในระบบ");
    expect(body.requestId).toBeTruthy();
    expect(res.headers.get("x-request-id")).toBe(body.requestId);
    expect(body.diagnostic).toEqual(
      expect.objectContaining({
        source: "setup.route",
        operation: "GET /api/setup",
      })
    );
  });

  it("allows display mutations in development without an API key", async () => {
    const updateWhere = vi.fn().mockResolvedValue(undefined);
    const updateSet = vi.fn(() => ({ where: updateWhere }));
    const update = vi.fn(() => ({ set: updateSet }));
    mocks.getDb.mockResolvedValue({ update });

    const req = new NextRequest("http://localhost/api/display", {
      method: "POST",
      body: JSON.stringify({ action: "done", transactionId: 123 }),
      headers: { "content-type": "application/json" },
    });

    const res = await postDisplay(req);
    const body = (await res.json()) as { success: boolean };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mocks.getSession).toHaveBeenCalled();
    expect(mocks.getDb).toHaveBeenCalled();
  });

  it("returns 503 for display mutations in production without API key or session", async () => {
    setEnv("NODE_ENV", "production");

    const req = new NextRequest("http://localhost/api/display", {
      method: "POST",
      body: JSON.stringify({ action: "done", transactionId: 123 }),
      headers: { "content-type": "application/json" },
    });

    const res = await postDisplay(req);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(503);
    expect(body.error).toContain("DISPLAY_API_KEY is not configured in production");
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
