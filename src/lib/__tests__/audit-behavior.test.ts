import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({
  getDb: vi.fn(),
}));

import { CUSTOMER_BEHAVIOR_SCHEMA, withBehaviorDetails } from "@/lib/audit";

describe("withBehaviorDetails", () => {
  it("adds required behavior envelope fields", () => {
    const result = withBehaviorDetails(
      { customerId: 11, totalAmount: 1234 },
      {
        event: "sale.created",
        source: "pos",
        customerId: 11,
        transactionId: 999,
      }
    );

    expect(result.customerId).toBe(11);
    expect(result.totalAmount).toBe(1234);
    expect(result.behavior).toEqual({
      schema: CUSTOMER_BEHAVIOR_SCHEMA,
      event: "sale.created",
      source: "pos",
      customerId: 11,
      transactionId: 999,
    });
  });

  it("includes optional amount/quantity/reason/tags/extra when provided", () => {
    const result = withBehaviorDetails(
      { oldPrice: 100, newPrice: 120 },
      {
        event: "price.changed",
        source: "backoffice",
        customerId: 21,
        transactionId: null,
        amount: 120,
        quantity: 1,
        reasonCode: "edit",
        tags: ["large_price_change"],
        extra: { pctDiff: 20 },
      }
    );

    expect(result.behavior).toMatchObject({
      schema: CUSTOMER_BEHAVIOR_SCHEMA,
      event: "price.changed",
      source: "backoffice",
      customerId: 21,
      transactionId: null,
      amount: 120,
      quantity: 1,
      reasonCode: "edit",
      tags: ["large_price_change"],
      pctDiff: 20,
    });
  });

  it("omits optional fields when undefined or empty", () => {
    const result = withBehaviorDetails(
      { note: "minimal" },
      {
        event: "sync.sync_started",
        source: "offline_sync",
        tags: [],
        reasonCode: "",
      }
    );

    const behavior = result.behavior as Record<string, unknown>;
    expect(behavior.amount).toBeUndefined();
    expect(behavior.quantity).toBeUndefined();
    expect(behavior.reasonCode).toBeUndefined();
    expect(behavior.tags).toBeUndefined();
    expect(behavior.customerId).toBeNull();
    expect(behavior.transactionId).toBeNull();
  });

  it("does not mutate input details object", () => {
    const baseDetails: Record<string, unknown> = { customerId: 77, status: "paid" };
    const cloneBefore = { ...baseDetails };

    const result = withBehaviorDetails(baseDetails, {
      event: "sale.payment",
      source: "backoffice",
      customerId: 77,
      transactionId: 4501,
      amount: 500,
    });

    expect(baseDetails).toEqual(cloneBefore);
    expect(result).not.toBe(baseDetails);
    expect(result.behavior).toBeDefined();
  });

  it("overrides stale behavior field from caller details", () => {
    const result = withBehaviorDetails(
      {
        customerId: 88,
        behavior: {
          schema: "old.schema",
          event: "old",
        },
      },
      {
        event: "sale.returned",
        source: "backoffice",
        customerId: 88,
        transactionId: 321,
      }
    );

    expect(result.behavior).toMatchObject({
      schema: CUSTOMER_BEHAVIOR_SCHEMA,
      event: "sale.returned",
      source: "backoffice",
      customerId: 88,
      transactionId: 321,
    });
  });

  it("keeps same-account events isolated by transaction/customer context", () => {
    const sharedIdentity = { username: "cashier-shared", role: "manager" };

    const first = withBehaviorDetails(
      { ...sharedIdentity, amount: 1000 },
      {
        event: "sale.created",
        source: "pos",
        customerId: 10,
        transactionId: 501,
      }
    );
    const second = withBehaviorDetails(
      { ...sharedIdentity, amount: 2000 },
      {
        event: "sale.created",
        source: "pos",
        customerId: 20,
        transactionId: 502,
      }
    );

    const firstBehavior = first.behavior as Record<string, unknown>;
    const secondBehavior = second.behavior as Record<string, unknown>;

    expect(firstBehavior.transactionId).toBe(501);
    expect(secondBehavior.transactionId).toBe(502);
    expect(firstBehavior.customerId).toBe(10);
    expect(secondBehavior.customerId).toBe(20);
    expect(first.username).toBe(second.username);
  });
});
