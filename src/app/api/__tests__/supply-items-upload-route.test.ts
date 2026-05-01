import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  putObjectToS3Compatible: vi.fn(),
}));

vi.mock("@/lib/api-auth", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("@/lib/s3-upload", () => ({
  putObjectToS3Compatible: mocks.putObjectToS3Compatible,
}));

import { POST } from "@/app/api/supply/items/upload/route";

function createUploadRequest(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  return {
    formData: vi.fn().mockResolvedValue(formData),
  };
}

describe("supply item upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    delete process.env.BACKUP_R2_ENDPOINT;
    delete process.env.BACKUP_R2_BUCKET;
    delete process.env.BACKUP_R2_ACCESS_KEY_ID;
    delete process.env.BACKUP_R2_SECRET_ACCESS_KEY;
    delete process.env.BACKUP_R2_SESSION_TOKEN;
    delete process.env.BACKUP_R2_REGION;
    delete process.env.SUPPLY_IMAGE_R2_PREFIX;
    delete process.env.SUPPLY_IMAGE_PUBLIC_BASE_URL;

    mocks.requireAdmin.mockResolvedValue({
      user: { id: 1, username: "admin", role: "admin", factoryKey: "si" },
    });
    mocks.putObjectToS3Compatible.mockResolvedValue({ etag: "etag-123", objectUrl: "https://internal-r2.example/upload" });
  });

  it("returns 500 when R2 is configured without a public image base URL", async () => {
    process.env.BACKUP_R2_ENDPOINT = "https://example.r2.cloudflarestorage.com";
    process.env.BACKUP_R2_BUCKET = "superice";
    process.env.BACKUP_R2_ACCESS_KEY_ID = "key";
    process.env.BACKUP_R2_SECRET_ACCESS_KEY = "secret";

    const request = createUploadRequest(
      new File(["image-bytes"], "pen.png", { type: "image/png" })
    );

    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe("ต้องตั้งค่า SUPPLY_IMAGE_PUBLIC_BASE_URL ก่อนใช้งานการอัปโหลดรูปไป R2");
    expect(mocks.putObjectToS3Compatible).not.toHaveBeenCalled();
  });

  it("returns auth error when admin access is denied", async () => {
    mocks.requireAdmin.mockResolvedValueOnce({
      error: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    });

    const request = createUploadRequest(
      new File(["image-bytes"], "pen.png", { type: "image/png" })
    );

    const response = await POST(request as never);
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error).toBe("forbidden");
  });
});
