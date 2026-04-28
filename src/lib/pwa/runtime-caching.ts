export interface RuntimeCachingContext {
  request: {
    mode?: string;
    destination?: string;
  };
  url: URL;
}

export interface RuntimeCachingRule {
  urlPattern: RegExp | ((context: RuntimeCachingContext) => boolean);
  handler: "StaleWhileRevalidate" | "NetworkFirst" | "NetworkOnly";
  options: Record<string, unknown>;
}

const ONE_DAY_SECONDS = 60 * 60 * 24;
const ONE_WEEK_SECONDS = ONE_DAY_SECONDS * 7;
const ONE_MONTH_SECONDS = ONE_DAY_SECONDS * 30;

export function isSameOriginAsset({ request, url }: RuntimeCachingContext): boolean {
  return (
    url.origin === "self" ||
    (request.destination != null &&
      ["style", "script", "worker"].includes(request.destination) &&
      !url.pathname.startsWith("/api/"))
  );
}

export function isStaticAssetRequest({ url }: RuntimeCachingContext): boolean {
  return url.pathname.startsWith("/_next/static/");
}

export function isIconOrManifestRequest({ url }: RuntimeCachingContext): boolean {
  return (
    url.pathname === "/manifest.json" ||
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/favicon.ico"
  );
}

export function isFontStylesheetRequest({ url }: RuntimeCachingContext): boolean {
  return url.origin === "https://fonts.googleapis.com";
}

export function isFontFileRequest({ url }: RuntimeCachingContext): boolean {
  return url.origin === "https://fonts.gstatic.com";
}

export function isApiRequest({ url }: RuntimeCachingContext): boolean {
  return url.pathname.startsWith("/api/");
}

export function isDocumentNavigation({ request, url }: RuntimeCachingContext): boolean {
  return request.mode === "navigate" && !url.pathname.startsWith("/api/");
}

export const pwaRuntimeCaching: RuntimeCachingRule[] = [
  {
    urlPattern: isApiRequest,
    handler: "NetworkOnly",
    options: {
      cacheName: "api-network-only",
    },
  },
  {
    urlPattern: isStaticAssetRequest,
    handler: "StaleWhileRevalidate",
    options: {
      cacheName: "next-static-assets",
      expiration: {
        maxEntries: 128,
        maxAgeSeconds: ONE_MONTH_SECONDS,
      },
    },
  },
  {
    urlPattern: isSameOriginAsset,
    handler: "StaleWhileRevalidate",
    options: {
      cacheName: "app-shell-assets",
      expiration: {
        maxEntries: 64,
        maxAgeSeconds: ONE_WEEK_SECONDS,
      },
    },
  },
  {
    urlPattern: isIconOrManifestRequest,
    handler: "StaleWhileRevalidate",
    options: {
      cacheName: "app-icons-manifest",
      expiration: {
        maxEntries: 16,
        maxAgeSeconds: ONE_WEEK_SECONDS,
      },
    },
  },
  {
    urlPattern: isFontStylesheetRequest,
    handler: "StaleWhileRevalidate",
    options: {
      cacheName: "google-font-stylesheets",
      expiration: {
        maxEntries: 8,
        maxAgeSeconds: ONE_WEEK_SECONDS,
      },
    },
  },
  {
    urlPattern: isFontFileRequest,
    handler: "StaleWhileRevalidate",
    options: {
      cacheName: "google-font-files",
      expiration: {
        maxEntries: 16,
        maxAgeSeconds: ONE_MONTH_SECONDS,
      },
    },
  },
  {
    urlPattern: isDocumentNavigation,
    handler: "NetworkFirst",
    options: {
      cacheName: "app-documents",
      networkTimeoutSeconds: 3,
      expiration: {
        maxEntries: 32,
        maxAgeSeconds: ONE_DAY_SECONDS,
      },
      precacheFallback: {
        fallbackURL: "/offline.html",
      },
    },
  },
];
