import { NextResponse } from "next/server";
import { getSession, SessionUser, UserRole } from "@/lib/auth";

const UNAUTHORIZED = NextResponse.json(
  { error: "ไม่ได้เข้าสู่ระบบ" },
  { status: 401 }
);

type AuthSuccess = { user: SessionUser; error?: undefined };
type AuthFailure = { user?: undefined; error: NextResponse };
type AuthResult = AuthSuccess | AuthFailure;

/**
 * Check session and return user. Returns error if not authenticated.
 * Any logged-in user passes this check regardless of role.
 */
export async function requireAuth(): Promise<AuthResult> {
  const session = await getSession();
  if (!session) {
    return { error: UNAUTHORIZED };
  }
  return { user: session };
}

/**
 * Check session and require one of the specified roles.
 */
export async function requireRole(...allowedRoles: UserRole[]): Promise<AuthResult> {
  const session = await getSession();
  if (!session) {
    return { error: UNAUTHORIZED };
  }
  if (!allowedRoles.includes(session.role)) {
    return {
      error: NextResponse.json(
        { error: "ไม่มีสิทธิ์เข้าถึง" },
        { status: 403 }
      ),
    };
  }
  return { user: session };
}

/**
 * Require admin role.
 */
export async function requireAdmin(): Promise<AuthResult> {
  return requireRole("admin");
}

/**
 * Require admin or office role.
 */
export async function requireOfficeUp(): Promise<AuthResult> {
  return requireRole("admin", "office");
}

/**
 * Require admin, office, or manager role.
 */
export async function requireManagerUp(): Promise<AuthResult> {
  return requireRole("admin", "office", "manager");
}
