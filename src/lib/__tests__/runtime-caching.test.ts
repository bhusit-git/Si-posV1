import { describe, expect, it } from "vitest";
import {
  isApiRequest,
  isDocumentNavigation,
  isFontFileRequest,
  isFontStylesheetRequest,
  isIconOrManifestRequest,
  isStaticAssetRequest,
  pwaRuntimeCaching,
} from "@/lib/pwa/runtime-caching";

function createContext(urlValue: string, request: { mode?: string; destination?: string } = {}) {
  return {
    url: new URL(urlValue),
    request,
  };
}

describe("pwa runtime caching", () => {
  it("treats api requests as network-only", () => {
    expect(isApiRequest(createContext("https://superice.local/api/transactions"))).toBe(true);
  });

  it("detects document navigations separately from api requests", () => {
    expect(
      isDocumentNavigation(
        createContext("https://superice.local/sale", {
          mode: "navigate",
          destination: "document",
        })
      )
    ).toBe(true);
    expect(
      isDocumentNavigation(
        createContext("https://superice.local/api/auth", {
          mode: "navigate",
          destination: "document",
        })
      )
    ).toBe(false);
  });

  it("detects static assets, icons, manifest, and fonts", () => {
    expect(
      isStaticAssetRequest(createContext("https://superice.local/_next/static/chunks/app.js"))
    ).toBe(true);
    expect(isIconOrManifestRequest(createContext("https://superice.local/manifest.json"))).toBe(
      true
    );
    expect(
      isFontStylesheetRequest(
        createContext("https://fonts.googleapis.com/css2?family=Noto+Sans+Thai")
      )
    ).toBe(true);
    expect(
      isFontFileRequest(createContext("https://fonts.gstatic.com/s/notosansthai.woff2"))
    ).toBe(true);
  });

  it("keeps the document fallback wired to offline.html", () => {
    const documentRule = pwaRuntimeCaching.find((rule) => rule.handler === "NetworkFirst");
    expect(documentRule?.options).toMatchObject({
      cacheName: "app-documents",
      networkTimeoutSeconds: 3,
      precacheFallback: {
        fallbackURL: "/offline.html",
      },
    });
  });
});
