import posthog from "posthog-js";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
const posthogHost = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

if (posthogKey) {
  posthog.init(posthogKey, {
    // Use direct host in local dev to avoid local rewrite/proxy failures.
    // Keep the /ingest proxy in production for ad-blocker resilience.
    api_host: process.env.NODE_ENV === "development" ? posthogHost : "/ingest",
    ui_host: "https://us.posthog.com",
    // Include the defaults option as required by PostHog
    defaults: "2026-01-30",
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    disable_session_recording: true,
    // Enables capturing unhandled exceptions via Error Tracking
    capture_exceptions: true,
    // Turn on debug in development mode
    debug: process.env.NODE_ENV === "development",
  });
}

// IMPORTANT: Never combine this approach with other client-side PostHog initialization approaches,
// especially components like a PostHogProvider. instrumentation-client.ts is the correct solution
// for initializing client-side PostHog in Next.js 15.3+ apps.
