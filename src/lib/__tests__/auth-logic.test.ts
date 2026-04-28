import { describe, it, expect } from "vitest";

/**
 * Auth logic tests — pure function tests for role guard logic,
 * bcrypt detection, session structure, and password rules.
 * No actual JWT or bcrypt calls (those require runtime).
 */

// ---- Role system helpers (mirrors api-auth.ts logic) ----

type UserRole = "admin" | "office" | "manager" | "factory";

interface SessionUser {
  id: number;
  username: string;
  role: UserRole;
}

function requireRole(
  session: SessionUser | null,
  allowedRoles: UserRole[]
): { user: SessionUser } | { error: string } {
  if (!session) return { error: "ไม่ได้เข้าสู่ระบบ" };
  if (!allowedRoles.includes(session.role)) return { error: "ไม่มีสิทธิ์เข้าถึง" };
  return { user: session };
}

const requireAdmin = (s: SessionUser | null) => requireRole(s, ["admin"]);
const requireOfficeUp = (s: SessionUser | null) => requireRole(s, ["admin", "office"]);
const requireManagerUp = (s: SessionUser | null) => requireRole(s, ["admin", "office", "manager"]);

// ---- Bcrypt detection (mirrors auth/route.ts logic) ----

function isBcryptHash(password: string): boolean {
  return password.startsWith("$2a$") || password.startsWith("$2b$");
}

// ---- Session structure validation ----

function isValidSession(obj: unknown): obj is SessionUser {
  if (!obj || typeof obj !== "object") return false;
  const s = obj as Record<string, unknown>;
  return (
    typeof s.id === "number" &&
    typeof s.username === "string" &&
    typeof s.role === "string" &&
    ["admin", "office", "manager", "factory"].includes(s.role as string)
  );
}

describe("Auth Logic", () => {
  describe("bcrypt detection", () => {
    it("detects $2a$ prefix as bcrypt", () => {
      expect(isBcryptHash("$2a$10$abcdefghijklmnopqrstuvwxyz")).toBe(true);
    });

    it("detects $2b$ prefix as bcrypt", () => {
      expect(isBcryptHash("$2b$10$abcdefghijklmnopqrstuvwxyz")).toBe(true);
    });

    it("rejects plaintext password", () => {
      expect(isBcryptHash("myplainpassword")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isBcryptHash("")).toBe(false);
    });

    it("rejects $2y$ prefix (not used by bcryptjs)", () => {
      expect(isBcryptHash("$2y$10$abcdefg")).toBe(false);
    });

    it("rejects string that just starts with $2a without proper format", () => {
      expect(isBcryptHash("$2a")).toBe(false);
    });
  });

  describe("session structure validation", () => {
    it("valid admin session", () => {
      expect(
        isValidSession({ id: 1, username: "admin", role: "admin" })
      ).toBe(true);
    });

    it("valid office session", () => {
      expect(
        isValidSession({ id: 2, username: "user1", role: "office" })
      ).toBe(true);
    });

    it("valid manager session", () => {
      expect(
        isValidSession({ id: 3, username: "mgr", role: "manager" })
      ).toBe(true);
    });

    it("valid factory session", () => {
      expect(
        isValidSession({ id: 4, username: "factory1", role: "factory" })
      ).toBe(true);
    });

    it("rejects old 'user' role", () => {
      expect(
        isValidSession({ id: 2, username: "user1", role: "user" })
      ).toBe(false);
    });

    it("rejects null", () => {
      expect(isValidSession(null)).toBe(false);
    });

    it("rejects missing id", () => {
      expect(
        isValidSession({ username: "admin", role: "admin" })
      ).toBe(false);
    });

    it("rejects non-numeric id", () => {
      expect(
        isValidSession({ id: "1", username: "admin", role: "admin" })
      ).toBe(false);
    });

    it("rejects unknown role", () => {
      expect(
        isValidSession({ id: 1, username: "admin", role: "superuser" })
      ).toBe(false);
    });
  });

  describe("role guards", () => {
    const admin: SessionUser = { id: 1, username: "admin", role: "admin" };
    const office: SessionUser = { id: 2, username: "office1", role: "office" };
    const manager: SessionUser = { id: 3, username: "mgr1", role: "manager" };
    const factory: SessionUser = { id: 4, username: "fac1", role: "factory" };

    describe("requireAdmin", () => {
      it("allows admin", () => {
        const result = requireAdmin(admin);
        expect("user" in result).toBe(true);
      });

      it("rejects office", () => {
        const result = requireAdmin(office);
        expect("error" in result).toBe(true);
      });

      it("rejects manager", () => {
        const result = requireAdmin(manager);
        expect("error" in result).toBe(true);
      });

      it("rejects factory", () => {
        const result = requireAdmin(factory);
        expect("error" in result).toBe(true);
      });

      it("rejects null session", () => {
        const result = requireAdmin(null);
        expect("error" in result).toBe(true);
      });
    });

    describe("requireOfficeUp", () => {
      it("allows admin", () => {
        expect("user" in requireOfficeUp(admin)).toBe(true);
      });

      it("allows office", () => {
        expect("user" in requireOfficeUp(office)).toBe(true);
      });

      it("rejects manager", () => {
        expect("error" in requireOfficeUp(manager)).toBe(true);
      });

      it("rejects factory", () => {
        expect("error" in requireOfficeUp(factory)).toBe(true);
      });
    });

    describe("requireManagerUp", () => {
      it("allows admin", () => {
        expect("user" in requireManagerUp(admin)).toBe(true);
      });

      it("allows office", () => {
        expect("user" in requireManagerUp(office)).toBe(true);
      });

      it("allows manager", () => {
        expect("user" in requireManagerUp(manager)).toBe(true);
      });

      it("rejects factory", () => {
        expect("error" in requireManagerUp(factory)).toBe(true);
      });
    });

    describe("custom role combinations", () => {
      it("factory-only access (e.g. display mark loaded)", () => {
        const allowedForDisplay: UserRole[] = ["admin", "office", "factory"];
        expect("user" in requireRole(factory, allowedForDisplay)).toBe(true);
        expect("error" in requireRole(manager, allowedForDisplay)).toBe(true);
      });

      it("empty allowed roles rejects everyone", () => {
        expect("error" in requireRole(admin, [])).toBe(true);
      });
    });
  });

  describe("password rules", () => {
    const isValidPassword = (password: string): boolean => password.length >= 4;

    it("requires minimum length of 4", () => {
      expect(isValidPassword("123")).toBe(false);
      expect(isValidPassword("1234")).toBe(true);
    });

    it("accepts numbers, letters, and mixed values", () => {
      expect(isValidPassword("abcd")).toBe(true);
      expect(isValidPassword("1234")).toBe(true);
      expect(isValidPassword("a1b2")).toBe(true);
    });

    it("accepts unicode as long as the minimum length passes", () => {
      expect(isValidPassword("รหัส")).toBe(true);
      expect(isValidPassword("รหั")).toBe(false);
    });
  });
});
