import { NextRequest, NextResponse } from "next/server";

import { requireManagerUp } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { getStockBalances } from "@/lib/supply/stock-engine";
import { parseBooleanFlag, resolveSupplyReadContext } from "@/lib/supply/route-helpers";

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireManagerUp();
  if (auth.error) return auth.error;

  const context = resolveSupplyReadContext(request, auth.user);
  if ("error" in context) return context.error;

  const lowOnly = parseBooleanFlag(request.nextUrl.searchParams.get("lowOnly"));
  const rows = await getStockBalances(context.db, context.factoryKey);

  return NextResponse.json(lowOnly ? rows.filter((row) => row.isLow) : rows);
});
