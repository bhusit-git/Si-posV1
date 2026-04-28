import { NextRequest, NextResponse } from "next/server";
import { asDiagnosticError } from "@/lib/diagnostic-error";
import { buildLoggedInternalApiError } from "@/lib/error-logging";
import { writeMigrateAuditEntry } from "./audit";
import { findMigrateAction } from "./registry";
import {
  createMigrateContext,
  requireConfirmation,
  requireFactoryActionParam,
} from "./shared";
import type { MigrateActionContext, MigrateActionDefinition } from "./types";

function isApplyPath(definition: MigrateActionDefinition, context: MigrateActionContext): boolean {
  if (!definition.supportsDryRun) return true;
  return !context.dryRunRequested;
}

function enforceMigrateGuards(
  request: NextRequest,
  definition: MigrateActionDefinition,
  context: MigrateActionContext
): NextResponse | null {
  if (definition.factoryScope === "single" && !requireFactoryActionParam(request)) {
    return NextResponse.json({ error: "Missing ?factory= parameter" }, { status: 400 });
  }

  if (
    definition.requiresConfirmation &&
    isApplyPath(definition, context)
  ) {
    const confirmation = requireConfirmation(request, definition.requiresConfirmation);
    if (!confirmation.ok) return confirmation.response;
  }

  return null;
}

export async function dispatchMigrateAction(
  request: NextRequest,
  callerIp: string
): Promise<NextResponse> {
  const method = request.method as "GET" | "POST";
  const externalAction = request.nextUrl.searchParams.get("action");
  const definition = findMigrateAction(method, externalAction);

  if (!definition) {
    return NextResponse.json(
      { error: externalAction ? `Unknown action '${externalAction}'` : "Unknown migrate action" },
      { status: 400 }
    );
  }

  const context = createMigrateContext(request, definition, callerIp);
  const guardFailure = enforceMigrateGuards(request, definition, context);
  if (guardFailure) return guardFailure;

  try {
    const result = await definition.handler(context);
    await writeMigrateAuditEntry({
      definition,
      context,
      result,
    });
    const status = result.status ?? 200;
    if (status >= 500) {
      const logged = buildLoggedInternalApiError({
        request,
        error: asDiagnosticError(result.body?.error, {
          code: "SRV-MIGRATE-1001",
          category: "server.unhandled",
          source: "migrate.dispatcher",
          operation: definition.name,
          title: "Migration action failed",
          hint: "ดู requestId และ log ของ migration action นี้เพื่อไล่สาเหตุ",
          retryable: false,
          safeContext: {
            action: definition.name,
            callerIp,
          },
        }),
        context: {
          action: definition.name,
          callerIp,
        },
        fallbackSource: "migrate.dispatcher",
        fallbackOperation: definition.name,
        status,
      });
      return NextResponse.json(logged.body, {
        status: logged.status,
        headers: {
          "x-request-id": logged.requestId,
        },
      });
    }
    return NextResponse.json(result.body, { status });
  } catch (error) {
    await writeMigrateAuditEntry({
      definition,
      context,
      error,
    });
    const logged = buildLoggedInternalApiError({
      request,
      error,
      context: {
        action: definition.name,
        callerIp,
      },
      fallbackSource: "migrate.dispatcher",
      fallbackOperation: definition.name,
    });
    return NextResponse.json(logged.body, {
      status: logged.status,
      headers: {
        "x-request-id": logged.requestId,
      },
    });
  }
}
