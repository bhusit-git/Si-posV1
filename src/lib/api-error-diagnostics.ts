import { ZodError } from "zod";
import { findDiagnosticError } from "@/lib/diagnostic-error";

export type RecordLike = Record<string, unknown>;

export interface PostgresErrorDetails {
  code?: string | null;
  detail?: string | null;
  hint?: string | null;
  severity?: string | null;
  schema?: string | null;
  table?: string | null;
  column?: string | null;
  constraint?: string | null;
  file?: string | null;
  line?: string | null;
  routine?: string | null;
}

export interface ApiErrorDiagnostic {
  category: string;
  code: string;
  source: string;
  operation: string;
  title: string;
  hint?: string;
  retryable?: boolean;
  postgresCode?: string | null;
  table?: string | null;
  column?: string | null;
  constraint?: string | null;
}

export interface ApiErrorResponseBody {
  error: string;
  requestId?: string;
  diagnostic?: ApiErrorDiagnostic;
}

interface PgLikeError extends RecordLike {
  code?: string;
  detail?: string;
  hint?: string;
  severity?: string;
  severity_local?: string;
  schema_name?: string;
  table_name?: string;
  column_name?: string;
  constraint_name?: string;
  file?: string;
  line?: string | number;
  routine?: string;
  cause?: unknown;
}

function asRecord(value: unknown): RecordLike | null {
  if (!value || typeof value !== "object") return null;
  return value as RecordLike;
}

function toText(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function toBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function extractPostgresErrorDirect(error: unknown): PostgresErrorDetails | null {
  const rec = asRecord(error) as PgLikeError | null;
  if (!rec) return null;

  const code = toText(rec.code);
  const detail = toText(rec.detail);
  const constraint = toText(rec.constraint_name);
  const table = toText(rec.table_name);
  const looksLikePostgres =
    (code !== null && /^\d[A-Z0-9]{4}$/i.test(code)) ||
    detail !== null ||
    constraint !== null ||
    table !== null;
  if (!looksLikePostgres) return null;

  return {
    code,
    detail,
    hint: toText(rec.hint),
    severity: toText(rec.severity) || toText(rec.severity_local),
    schema: toText(rec.schema_name),
    table,
    column: toText(rec.column_name),
    constraint,
    file: toText(rec.file),
    line: toText(rec.line),
    routine: toText(rec.routine),
  };
}

export function extractPostgresError(error: unknown): PostgresErrorDetails | null {
  const direct = extractPostgresErrorDirect(error);
  if (direct) return direct;

  const rec = asRecord(error) as PgLikeError | null;
  if (!rec || rec.cause === undefined) return null;
  return extractPostgresError(rec.cause);
}

export function extractErrorShape(error: unknown): RecordLike {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      postgres: extractPostgresError(error),
    };
  }

  const rec = asRecord(error);
  if (!rec) {
    return { message: String(error) };
  }

  return {
    name: toText(rec.name),
    message: toText(rec.message) || String(error),
    stack: toText(rec.stack),
    postgres: extractPostgresError(error),
  };
}

export function extractErrorCauseChain(error: unknown, maxDepth = 6): RecordLike[] {
  const causes: RecordLike[] = [];
  let current: unknown =
    typeof error === "object" && error !== null && "cause" in error
      ? (error as { cause?: unknown }).cause
      : undefined;
  let depth = 0;

  while (current !== undefined && depth < maxDepth) {
    causes.push(extractErrorShape(current));
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause?: unknown }).cause
        : undefined;
    depth += 1;
  }

  return causes;
}

function buildDiagnostic(base: ApiErrorDiagnostic): ApiErrorDiagnostic {
  return base;
}

interface DiagnosticFallback {
  source?: string;
  operation?: string;
}

function applyFallback(base: ApiErrorDiagnostic, fallback?: DiagnosticFallback): ApiErrorDiagnostic {
  return {
    ...base,
    source:
      !base.source || base.source === "server"
        ? fallback?.source || base.source || "server"
        : base.source,
    operation:
      !base.operation || base.operation === "unhandled"
        ? fallback?.operation || base.operation || "unhandled"
        : base.operation,
  };
}

export function classifyApiError(
  error: unknown,
  fallback?: DiagnosticFallback
): ApiErrorDiagnostic {
  const typed = findDiagnosticError(error);
  if (typed) {
    return applyFallback(
      buildDiagnostic({
        category: typed.category,
        code: typed.code,
        source: typed.source,
        operation: typed.operation,
        title: typed.title,
        hint: typed.hint,
        retryable: typed.retryable,
        postgresCode: extractPostgresError(error)?.code || null,
        table: extractPostgresError(error)?.table || null,
        column: extractPostgresError(error)?.column || null,
        constraint: extractPostgresError(error)?.constraint || null,
      }),
      fallback
    );
  }

  const pg = extractPostgresError(error);
  const shape = extractErrorShape(error);
  if (error instanceof ZodError) {
    return applyFallback(
      buildDiagnostic({
        category: "request.validation",
        code: "REQ-VALIDATION-1001",
        source: "request.body",
        operation: "schema-parse",
        title: "Request validation failed",
        hint: "ข้อมูลที่ส่งมาไม่ตรงตามรูปแบบที่ API ต้องการ",
        retryable: false,
        postgresCode: pg?.code || null,
        table: pg?.table || null,
        column: pg?.column || null,
        constraint: pg?.constraint || null,
      }),
      fallback
    );
  }

  const message = (toText(shape.message) || "").toLowerCase();
  const constraint = pg?.constraint || null;
  const table = pg?.table || null;
  const column = pg?.column || null;
  const detail = (pg?.detail || "").toLowerCase();

  if (
    message.includes("not configured") ||
    message.includes("must be an integer") ||
    message.includes("missing required")
  ) {
    return applyFallback(buildDiagnostic({
      category: "server.config",
      code: "SRV-CONFIG-1001",
      source: "server.config",
      operation: "load",
      title: "Server configuration error",
      hint: "ตรวจสอบ environment variables หรือค่า config ของ deployment นี้",
      retryable: false,
      postgresCode: pg?.code || null,
      table,
      column,
      constraint,
    }), fallback);
  }

  if (
    message.includes("unauthorized") ||
    message.includes("ไม่ได้เข้าสู่ระบบ") ||
    message.includes("invalid or missing api key") ||
    message.includes("ไม่มีสิทธิ์เข้าถึง")
  ) {
    return applyFallback(buildDiagnostic({
      category: "auth.session",
      code: "AUTH-SESSION-1001",
      source: "auth.session",
      operation: "verify",
      title: "Authentication or authorization failed",
      hint: "ตรวจสอบ session, role หรือ API key ของคำขอนี้",
      retryable: false,
      postgresCode: pg?.code || null,
      table,
      column,
      constraint,
    }), fallback);
  }

  if (
    message.includes("unexpected end of json input") ||
    (message.includes("json") && message.includes("position")) ||
    (error instanceof SyntaxError && message.includes("json"))
  ) {
    return applyFallback(buildDiagnostic({
      category: "request.validation",
      code: "REQ-VALIDATION-1002",
      source: "request.body",
      operation: "json-parse",
      title: "Request body is not valid JSON",
      hint: "ตรวจสอบรูปแบบ JSON ของคำขอนี้ก่อนส่งใหม่",
      retryable: false,
      postgresCode: pg?.code || null,
      table,
      column,
      constraint,
    }), fallback);
  }

  if (pg?.code === "42P01") {
    return applyFallback(buildDiagnostic({
      category: "database.schema",
      code: "DB-SCHEMA-1001",
      source: "database.schema",
      operation: "query",
      title: "Missing database table",
      hint: table
        ? `ตาราง ${table} ยังไม่มีในฐานข้อมูลที่ใช้งานอยู่`
        : "ตารางที่ระบบต้องใช้ยังไม่มีในฐานข้อมูลที่ใช้งานอยู่",
      retryable: false,
      postgresCode: pg.code,
      table,
      column,
      constraint,
    }), fallback);
  }

  if (pg?.code === "42703") {
    return applyFallback(buildDiagnostic({
      category: "database.schema",
      code: "DB-SCHEMA-1002",
      source: "database.schema",
      operation: "query",
      title: "Missing database column",
      hint: column
        ? `คอลัมน์ ${column} ยังไม่มีในฐานข้อมูลที่ใช้งานอยู่`
        : "คอลัมน์ที่ระบบต้องใช้ยังไม่มีในฐานข้อมูลที่ใช้งานอยู่",
      retryable: false,
      postgresCode: pg.code,
      table,
      column,
      constraint,
    }), fallback);
  }

  if (
    pg?.code === "23505" &&
    (constraint?.endsWith("_pkey") || detail.includes("key (id)="))
  ) {
    return applyFallback(buildDiagnostic({
      category: "database.sequence",
      code: "DB-SEQUENCE-1001",
      source: "database.sequence",
      operation: "insert",
      title: "Primary key sequence drift",
      hint: table
        ? `sequence ของตาราง ${table} น่าจะตามหลังค่า id ล่าสุด`
        : "sequence ของตารางน่าจะตามหลังค่า id ล่าสุด",
      retryable: false,
      postgresCode: pg.code,
      table,
      column,
      constraint,
    }), fallback);
  }

  if (pg?.code === "23505") {
    return applyFallback(buildDiagnostic({
      category: "database.constraint",
      code: "DB-CONSTRAINT-1001",
      source: "database.constraint",
      operation: "write",
      title: "Unique constraint violation",
      hint: constraint
        ? `ข้อมูลซ้ำกับข้อกำหนด ${constraint}`
        : "มีข้อมูลซ้ำกับข้อกำหนด unique ของฐานข้อมูล",
      retryable: false,
      postgresCode: pg.code,
      table,
      column,
      constraint,
    }), fallback);
  }

  if (pg?.code === "23503") {
    return applyFallback(buildDiagnostic({
      category: "database.constraint",
      code: "DB-CONSTRAINT-1002",
      source: "database.constraint",
      operation: "write",
      title: "Foreign key violation",
      hint: table
        ? `ข้อมูลอ้างอิงในตาราง ${table} ไม่ครบหรือไม่ตรงกัน`
        : "ข้อมูลอ้างอิงในฐานข้อมูลไม่ครบหรือไม่ตรงกัน",
      retryable: false,
      postgresCode: pg.code,
      table,
      column,
      constraint,
    }), fallback);
  }

  if (pg?.code === "23502") {
    return applyFallback(buildDiagnostic({
      category: "database.constraint",
      code: "DB-CONSTRAINT-1003",
      source: "database.constraint",
      operation: "write",
      title: "Missing required value",
      hint: column
        ? `คอลัมน์ ${column} ต้องมีค่าแต่คำขอนี้ส่งมาไม่ครบ`
        : "มีค่าที่จำเป็นในฐานข้อมูลหายไป",
      retryable: false,
      postgresCode: pg.code,
      table,
      column,
      constraint,
    }), fallback);
  }

  if (pg?.code === "22P02") {
    return applyFallback(buildDiagnostic({
      category: "database.data",
      code: "DB-DATA-1001",
      source: "database.query",
      operation: "bind",
      title: "Invalid database input",
      hint: column
        ? `ค่าที่ส่งให้คอลัมน์ ${column} อยู่ในรูปแบบที่ฐานข้อมูลไม่รับ`
        : "มีค่าบางช่องอยู่ในรูปแบบที่ฐานข้อมูลไม่รับ",
      retryable: false,
      postgresCode: pg.code,
      table,
      column,
      constraint,
    }), fallback);
  }

  if (pg?.code === "57014" || message.includes("statement timeout")) {
    return applyFallback(buildDiagnostic({
      category: "database.timeout",
      code: "DB-TIMEOUT-1001",
      source: "database.query",
      operation: "execute",
      title: "Database query timed out",
      hint: "คำสั่งฐานข้อมูลใช้เวลานานเกินไป ให้ตรวจสอบ query และภาระงานของฐานข้อมูล",
      retryable: true,
      postgresCode: pg?.code || null,
      table,
      column,
      constraint,
    }), fallback);
  }

  if (pg?.code && ["08001", "08006", "57P01", "53300"].includes(pg.code)) {
    return applyFallback(buildDiagnostic({
      category: "database.connection",
      code: "DB-CONNECTION-1001",
      source: "database.connection",
      operation: "connect",
      title: "Database connection failed",
      hint: "การเชื่อมต่อฐานข้อมูลมีปัญหา กรุณาตรวจสอบสถานะ Render/Postgres",
      retryable: true,
      postgresCode: pg.code,
      table,
      column,
      constraint,
    }), fallback);
  }

  if (
    message.includes("failed to fetch") ||
    message.includes("fetch failed") ||
    message.includes("networkerror") ||
    (error instanceof DOMException && error.name === "AbortError")
  ) {
    return applyFallback(buildDiagnostic({
      category: "external.fetch",
      code: "EXT-FETCH-1001",
      source: "external.fetch",
      operation: "request",
      title: "External request failed",
      hint: "ตรวจสอบการเชื่อมต่อเครือข่ายหรือบริการภายนอกที่เกี่ยวข้อง",
      retryable: true,
    }), fallback);
  }

  if (
    message.includes("upstream") ||
    message.includes("service unavailable") ||
    message.includes("unexpected response")
  ) {
    return applyFallback(buildDiagnostic({
      category: "external.service",
      code: "EXT-SERVICE-1001",
      source: "external.service",
      operation: "respond",
      title: "External service returned an invalid response",
      hint: "ตรวจสอบบริการภายนอกและ response ที่ระบบได้รับ",
      retryable: true,
      postgresCode: pg?.code || null,
      table,
      column,
      constraint,
    }), fallback);
  }

  return applyFallback(buildDiagnostic({
    category: "server.unhandled",
    code: "SRV-UNEXPECTED-1000",
    source: "server",
    operation: "unhandled",
    title: "Unhandled server error",
    hint: "ดู requestId ใน log เพื่อไล่สาเหตุจากฝั่งเซิร์ฟเวอร์",
    retryable: false,
    postgresCode: pg?.code || null,
    table,
    column,
    constraint,
  }), fallback);
}

export function buildInternalApiErrorBody(
  error: unknown,
  requestId: string,
  message = "เกิดข้อผิดพลาดภายในระบบ",
  fallback?: DiagnosticFallback
): ApiErrorResponseBody {
  return {
    error: message,
    requestId,
    diagnostic: classifyApiError(error, fallback),
  };
}

export function parseApiErrorResponse(value: unknown): ApiErrorResponseBody | null {
  const rec = asRecord(value);
  if (!rec) return null;

  const error = toText(rec.error);
  const requestId = toText(rec.requestId);
  const diagnosticRec = asRecord(rec.diagnostic);
  const diagnostic = diagnosticRec
    ? {
        category: toText(diagnosticRec.category) || "server.unhandled",
        code: toText(diagnosticRec.code) || "SRV-UNEXPECTED-1000",
        source: toText(diagnosticRec.source) || "server",
        operation: toText(diagnosticRec.operation) || "unhandled",
        title: toText(diagnosticRec.title) || "Unhandled server error",
        hint: toText(diagnosticRec.hint) || undefined,
        retryable: toBoolean(diagnosticRec.retryable),
        postgresCode: toText(diagnosticRec.postgresCode),
        table: toText(diagnosticRec.table),
        column: toText(diagnosticRec.column),
        constraint: toText(diagnosticRec.constraint),
      }
    : undefined;

  if (!error && !requestId && !diagnostic) return null;

  return {
    error: error || "เกิดข้อผิดพลาดภายในระบบ",
    requestId: requestId || undefined,
    diagnostic,
  };
}

export function formatApiDiagnosticMeta(payload: ApiErrorResponseBody | null | undefined): string {
  const parts: string[] = [];
  if (payload?.diagnostic?.code) parts.push(`รหัส ${payload.diagnostic.code}`);
  if (payload?.diagnostic?.category) parts.push(`หมวด ${payload.diagnostic.category}`);
  if (payload?.diagnostic?.source) parts.push(`จุด ${payload.diagnostic.source}`);
  if (payload?.diagnostic?.operation) parts.push(`งาน ${payload.diagnostic.operation}`);
  if (payload?.requestId) parts.push(`Req ${payload.requestId}`);
  return parts.join(" | ");
}

export function buildApiErrorDescription(
  payload: ApiErrorResponseBody | null | undefined,
  fallbackMessage: string
): string {
  const lines: string[] = [payload?.error || fallbackMessage];
  const meta = formatApiDiagnosticMeta(payload);
  if (meta) lines.push(meta);
  if (payload?.diagnostic?.hint) lines.push(payload.diagnostic.hint);
  return lines.join("\n");
}

export function buildClientDiagnostic(params: {
  category: string;
  code: string;
  source: string;
  operation: string;
  title: string;
  hint?: string;
  retryable?: boolean;
}): ApiErrorDiagnostic {
  return {
    category: params.category,
    code: params.code,
    source: params.source,
    operation: params.operation,
    title: params.title,
    hint: params.hint,
    retryable: params.retryable,
  };
}
