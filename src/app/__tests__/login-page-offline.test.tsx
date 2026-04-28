import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/page";
import { getOfflineReferenceCacheStatus } from "@/lib/offline-reference-cache";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push,
  }),
}));

vi.mock("@/lib/offline-reference-cache", () => ({
  ensureOfflineReferenceCacheWarm: vi.fn(),
  getOfflineReferenceCacheStatus: vi.fn(),
}));

describe("login page offline behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    vi.mocked(getOfflineReferenceCacheStatus).mockResolvedValue({
      factoryKey: "si",
      hasProducts: true,
      hasCustomers: true,
      lastPreparedAt: "2026-04-03T10:05:00.000Z",
      ready: true,
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the offline sale shortcut when a device has an offline-capable session", async () => {
    vi.stubGlobal(
      "navigator",
      Object.assign({}, window.navigator, {
        onLine: false,
      })
    );
    window.localStorage.setItem(
      "superice-offline-capable-session",
      JSON.stringify({
        username: "manager-si",
        role: "manager",
        factoryKey: "si",
        lastValidatedAt: "2026-04-03T10:00:00.000Z",
        continuityEnabled: true,
      })
    );

    render(<LoginPage />);

    expect(screen.getByText("อุปกรณ์นี้กำลังออฟไลน์")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "เปิดหน้าขายออฟไลน์" }));
    expect(push).toHaveBeenCalledWith("/sale");
  });

  it("hides the offline sale shortcut until cached references are ready", async () => {
    vi.mocked(getOfflineReferenceCacheStatus).mockResolvedValue({
      factoryKey: "si",
      hasProducts: false,
      hasCustomers: false,
      lastPreparedAt: null,
      ready: false,
    });
    vi.stubGlobal(
      "navigator",
      Object.assign({}, window.navigator, {
        onLine: false,
      })
    );
    window.localStorage.setItem(
      "superice-offline-capable-session",
      JSON.stringify({
        username: "manager-si",
        role: "manager",
        factoryKey: "si",
        lastValidatedAt: "2026-04-03T10:00:00.000Z",
        continuityEnabled: true,
      })
    );

    render(<LoginPage />);

    expect(
      await screen.findByText("เครื่องนี้เคยเข้าสู่ระบบแล้ว แต่ยังไม่มีข้อมูลขายออฟไลน์ครบ ต้องล็อกอินออนไลน์อีกครั้งเพื่อเตรียมข้อมูลเครื่อง")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "เปิดหน้าขายออฟไลน์" })).toBeNull();
  });

  it("tells first-time devices to reconnect before login", async () => {
    vi.stubGlobal(
      "navigator",
      Object.assign({}, window.navigator, {
        onLine: false,
      })
    );

    render(<LoginPage />);

    expect(
      await screen.findByText("ต้องเชื่อมต่ออินเทอร์เน็ตเพื่อเข้าสู่ระบบครั้งแรกก่อน แล้วจึงจะกลับมาใช้งานออฟไลน์ได้")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เข้าสู่ระบบ" })).toBeDisabled();
  });
});
