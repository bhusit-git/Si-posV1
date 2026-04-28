const DEFAULT_SUPERICE_SESSION_SECRET = "superice-pos-dev-secret-key-local-only";

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function readOptionalEnv(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseCsv(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getSupericeEdgeEnv() {
  const production = isProduction();

  return {
    isProduction: production,
    sessionSecret:
      readOptionalEnv("SUPERICE_SESSION_SECRET") ||
      DEFAULT_SUPERICE_SESSION_SECRET,
    csrfTrustedOrigins: parseCsv(readOptionalEnv("CSRF_TRUSTED_ORIGINS")),
  };
}
