import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { getSupericeEdgeEnv } from "@/lib/config/edge-env";

export type UserRole = "admin" | "office" | "manager" | "factory";

export interface SessionUser {
  id: number;
  username: string;
  role: UserRole;
  factoryKey: string | null;
}

const SESSION_COOKIE = "superice_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const VALID_ROLES = new Set<UserRole>(["admin", "office", "manager", "factory"]);
const EDGE_ENV = getSupericeEdgeEnv();

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(EDGE_ENV.sessionSecret);
}

function toSessionUser(payload: Record<string, unknown>): SessionUser | null {
  const id = payload.id;
  const username = payload.username;
  const role = payload.role;
  const factoryKey = payload.factoryKey;

  if (typeof id !== "number") return null;
  if (typeof username !== "string" || username.length === 0) return null;
  if (typeof role !== "string" || !VALID_ROLES.has(role as UserRole)) return null;
  if (factoryKey != null && typeof factoryKey !== "string") return null;

  return {
    id,
    username,
    role: role as UserRole,
    factoryKey: factoryKey ?? null,
  };
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const session = cookieStore.get(SESSION_COOKIE);
  if (!session?.value) return null;
  try {
    const { payload } = await jwtVerify(session.value, getSecretKey(), {
      algorithms: ["HS256"],
    });
    return toSessionUser(payload);
  } catch {
    return null;
  }
}

export async function setSession(user: SessionUser): Promise<void> {
  const cookieStore = await cookies();
  const token = await new SignJWT({
    id: user.id,
    username: user.username,
    role: user.role,
    factoryKey: user.factoryKey || null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecretKey());

  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: EDGE_ENV.isProduction,
    sameSite: "lax",
    maxAge: SESSION_TTL_SECONDS,
    path: "/",
  });
}

export async function clearSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}
