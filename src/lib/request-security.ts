const SEC_FETCH_ALLOWED = new Set(["same-origin", "same-site", "none"]);

const IPV4_PART = "(25[0-5]|2[0-4][0-9]|1?[0-9]?[0-9])";
const IPV4_REGEX = new RegExp(`^${IPV4_PART}(\\.${IPV4_PART}){3}$`);
const IPV6_REGEX = /^[0-9a-fA-F:]+$/;

function isValidIp(candidate: string | null | undefined): candidate is string {
  if (!candidate) return false;
  const value = candidate.trim();
  if (!value) return false;
  if (IPV4_REGEX.test(value)) return true;
  return value.includes(":") && IPV6_REGEX.test(value);
}

export function getClientIpFromHeaders(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const candidates = forwarded
      .split(",")
      .map((part) => part.trim())
      .filter((ip) => isValidIp(ip));
    if (candidates.length > 0) {
      // Use the right-most trusted proxy-provided address to avoid spoofed prefixes.
      return candidates[candidates.length - 1];
    }
  }

  const realIp = headers.get("x-real-ip");
  if (isValidIp(realIp)) {
    return realIp;
  }
  return "unknown";
}

function normalizeOrigin(origin: string): string | null {
  try {
    const url = new URL(origin);
    return url.origin;
  } catch {
    return null;
  }
}

export function buildExpectedOriginsFromHeaders(
  headers: Headers,
  fallbackOrigin: string,
  extraOrigins: string[] = []
): Set<string> {
  const origins = new Set<string>();
  const fallback = normalizeOrigin(fallbackOrigin);
  if (fallback) origins.add(fallback);

  const proto =
    headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (fallback ? new URL(fallback).protocol.replace(":", "") : "https");
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = headers.get("host")?.trim();
  const effectiveHost = forwardedHost || host;
  if (effectiveHost) {
    const composed = normalizeOrigin(`${proto}://${effectiveHost}`);
    if (composed) origins.add(composed);
  }

  for (const candidate of extraOrigins) {
    const normalized = normalizeOrigin(candidate.trim());
    if (normalized) origins.add(normalized);
  }

  return origins;
}

export function hasValidCsrfContextFromHeaders(
  headers: Headers,
  expectedOrigins: Iterable<string>
): boolean {
  const allowedOrigins = new Set(Array.from(expectedOrigins));
  if (allowedOrigins.size === 0) return false;

  const secFetchSite = headers.get("sec-fetch-site");
  if (secFetchSite && !SEC_FETCH_ALLOWED.has(secFetchSite)) {
    return false;
  }

  const origin = headers.get("origin");
  if (origin) {
    try {
      return allowedOrigins.has(new URL(origin).origin);
    } catch {
      return false;
    }
  }

  const referer = headers.get("referer");
  if (referer) {
    try {
      return allowedOrigins.has(new URL(referer).origin);
    } catch {
      return false;
    }
  }

  // Some browsers/contexts omit Origin+Referer for same-site requests.
  // Allow only when Fetch metadata confirms same-site/same-origin.
  return secFetchSite !== null && SEC_FETCH_ALLOWED.has(secFetchSite);
}
