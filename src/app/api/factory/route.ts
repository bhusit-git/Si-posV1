import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { getFactories, isMultiFactory, FACTORY_COOKIE } from "@/db";
import { getSupericeEnv } from "@/lib/config/env";

/** GET /api/factory – returns current factory + list of available factories */
export async function GET() {
  const factories = getFactories();
  const cookieStore = await cookies();
  const current = cookieStore.get(FACTORY_COOKIE)?.value || factories[0]?.key || "default";

  return NextResponse.json({
    current,
    factories,
    multiFactory: isMultiFactory(),
  });
}

/** POST /api/factory – switch the active factory (admin/office only, not locked users) */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !["admin", "office"].includes(session.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (session.factoryKey) {
    return NextResponse.json(
      { error: "บัญชีของคุณผูกกับโรงงานนี้ ไม่สามารถเปลี่ยนได้" },
      { status: 403 }
    );
  }

  if (!isMultiFactory()) {
    return NextResponse.json(
      { error: "Multi-factory mode is not enabled" },
      { status: 400 }
    );
  }

  const body = await request.json();
  const factoryKey = body.factory as string;

  const validKeys = getFactories().map((f) => f.key);
  if (!factoryKey || !validKeys.includes(factoryKey)) {
    return NextResponse.json(
      { error: `Invalid factory. Must be one of: ${validKeys.join(", ")}` },
      { status: 400 }
    );
  }

  const cookieStore = await cookies();
  cookieStore.set(FACTORY_COOKIE, factoryKey, {
    httpOnly: false, // frontend needs to read this for UI indicators
    secure: getSupericeEnv().isProduction,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: "/",
  });

  const factoryName = getFactories().find((f) => f.key === factoryKey)?.name || factoryKey;

  return NextResponse.json({
    success: true,
    current: factoryKey,
    name: factoryName,
  });
}
