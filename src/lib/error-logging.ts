import { NextRequest } from "next/server";
import {
  buildInternalApiErrorBody,
  classifyApiError,
  extractErrorCauseChain,
  extractErrorShape,
  type ApiErrorDiagnostic,
  type RecordLike,
} from "@/lib/api-error-diagnostics";
import { findDiagnosticError } from "@/lib/diagnostic-error";

export function createRequestId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function logApiError(params: {
  request: NextRequest;
  error: unknown;
  requestId?: string;
  context?: RecordLike;
  diagnostic?: ApiErrorDiagnostic;
  fallbackSource?: string;
  fallbackOperation?: string;
}) {
  const requestId = params.requestId || createRequestId();
  const request = params.request;
  const typed = findDiagnosticError(params.error);
  const diagnostic =
    params.diagnostic ||
    classifyApiError(params.error, {
      source: typed?.source || params.fallbackSource || "api.route",
      operation:
        typed?.operation ||
        params.fallbackOperation ||
        `${request.method} ${request.nextUrl.pathname}`,
    });
  const payload = {
    requestId,
    ts: new Date().toISOString(),
    request: {
      method: request.method,
      path: request.nextUrl.pathname,
      query: request.nextUrl.search,
    },
    context: {
      ...(typed?.safeContext || {}),
      ...(params.context || {}),
    },
    diagnostic,
    error: extractErrorShape(params.error),
    causes: extractErrorCauseChain(params.error),
  };

  console.error(
    `[API Error][${diagnostic.category}][${diagnostic.code}][${requestId}] ${request.method} ${request.nextUrl.pathname}`,
    payload
  );
  return { requestId, diagnostic };
}

type LogLevel = "info" | "warn" | "error";

export function logDiagnosticEvent(params: {
  level: LogLevel;
  message: string;
  error?: unknown;
  context?: RecordLike;
  diagnostic?: ApiErrorDiagnostic;
  source?: string;
  operation?: string;
}) {
  const diagnostic =
    params.diagnostic ||
    (params.error
      ? classifyApiError(params.error, {
          source: params.source,
          operation: params.operation,
        })
      : undefined);
  const payload = {
    ts: new Date().toISOString(),
    message: params.message,
    context: params.context || {},
    diagnostic,
    error: params.error ? extractErrorShape(params.error) : undefined,
    causes: params.error ? extractErrorCauseChain(params.error) : [],
  };

  const method =
    params.level === "info"
      ? console.info
      : params.level === "warn"
      ? console.warn
      : console.error;

  method(`[Diagnostic][${params.level}] ${params.message}`, payload);
}

export function buildLoggedInternalApiError(params: {
  request: NextRequest;
  error: unknown;
  requestId?: string;
  context?: RecordLike;
  message?: string;
  status?: number;
  fallbackSource?: string;
  fallbackOperation?: string;
}) {
  const requestId = params.requestId || createRequestId();
  const diagnostic = classifyApiError(params.error, {
    source: params.fallbackSource || "api.route",
    operation:
      params.fallbackOperation ||
      `${params.request.method} ${params.request.nextUrl.pathname}`,
  });

  logApiError({
    request: params.request,
    error: params.error,
    requestId,
    context: params.context,
    diagnostic,
    fallbackSource: params.fallbackSource,
    fallbackOperation: params.fallbackOperation,
  });

  return {
    requestId,
    status: params.status || 500,
    body: buildInternalApiErrorBody(
      params.error,
      requestId,
      params.message,
      {
        source: diagnostic.source,
        operation: diagnostic.operation,
      }
    ),
  };
}
