import { NextRequest, NextResponse } from "next/server";
import { getDbForFactory, getFactories } from "@/db";
import { withErrorHandler } from "@/lib/api-utils";
import {
  loadForecastArtifact,
  persistForecastArtifact,
  tomorrowInBangkok,
} from "@/lib/forecast-service";
import { parseDryRun, parseFactoryKeys, readCronToken } from "@/lib/line-report-utils";
import { getSupericeForecastEnv } from "@/lib/config/env";

function resolveFactoryKeys(request: NextRequest): string[] {
  const forecastEnv = getSupericeForecastEnv();
  const queryKeys =
    request.nextUrl.searchParams.get("factories") ||
    request.nextUrl.searchParams.get("factory") ||
    forecastEnv.forecastFactoryKeys ||
    "";

  const parsed = parseFactoryKeys(queryKeys);
  const configured = getFactories().map((f) => f.key);

  if (parsed.length === 0) return configured;
  return parsed.filter((key) => configured.includes(key));
}

async function handle(request: NextRequest) {
  const forecastEnv = getSupericeForecastEnv();
  const expectedToken = forecastEnv.forecastCronToken;
  if (!expectedToken) {
    return NextResponse.json(
      { error: "FORECAST_CRON_TOKEN is not configured" },
      { status: 500 }
    );
  }

  const providedToken = readCronToken(request);
  if (!providedToken || providedToken !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = parseDryRun(request);
  const allowStale = request.nextUrl.searchParams.get("allowStale") === "1";
  const expectedTargetDate =
    request.nextUrl.searchParams.get("targetDate") || tomorrowInBangkok();

  const factories = resolveFactoryKeys(request);
  if (factories.length === 0) {
    return NextResponse.json(
      { error: "No matching factories configured for forecasting" },
      { status: 400 }
    );
  }

  const results: Array<Record<string, unknown>> = [];

  for (const factoryKey of factories) {
    try {
      const artifact = await loadForecastArtifact(factoryKey);
      const stale = artifact.target_date !== expectedTargetDate;

      if (stale && !allowStale) {
        results.push({
          factoryKey,
          ok: false,
          reason: "stale_target_date",
          artifactTargetDate: artifact.target_date,
          expectedTargetDate,
        });
        continue;
      }

      if (dryRun) {
        results.push({
          factoryKey,
          ok: true,
          dryRun: true,
          targetDate: artifact.target_date,
          modelVersion: artifact.model_version,
          rowCount: artifact.rows.length,
          stale,
        });
        continue;
      }

      const db = getDbForFactory(factoryKey);
      const persist = await persistForecastArtifact(db, factoryKey, artifact);

      results.push({
        factoryKey,
        ok: true,
        targetDate: persist.targetDate,
        modelVersion: persist.modelVersion,
        upserted: persist.upserted,
        stale,
      });
    } catch (error) {
      results.push({
        factoryKey,
        ok: false,
        reason: "load_or_persist_failed",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const okCount = results.filter((r) => r.ok === true).length;
  const status = okCount === results.length ? 200 : okCount > 0 ? 207 : 500;

  return NextResponse.json(
    {
      ok: okCount > 0,
      dryRun,
      expectedTargetDate,
      successCount: okCount,
      failureCount: results.length - okCount,
      results,
    },
    { status }
  );
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  return handle(request);
});

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  return handle(request);
});
