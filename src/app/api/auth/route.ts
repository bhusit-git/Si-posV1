import { NextRequest, NextResponse } from "next/server";
import { getMainDb, FACTORY_COOKIE, getFactories } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setSession, clearSession, getSession, type UserRole } from "@/lib/auth";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { withErrorHandler } from "@/lib/api-utils";
import { loginSchema, validateBody } from "@/lib/validations";
import { checkRateLimit } from "@/lib/rate-limit";
import { getPostHogClient } from "@/lib/posthog-server";
import { getClientIpFromHeaders } from "@/lib/request-security";
import { getSupericeEnv } from "@/lib/config/env";
import {
  AUTH_LOGIN_SUCCEEDED_EVENT,
  AUTH_LOGOUT_EVENT,
  buildAuthenticatedDistinctId,
  buildAuthLoginSucceededProperties,
  buildAuthLogoutProperties,
} from "@/lib/posthog-events";

const DUMMY_BCRYPT_HASH =
  "$2b$10$14Wi03Rr8QP5EVbnVllQfuqcSfPRLzuz78jrHysmU0c88ur/p.v9m";

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const ip = getClientIpFromHeaders(request.headers);
  const rl = checkRateLimit(ip);
  if (rl.limited) {
    return NextResponse.json(
      { error: "พยายามเข้าสู่ระบบมากเกินไป กรุณารอสักครู่" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.retryAfterMs || 60000) / 1000)) },
      }
    );
  }

  const body = await request.json();
  const validated = validateBody(loginSchema, body);
  if ("error" in validated) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }
  const { username, password } = validated.data;

  const db = getMainDb();
  const user = await db.query.users.findFirst({
    where: eq(users.username, username),
  });

  if (!user) {
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
    return NextResponse.json(
      { error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" },
      { status: 401 }
    );
  }

  let passwordMatch = false;
  if (user.password.startsWith("$2a$") || user.password.startsWith("$2b$")) {
    passwordMatch = await bcrypt.compare(password, user.password);
  } else {
    // Keep timing closer to bcrypt-backed accounts while migrating legacy plaintext rows.
    await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
    passwordMatch = user.password === password;
    if (passwordMatch) {
      const hashed = await bcrypt.hash(password, 10);
      await db.update(users).set({ password: hashed }).where(eq(users.id, user.id));
    }
  }

  if (!passwordMatch) {
    return NextResponse.json(
      { error: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" },
      { status: 401 }
    );
  }

  const factoryKey = user.factoryKey || null;
  const factoryName = factoryKey
    ? getFactories().find((factory) => factory.key === factoryKey)?.name || null
    : null;

  await setSession({
    id: user.id,
    username: user.username,
    role: user.role as UserRole,
    factoryKey,
  });

  // For locked users (manager/factory), force the factory cookie to their assigned factory
  if (factoryKey) {
    const cookieStore = await cookies();
    cookieStore.set(FACTORY_COOKIE, factoryKey, {
      httpOnly: false,
      secure: getSupericeEnv().isProduction,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
  }

  const distinctId = buildAuthenticatedDistinctId(user.id);
  const posthog = getPostHogClient();
  posthog.capture({
    distinctId,
    event: AUTH_LOGIN_SUCCEEDED_EVENT,
    properties: buildAuthLoginSucceededProperties({
      actorUserId: user.id,
      actorRole: user.role,
      factoryKey,
    }),
  });
  posthog.identify({
    distinctId,
    properties: {
      user_id: user.id,
      role: user.role,
      factory_key: factoryKey,
    },
  });

  return NextResponse.json({
    id: user.id,
    username: user.username,
    role: user.role,
    factoryKey,
    factoryName,
  });
});

export const GET = withErrorHandler(async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });
  }
  return NextResponse.json(session);
});

export const DELETE = withErrorHandler(async function DELETE() {
  // Get session before clearing to track logout
  const session = await getSession();

  await clearSession();

  // Track server-side logout event
  if (session) {
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: buildAuthenticatedDistinctId(session.id),
      event: AUTH_LOGOUT_EVENT,
      properties: buildAuthLogoutProperties({
        actorUserId: session.id,
        actorRole: session.role,
        factoryKey: session.factoryKey,
      }),
    });
  }

  return NextResponse.json({ success: true });
});
