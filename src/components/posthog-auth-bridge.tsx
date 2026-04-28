"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import {
  identifyAuthenticatedUser,
  resetAuthenticatedUser,
} from "@/lib/posthog-client";

export function PostHogAuthBridge() {
  const pathname = usePathname();

  useEffect(() => {
    let cancelled = false;

    const syncAnalyticsIdentity = async () => {
      try {
        const [authResponse, factoryResponse] = await Promise.all([
          fetch("/api/auth"),
          fetch("/api/factory"),
        ]);
        if (cancelled) return;

        const authData = authResponse.ok ? await authResponse.json() : null;
        const factoryData = factoryResponse.ok ? await factoryResponse.json() : null;
        if (cancelled) return;

        if (
          authData &&
          !authData.error &&
          Number.isFinite(authData.id) &&
          typeof authData.role === "string"
        ) {
          identifyAuthenticatedUser({
            id: Number(authData.id),
            role: authData.role,
            factoryKey:
              typeof authData.factoryKey === "string" && authData.factoryKey.length > 0
                ? authData.factoryKey
                : typeof factoryData?.current === "string" && factoryData.current.length > 0
                  ? factoryData.current
                  : null,
          });
          return;
        }

        resetAuthenticatedUser();
      } catch {
        // Keep the previous identified user on transient network failures.
      }
    };

    void syncAnalyticsIdentity();

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return null;
}
