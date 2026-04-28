/**
 * Simple in-memory rate limiter for login attempts.
 * Tracks attempts by IP address with a sliding window.
 */
import { getSupericeEnv } from "@/lib/config/env";

interface AttemptRecord {
  count: number;
  resetAt: number;
}

interface RateLimitResult {
  limited: boolean;
  remaining: number;
  retryAfterMs?: number;
}

const loginAttempts = new Map<string, AttemptRecord>();
const namedAttempts = new Map<string, Map<string, AttemptRecord>>();

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 60_000; // 1 minute
let warnedInProd = false;

function warnInMemoryLimiterInProd() {
  if (warnedInProd || !getSupericeEnv().isProduction) return;
  warnedInProd = true;
  console.warn(
    "[rate-limit] Using in-memory limiter in production. Configure a shared store (e.g. Redis) for multi-instance safety."
  );
}

function checkWithStore(
  store: Map<string, AttemptRecord>,
  key: string,
  maxAttempts: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const record = store.get(key);

  if (!record || now > record.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, remaining: maxAttempts - 1 };
  }

  if (record.count >= maxAttempts) {
    return {
      limited: true,
      remaining: 0,
      retryAfterMs: Math.max(0, record.resetAt - now),
    };
  }

  record.count++;
  return { limited: false, remaining: maxAttempts - record.count };
}

function cleanupExpired(store: Map<string, AttemptRecord>) {
  const now = Date.now();
  for (const [key, record] of store) {
    if (now > record.resetAt) {
      store.delete(key);
    }
  }
}

// Clean up expired entries periodically
setInterval(() => {
  cleanupExpired(loginAttempts);
  for (const limiterStore of namedAttempts.values()) {
    cleanupExpired(limiterStore);
  }
}, 60_000);

/**
 * Check if a key (usually IP) is rate-limited.
 * Returns { limited: true, retryAfterMs } if blocked,
 * or { limited: false } and increments the counter.
 */
export function checkRateLimit(key: string): {
  limited: boolean;
  remaining: number;
  retryAfterMs?: number;
} {
  warnInMemoryLimiterInProd();
  return checkWithStore(loginAttempts, key, MAX_ATTEMPTS, WINDOW_MS);
}

/**
 * Generic named rate limiter for route-level protections.
 * Each limiter name keeps its own in-memory counter store.
 */
export function checkNamedRateLimit(
  limiterName: string,
  key: string,
  maxAttempts: number,
  windowMs: number
): RateLimitResult {
  warnInMemoryLimiterInProd();
  let store = namedAttempts.get(limiterName);
  if (!store) {
    store = new Map<string, AttemptRecord>();
    namedAttempts.set(limiterName, store);
  }
  return checkWithStore(store, key, maxAttempts, windowMs);
}
