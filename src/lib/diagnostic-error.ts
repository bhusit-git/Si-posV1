import type { RecordLike } from "@/lib/api-error-diagnostics";

export interface DiagnosticErrorOptions {
  code: string;
  category: string;
  source: string;
  operation: string;
  title: string;
  hint?: string;
  retryable?: boolean;
  httpStatus?: number;
  safeContext?: RecordLike;
  cause?: unknown;
}

export class DiagnosticError extends Error {
  readonly code: string;
  readonly category: string;
  readonly source: string;
  readonly operation: string;
  readonly title: string;
  readonly hint?: string;
  readonly retryable?: boolean;
  readonly httpStatus?: number;
  readonly safeContext: RecordLike;

  constructor(message: string, options: DiagnosticErrorOptions) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "DiagnosticError";
    this.code = options.code;
    this.category = options.category;
    this.source = options.source;
    this.operation = options.operation;
    this.title = options.title;
    this.hint = options.hint;
    this.retryable = options.retryable;
    this.httpStatus = options.httpStatus;
    this.safeContext = options.safeContext || {};
  }
}

export function isDiagnosticError(error: unknown): error is DiagnosticError {
  return error instanceof DiagnosticError;
}

export function findDiagnosticError(error: unknown): DiagnosticError | null {
  if (!error) return null;
  if (isDiagnosticError(error)) return error;

  if (typeof error === "object" && error !== null && "cause" in error) {
    return findDiagnosticError((error as { cause?: unknown }).cause);
  }

  return null;
}

export function asDiagnosticError(
  error: unknown,
  options: DiagnosticErrorOptions & { message?: string }
): DiagnosticError {
  const existing = findDiagnosticError(error);
  if (existing) return existing;

  const fallbackMessage =
    options.message ||
    options.title ||
    (error instanceof Error ? error.message : String(error));

  return new DiagnosticError(fallbackMessage, {
    ...options,
    cause: options.cause ?? error,
  });
}
