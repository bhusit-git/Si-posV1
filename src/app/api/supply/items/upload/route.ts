import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { putObjectToS3Compatible } from "@/lib/s3-upload";
import { normalizePrefix, readOptionalEnv } from "@/shared/config/internal";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SUPPLY_UPLOAD_DIR = join(process.cwd(), "public", "uploads", "supply-items");

function sanitizeExtension(fileName: string, mimeType: string): string {
  const fromName = extname(fileName).toLowerCase();
  if (fromName) return fromName;
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  if (mimeType === "image/gif") return ".gif";
  return ".jpg";
}

function buildR2ObjectUrl(key: string): string | null {
  const publicBase = readOptionalEnv("SUPPLY_IMAGE_PUBLIC_BASE_URL");
  if (publicBase) {
    return `${publicBase.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
  }
  return null;
}

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "กรุณาเลือกไฟล์รูป" }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return NextResponse.json({ error: "รองรับเฉพาะไฟล์รูปภาพ" }, { status: 400 });
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: "ไฟล์รูปว่างเปล่า" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: "ไฟล์รูปต้องมีขนาดไม่เกิน 5 MB" },
      { status: 400 }
    );
  }

  const extension = sanitizeExtension(file.name, file.type);
  const fileName = `${randomUUID()}${extension}`;
  const arrayBuffer = await file.arrayBuffer();
  const body = new Uint8Array(arrayBuffer);

  const r2Endpoint = readOptionalEnv("BACKUP_R2_ENDPOINT");
  const r2Bucket = readOptionalEnv("BACKUP_R2_BUCKET");
  const r2AccessKeyId = readOptionalEnv("BACKUP_R2_ACCESS_KEY_ID");
  const r2SecretAccessKey = readOptionalEnv("BACKUP_R2_SECRET_ACCESS_KEY");
  const r2SessionToken = readOptionalEnv("BACKUP_R2_SESSION_TOKEN");
  const r2Region = readOptionalEnv("BACKUP_R2_REGION") || "auto";
  const r2Prefix = normalizePrefix(
    readOptionalEnv("SUPPLY_IMAGE_R2_PREFIX") || "superice/supply-items"
  );

  if (r2Endpoint && r2Bucket && r2AccessKeyId && r2SecretAccessKey) {
    const objectKey = r2Prefix ? `${r2Prefix}/${fileName}` : fileName;
    const imageUrl = buildR2ObjectUrl(objectKey);
    if (!imageUrl) {
      return NextResponse.json(
        { error: "ต้องตั้งค่า SUPPLY_IMAGE_PUBLIC_BASE_URL ก่อนใช้งานการอัปโหลดรูปไป R2" },
        { status: 500 }
      );
    }

    await putObjectToS3Compatible({
      endpoint: r2Endpoint,
      region: r2Region,
      accessKeyId: r2AccessKeyId,
      secretAccessKey: r2SecretAccessKey,
      sessionToken: r2SessionToken || undefined,
      bucket: r2Bucket,
      key: objectKey,
      body,
      contentType: file.type,
    });

    return NextResponse.json({
      imageUrl,
      storage: "r2",
    });
  }

  await mkdir(SUPPLY_UPLOAD_DIR, { recursive: true });
  await writeFile(join(SUPPLY_UPLOAD_DIR, fileName), body);

  return NextResponse.json({
    imageUrl: `/uploads/supply-items/${fileName}`,
    storage: "local",
  });
});
