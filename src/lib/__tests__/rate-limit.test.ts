import { describe, expect, it } from "vitest";
import { checkNamedRateLimit } from "@/lib/rate-limit";

describe("checkNamedRateLimit", () => {
  it("blocks after reaching max attempts in the same window", () => {
    const limiter = `tx-${Date.now()}-a`;
    const key = "127.0.0.1";

    const first = checkNamedRateLimit(limiter, key, 2, 60_000);
    const second = checkNamedRateLimit(limiter, key, 2, 60_000);
    const third = checkNamedRateLimit(limiter, key, 2, 60_000);

    expect(first.limited).toBe(false);
    expect(second.limited).toBe(false);
    expect(third.limited).toBe(true);
    expect(third.retryAfterMs).toBeGreaterThan(0);
  });

  it("keeps counters isolated between limiter names", () => {
    const key = "10.0.0.5";
    const limiterA = `users-${Date.now()}-a`;
    const limiterB = `users-${Date.now()}-b`;

    // Consume limiter A
    checkNamedRateLimit(limiterA, key, 1, 60_000);
    const limitedA = checkNamedRateLimit(limiterA, key, 1, 60_000);

    // Limiter B should still allow first request
    const firstB = checkNamedRateLimit(limiterB, key, 1, 60_000);

    expect(limitedA.limited).toBe(true);
    expect(firstB.limited).toBe(false);
  });
});
