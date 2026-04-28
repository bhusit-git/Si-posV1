import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getExecEnv,
  getHeatEnv,
  getSharedDbEnv,
  getSupericeBackupEnv,
  getSupericeDisplayEnv,
  getSupericeEnv,
  getSupericeForecastEnv,
  getSupericeLineEnv,
  getSupericeMigrateEnv,
  getSupericeSetupEnv,
} from "@/shared/config/env";

const TRACKED_ENV_KEYS = [
  "NODE_ENV",
  "DB_DEBUG_SQL",
  "DATABASE_URL",
  "DATABASE_URL_SI",
  "DATABASE_URL_BEARING",
  "DATABASE_URL_KTK",
  "DATABASE_URL_CUSTOM",
  "SUPERICE_SESSION_SECRET",
  "CSRF_TRUSTED_ORIGINS",
  "NEXT_PUBLIC_POSTHOG_KEY",
  "NEXT_PUBLIC_POSTHOG_HOST",
  "SETUP_KEY",
  "SETUP_ENABLED",
  "SETUP_ALLOWED_IPS",
  "DISPLAY_API_KEY",
  "FORECAST_ARTIFACTS_DIR",
  "FORECAST_ALLOW_UNAPPROVED",
  "FORECAST_CRON_TOKEN",
  "FORECAST_DEFAULT_FACTORY_KEY",
  "FORECAST_FACTORY_KEYS",
  "LINE_CHANNEL_ACCESS_TOKEN",
  "LINE_REPORT_CRON_TOKEN",
  "LINE_WEEKLY_BRIEFING_CRON_TOKEN",
  "LINE_REPORT_FACTORY_KEYS",
  "LINE_WEEKLY_FACTORY_KEYS",
  "LINE_REPORT_TARGET_IDS",
  "LINE_REPORT_TARGET_IDS_KTK",
  "LINE_WEEKLY_TARGET_IDS",
  "LINE_WEEKLY_TARGET_IDS_SI",
  "BACKUP_CRON_TOKEN",
  "BACKUP_CUTOFF_HOUR",
  "BACKUP_LOCAL_DIR",
  "BACKUP_R2_ENDPOINT",
  "BACKUP_R2_BUCKET",
  "BACKUP_R2_ACCESS_KEY_ID",
  "BACKUP_R2_SECRET_ACCESS_KEY",
  "BACKUP_R2_SESSION_TOKEN",
  "BACKUP_R2_REGION",
  "BACKUP_R2_KEY_PREFIX",
  "MIGRATE_KEY",
  "MIGRATE_ENABLED",
  "MIGRATE_ALLOWED_IPS",
  "MIGRATE_V5_SEED_PASSWORDS_JSON",
  "ML_ARTIFACTS_ROOT",
  "EXEC_SESSION_SECRET",
  "EXEC_PIN",
] as const;

type TrackedEnvKey = (typeof TRACKED_ENV_KEYS)[number];

function setEnv(name: string, value: string) {
  Reflect.set(process.env, name, value);
}

function snapshotEnv(): Record<TrackedEnvKey, string | undefined> {
  return Object.fromEntries(
    TRACKED_ENV_KEYS.map((key) => [key, process.env[key]])
  ) as Record<TrackedEnvKey, string | undefined>;
}

function restoreEnv(snapshot: Record<TrackedEnvKey, string | undefined>) {
  for (const key of TRACKED_ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      setEnv(key, value);
    }
  }
}

describe("shared env accessors", () => {
  let originalEnv: Record<TrackedEnvKey, string | undefined>;

  beforeEach(() => {
    originalEnv = snapshotEnv();
    restoreEnv(
      Object.fromEntries(TRACKED_ENV_KEYS.map((key) => [key, undefined])) as Record<
        TrackedEnvKey,
        string | undefined
      >
    );
    setEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    restoreEnv(originalEnv);
  });

  it("reads canonical shared db urls and debug flags", () => {
    process.env.DB_DEBUG_SQL = "1";
    process.env.DATABASE_URL = "postgres://main";
    process.env.DATABASE_URL_SI = "postgres://si";
    process.env.DATABASE_URL_BEARING = "postgres://bearing";
    process.env.DATABASE_URL_CUSTOM = "postgres://custom";

    const env = getSharedDbEnv();

    expect(env.dbDebugSql).toBe(true);
    expect(env.mainDatabaseUrl).toBe("postgres://main");
    expect(env.factoryDatabaseUrls).toEqual({
      si: "postgres://si",
      bearing: "postgres://bearing",
      ktk: null,
    });
    expect(env.getFactoryDatabaseUrl("bearing")).toBe("postgres://bearing");
    expect(env.getFactoryDatabaseUrl("custom")).toBe("postgres://custom");
  });

  it("parses superice env values with development defaults", () => {
    process.env.CSRF_TRUSTED_ORIGINS =
      " https://one.example.com,https://two.example.com ,, ";
    process.env.NEXT_PUBLIC_POSTHOG_KEY = "ph_test";

    const env = getSupericeEnv();

    expect(env.sessionSecret).toBe("superice-pos-dev-secret-key-local-only");
    expect(env.csrfTrustedOrigins).toEqual([
      "https://one.example.com",
      "https://two.example.com",
    ]);
    expect(env.posthogKey).toBe("ph_test");
    expect(env.posthogHost).toBe("https://us.i.posthog.com");
  });

  it("parses setup and display env groups", () => {
    setEnv("NODE_ENV", "production");
    process.env.SETUP_KEY = "setup-secret";
    process.env.SETUP_ENABLED = "true";
    process.env.SETUP_ALLOWED_IPS = "10.0.0.1, 10.0.0.2";
    process.env.DISPLAY_API_KEY = "display-secret";

    expect(getSupericeSetupEnv()).toEqual({
      isProduction: true,
      setupKey: "setup-secret",
      setupEnabled: true,
      setupAllowedIps: ["10.0.0.1", "10.0.0.2"],
    });

    expect(getSupericeDisplayEnv()).toEqual({
      isProduction: true,
      displayApiKey: "display-secret",
    });
  });

  it("parses forecast env values and defaults", () => {
    process.env.FORECAST_ARTIFACTS_DIR = "/tmp/forecast-artifacts";
    process.env.FORECAST_ALLOW_UNAPPROVED = "1";
    process.env.FORECAST_CRON_TOKEN = "forecast-token";
    process.env.FORECAST_DEFAULT_FACTORY_KEY = "bearing";
    process.env.FORECAST_FACTORY_KEYS = "si,bearing";

    expect(getSupericeForecastEnv()).toEqual({
      isProduction: false,
      forecastArtifactsDir: "/tmp/forecast-artifacts",
      forecastAllowUnapproved: true,
      forecastCronToken: "forecast-token",
      forecastDefaultFactoryKey: "bearing",
      forecastFactoryKeys: "si,bearing",
    });
  });

  it("uses per-factory LINE targets with weekly fallbacks", () => {
    process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-token";
    process.env.LINE_REPORT_CRON_TOKEN = "daily-token";
    process.env.LINE_REPORT_FACTORY_KEYS = "si,ktk";
    process.env.LINE_REPORT_TARGET_IDS = "daily-default-1,daily-default-2";
    process.env.LINE_REPORT_TARGET_IDS_KTK = "ktk-specific";
    process.env.LINE_WEEKLY_TARGET_IDS = "weekly-default";
    process.env.LINE_WEEKLY_TARGET_IDS_SI = "si-weekly";

    const env = getSupericeLineEnv();

    expect(env.lineChannelAccessToken).toBe("line-token");
    expect(env.lineReportCronToken).toBe("daily-token");
    expect(env.lineWeeklyBriefingCronToken).toBe("daily-token");
    expect(env.lineReportFactoryKeys).toBe("si,ktk");
    expect(env.lineWeeklyFactoryKeys).toBe("si,ktk");
    expect(env.lineReportTargetIds).toEqual(["daily-default-1", "daily-default-2"]);
    expect(env.lineWeeklyTargetIds).toEqual(["weekly-default"]);
    expect(env.getDailyTargetIds("ktk")).toEqual(["ktk-specific"]);
    expect(env.getDailyTargetIds("si")).toEqual(["daily-default-1", "daily-default-2"]);
    expect(env.getWeeklyTargetIds("si")).toEqual(["si-weekly"]);
    expect(env.getWeeklyTargetIds("bearing")).toEqual(["weekly-default"]);
  });

  it("normalizes backup config and validates cutoff hour", () => {
    process.env.BACKUP_CRON_TOKEN = "backup-token";
    process.env.BACKUP_CUTOFF_HOUR = "9";
    process.env.BACKUP_LOCAL_DIR = "/tmp/custom-backups";
    process.env.BACKUP_R2_ENDPOINT = "https://example.r2.cloudflarestorage.com";
    process.env.BACKUP_R2_BUCKET = "superice";
    process.env.BACKUP_R2_ACCESS_KEY_ID = "key";
    process.env.BACKUP_R2_SECRET_ACCESS_KEY = "secret";
    process.env.BACKUP_R2_SESSION_TOKEN = "session";
    process.env.BACKUP_R2_KEY_PREFIX = "/custom/prefix/";

    expect(getSupericeBackupEnv("/repo")).toEqual({
      isProduction: false,
      backupCronToken: "backup-token",
      backupCutoffHour: 9,
      backupLocalDir: "/tmp/custom-backups",
      r2: {
        endpoint: "https://example.r2.cloudflarestorage.com",
        bucket: "superice",
        accessKeyId: "key",
        secretAccessKey: "secret",
        sessionToken: "session",
        region: "auto",
        prefix: "custom/prefix",
      },
    });

    process.env.BACKUP_CUTOFF_HOUR = "99";
    expect(() => getSupericeBackupEnv("/repo")).toThrow(
      "BACKUP_CUTOFF_HOUR must be an integer between 0 and 23"
    );
  });

  it("parses migrate env and delegates factory database lookups", () => {
    process.env.MIGRATE_KEY = "migrate-secret";
    process.env.MIGRATE_ENABLED = "true";
    process.env.MIGRATE_ALLOWED_IPS = "127.0.0.1,10.0.0.5";
    process.env.MIGRATE_V5_SEED_PASSWORDS_JSON = "{\"office\":\"pw\"}";
    process.env.DATABASE_URL_SI = "postgres://si";

    const env = getSupericeMigrateEnv();

    expect(env.migrateKey).toBe("migrate-secret");
    expect(env.migrateEnabled).toBe(true);
    expect(env.migrateAllowedIps).toEqual(["127.0.0.1", "10.0.0.5"]);
    expect(env.migrateV5SeedPasswordsJson).toBe("{\"office\":\"pw\"}");
    expect(env.getFactoryDatabaseUrl("si")).toBe("postgres://si");
    expect(env.getFactoryEnvVarName("bearing")).toBe("DATABASE_URL_BEARING");
    expect(env.getFactoryEnvVarName("custom")).toBe("DATABASE_URL_CUSTOM");
  });

  it("exposes heat artifact config and exec defaults from the shared env module", () => {
    process.env.ML_ARTIFACTS_ROOT = "/tmp/ml-artifacts";
    process.env.DATABASE_URL_SI = "postgres://si";

    expect(getHeatEnv().mlArtifactsRoot).toBe("/tmp/ml-artifacts");
    expect(getExecEnv().siDatabaseUrl).toBe("postgres://si");
    expect(getExecEnv().pin).toBe("1234");
  });

  it("enforces production-only required exec secrets", () => {
    setEnv("NODE_ENV", "production");
    delete process.env.EXEC_SESSION_SECRET;

    expect(() => getExecEnv()).toThrow("EXEC_SESSION_SECRET is required in production");

    process.env.EXEC_SESSION_SECRET = "prod-secret";
    delete process.env.EXEC_PIN;

    expect(() => getExecEnv()).toThrow("EXEC_PIN is required in production");
  });
});
