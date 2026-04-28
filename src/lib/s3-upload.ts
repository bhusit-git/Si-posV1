import { createHash, createHmac } from "node:crypto";

interface S3PutObjectParams {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  key: string;
  body: string;
  contentType: string;
  sessionToken?: string;
}

interface S3PutObjectResult {
  etag: string | null;
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodePathPreservingSlashes(path: string): string {
  return path
    .split("/")
    .map((segment) => encodePathSegment(segment))
    .join("/");
}

export async function putObjectToS3Compatible(
  params: S3PutObjectParams
): Promise<S3PutObjectResult> {
  const endpointUrl = new URL(params.endpoint);
  const host = endpointUrl.host;
  const service = "s3";
  const now = new Date();

  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(params.body);

  const canonicalBucket = encodePathSegment(params.bucket);
  const canonicalKey = encodePathPreservingSlashes(params.key.replace(/^\/+/, ""));
  const basePath = endpointUrl.pathname.replace(/\/+$/, "");
  const canonicalUri = `${basePath}/${canonicalBucket}/${canonicalKey}`.replace(/\/+/g, "/");

  const canonicalHeadersMap: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (params.sessionToken) {
    canonicalHeadersMap["x-amz-security-token"] = params.sessionToken;
  }

  const canonicalHeaderEntries = Object.entries(canonicalHeadersMap)
    .map(([name, value]) => [name.toLowerCase(), value.trim()] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  const canonicalHeaders = canonicalHeaderEntries
    .map(([name, value]) => `${name}:${value}\n`)
    .join("");

  const signedHeaders = canonicalHeaderEntries.map(([name]) => name).join(";");

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${params.region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmacSha256(`AWS4${params.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, params.region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning)
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const requestUrl = `${endpointUrl.origin}${canonicalUri}`;

  const response = await fetch(requestUrl, {
    method: "PUT",
    headers: {
      "Content-Type": params.contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...(params.sessionToken
        ? { "x-amz-security-token": params.sessionToken }
        : {}),
      Authorization: authorization,
    },
    body: params.body,
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(
      `R2 upload failed (${response.status} ${response.statusText}): ${responseText}`
    );
  }

  return {
    etag: response.headers.get("etag"),
  };
}
