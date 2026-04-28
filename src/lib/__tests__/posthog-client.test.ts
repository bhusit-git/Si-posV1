import { beforeEach, describe, expect, it, vi } from "vitest";

const posthogMock = vi.hoisted(() => ({
  init: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  capture: vi.fn(),
  captureException: vi.fn(),
}));

vi.mock("posthog-js", () => ({
  default: posthogMock,
}));

async function loadPostHogClient() {
  vi.resetModules();
  return import("@/lib/posthog-client");
}

describe("posthog-client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "ph_test";
  });

  it("does not initialize posthog from the wrapper module", async () => {
    await loadPostHogClient();

    expect(posthogMock.init).not.toHaveBeenCalled();
  });

  it("does not capture auth-required events before identify unless explicitly anonymous", async () => {
    const { captureClientEvent } = await loadPostHogClient();

    expect(captureClientEvent("sale_reference_ready", { sale_id: 1 })).toBe(false);
    expect(posthogMock.capture).not.toHaveBeenCalled();

    expect(
      captureClientEvent(
        "sale_screen_interactive",
        { route: "/sale" },
        { allowAnonymous: true }
      )
    ).toBe(true);
    expect(posthogMock.capture).toHaveBeenCalledWith(
      "sale_screen_interactive",
      expect.objectContaining({
        schema_version: 2,
        app: "superice-pos",
        event_origin: "client",
        actor_user_id: null,
        actor_role: null,
        factory_key: null,
        analytics_anonymous: true,
        route: "/sale",
      })
    );
  });

  it("flushes queued events once the authenticated user is identified", async () => {
    const { captureClientEvent, identifyAuthenticatedUser } = await loadPostHogClient();

    expect(
      captureClientEvent("sale_reference_ready", { sale_id: 9, factory_key: "si" })
    ).toBe(false);
    expect(posthogMock.capture).not.toHaveBeenCalled();

    identifyAuthenticatedUser({ id: 7, role: "manager", factoryKey: "si" });

    expect(posthogMock.identify).toHaveBeenCalledWith("user:7", {
      user_id: 7,
      role: "manager",
      factory_key: "si",
    });
    expect(posthogMock.capture).toHaveBeenCalledWith(
      "sale_reference_ready",
      expect.objectContaining({
        schema_version: 2,
        app: "superice-pos",
        event_origin: "client",
        actor_user_id: 7,
        actor_role: "manager",
        factory_key: "si",
        sale_id: 9,
      })
    );
  });

  it("resets posthog identity and clears queued captures on logout", async () => {
    const { captureClientEvent, identifyAuthenticatedUser, resetAuthenticatedUser } =
      await loadPostHogClient();

    identifyAuthenticatedUser({ id: 5, role: "office", factoryKey: "si" });
    resetAuthenticatedUser();

    expect(posthogMock.reset).toHaveBeenCalledTimes(1);

    posthogMock.capture.mockClear();
    expect(captureClientEvent("report.exported", { report_type: "daily" })).toBe(false);
    expect(posthogMock.capture).not.toHaveBeenCalled();
  });

  it("adds exception diagnostics when capturing client errors", async () => {
    const { captureClientException } = await loadPostHogClient();

    expect(captureClientException(new TypeError("dashboard crashed"))).toBe(true);

    expect(posthogMock.captureException).toHaveBeenCalledWith(
      expect.any(TypeError),
      expect.objectContaining({
        schema_version: 2,
        app: "superice-pos",
        event_origin: "client",
        actor_user_id: null,
        actor_role: null,
        factory_key: null,
        analytics_anonymous: true,
        $exception_type: "TypeError",
        $exception_message: "dashboard crashed",
      })
    );
  });

  it("serializes object-like errors into diagnostic fields", async () => {
    const { captureClientException } = await loadPostHogClient();

    expect(captureClientException({ name: "ServerError", message: "bad gateway" })).toBe(true);

    expect(posthogMock.captureException).toHaveBeenCalledWith(
      { name: "ServerError", message: "bad gateway" },
      expect.objectContaining({
        $exception_type: "ServerError",
        $exception_message: "bad gateway",
      })
    );
  });
});
