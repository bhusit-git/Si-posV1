import { NextRequest, NextResponse } from "next/server";
import type { RecordLike } from "@/lib/api-error-diagnostics";
import { buildLoggedInternalApiError } from "@/lib/error-logging";

type RouteHandler<TArgs extends unknown[] = []> = (
  request: NextRequest,
  ...args: TArgs
) => Promise<NextResponse>;

interface ErrorHandlerOptions<TArgs extends unknown[] = []> {
  message?: string;
  source?: string;
  operation?:
    | string
    | ((request: NextRequest, ...args: TArgs) => string);
  context?:
    | RecordLike
    | ((request: NextRequest, ...args: TArgs) => RecordLike | Promise<RecordLike>);
}

async function resolveOption<TArgs extends unknown[], TValue>(
  option:
    | TValue
    | ((request: NextRequest, ...args: TArgs) => TValue | Promise<TValue>)
    | undefined,
  request: NextRequest,
  args: TArgs
): Promise<TValue | undefined> {
  if (typeof option === "function") {
    return await (option as (request: NextRequest, ...args: TArgs) => TValue | Promise<TValue>)(
      request,
      ...args
    );
  }
  return option;
}

export function createInternalServerErrorResponse(params: {
  request: NextRequest;
  error: unknown;
  requestId?: string;
  context?: RecordLike;
  message?: string;
  source?: string;
  operation?: string;
  status?: number;
}): NextResponse {
  const logged = buildLoggedInternalApiError({
    request: params.request,
    error: params.error,
    requestId: params.requestId,
    context: params.context,
    message: params.message,
    status: params.status,
    fallbackSource: params.source,
    fallbackOperation: params.operation,
  });

  return NextResponse.json(logged.body, {
    status: logged.status,
    headers: {
      "x-request-id": logged.requestId,
    },
  });
}

/**
 * Wraps an API route handler with try/catch error handling.
 * Catches unhandled errors and returns a generic 500 response
 * instead of exposing stack traces.
 */
export function withErrorHandler<TArgs extends unknown[] = []>(
  handler: RouteHandler<TArgs>,
  options?: ErrorHandlerOptions<TArgs>
): RouteHandler<TArgs> {
  return async (request: NextRequest, ...args: TArgs) => {
    try {
      return await handler(request, ...args);
    } catch (error) {
      return createInternalServerErrorResponse({
        request,
        error,
        message: options?.message,
        source: options?.source || "api.route",
        operation:
          (await resolveOption(options?.operation, request, args)) ||
          `${request.method} ${request.nextUrl.pathname}`,
        context: await resolveOption(options?.context, request, args),
      });
    }
  };
}
