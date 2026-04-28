import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { readIdempotencyKey, stableHash } from "@/lib/idempotency";

describe("idempotency helpers", () => {
  it("stableHash is deterministic for object key order", () => {
    const a = { z: 1, a: { y: 2, b: 3 }, list: [3, 2, 1] };
    const b = { list: [3, 2, 1], a: { b: 3, y: 2 }, z: 1 };

    expect(stableHash(a)).toBe(stableHash(b));
  });

  it("reads key from header first", () => {
    const req = new NextRequest("http://localhost/api/invoices", {
      method: "POST",
      headers: {
        "Idempotency-Key": "header-key",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ idempotencyKey: "body-key" }),
    });
    expect(readIdempotencyKey(req, { idempotencyKey: "body-key" })).toBe("header-key");
  });

  it("falls back to body key", () => {
    const req = new NextRequest("http://localhost/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(readIdempotencyKey(req, { idempotencyKey: "body-key" })).toBe("body-key");
  });
});
