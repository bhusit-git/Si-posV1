import type { NextConfig } from "next";
import { createRequire } from "node:module";

const isDevelopment = process.env.NODE_ENV === "development";
const require = createRequire(import.meta.url);

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres"],
  async rewrites() {
    return [
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
    ];
  },
  // This is required to support PostHog trailing slash API requests
  skipTrailingSlashRedirect: true,
  // Keep dev on the faster default path. Production still adds PWA support below.
  turbopack: isDevelopment ? {} : undefined,
};

let finalConfig: NextConfig = nextConfig;

if (!isDevelopment) {
  const nextPwa = require("next-pwa") as typeof import("next-pwa").default;
  const { pwaRuntimeCaching } =
    require("./src/lib/pwa/runtime-caching") as typeof import("./src/lib/pwa/runtime-caching");

  const withPWA = nextPwa({
    dest: "public",
    register: true,
    skipWaiting: true,
    runtimeCaching: pwaRuntimeCaching,
    fallbacks: {
      document: "/offline.html",
    },
  });

  finalConfig = withPWA(nextConfig);
}

export default finalConfig;
