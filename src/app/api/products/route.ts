import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { productTypes } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin, requireManagerUp } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { logAudit } from "@/lib/audit";
import { isCatalogCodeInFamilyRange } from "@/lib/product-catalog-codes";
import { requireFactoryWriteContext } from "@/lib/factory-context";
import type {
  ProductFamily,
  ProductForm,
  ProductPackageType,
  ProductSizeUnit,
} from "@/lib/types";

const PRODUCT_FAMILIES = ["block", "large_tube", "small_tube", "iceberg"] as const;
const PRODUCT_FORMS = ["standard", "crushed"] as const;
const PRODUCT_PACKAGE_TYPES = ["loose", "returnable_bag", "clear_bag", "basket"] as const;
const PRODUCT_SIZE_UNITS = ["piece", "kg", "basket"] as const;
const PRODUCT_CODE_RANGE_LABELS: Record<ProductFamily, string> = {
  block: "101-199",
  small_tube: "201-299",
  large_tube: "301-399",
  iceberg: "401-499",
};

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeOptionalInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : null;
  }
  return null;
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== "string") return null;
  return allowed.includes(value as T) ? (value as T) : null;
}

function validateCatalogCode(
  catalogCode: number | null,
  family: ProductFamily | null
): string | null {
  if (catalogCode == null || family == null) return null;
  if (isCatalogCodeInFamilyRange(catalogCode, family)) return null;
  return `รหัสสินค้าของหมวดนี้ต้องอยู่ในช่วง ${PRODUCT_CODE_RANGE_LABELS[family]}`;
}

export const GET = withErrorHandler(async function GET() {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;
  const db = await getDb();
  const all = await db.query.productTypes.findMany({
    orderBy: (pt, { asc }) => [asc(pt.catalogCode), asc(pt.sortOrder), asc(pt.name)],
  });
  const response = NextResponse.json(all);
  response.headers.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  return response;
});

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = await request.json();
  const {
    name,
    nameEn,
    hasBag,
    decreasesBag,
    sortOrder,
    catalogCode,
    family,
    form,
    packageType,
    sizeValue,
    sizeUnit,
    sizeLabel,
  } = body;

  const factoryContext = requireFactoryWriteContext(request, auth.user);
  if ("error" in factoryContext) return factoryContext.error;
  const { db } = factoryContext;
  const normalizedName = `${name || ""}`.trim();
  if (!normalizedName) {
    return NextResponse.json({ error: "กรุณาระบุชื่อสินค้า" }, { status: 400 });
  }
  const normalizedNameEn = normalizeOptionalString(nameEn);
  const normalizedHasBag = Boolean(hasBag);
  const normalizedDecreasesBag = Boolean(decreasesBag);
  const normalizedSortOrder = normalizeOptionalInteger(sortOrder) ?? 99;
  const normalizedCatalogCode = normalizeOptionalInteger(catalogCode);
  const normalizedFamily = normalizeEnum<ProductFamily>(family, PRODUCT_FAMILIES);
  const normalizedForm = normalizeEnum<ProductForm>(form, PRODUCT_FORMS);
  const normalizedPackageType =
    normalizeEnum<ProductPackageType>(packageType, PRODUCT_PACKAGE_TYPES) ??
    (normalizedHasBag ? "returnable_bag" : null);
  const normalizedSizeValue = normalizeOptionalInteger(sizeValue);
  const normalizedSizeUnit = normalizeEnum<ProductSizeUnit>(sizeUnit, PRODUCT_SIZE_UNITS);
  const normalizedSizeLabel = normalizeOptionalString(sizeLabel);
  const catalogCodeError = validateCatalogCode(normalizedCatalogCode, normalizedFamily);
  if (catalogCodeError) {
    return NextResponse.json({ error: catalogCodeError }, { status: 400 });
  }
  if (normalizedCatalogCode != null) {
    const conflictingProduct = await db.query.productTypes.findFirst({
      where: eq(productTypes.catalogCode, normalizedCatalogCode),
    });
    if (conflictingProduct) {
      return NextResponse.json({ error: "รหัสสินค้านี้ถูกใช้งานแล้ว" }, { status: 409 });
    }
  }
  const result = await db
    .insert(productTypes)
    .values({
      name: normalizedName,
      nameEn: normalizedNameEn,
      hasBag: normalizedHasBag,
      decreasesBag: normalizedDecreasesBag,
      isActive: true,
      sortOrder: normalizedSortOrder,
      catalogCode: normalizedCatalogCode,
      family: normalizedFamily,
      form: normalizedForm,
      packageType: normalizedPackageType,
      sizeValue: normalizedSizeValue,
      sizeUnit: normalizedSizeUnit,
      sizeLabel: normalizedSizeLabel,
    })
    .returning();

  await logAudit({
    userId: auth.user.id,
    username: auth.user.username,
    action: "product.create",
    entity: "product",
    entityId: result[0]?.id ?? null,
    details: {
      name: normalizedName,
      nameEn: normalizedNameEn,
      hasBag: normalizedHasBag,
      decreasesBag: normalizedDecreasesBag,
      isActive: true,
      sortOrder: normalizedSortOrder,
      catalogCode: normalizedCatalogCode,
      family: normalizedFamily,
      form: normalizedForm,
      packageType: normalizedPackageType,
      sizeValue: normalizedSizeValue,
      sizeUnit: normalizedSizeUnit,
      sizeLabel: normalizedSizeLabel,
    },
  }, db);

  return NextResponse.json(result[0], { status: 201 });
});

export const PUT = withErrorHandler(async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const body = await request.json();
  const {
    id,
    name,
    nameEn,
    hasBag,
    decreasesBag,
    isActive,
    sortOrder,
    catalogCode,
    family,
    form,
    packageType,
    sizeValue,
    sizeUnit,
    sizeLabel,
  } = body;

  const factoryContext = requireFactoryWriteContext(request, auth.user);
  if ("error" in factoryContext) return factoryContext.error;
  const { db } = factoryContext;
  const existing = await db.query.productTypes.findFirst({
    where: eq(productTypes.id, id),
  });
  if (!existing) {
    return NextResponse.json({ error: "ไม่พบสินค้า" }, { status: 404 });
  }

  const normalizedName = typeof name === "string" ? name : existing.name;
  const normalizedNameEn =
    nameEn !== undefined ? normalizeOptionalString(nameEn) : (existing.nameEn || null);
  const normalizedHasBag = hasBag ?? existing.hasBag;
  const normalizedDecreasesBag = decreasesBag ?? existing.decreasesBag;
  const normalizedIsActive = isActive ?? existing.isActive;
  const normalizedSortOrder = normalizeOptionalInteger(sortOrder) ?? existing.sortOrder;
  const existingFamily = normalizeEnum<ProductFamily>(existing.family, PRODUCT_FAMILIES);
  const existingForm = normalizeEnum<ProductForm>(existing.form, PRODUCT_FORMS);
  const existingPackageType = normalizeEnum<ProductPackageType>(
    existing.packageType,
    PRODUCT_PACKAGE_TYPES
  );
  const existingSizeUnit = normalizeEnum<ProductSizeUnit>(existing.sizeUnit, PRODUCT_SIZE_UNITS);
  const normalizedCatalogCode =
    catalogCode !== undefined
      ? normalizeOptionalInteger(catalogCode)
      : (existing.catalogCode ?? null);
  const normalizedFamily =
    family !== undefined
      ? normalizeEnum<ProductFamily>(family, PRODUCT_FAMILIES)
      : existingFamily;
  const normalizedForm =
    form !== undefined
      ? normalizeEnum<ProductForm>(form, PRODUCT_FORMS)
      : existingForm;
  const normalizedPackageType =
    packageType !== undefined
      ? normalizeEnum<ProductPackageType>(packageType, PRODUCT_PACKAGE_TYPES)
      : existingPackageType;
  const normalizedSizeValue =
    sizeValue !== undefined ? normalizeOptionalInteger(sizeValue) : (existing.sizeValue ?? null);
  const normalizedSizeUnit =
    sizeUnit !== undefined
      ? normalizeEnum<ProductSizeUnit>(sizeUnit, PRODUCT_SIZE_UNITS)
      : existingSizeUnit;
  const normalizedSizeLabel =
    sizeLabel !== undefined ? normalizeOptionalString(sizeLabel) : (existing.sizeLabel || null);
  const catalogCodeError = validateCatalogCode(normalizedCatalogCode, normalizedFamily);
  if (catalogCodeError) {
    return NextResponse.json({ error: catalogCodeError }, { status: 400 });
  }
  if (normalizedCatalogCode != null) {
    const conflictingProduct = await db.query.productTypes.findFirst({
      where: eq(productTypes.catalogCode, normalizedCatalogCode),
    });
    if (conflictingProduct && conflictingProduct.id !== id) {
      return NextResponse.json({ error: "รหัสสินค้านี้ถูกใช้งานแล้ว" }, { status: 409 });
    }
  }

  await db
    .update(productTypes)
    .set({
      name: normalizedName,
      nameEn: normalizedNameEn,
      hasBag: normalizedHasBag,
      decreasesBag: normalizedDecreasesBag,
      isActive: normalizedIsActive,
      sortOrder: normalizedSortOrder,
      catalogCode: normalizedCatalogCode,
      family: normalizedFamily,
      form: normalizedForm,
      packageType: normalizedPackageType,
      sizeValue: normalizedSizeValue,
      sizeUnit: normalizedSizeUnit,
      sizeLabel: normalizedSizeLabel,
    })
    .where(eq(productTypes.id, id));

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (existing.name !== normalizedName) {
    changes.name = { from: existing.name, to: normalizedName };
  }
  if ((existing.nameEn || null) !== normalizedNameEn) {
    changes.nameEn = { from: existing.nameEn || null, to: normalizedNameEn };
  }
  if (existing.hasBag !== normalizedHasBag) {
    changes.hasBag = { from: existing.hasBag, to: normalizedHasBag };
  }
  if (existing.decreasesBag !== normalizedDecreasesBag) {
    changes.decreasesBag = { from: existing.decreasesBag, to: normalizedDecreasesBag };
  }
  if (existing.isActive !== normalizedIsActive) {
    changes.isActive = { from: existing.isActive, to: normalizedIsActive };
  }
  if (existing.sortOrder !== normalizedSortOrder) {
    changes.sortOrder = { from: existing.sortOrder, to: normalizedSortOrder };
  }
  if ((existing.catalogCode ?? null) !== normalizedCatalogCode) {
    changes.catalogCode = { from: existing.catalogCode ?? null, to: normalizedCatalogCode };
  }
  if ((existing.family || null) !== normalizedFamily) {
    changes.family = { from: existing.family || null, to: normalizedFamily };
  }
  if ((existing.form || null) !== normalizedForm) {
    changes.form = { from: existing.form || null, to: normalizedForm };
  }
  if ((existing.packageType || null) !== normalizedPackageType) {
    changes.packageType = { from: existing.packageType || null, to: normalizedPackageType };
  }
  if ((existing.sizeValue ?? null) !== normalizedSizeValue) {
    changes.sizeValue = { from: existing.sizeValue ?? null, to: normalizedSizeValue };
  }
  if ((existing.sizeUnit || null) !== normalizedSizeUnit) {
    changes.sizeUnit = { from: existing.sizeUnit || null, to: normalizedSizeUnit };
  }
  if ((existing.sizeLabel || null) !== normalizedSizeLabel) {
    changes.sizeLabel = { from: existing.sizeLabel || null, to: normalizedSizeLabel };
  }

  if (Object.keys(changes).length > 0) {
    await logAudit({
      userId: auth.user.id,
      username: auth.user.username,
      action: "product.update",
      entity: "product",
      entityId: id,
      details: {
        changes,
      },
    }, db);
  }

  return NextResponse.json({ success: true });
});
