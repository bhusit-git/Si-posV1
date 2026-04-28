import { NextRequest, NextResponse } from "next/server";
import { FACTORY_COOKIE, getDbForFactory, getFactories, type DrizzleDB } from "@/db";
import type { SessionUser } from "@/lib/auth";

export interface FactoryContext {
  factoryKey: string;
  db: DrizzleDB;
}

export type FactoryWriteContext = FactoryContext;
export type FactoryReadContext = FactoryContext;

export type FactoryWriteContextResult =
  | FactoryWriteContext
  | { error: NextResponse };

export type FactoryReadContextResult =
  | FactoryReadContext
  | { error: NextResponse };

function factoryContextError(message: string, status = 400): FactoryWriteContextResult {
  return {
    error: NextResponse.json({ error: message }, { status }),
  };
}

/**
 * Strict DB resolver for factory-scoped write paths.
 *
 * Unlike getDb(), this never silently falls back to the default factory in
 * multi-factory mode. Critical writes must resolve one explicit factory key
 * from the locked session factory or the active factory cookie.
 */
export function requireFactoryWriteContext(
  request: NextRequest,
  user: Pick<SessionUser, "factoryKey">
): FactoryWriteContextResult {
  const factories = getFactories();
  const defaultFactoryKey = factories[0]?.key || "default";

  if (factories.length <= 1) {
    const singleFactoryKey = user.factoryKey;
    const factoryKey =
      singleFactoryKey && factories.some((factory) => factory.key === singleFactoryKey)
        ? singleFactoryKey
        : defaultFactoryKey;
    return { factoryKey, db: getDbForFactory(factoryKey) };
  }

  const validFactoryKeys = new Set(factories.map((factory) => factory.key));
  const sessionFactoryKey = user.factoryKey;
  if (sessionFactoryKey) {
    if (!validFactoryKeys.has(sessionFactoryKey)) {
      return factoryContextError("โรงงานของผู้ใช้นี้ไม่ได้ถูกตั้งค่า", 403);
    }
    return { factoryKey: sessionFactoryKey, db: getDbForFactory(sessionFactoryKey) };
  }

  const cookieFactoryKey = request.cookies.get(FACTORY_COOKIE)?.value || null;
  if (!cookieFactoryKey) {
    return factoryContextError("กรุณาเลือกโรงงานก่อนบันทึกข้อมูล");
  }
  if (!validFactoryKeys.has(cookieFactoryKey)) {
    return factoryContextError("โรงงานที่เลือกไม่ถูกต้อง");
  }

  return { factoryKey: cookieFactoryKey, db: getDbForFactory(cookieFactoryKey) };
}

/**
 * Strict DB resolver for factory-scoped reads that must not leak across factories.
 *
 * Read-only reports can be just as sensitive as writes. This mirrors the write
 * resolver so factory-scoped report endpoints do not silently hit the default DB
 * in multi-factory mode.
 */
export function requireFactoryReadContext(
  request: NextRequest,
  user: Pick<SessionUser, "factoryKey">
): FactoryReadContextResult {
  return requireFactoryWriteContext(request, user);
}
