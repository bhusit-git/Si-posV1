import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import type { DrizzleDB } from "@/db";
import { idempotencyKeys } from "@/db/schema";

export type IdempotencyScope =
  | "invoice.create"
  | "invoice.issue"
  | "invoice.pay"
  | "invoice.void";

type TxLike = Parameters<Parameters<DrizzleDB["transaction"]>[0]>[0];

export type ClaimOrReplayResult =
  | { kind: "proceed"; claimId: number }
  | {
      kind: "replay";
      claimId: number;
      invoiceId: number | null;
      invoicePaymentId: number | null;
    }
  | { kind: "conflict" };

function stableNormalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => stableNormalize(v));
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    const out: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      out[key] = stableNormalize(val);
    }
    return out;
  }
  return value;
}

export function stableHash(payload: unknown): string {
  const normalized = stableNormalize(payload);
  const serialized = JSON.stringify(normalized);
  return createHash("sha256").update(serialized).digest("hex");
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function readIdempotencyKey(
  request: NextRequest,
  body: unknown
): string | null {
  const fromHeader = nonEmptyString(request.headers.get("Idempotency-Key"));
  if (fromHeader) return fromHeader;
  if (!body || typeof body !== "object") return null;
  return nonEmptyString((body as Record<string, unknown>).idempotencyKey);
}

export async function claimOrReplay(
  tx: TxLike,
  params: {
    scope: IdempotencyScope;
    key: string;
    requestHash: string;
    createdBy: number | null;
  }
): Promise<ClaimOrReplayResult> {
  const insertedRows = await tx
    .insert(idempotencyKeys)
    .values({
      scope: params.scope,
      idempotencyKey: params.key,
      requestHash: params.requestHash,
      createdBy: params.createdBy,
    })
    .onConflictDoNothing()
    .returning({
      id: idempotencyKeys.id,
    });

  if (insertedRows.length > 0) {
    return { kind: "proceed", claimId: insertedRows[0].id };
  }

  const rows = await tx
    .select({
      id: idempotencyKeys.id,
      requestHash: idempotencyKeys.requestHash,
      invoiceId: idempotencyKeys.invoiceId,
      invoicePaymentId: idempotencyKeys.invoicePaymentId,
    })
    .from(idempotencyKeys)
    .where(
      and(
        eq(idempotencyKeys.scope, params.scope),
        eq(idempotencyKeys.idempotencyKey, params.key)
      )
    )
    .limit(1);

  if (rows.length === 0) {
    return { kind: "conflict" };
  }

  const existing = rows[0];
  if (existing.requestHash !== params.requestHash) {
    return { kind: "conflict" };
  }

  return {
    kind: "replay",
    claimId: existing.id,
    invoiceId: existing.invoiceId,
    invoicePaymentId: existing.invoicePaymentId,
  };
}

export async function completeClaim(
  tx: TxLike,
  claimId: number,
  refs: {
    invoiceId?: number | null;
    invoicePaymentId?: number | null;
  }
): Promise<void> {
  const update: Record<string, number | null> = {};
  if (refs.invoiceId !== undefined) update.invoiceId = refs.invoiceId;
  if (refs.invoicePaymentId !== undefined) {
    update.invoicePaymentId = refs.invoicePaymentId;
  }
  if (Object.keys(update).length === 0) return;

  await tx
    .update(idempotencyKeys)
    .set(update)
    .where(eq(idempotencyKeys.id, claimId));
}
