import { NextRequest, NextResponse } from "next/server";
import { getMainDb } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/api-auth";
import { logAudit } from "@/lib/audit";
import bcrypt from "bcryptjs";
import { clearSession, type UserRole } from "@/lib/auth";
import { withErrorHandler } from "@/lib/api-utils";
import { userPasswordSchema } from "@/lib/validations";

const VALID_ROLES: UserRole[] = ["admin", "office", "manager", "factory"];
const LOCKED_ROLES: UserRole[] = ["manager", "factory"];

export const GET = withErrorHandler(async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const db = getMainDb();
  const allUsers = await db
    .select({
      id: users.id,
      username: users.username,
      role: users.role,
      factoryKey: users.factoryKey,
    })
    .from(users)
    .orderBy(users.id);

  return NextResponse.json(allUsers);
});

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { username, password, role, factoryKey } = await request.json();

  if (!username || !password) {
    return NextResponse.json({ error: "ต้องระบุชื่อผู้ใช้และรหัสผ่าน" }, { status: 400 });
  }
  const passwordValidation = userPasswordSchema.safeParse(password);
  if (!passwordValidation.success) {
    return NextResponse.json(
      { error: passwordValidation.error.issues[0]?.message || "รหัสผ่านไม่ถูกต้อง" },
      { status: 400 }
    );
  }

  const db = getMainDb();
  const existing = await db.query.users.findFirst({
    where: eq(users.username, username),
  });
  if (existing) {
    return NextResponse.json({ error: "ชื่อผู้ใช้นี้มีอยู่แล้ว" }, { status: 400 });
  }

  const finalRole: UserRole = VALID_ROLES.includes(role) ? role : "office";

  // manager/factory roles require a factoryKey assignment
  if (LOCKED_ROLES.includes(finalRole) && !factoryKey) {
    return NextResponse.json(
      { error: "ต้องระบุโรงงานสำหรับบทบาทนี้" },
      { status: 400 }
    );
  }

  const finalFactoryKey = LOCKED_ROLES.includes(finalRole) ? (factoryKey || null) : null;

  const hashed = await bcrypt.hash(passwordValidation.data, 10);
  const result = await db
    .insert(users)
    .values({
      username,
      password: hashed,
      role: finalRole,
      factoryKey: finalFactoryKey,
    })
    .returning({ id: users.id, username: users.username, role: users.role, factoryKey: users.factoryKey });

  await logAudit({
    userId: auth.user.id,
    username: auth.user.username,
    action: "user.create",
    entity: "user",
    entityId: result[0].id,
    details: { newUsername: username, role: finalRole, factoryKey: finalFactoryKey },
  });

  return NextResponse.json(result[0], { status: 201 });
});

export const PUT = withErrorHandler(async function PUT(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { id, role, newPassword, factoryKey } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "ต้องระบุ ID ผู้ใช้" }, { status: 400 });
  }

  const db = getMainDb();
  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
  });
  if (!user) {
    return NextResponse.json({ error: "ไม่พบผู้ใช้" }, { status: 404 });
  }

  const updates: { role?: UserRole; password?: string; factoryKey?: string | null } = {};
  if (role && VALID_ROLES.includes(role)) {
    updates.role = role;
    // Clear factoryKey when switching to a non-locked role
    if (!LOCKED_ROLES.includes(role)) {
      updates.factoryKey = null;
    }
  }
  if (factoryKey !== undefined) {
    const effectiveRole = updates.role || user.role;
    if (LOCKED_ROLES.includes(effectiveRole as UserRole)) {
      updates.factoryKey = factoryKey || null;
    }
  }
  if (newPassword) {
    const passwordValidation = userPasswordSchema.safeParse(newPassword);
    if (!passwordValidation.success) {
      return NextResponse.json(
        { error: passwordValidation.error.issues[0]?.message || "รหัสผ่านใหม่ไม่ถูกต้อง" },
        { status: 400 }
      );
    }
    updates.password = await bcrypt.hash(passwordValidation.data, 10);
  }

  if (Object.keys(updates).length > 0) {
    await db.update(users).set(updates).where(eq(users.id, id));
  }

  await logAudit({
    userId: auth.user.id,
    username: auth.user.username,
    action: "user.update",
    entity: "user",
    entityId: id,
    details: {
      targetUsername: user.username,
      roleChanged: updates.role ? { from: user.role, to: updates.role } : undefined,
      factoryKeyChanged: updates.factoryKey !== undefined
        ? { from: user.factoryKey, to: updates.factoryKey }
        : undefined,
      passwordReset: !!updates.password,
    },
  });

  if (updates.password && auth.user.id === id) {
    await clearSession();
    return NextResponse.json({ success: true, requiresReauth: true });
  }

  return NextResponse.json({ success: true, requiresReauth: false });
});

export const DELETE = withErrorHandler(async function DELETE(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const { id } = await request.json();

  if (!id) {
    return NextResponse.json({ error: "ต้องระบุ ID ผู้ใช้" }, { status: 400 });
  }

  if (auth.user.id === id) {
    return NextResponse.json({ error: "ไม่สามารถลบบัญชีตัวเอง" }, { status: 400 });
  }

  const db = getMainDb();
  const user = await db.query.users.findFirst({ where: eq(users.id, id) });

  await db.delete(users).where(eq(users.id, id));

  await logAudit({
    userId: auth.user.id,
    username: auth.user.username,
    action: "user.delete",
    entity: "user",
    entityId: id,
    details: { deletedUsername: user?.username, deletedRole: user?.role, deletedFactoryKey: user?.factoryKey },
  });

  return NextResponse.json({ success: true });
});
