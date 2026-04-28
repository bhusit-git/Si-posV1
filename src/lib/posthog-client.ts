"use client";

import posthog from "posthog-js";
import { buildAnalyticsBaseProperties, buildAuthenticatedDistinctId } from "@/lib/posthog-events";

export interface AuthenticatedAnalyticsUser {
  id: number;
  role: string;
  factoryKey: string | null;
}

interface ClientAnalyticsAuthContext {
  distinctId: string;
  userId: number;
  role: string;
  factoryKey: string | null;
}

interface CaptureClientEventOptions {
  allowAnonymous?: boolean;
}

interface QueuedClientCapture {
  type: "event" | "exception";
  eventName?: string;
  error?: unknown;
  properties?: Record<string, unknown>;
  options: CaptureClientEventOptions;
}

let authContext: ClientAnalyticsAuthContext | null = null;
const pendingCaptures: QueuedClientCapture[] = [];
const MAX_EXCEPTION_MESSAGE_LENGTH = 500;

function hasClientAnalyticsConfig(): boolean {
  return typeof window !== "undefined" && Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);
}

function isAbortLikeError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name} ${error.message}`
      : typeof error === "string"
        ? error
        : String(error);
  return /abort|aborted|AbortError|signal is aborted/i.test(message);
}

function safeHandleAsyncResult(result: unknown, eventName: string): void {
  if (!result || typeof result !== "object") return;
  const maybePromise = result as Promise<unknown>;
  if (typeof maybePromise.catch !== "function") return;
  maybePromise.catch((error) => {
    if (!isAbortLikeError(error)) {
      console.warn(`[analytics] posthog capture failed for ${eventName}`, error);
    }
  });
}

function buildClientProperties(
  properties: Record<string, unknown> | undefined,
  allowAnonymous: boolean
): Record<string, unknown> {
  const factoryKeyOverride =
    typeof properties?.factory_key === "string" ? properties.factory_key : null;

  return {
    ...buildAnalyticsBaseProperties({
      eventOrigin: "client",
      actorUserId: authContext?.userId ?? null,
      actorRole: authContext?.role ?? null,
      factoryKey:
        factoryKeyOverride ??
        authContext?.factoryKey ??
        null,
    }),
    ...(allowAnonymous && !authContext
      ? { analytics_anonymous: true }
      : {}),
    ...(properties || {}),
  };
}

function truncateExceptionMessage(message: string): string {
  return message.trim().slice(0, MAX_EXCEPTION_MESSAGE_LENGTH);
}

function buildExceptionDiagnostics(error: unknown): Record<string, string> {
  if (error instanceof Error) {
    return {
      $exception_type: error.name || "Error",
      $exception_message: truncateExceptionMessage(error.message || String(error)),
    };
  }

  if (typeof error === "string") {
    return {
      $exception_type: "Error",
      $exception_message: truncateExceptionMessage(error),
    };
  }

  if (error && typeof error === "object") {
    const errorLike = error as {
      name?: unknown;
      message?: unknown;
      constructor?: { name?: unknown };
    };
    const exceptionType =
      typeof errorLike.name === "string" && errorLike.name.trim()
        ? errorLike.name.trim()
        : typeof errorLike.constructor?.name === "string" && errorLike.constructor.name.trim()
          ? errorLike.constructor.name.trim()
          : "Error";

    const message =
      typeof errorLike.message === "string" && errorLike.message.trim()
        ? errorLike.message
        : (() => {
            try {
              return JSON.stringify(error);
            } catch {
              return String(error);
            }
          })();

    return {
      $exception_type: exceptionType,
      $exception_message: truncateExceptionMessage(message),
    };
  }

  return {
    $exception_type: "Error",
    $exception_message: truncateExceptionMessage(String(error)),
  };
}

function enqueueCapture(capture: QueuedClientCapture): void {
  pendingCaptures.push(capture);
  if (pendingCaptures.length > 50) {
    pendingCaptures.splice(0, pendingCaptures.length - 50);
  }
}

function flushPendingCaptures(): void {
  if (!authContext || pendingCaptures.length === 0) return;
  const queued = pendingCaptures.splice(0, pendingCaptures.length);
  for (const capture of queued) {
    if (capture.type === "event" && capture.eventName) {
      captureClientEvent(capture.eventName, capture.properties, capture.options);
      continue;
    }
    if (capture.type === "exception") {
      captureClientException(capture.error, capture.options);
    }
  }
}

export function identifyAuthenticatedUser(user: AuthenticatedAnalyticsUser): void {
  if (!hasClientAnalyticsConfig()) return;
  if (!Number.isFinite(user.id) || user.id <= 0 || !user.role) return;

  const nextContext: ClientAnalyticsAuthContext = {
    distinctId: buildAuthenticatedDistinctId(user.id),
    userId: user.id,
    role: user.role,
    factoryKey: user.factoryKey ?? null,
  };

  authContext = nextContext;

  try {
    posthog.identify(nextContext.distinctId, {
      user_id: nextContext.userId,
      role: nextContext.role,
      factory_key: nextContext.factoryKey,
    });
  } catch (error) {
    if (!isAbortLikeError(error)) {
      console.warn("[analytics] posthog identify threw", error);
    }
  }

  flushPendingCaptures();
}

export function resetAuthenticatedUser(): void {
  authContext = null;
  pendingCaptures.splice(0, pendingCaptures.length);
  if (!hasClientAnalyticsConfig()) return;

  try {
    posthog.reset();
  } catch (error) {
    if (!isAbortLikeError(error)) {
      console.warn("[analytics] posthog reset threw", error);
    }
  }
}

export function captureClientEvent(
  eventName: string,
  properties?: Record<string, unknown>,
  options: CaptureClientEventOptions = {}
): boolean {
  if (!hasClientAnalyticsConfig()) return false;

  const allowAnonymous = options.allowAnonymous === true;
  if (!allowAnonymous && !authContext) {
    enqueueCapture({ type: "event", eventName, properties, options });
    return false;
  }

  try {
    const result = posthog.capture(
      eventName,
      buildClientProperties(properties, allowAnonymous)
    );
    safeHandleAsyncResult(result, eventName);
    return true;
  } catch (error) {
    if (!isAbortLikeError(error)) {
      console.warn(`[analytics] posthog capture threw for ${eventName}`, error);
    }
    return false;
  }
}

export function captureClientException(
  error: unknown,
  options: CaptureClientEventOptions = { allowAnonymous: true }
): boolean {
  if (!hasClientAnalyticsConfig()) return false;

  const allowAnonymous = options.allowAnonymous === true;
  if (!allowAnonymous && !authContext) {
    enqueueCapture({ type: "exception", error, options });
    return false;
  }

  try {
    const result = posthog.captureException(
      error,
      buildClientProperties(buildExceptionDiagnostics(error), allowAnonymous)
    );
    safeHandleAsyncResult(result, "exception");
    return true;
  } catch (captureError) {
    if (!isAbortLikeError(captureError)) {
      console.warn("[analytics] posthog captureException threw", captureError);
    }
    return false;
  }
}
