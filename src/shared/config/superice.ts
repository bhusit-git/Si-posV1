import {
  isProduction,
  normalizePrefix,
  parseCsv,
  parseIntegerInRange,
  readOptionalEnv,
  requireInProduction,
} from "./internal";
import { getSharedDbEnv } from "./shared-db";

const DEFAULT_SUPERICE_SESSION_SECRET = "superice-pos-dev-secret-key-local-only";
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const DEFAULT_BACKUP_CUTOFF_HOUR = 8;
const DEFAULT_BACKUP_R2_REGION = "auto";

function joinPathParts(...parts: string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .map((part, index) => {
      if (index === 0) return part.replace(/\/+$/, "");
      return part.replace(/^\/+/, "").replace(/\/+$/, "");
    })
    .join("/");
}

function parseTargets(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function getFactoryTargetIds(
  envNamePrefix: "LINE_REPORT_TARGET_IDS" | "LINE_WEEKLY_TARGET_IDS",
  factoryKey: string,
  fallbackTargetIds: string[]
): string[] {
  const envKey = `${envNamePrefix}_${factoryKey.toUpperCase()}`;
  const configured = parseTargets(readOptionalEnv(envKey) || undefined);
  return configured.length > 0 ? configured : fallbackTargetIds;
}

export function getSupericeEnv() {
  return {
    isProduction: isProduction(),
    sessionSecret: requireInProduction(
      "SUPERICE_SESSION_SECRET",
      readOptionalEnv("SUPERICE_SESSION_SECRET"),
      DEFAULT_SUPERICE_SESSION_SECRET
    ),
    csrfTrustedOrigins: parseCsv(readOptionalEnv("CSRF_TRUSTED_ORIGINS")),
    posthogKey: readOptionalEnv("NEXT_PUBLIC_POSTHOG_KEY"),
    posthogHost: readOptionalEnv("NEXT_PUBLIC_POSTHOG_HOST") || DEFAULT_POSTHOG_HOST,
  };
}

export function getSupericeSetupEnv() {
  return {
    isProduction: isProduction(),
    setupKey: readOptionalEnv("SETUP_KEY"),
    setupEnabled: readOptionalEnv("SETUP_ENABLED") === "true",
    setupAllowedIps: parseCsv(readOptionalEnv("SETUP_ALLOWED_IPS")),
  };
}

export function getSupericeDisplayEnv() {
  return {
    isProduction: isProduction(),
    displayApiKey: readOptionalEnv("DISPLAY_API_KEY"),
  };
}

export function getSupericeForecastEnv() {
  return {
    isProduction: isProduction(),
    forecastArtifactsDir: readOptionalEnv("FORECAST_ARTIFACTS_DIR"),
    forecastAllowUnapproved: readOptionalEnv("FORECAST_ALLOW_UNAPPROVED") === "1",
    forecastCronToken: readOptionalEnv("FORECAST_CRON_TOKEN"),
    forecastDefaultFactoryKey: readOptionalEnv("FORECAST_DEFAULT_FACTORY_KEY"),
    forecastFactoryKeys: readOptionalEnv("FORECAST_FACTORY_KEYS"),
  };
}

export function getSupericeLineEnv() {
  const lineReportTargetIds = parseTargets(readOptionalEnv("LINE_REPORT_TARGET_IDS") || undefined);
  const lineWeeklyTargetIds = parseTargets(
    readOptionalEnv("LINE_WEEKLY_TARGET_IDS") ||
      readOptionalEnv("LINE_REPORT_TARGET_IDS") ||
      undefined
  );

  return {
    isProduction: isProduction(),
    lineChannelAccessToken: readOptionalEnv("LINE_CHANNEL_ACCESS_TOKEN"),
    lineReportCronToken: readOptionalEnv("LINE_REPORT_CRON_TOKEN"),
    lineWeeklyBriefingCronToken:
      readOptionalEnv("LINE_WEEKLY_BRIEFING_CRON_TOKEN") ||
      readOptionalEnv("LINE_REPORT_CRON_TOKEN"),
    lineReportFactoryKeys: readOptionalEnv("LINE_REPORT_FACTORY_KEYS"),
    lineWeeklyFactoryKeys:
      readOptionalEnv("LINE_WEEKLY_FACTORY_KEYS") ||
      readOptionalEnv("LINE_REPORT_FACTORY_KEYS"),
    lineReportTargetIds,
    lineWeeklyTargetIds,
    getDailyTargetIds(factoryKey: string): string[] {
      return getFactoryTargetIds("LINE_REPORT_TARGET_IDS", factoryKey, lineReportTargetIds);
    },
    getWeeklyTargetIds(factoryKey: string): string[] {
      const weeklyTargets = getFactoryTargetIds(
        "LINE_WEEKLY_TARGET_IDS",
        factoryKey,
        lineWeeklyTargetIds
      );
      if (weeklyTargets.length > 0) return weeklyTargets;
      return getFactoryTargetIds("LINE_REPORT_TARGET_IDS", factoryKey, lineReportTargetIds);
    },
  };
}

export function getSupericeBackupEnv(cwd?: string) {
  const resolvedCwd = cwd || ".";
  return {
    isProduction: isProduction(),
    backupCronToken: readOptionalEnv("BACKUP_CRON_TOKEN"),
    backupCutoffHour: parseIntegerInRange(
      readOptionalEnv("BACKUP_CUTOFF_HOUR"),
      DEFAULT_BACKUP_CUTOFF_HOUR,
      0,
      23,
      "BACKUP_CUTOFF_HOUR"
    ),
    backupLocalDir:
      readOptionalEnv("BACKUP_LOCAL_DIR") ||
      joinPathParts(resolvedCwd, "backups", "transaction-history"),
    r2: {
      endpoint: readOptionalEnv("BACKUP_R2_ENDPOINT"),
      bucket: readOptionalEnv("BACKUP_R2_BUCKET"),
      accessKeyId: readOptionalEnv("BACKUP_R2_ACCESS_KEY_ID"),
      secretAccessKey: readOptionalEnv("BACKUP_R2_SECRET_ACCESS_KEY"),
      sessionToken: readOptionalEnv("BACKUP_R2_SESSION_TOKEN"),
      region: readOptionalEnv("BACKUP_R2_REGION") || DEFAULT_BACKUP_R2_REGION,
      prefix: normalizePrefix(
        readOptionalEnv("BACKUP_R2_KEY_PREFIX") || "superice/transaction-history"
      ),
    },
  };
}

export function getSupericeMigrateEnv() {
  const sharedDbEnv = getSharedDbEnv();

  return {
    isProduction: isProduction(),
    migrateKey: readOptionalEnv("MIGRATE_KEY"),
    migrateEnabled: readOptionalEnv("MIGRATE_ENABLED") === "true",
    migrateAllowedIps: parseCsv(readOptionalEnv("MIGRATE_ALLOWED_IPS")),
    migrateV5SeedPasswordsJson: readOptionalEnv("MIGRATE_V5_SEED_PASSWORDS_JSON"),
    getFactoryDatabaseUrl(factoryKey: string): string | null {
      return sharedDbEnv.getFactoryDatabaseUrl(factoryKey);
    },
    getFactoryEnvVarName(factoryKey: string): string | null {
      return sharedDbEnv.getFactoryEnvVarName(factoryKey);
    },
  };
}
