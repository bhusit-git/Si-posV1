import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSupericeEdgeEnv } from "@/lib/config/edge-env";
import { checkNamedRateLimit } from "@/lib/rate-limit";
import {
  buildExpectedOriginsFromHeaders,
  getClientIpFromHeaders,
  hasValidCsrfContextFromHeaders,
} from "@/lib/request-security";

const SESSION_COOKIE = "superice_session";
const FACTORY_COOKIE = "superice_factory";
const EDGE_ENV = getSupericeEdgeEnv();

function getSecretKey(): Uint8Array {
  return new TextEncoder().encode(EDGE_ENV.sessionSecret);
}

// Public routes that don't need auth
const PUBLIC_PATHS = new Set([
  "/api/auth",
  "/api/display",
  "/api/health",
  "/api/setup",
  "/api/line/daily-summary",
  "/api/line/weekly-briefing",
  "/api/forecast/run",
  "/sale",
  "/",
]);

// Prefix patterns that don't need auth
const PUBLIC_PREFIXES = ["/api/display", "/api/auth", "/api/migrate", "/sale"];

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_EXEMPT_PREFIXES = [
  "/api/auth",
  "/api/display",
  "/api/migrate",
  "/api/setup",
  "/api/health",
  "/api/forecast/run",
];
const CSRF_TRUSTED_ORIGINS = EDGE_ENV.csrfTrustedOrigins;

const CSP_PRODUCTION = [
  "default-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "script-src 'self' 'unsafe-inline' https://us.i.posthog.com https://us-assets.i.posthog.com",
  "connect-src 'self' https://us.i.posthog.com https://us-assets.i.posthog.com",
].join("; ");

const RATE_LIMIT_POLICIES = [
  {
    name: "transactions-mutation",
    prefix: "/api/transactions",
    methods: new Set(["POST", "PUT"]),
    maxAttempts: 180,
    windowMs: 60_000,
  },
  {
    name: "returns-create",
    prefix: "/api/returns",
    methods: new Set(["POST"]),
    maxAttempts: 90,
    windowMs: 60_000,
  },
  {
    name: "users-mutation",
    prefix: "/api/users",
    methods: new Set(["POST", "PUT", "DELETE"]),
    maxAttempts: 30,
    windowMs: 60_000,
  },
  {
    name: "backup-export",
    prefix: "/api/backup",
    methods: new Set(["GET"]),
    maxAttempts: 6,
    windowMs: 60 * 60_000,
  },
  {
    name: "display-mutation",
    prefix: "/api/display",
    methods: new Set(["POST"]),
    maxAttempts: 360,
    windowMs: 60_000,
  },
] as const;

function withSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()"
  );
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");

  if (EDGE_ENV.isProduction) {
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
    response.headers.set("Content-Security-Policy", CSP_PRODUCTION);
  }

  return response;
}

function getRateLimitPolicy(pathname: string, method: string) {
  return RATE_LIMIT_POLICIES.find(
    (policy) => pathname.startsWith(policy.prefix) && policy.methods.has(method)
  );
}

function shouldCheckCsrf(pathname: string, method: string): boolean {
  if (!pathname.startsWith("/api/")) return false;
  if (!MUTATING_METHODS.has(method)) return false;
  return !CSRF_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  for (const prefix of PUBLIC_PREFIXES) {
    if (pathname.startsWith(prefix)) return true;
  }
  // Display pages (factory kiosks)
  if (pathname.startsWith("/display")) return true;
  // Print pages
  if (pathname.startsWith("/print")) return true;
  // Static files and Next.js internals
  if (pathname.startsWith("/_next") || pathname.startsWith("/favicon")) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method.toUpperCase();

  const rateLimitPolicy = getRateLimitPolicy(pathname, method);
  if (rateLimitPolicy) {
    const ip = getClientIpFromHeaders(request.headers);
    const rateKey = `${ip}:${pathname}:${method}`;
    const rl = checkNamedRateLimit(
      rateLimitPolicy.name,
      rateKey,
      rateLimitPolicy.maxAttempts,
      rateLimitPolicy.windowMs
    );
    if (rl.limited) {
      return withSecurityHeaders(
        NextResponse.json(
          { error: "คำขอมากเกินไป กรุณาลองใหม่อีกครั้ง" },
          {
            status: 429,
            headers: {
              "Retry-After": String(
                Math.ceil((rl.retryAfterMs || rateLimitPolicy.windowMs) / 1000)
              ),
            },
          }
        )
      );
    }
  }

  // Allow public routes
  if (isPublicPath(pathname)) {
    return withSecurityHeaders(NextResponse.next());
  }

  // CSRF protection for authenticated API mutations
  if (
    shouldCheckCsrf(pathname, method) &&
    !hasValidCsrfContextFromHeaders(
      request.headers,
      buildExpectedOriginsFromHeaders(
        request.headers,
        request.nextUrl.origin,
        CSRF_TRUSTED_ORIGINS
      )
    )
  ) {
    console.warn(
      `[CSRF BLOCK] ${method} ${pathname} origin=${request.headers.get("origin") || "-"} referer=${request.headers.get("referer") || "-"} sec-fetch-site=${request.headers.get("sec-fetch-site") || "-"} host=${request.headers.get("host") || "-"} x-forwarded-host=${request.headers.get("x-forwarded-host") || "-"} x-forwarded-proto=${request.headers.get("x-forwarded-proto") || "-"}`
    );
    return withSecurityHeaders(
      NextResponse.json(
        { error: "คำขอไม่ปลอดภัย (CSRF blocked)" },
        { status: 403 }
      )
    );
  }

  // Check session cookie
  const sessionCookie = request.cookies.get(SESSION_COOKIE)?.value;
  if (!sessionCookie) {
    // API routes get 401; pages get redirected to login
    if (pathname.startsWith("/api/")) {
      return withSecurityHeaders(
        NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 })
      );
    }
    const loginUrl = new URL("/", request.url);
    return withSecurityHeaders(NextResponse.redirect(loginUrl));
  }

  // Verify JWT signature
  try {
    const { payload } = await jwtVerify(sessionCookie, getSecretKey(), {
      algorithms: ["HS256"],
    });

    // Log request (stdout captured by Render)
    console.log(`[${request.method}] ${pathname} user=${payload.username} role=${payload.role}`);

    const lockedFactory = (payload.factoryKey as string) || null;

    // Enforce factory lock: if the user is locked to a factory, force the cookie
    if (lockedFactory) {
      const currentFactory = request.cookies.get(FACTORY_COOKIE)?.value;
      if (currentFactory !== lockedFactory) {
        const response = NextResponse.next();
        response.cookies.set(FACTORY_COOKIE, lockedFactory, {
          httpOnly: false,
          secure: EDGE_ENV.isProduction,
          sameSite: "lax",
          maxAge: 60 * 60 * 24 * 365,
          path: "/",
        });
        return withSecurityHeaders(response);
      }
    }

    return withSecurityHeaders(NextResponse.next());
  } catch {
    // Invalid session
    if (pathname.startsWith("/api/")) {
      return withSecurityHeaders(
        NextResponse.json({ error: "เซสชั่นหมดอายุ" }, { status: 401 })
      );
    }
    const loginUrl = new URL("/", request.url);
    return withSecurityHeaders(NextResponse.redirect(loginUrl));
  }
}

export const config = {
  matcher: [
    // Match API routes and dashboard pages, skip static files
    "/api/:path*",
    "/dashboard/:path*",
    "/sale/:path*",
    "/transactions/:path*",
    "/transfers/:path*",
    "/returns/:path*",
    "/bags/:path*",
    "/production/:path*",
    "/reports/:path*",
    "/settings/:path*",
    "/credit/:path*",
  ],
};
