import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

import type { DrizzleDB } from "@/db";
import { requireAdmin, requireManagerUp } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { extractPostgresError } from "@/lib/api-error-diagnostics";
import { logAudit } from "@/lib/audit";
import { normalizeSupplyItemSettings } from "@/lib/supply/item-settings";
import { resolveSupplyReadContext, resolveSupplyWriteContext } from "@/lib/supply/route-helpers";
import { supplyCatalogSettings } from "@/db/schema";

async function loadSupplySettings(factoryKey: string, db: DrizzleDB) {
  const row = await db.query?.supplyCatalogSettings?.findFirst?.({
    where: eq(supplyCatalogSettings.factoryKey, factoryKey),
  });

  if (row) {
    return normalizeSupplyItemSettings({
      units: row.units as string[] | undefined,
      categories: row.categories as string[] | undefined,
    });
  }

  const fallback = await db
    .select({
      category: supplyCatalogSettings.categories,
      units: supplyCatalogSettings.units,
    })
    .from(supplyCatalogSettings)
    .where(eq(supplyCatalogSettings.factoryKey, factoryKey))
    .limit(1);

  return normalizeSupplyItemSettings({
    units: fallback[0]?.units as string[] | undefined,
    categories: fallback[0]?.category as string[] | undefined,
  });
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  const context = resolveSupplyReadContext(request, auth.user);
  if ("error" in context) return context.error;

  let settings;
  try {
    settings = await loadSupplySettings(context.factoryKey, context.db);
  } catch (error) {
    const pg = extractPostgresError(error);
    if (pg?.code === "42P01") {
      return NextResponse.json(
        { error: "ยังไม่พร้อมใช้งาน: ต้องอัปเดตฐานข้อมูล Supply ก่อน (ตาราง supply_catalog_settings)" },
        { status: 503 }
      );
    }
    throw error;
  }
  return NextResponse.json(settings);
});

export const PUT = withErrorHandler(async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const context = resolveSupplyWriteContext(request, auth.user);
  if ("error" in context) return context.error;

  const body = await request.json().catch(() => null);
  const settings = normalizeSupplyItemSettings(body);

  try {
    await context.db
      .insert(supplyCatalogSettings)
      .values({
        factoryKey: context.factoryKey,
        units: settings.units,
        categories: settings.categories,
        updatedBy: auth.user.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: supplyCatalogSettings.factoryKey,
        set: {
          units: settings.units,
          categories: settings.categories,
          updatedBy: auth.user.id,
          updatedAt: new Date(),
        },
      });
  } catch (error) {
    const pg = extractPostgresError(error);
    if (pg?.code === "42P01") {
      return NextResponse.json(
        { error: "บันทึกไม่ได้: ยังไม่ได้อัปเดตฐานข้อมูล Supply (ตาราง supply_catalog_settings)" },
        { status: 503 }
      );
    }
    throw error;
  }

  await logAudit(
    {
      userId: auth.user.id,
      username: auth.user.username,
      action: "supply.catalog_settings.update",
      entity: "supply_catalog_settings",
      entityId: null,
      details: {
        factoryKey: context.factoryKey,
        units: settings.units,
        categories: settings.categories,
      },
    },
    context.db
  );

  return NextResponse.json(settings);
});
