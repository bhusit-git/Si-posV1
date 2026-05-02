import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDbForFactory, getFactories, type DrizzleDB } from "@/db";
import type { SessionUser } from "@/lib/auth";
import { requireFactoryReadContext, requireFactoryWriteContext } from "@/lib/factory-context";

export interface SupplyRouteContext {
  factoryKey: string;
  db: DrizzleDB;
}

export function parsePositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export function parseInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
}

export function parseOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function normalizeSupplyItemType(value: unknown): "consumable" | "durable" {
  if (value === "durable" || value === "tool" || value === "spare_part") return "durable";
  return "consumable";
}

export function parseBooleanFlag(value: string | null): boolean {
  return value === "1" || value === "true";
}

export function ensureFactoryKey(factoryKey: string): string | null {
  return getFactories().some((factory) => factory.key === factoryKey) ? factoryKey : null;
}

export function resolveSupplyReadContext(
  request: NextRequest,
  user: SessionUser
): SupplyRouteContext | { error: NextResponse } {
  const requestedFactoryKey = request.nextUrl.searchParams.get("factoryKey")?.trim() || null;

  if (requestedFactoryKey) {
    const validFactoryKey = ensureFactoryKey(requestedFactoryKey);
    if (!validFactoryKey) {
      return {
        error: NextResponse.json({ error: "โรงงานที่เลือกไม่ถูกต้อง" }, { status: 400 }),
      };
    }
    if (user.role !== "admin") {
      const ownContext = requireFactoryReadContext(request, user);
      if ("error" in ownContext) return ownContext;
      if (ownContext.factoryKey !== validFactoryKey) {
        return {
          error: NextResponse.json({ error: "ไม่มีสิทธิ์ดูข้อมูลข้ามโรงงาน" }, { status: 403 }),
        };
      }
      return ownContext;
    }
    return {
      factoryKey: validFactoryKey,
      db: getDbForFactory(validFactoryKey),
    };
  }

  const ownContext = requireFactoryReadContext(request, user);
  if ("error" in ownContext) return ownContext;
  return ownContext;
}

export function resolveSupplyWriteContext(
  request: NextRequest,
  user: SessionUser
): SupplyRouteContext | { error: NextResponse } {
  return requireFactoryWriteContext(request, user);
}

export function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function ensureSupplyItemDetailColumns(db: DrizzleDB) {
  await db.execute(sql`
    ALTER TABLE "supply_items"
      ADD COLUMN IF NOT EXISTS "image_url" text,
      ADD COLUMN IF NOT EXISTS "item_type" text,
      ADD COLUMN IF NOT EXISTS "brand" text,
      ADD COLUMN IF NOT EXISTS "model" text,
      ADD COLUMN IF NOT EXISTS "serial_number" text,
      ADD COLUMN IF NOT EXISTS "barcode" text,
      ADD COLUMN IF NOT EXISTS "details" text,
      ADD COLUMN IF NOT EXISTS "purchased_at" text,
      ADD COLUMN IF NOT EXISTS "warranty_expires_at" text,
      ADD COLUMN IF NOT EXISTS "pack_size" integer NOT NULL DEFAULT 1,
      ADD COLUMN IF NOT EXISTS "borrow_limit" integer NOT NULL DEFAULT 0
  `);
}
