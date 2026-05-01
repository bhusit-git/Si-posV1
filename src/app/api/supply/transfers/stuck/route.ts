import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, lt } from "drizzle-orm";

import type { DrizzleDB } from "@/db";
import { supplyTransfers } from "@/db/schema";
import { requireAdmin } from "@/lib/api-auth";
import { withErrorHandler } from "@/lib/api-utils";
import { resolveSupplyReadContext } from "@/lib/supply/route-helpers";

async function loadStuckTransfers(db: DrizzleDB, cutoff: Date) {
  const findMany = db.query?.supplyTransfers?.findMany;
  if (findMany) {
    return findMany({
      where: and(eq(supplyTransfers.status, "sending"), lt(supplyTransfers.updatedAt, cutoff)),
      orderBy: [asc(supplyTransfers.updatedAt), asc(supplyTransfers.id)],
    });
  }

  return db
    .select()
    .from(supplyTransfers)
    .where(and(eq(supplyTransfers.status, "sending"), lt(supplyTransfers.updatedAt, cutoff)))
    .orderBy(asc(supplyTransfers.updatedAt), asc(supplyTransfers.id));
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const context = resolveSupplyReadContext(request, auth.user);
  if ("error" in context) return context.error;

  const cutoff = new Date(Date.now() - 5 * 60 * 1000);
  const rows = await loadStuckTransfers(context.db, cutoff);

  return NextResponse.json(rows);
});
