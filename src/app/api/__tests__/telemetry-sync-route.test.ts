import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireManagerUp: vi.fn(),
  logAudit: vi.fn(),
  withBehaviorDetails: vi.fn(
    (details: Record<string, unknown>, behavior: Record<string, unknown>) => ({
      ...details,
      behavior,
    })
  ),
}));

vi.mock("@/lib/api-auth", () => ({
  requireManagerUp: mocks.requireManagerUp,
}));

vi.mock("@/lib/audit", () => ({
  logAudit: mocks.logAudit,
  withBehaviorDetails: mocks.withBehaviorDetails,
}));

import { POST } from "@/app/api/telemetry/sync/route";

function makeRequest(rawBody: string) {
  return new NextRequest("http://localhost/api/telemetry/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: rawBody,
  });
}

describe("POST /api/telemetry/sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireManagerUp.mockResolvedValue({
      user: { id: 9, username: "shared-account", role: "manager" },
    });
  });

  it("returns auth error when session is missing", async () => {
    mocks.requireManagerUp.mockResolvedValueOnce({
      error: NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 }),
    });

    const res = await POST(makeRequest(JSON.stringify({ event: "sync_started" })));
    expect(res.status).toBe(401);
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON payload", async () => {
    const res = await POST(makeRequest("{invalid-json"));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(body.error).toBe("payload ไม่ถูกต้อง");
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("rejects unknown event values", async () => {
    const res = await POST(makeRequest(JSON.stringify({ event: "unexpected" })));
    const body = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(400);
    expect(body.error).toBe("event ไม่ถูกต้อง");
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it("accepts valid payload and writes structured audit event", async () => {
    const res = await POST(
      makeRequest(
        JSON.stringify({
          event: "sale_synced",
          clientId: "abc-123",
          customerId: "44",
          transactionId: 778,
          amount: "1234.5",
          pendingCount: 5,
          successCount: 2,
          failedCount: 1,
          queuedAt: "2026-02-25T10:00:00.000Z",
        })
      )
    );

    expect(res.status).toBe(200);
    expect(mocks.logAudit).toHaveBeenCalledTimes(1);

    const arg = mocks.logAudit.mock.calls[0][0] as Record<string, unknown>;
    expect(arg.userId).toBe(9);
    expect(arg.username).toBe("shared-account");
    expect(arg.action).toBe("sync.sale_synced");
    expect(arg.entity).toBe("sync");
    expect(arg.entityId).toBe(778);

    const withBehaviorArg = mocks.withBehaviorDetails.mock.calls[0];
    expect(withBehaviorArg[0]).toMatchObject({
      event: "sale_synced",
      customerId: 44,
      transactionId: 778,
      amount: 1234.5,
      pendingCount: 5,
      successCount: 2,
      failedCount: 1,
      clientId: "abc-123",
    });
    expect(withBehaviorArg[1]).toMatchObject({
      event: "sync.sale_synced",
      source: "offline_sync",
      customerId: 44,
      transactionId: 778,
      amount: 1234.5,
    });
  });

  it("truncates large error text and clamps future queuedAt lag to zero", async () => {
    const longError = "x".repeat(500);
    const future = new Date(Date.now() + 60_000).toISOString();

    const res = await POST(
      makeRequest(
        JSON.stringify({
          event: "sale_failed",
          error: longError,
          queuedAt: future,
          customerId: 1,
        })
      )
    );
    expect(res.status).toBe(200);

    const withBehaviorArg = mocks.withBehaviorDetails.mock.calls[0];
    const details = withBehaviorArg[0] as Record<string, unknown>;
    const behavior = withBehaviorArg[1] as Record<string, unknown>;

    expect(String(details.error).length).toBe(300);
    expect(details.queueLagSeconds).toBe(0);
    expect(behavior.reasonCode).toBe("error");
  });

  it("does not include queueLagSeconds when queuedAt is invalid", async () => {
    const res = await POST(
      makeRequest(
        JSON.stringify({
          event: "sync_finished",
          queuedAt: "not-a-date",
        })
      )
    );
    expect(res.status).toBe(200);

    const withBehaviorArg = mocks.withBehaviorDetails.mock.calls[0];
    const details = withBehaviorArg[0] as Record<string, unknown>;
    expect(details.queueLagSeconds).toBeUndefined();
  });

  it("keeps same-account telemetry events separate by entityId/details", async () => {
    const payloadA = JSON.stringify({
      event: "sale_synced",
      transactionId: 7001,
      customerId: 201,
      clientId: "same-user-a",
    });
    const payloadB = JSON.stringify({
      event: "sale_synced",
      transactionId: 7002,
      customerId: 202,
      clientId: "same-user-b",
    });

    const [resA, resB] = await Promise.all([
      POST(makeRequest(payloadA)),
      POST(makeRequest(payloadB)),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(mocks.logAudit).toHaveBeenCalledTimes(2);

    const first = mocks.logAudit.mock.calls[0][0] as Record<string, unknown>;
    const second = mocks.logAudit.mock.calls[1][0] as Record<string, unknown>;
    expect(first.username).toBe("shared-account");
    expect(second.username).toBe("shared-account");
    expect(first.entityId).not.toBe(second.entityId);
    expect(first.details).not.toEqual(second.details);
  });
});
