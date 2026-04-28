import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const debug = vi.fn();
  const shutdown = vi.fn(() => Promise.resolve());
  const posthogInstances: Array<{ options: Record<string, unknown> }> = [];

  class MockPostHog {
    debug = debug;
    shutdown = shutdown;

    constructor(_key: string, options: Record<string, unknown>) {
      posthogInstances.push({ options });
    }

    capture() {}

    identify() {}
  }

  return {
    MockPostHog,
    debug,
    shutdown,
    posthogInstances,
    getSupericeEnv: vi.fn(),
  };
});

vi.mock("posthog-node", () => ({
  PostHog: mocks.MockPostHog,
}));

vi.mock("@/lib/config/env", () => ({
  getSupericeEnv: mocks.getSupericeEnv,
}));

describe("posthog-server", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.debug.mockReset();
    mocks.shutdown.mockReset();
    mocks.posthogInstances.length = 0;
    mocks.getSupericeEnv.mockReturnValue({
      posthogKey: "ph_test",
      posthogHost: "https://us.i.posthog.com",
      isProduction: true,
    });
  });

  it("drops malformed events in before_send and normalizes valid names", async () => {
    const { getPostHogClient } = await import("@/lib/posthog-server");
    getPostHogClient();

    expect(mocks.posthogInstances).toHaveLength(1);
    const beforeSend = mocks.posthogInstances[0].options.before_send as
      | ((payload: Record<string, unknown>) => Record<string, unknown> | null)
      | undefined;

    expect(beforeSend).toBeTypeOf("function");
    expect(
      beforeSend?.({
        distinctId: "user:1",
        event: "  sale_completed  ",
        properties: { total_amount: 100 },
      })
    ).toEqual({
      distinctId: "user:1",
      event: "sale_completed",
      properties: { total_amount: 100 },
    });

    expect(
      beforeSend?.({
        distinctId: "user:1",
        event: "   ",
        properties: { total_amount: 100 },
      })
    ).toBeNull();
  });
});
