import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  putObjectToS3Compatible: vi.fn(),
}));

vi.mock("@/db", () => ({
  getDb: mocks.getDb,
}));

vi.mock("@/lib/s3-upload", () => ({
  putObjectToS3Compatible: mocks.putObjectToS3Compatible,
}));

import { GET as getTransactionsRotate } from "@/app/api/backup/transactions-rotate/route";

function setEnv(name: string, value: string) {
  Reflect.set(process.env, name, value);
}

function createSelectDb(results: unknown[]) {
  let index = 0;

  return {
    select() {
      const result = results[index++];
      const builder = {
        from: () => builder,
        innerJoin: () => builder,
        leftJoin: () => builder,
        where: () => builder,
        orderBy: () => Promise.resolve(result),
      };
      return builder;
    },
  };
}

describe("backup transactions rotate env integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    delete process.env.BACKUP_CRON_TOKEN;
    delete process.env.BACKUP_CUTOFF_HOUR;
    delete process.env.BACKUP_LOCAL_DIR;
    delete process.env.BACKUP_R2_ENDPOINT;
    delete process.env.BACKUP_R2_BUCKET;
    delete process.env.BACKUP_R2_ACCESS_KEY_ID;
    delete process.env.BACKUP_R2_SECRET_ACCESS_KEY;
    delete process.env.BACKUP_R2_SESSION_TOKEN;
    delete process.env.BACKUP_R2_REGION;
    delete process.env.BACKUP_R2_KEY_PREFIX;

    setEnv("NODE_ENV", "test");
    mocks.getDb.mockResolvedValue(createSelectDb([[], [], []]));
    mocks.putObjectToS3Compatible.mockResolvedValue({ etag: "etag-123" });
  });

  it("returns 500 when the backup cron token is not configured", async () => {
    const req = new NextRequest("http://localhost/api/backup/transactions-rotate", {
      headers: { "x-cron-token": "backup-token" },
    });

    const res = await getTransactionsRotate(req);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(body.error).toBe("BACKUP_CRON_TOKEN is not configured");
  });

  it("returns a dry-run payload with normalized local and R2 destinations", async () => {
    process.env.BACKUP_CRON_TOKEN = "backup-token";
    process.env.BACKUP_CUTOFF_HOUR = "8";
    process.env.BACKUP_LOCAL_DIR = "/tmp/rotated";
    process.env.BACKUP_R2_ENDPOINT = "https://example.r2.cloudflarestorage.com";
    process.env.BACKUP_R2_BUCKET = "superice";
    process.env.BACKUP_R2_ACCESS_KEY_ID = "key";
    process.env.BACKUP_R2_SECRET_ACCESS_KEY = "secret";
    process.env.BACKUP_R2_KEY_PREFIX = "/archive/transactions/";

    const req = new NextRequest(
      "http://localhost/api/backup/transactions-rotate?dryRun=1",
      { headers: { "x-cron-token": "backup-token" } }
    );

    const res = await getTransactionsRotate(req);
    const body = (await res.json()) as {
      ok: boolean;
      dryRun: boolean;
      localPath: string;
      r2ObjectKey: string;
      missingR2: string[];
    };

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(body.localPath).toContain("/tmp/rotated/transactions-history-slot-");
    expect(body.r2ObjectKey).toMatch(/^archive\/transactions\/transactions-history-slot-\d\.json$/);
    expect(body.missingR2).toEqual([]);
    expect(mocks.putObjectToS3Compatible).not.toHaveBeenCalled();
  });

  it("returns 500 when the configured cutoff hour is invalid", async () => {
    process.env.BACKUP_CRON_TOKEN = "backup-token";
    process.env.BACKUP_CUTOFF_HOUR = "99";

    const req = new NextRequest(
      "http://localhost/api/backup/transactions-rotate?dryRun=1",
      { headers: { "x-cron-token": "backup-token" } }
    );

    const res = await getTransactionsRotate(req);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(500);
    expect(body.error).toBe("เกิดข้อผิดพลาดภายในระบบ");
  });
});
