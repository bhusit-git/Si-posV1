import { describe, expect, it } from "vitest";
import {
  getClientIpFromHeaders,
  hasValidCsrfContextFromHeaders,
} from "@/lib/request-security";

describe("request-security helpers", () => {
  describe("getClientIpFromHeaders", () => {
    it("uses the right-most valid x-forwarded-for entry", () => {
      const headers = new Headers({
        "x-forwarded-for": "198.51.100.10, 203.0.113.7",
      });
      expect(getClientIpFromHeaders(headers)).toBe("203.0.113.7");
    });

    it("ignores invalid x-forwarded-for entries", () => {
      const headers = new Headers({
        "x-forwarded-for": "not-an-ip, 203.0.113.9",
      });
      expect(getClientIpFromHeaders(headers)).toBe("203.0.113.9");
    });

    it("falls back to x-real-ip", () => {
      const headers = new Headers({
        "x-real-ip": "203.0.113.8",
      });
      expect(getClientIpFromHeaders(headers)).toBe("203.0.113.8");
    });

    it("returns unknown when no valid IP headers exist", () => {
      const headers = new Headers({
        "x-forwarded-for": "invalid-ip",
        "x-real-ip": "also-invalid",
      });
      expect(getClientIpFromHeaders(headers)).toBe("unknown");
    });
  });

  describe("hasValidCsrfContextFromHeaders", () => {
    const expectedOrigin = "https://app.example.com";
    const expectedOrigins = new Set([expectedOrigin]);

    it("accepts matching origin", () => {
      const headers = new Headers({ origin: expectedOrigin });
      expect(hasValidCsrfContextFromHeaders(headers, expectedOrigins)).toBe(true);
    });

    it("rejects mismatched origin", () => {
      const headers = new Headers({ origin: "https://evil.example.com" });
      expect(hasValidCsrfContextFromHeaders(headers, expectedOrigins)).toBe(false);
    });

    it("accepts matching referer when origin is missing", () => {
      const headers = new Headers({
        referer: "https://app.example.com/dashboard",
      });
      expect(hasValidCsrfContextFromHeaders(headers, expectedOrigins)).toBe(true);
    });

    it("rejects cross-site fetch context", () => {
      const headers = new Headers({
        origin: expectedOrigin,
        "sec-fetch-site": "cross-site",
      });
      expect(hasValidCsrfContextFromHeaders(headers, expectedOrigins)).toBe(false);
    });

    it("rejects requests with no origin or referer", () => {
      const headers = new Headers();
      expect(hasValidCsrfContextFromHeaders(headers, expectedOrigins)).toBe(false);
    });

    it("accepts same-site fetch when origin/referer are missing", () => {
      const headers = new Headers({
        "sec-fetch-site": "same-origin",
      });
      expect(hasValidCsrfContextFromHeaders(headers, expectedOrigins)).toBe(true);
    });
  });
});
