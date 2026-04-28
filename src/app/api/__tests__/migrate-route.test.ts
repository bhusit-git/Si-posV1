import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  authorizeMigrationRequest: vi.fn(),
  dispatchMigrateAction: vi.fn(),
}));

vi.mock("@/lib/migrate/shared", () => ({
  authorizeMigrationRequest: mocks.authorizeMigrationRequest,
}));

vi.mock("@/lib/migrate/dispatcher", () => ({
  dispatchMigrateAction: mocks.dispatchMigrateAction,
}));

import { GET, POST } from "@/app/api/migrate/route";

describe("migrate route shell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the auth failure response without dispatching", async () => {
    const authResponse = NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    mocks.authorizeMigrationRequest.mockReturnValue({
      ok: false,
      response: authResponse,
    });

    const req = new NextRequest("http://localhost/api/migrate");
    const res = await GET(req);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(mocks.dispatchMigrateAction).not.toHaveBeenCalled();
  });

  it("delegates to the dispatcher with the resolved caller ip", async () => {
    mocks.authorizeMigrationRequest.mockReturnValue({
      ok: true,
      callerIp: "10.0.0.8",
    });
    mocks.dispatchMigrateAction.mockResolvedValue(
      NextResponse.json({ success: true }, { status: 200 })
    );

    const req = new NextRequest("http://localhost/api/migrate", { method: "POST" });
    const res = await POST(req);
    const body = (await res.json()) as { success: boolean };

    expect(body.success).toBe(true);
    expect(mocks.dispatchMigrateAction).toHaveBeenCalledWith(req, "10.0.0.8");
  });
});
