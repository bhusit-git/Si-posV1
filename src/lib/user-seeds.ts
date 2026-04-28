export type SeedUserRole = "admin" | "office" | "manager" | "factory";

export interface SeedUser {
  username: string;
  password: string;
  role: SeedUserRole;
  factoryKey: string | null;
}

interface SeedUserDefinition {
  username: string;
  role: SeedUserRole;
  factoryKey: string | null;
}

const LEGACY_COMPAT_SEED_USERS: SeedUser[] = [
  { username: "Admin", password: "lion", role: "admin", factoryKey: null },
];

const MODERN_SCRIPT_SEED_USERS: SeedUser[] = [
  { username: "admin", password: "superice@2026", role: "admin", factoryKey: null },
  { username: "office", password: "office@2026", role: "office", factoryKey: null },
  { username: "manager-si", password: "manager@2026", role: "manager", factoryKey: "si" },
  { username: "factory-si", password: "factory@2026", role: "factory", factoryKey: "si" },
  { username: "manager-bearing", password: "manager@2026", role: "manager", factoryKey: "bearing" },
  { username: "factory-bearing", password: "factory@2026", role: "factory", factoryKey: "bearing" },
];

const MODERN_BOOTSTRAP_SEED_USERS: SeedUserDefinition[] = [
  { username: "admin", role: "admin", factoryKey: null },
  { username: "office", role: "office", factoryKey: null },
  { username: "manager-si", role: "manager", factoryKey: "si" },
  { username: "factory-si", role: "factory", factoryKey: "si" },
  { username: "manager-bearing", role: "manager", factoryKey: "bearing" },
  { username: "factory-bearing", role: "factory", factoryKey: "bearing" },
];

export interface SeedPasswordMap {
  [username: string]: string;
}

export function getScriptSeedUsers(): SeedUser[] {
  return [...LEGACY_COMPAT_SEED_USERS, ...MODERN_SCRIPT_SEED_USERS];
}

export function buildBootstrapSeedUsers(seedPasswords: SeedPasswordMap): SeedUser[] {
  const modernUsers = MODERN_BOOTSTRAP_SEED_USERS.map((user) => {
    const plainPassword = seedPasswords[user.username];
    if (typeof plainPassword !== "string" || plainPassword.length < 4) {
      throw new Error(
        `Missing password with at least 4 chars for '${user.username}'`
      );
    }

    return {
      ...user,
      password: plainPassword,
    };
  });

  return [...LEGACY_COMPAT_SEED_USERS, ...modernUsers];
}
