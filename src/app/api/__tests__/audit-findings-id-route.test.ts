import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getDb: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("@/db", () => ({
  getDb: mocks.getDb,
}));

import { PATCH } from "@/app/api/audit/findings/[id]/route";

describe("PATCH /api/audit/findings/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({
      user: { id: 1, username: "admin", role: "admin" },
    });
  });

  it("updates finding review status", async () => {
    const returning = vi.fn().mockResolvedValue([
      {
        id: 14,
        status: "reviewed",
        reviewNote: "checked",
        updatedAt: new Date("2026-03-16T01:00:00.000Z"),
      },
    ]);
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    mocks.getDb.mockResolvedValue({ update });

    const req = new NextRequest("http://localhost/api/audit/findings/14", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "reviewed", reviewNote: "checked" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "14" }) });
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalled();
    expect(body.success).toBe(true);
    expect((body.finding as Record<string, unknown>).status).toBe("reviewed");
  });

  it("returns validation error for unsupported status", async () => {
    const req = new NextRequest("http://localhost/api/audit/findings/14", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "bad-status" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "14" }) });
    const body = (await res.json()) as Record<string, unknown>;
    expect(res.status).toBe(400);
    expect(body.error).toBe("ต้องระบุสถานะ");
  });

  it("returns auth error when user is not allowed", async () => {
    mocks.requireAdmin.mockResolvedValueOnce({
      error: NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 }),
    });

    const req = new NextRequest("http://localhost/api/audit/findings/14", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "dismissed" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "14" }) });
    expect(res.status).toBe(403);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("returns a structured 500 payload when the update fails", async () => {
    const where = vi.fn(() => ({
      returning: vi.fn().mockRejectedValue(new Error("write failed")),
    }));
    const set = vi.fn(() => ({ where }));
    const update = vi.fn(() => ({ set }));
    mocks.getDb.mockResolvedValue({ update });

    const req = new NextRequest("http://localhost/api/audit/findings/14", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "reviewed" }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: "14" }) });
    const body = (await res.json()) as {
      error: string;
      requestId?: string;
      diagnostic?: { source?: string; operation?: string };
    };

    expect(res.status).toBe(500);
    expect(body.error).toBe("เกิดข้อผิดพลาดภายในระบบ");
    expect(body.requestId).toBeTruthy();
    expect(body.diagnostic).toEqual(
      expect.objectContaining({
        source: "audit.findings",
        operation: "PATCH /api/audit/findings/[id]",
      })
    );
  });
});
