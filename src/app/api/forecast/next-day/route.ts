import { NextRequest, NextResponse } from "next/server";
import { getDb, getDbForFactory, getFactories } from "@/db";
import { withErrorHandler } from "@/lib/api-utils";
import { getForecastSnapshot, tomorrowInBangkok } from "@/lib/forecast-service";
import { requireOfficeUp } from "@/lib/api-auth";
import { getSupericeForecastEnv } from "@/lib/config/env";

function resolveFactoryKey(request: NextRequest): string {
  const requested = request.nextUrl.searchParams.get("factory")?.toLowerCase() || "";
  const configured = getFactories();

  if (requested) {
    const match = configured.find((f) => f.key === requested);
    if (match) return match.key;
  }

  return (
    getSupericeForecastEnv().forecastDefaultFactoryKey ||
    configured[0]?.key ||
    "default"
  );
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireOfficeUp();
  if (auth.error) return auth.error;

  const targetDate = request.nextUrl.searchParams.get("targetDate") || tomorrowInBangkok();
  const factoryKey = resolveFactoryKey(request);

  const db = request.nextUrl.searchParams.get("factory") ? getDbForFactory(factoryKey) : await getDb();
  const snapshot = await getForecastSnapshot(db, factoryKey, targetDate);

  if (!snapshot) {
    return NextResponse.json(
      {
        error: "Forecast not found",
        factoryKey,
        targetDate,
      },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    factoryKey,
    targetDate,
    snapshot,
  });
});
