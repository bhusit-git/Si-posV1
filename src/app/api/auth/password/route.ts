import { NextRequest, NextResponse } from "next/server";
import { getMainDb } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { clearSession, getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import bcrypt from "bcryptjs";
import { withErrorHandler } from "@/lib/api-utils";
import { userPasswordSchema } from "@/lib/validations";

export const PUT = withErrorHandler(async function PUT(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });
  }

  const { currentPassword, newPassword, targetUserId } = await request.json();

  const userId = session.role === "admin" && targetUserId ? targetUserId : session.id;

  const db = getMainDb();
  if (!targetUserId || targetUserId === session.id) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, session.id),
    });
    if (!user) {
      return NextResponse.json({ error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" }, { status: 400 });
    }
    let match = false;
    if (user.password.startsWith("$2a$") || user.password.startsWith("$2b$")) {
      match = await bcrypt.compare(currentPassword, user.password);
    } else {
      match = user.password === currentPassword;
    }
    if (!match) {
      return NextResponse.json({ error: "รหัสผ่านปัจจุบันไม่ถูกต้อง" }, { status: 400 });
    }
  }

  const parsedPassword = userPasswordSchema.safeParse(newPassword);
  if (!parsedPassword.success) {
    return NextResponse.json(
      { error: parsedPassword.error.issues[0]?.message || "รหัสผ่านใหม่ไม่ถูกต้อง" },
      { status: 400 }
    );
  }

  const hashedPassword = await bcrypt.hash(parsedPassword.data, 10);
  await db
    .update(users)
    .set({ password: hashedPassword })
    .where(eq(users.id, userId));

  await logAudit({
    userId: session.id,
    username: session.username,
    action: "user.passwordChange",
    entity: "user",
    entityId: userId,
    details: { changedBySelf: userId === session.id, targetUserId: userId },
  });

  const changedBySelf = userId === session.id;
  if (changedBySelf) {
    await clearSession();
  }

  return NextResponse.json({ success: true, requiresReauth: changedBySelf });
});
