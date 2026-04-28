declare module "next-pwa" {
  import type { NextConfig } from "next";

  interface NextPwaOptions {
    dest: string;
    register?: boolean;
    skipWaiting?: boolean;
    disable?: boolean;
    runtimeCaching?: unknown;
    fallbacks?: Record<string, string>;
  }

  export default function nextPwa(
    options: NextPwaOptions
  ): (config: NextConfig) => NextConfig;
}
