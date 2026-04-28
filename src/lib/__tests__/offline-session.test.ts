import { beforeEach, describe, expect, it } from "vitest";
import {
  clearOfflineCapableSession,
  markOfflineCapableSession,
  OFFLINE_SESSION_STORAGE_KEY,
  readOfflineCapableSession,
  readOfflineCapableSessionUser,
} from "@/lib/offline-session";

describe("offline-session", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("writes and reads an offline-capable session marker", () => {
    markOfflineCapableSession({
      username: "admin-si",
      role: "admin",
      factoryKey: "si",
      at: "2026-04-03T10:00:00.000Z",
    });

    expect(readOfflineCapableSession()).toEqual({
      username: "admin-si",
      role: "admin",
      factoryKey: "si",
      lastValidatedAt: "2026-04-03T10:00:00.000Z",
      continuityEnabled: true,
    });
    expect(readOfflineCapableSessionUser()).toEqual({
      id: 0,
      username: "admin-si",
      role: "admin",
      factoryKey: "si",
    });
  });

  it("clears the offline-capable session marker", () => {
    window.localStorage.setItem(
      OFFLINE_SESSION_STORAGE_KEY,
      JSON.stringify({
        username: "office-bearing",
        role: "office",
        factoryKey: "bearing",
        at: "2026-04-03T11:00:00.000Z",
      })
    );

    clearOfflineCapableSession();

    expect(readOfflineCapableSession()).toBeNull();
  });

  it("ignores malformed markers", () => {
    window.localStorage.setItem(OFFLINE_SESSION_STORAGE_KEY, '{"bad":true}');

    expect(readOfflineCapableSession()).toBeNull();
    expect(readOfflineCapableSessionUser()).toBeNull();
  });

  it("normalizes legacy markers saved with the old at field", () => {
    window.localStorage.setItem(
      OFFLINE_SESSION_STORAGE_KEY,
      JSON.stringify({
        username: "legacy",
        role: "manager",
        factoryKey: "si",
        at: "2026-04-03T09:30:00.000Z",
      })
    );

    expect(readOfflineCapableSession()).toEqual({
      username: "legacy",
      role: "manager",
      factoryKey: "si",
      lastValidatedAt: "2026-04-03T09:30:00.000Z",
      continuityEnabled: true,
    });
  });
});
