import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { withErrorHandler } from "@/lib/api-utils";
import { getClientIpFromHeaders } from "@/lib/request-security";
import { getSupericeSetupEnv } from "@/lib/config/env";

/**
 * One-time database setup endpoint.
 * GET /api/setup -- check schema status
 * POST /api/setup?action=schema -- apply schema migrations
 *
 * Protected by Authorization: Bearer <SETUP_KEY>.
 */
function isRequestAuthorized(request: NextRequest): { ok: true } | { ok: false; response: NextResponse } {
  const setupEnv = getSupericeSetupEnv();
  if (!setupEnv.setupKey) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Setup endpoint is disabled" }, { status: 403 }),
    };
  }
  if (setupEnv.isProduction && !setupEnv.setupEnabled) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Setup endpoint is disabled in production" }, { status: 403 }),
    };
  }

  if (setupEnv.setupAllowedIps.length > 0) {
    const clientIp = getClientIpFromHeaders(request.headers);
    if (!setupEnv.setupAllowedIps.includes(clientIp)) {
      return {
        ok: false,
        response: NextResponse.json({ error: "IP address is not allowed" }, { status: 403 }),
      };
    }
  }

  const authHeader = request.headers.get("authorization");
  const token =
    authHeader && authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length).trim()
      : null;
  if (!token || token !== setupEnv.setupKey) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  return { ok: true };
}

export const GET = withErrorHandler(async function GET(request: NextRequest) {
  const auth = isRequestAuthorized(request);
  if (!auth.ok) return auth.response;

  const db = await getDb();
  // Check schema status -- db.execute returns a RowList (array-like)
  const enumCheck = await db.execute(
    sql`SELECT 1 as ok FROM pg_type WHERE typname = 'fulfillment_status'`
  );
  const fulfillmentCol = await db.execute(
    sql`SELECT 1 as ok FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'fulfillment'`
  );
  const loadedCol = await db.execute(
    sql`SELECT 1 as ok FROM information_schema.columns WHERE table_name = 'transaction_items' AND column_name = 'loaded_qty'`
  );
  const idxCheck = await db.execute(
    sql`SELECT 1 as ok FROM pg_indexes WHERE tablename = 'transactions' AND indexname = 'idx_transactions_fulfillment'`
  );

  // Row counts
  const counts = await db.execute(sql`
    SELECT 'product_types' as tbl, COUNT(*)::int as cnt FROM product_types
    UNION ALL SELECT 'customers', COUNT(*)::int FROM customers
    UNION ALL SELECT 'customer_prices', COUNT(*)::int FROM customer_prices
    UNION ALL SELECT 'transactions', COUNT(*)::int FROM transactions
    UNION ALL SELECT 'transaction_items', COUNT(*)::int FROM transaction_items
    UNION ALL SELECT 'bag_ledger', COUNT(*)::int FROM bag_ledger
    UNION ALL SELECT 'users', COUNT(*)::int FROM users
  `);

  return NextResponse.json({
    schema: {
      fulfillment_status_enum: Array.from(enumCheck).length > 0,
      transactions_fulfillment_col: Array.from(fulfillmentCol).length > 0,
      transaction_items_loaded_qty_col: Array.from(loadedCol).length > 0,
      idx_transactions_fulfillment: Array.from(idxCheck).length > 0,
    },
    rowCounts: Array.from(counts),
  });
}, {
  source: "setup.route",
  operation: "GET /api/setup",
});

export const POST = withErrorHandler(async function POST(request: NextRequest) {
  const auth = isRequestAuthorized(request);
  if (!auth.ok) return auth.response;

  const action = request.nextUrl.searchParams.get("action");

  if (action === "schema") {
    const db = await getDb();
    const results: string[] = [];

    // 1. Create enum if missing
    const enumCheck = await db.execute(
      sql`SELECT 1 FROM pg_type WHERE typname = 'fulfillment_status'`
    );
    if (Array.from(enumCheck).length === 0) {
      await db.execute(sql`CREATE TYPE fulfillment_status AS ENUM ('pending', 'loaded')`);
      results.push("Created fulfillment_status enum");
    } else {
      results.push("fulfillment_status enum: already exists");
    }

    // 2. Add fulfillment column if missing
    const fulfillmentCol = await db.execute(
      sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'transactions' AND column_name = 'fulfillment'`
    );
    if (Array.from(fulfillmentCol).length === 0) {
      await db.execute(sql`ALTER TABLE transactions ADD COLUMN fulfillment fulfillment_status`);
      results.push("Added fulfillment column");
    } else {
      results.push("fulfillment column: already exists");
    }

    // 3. Add loaded_qty column if missing
    const loadedCol = await db.execute(
      sql`SELECT 1 FROM information_schema.columns WHERE table_name = 'transaction_items' AND column_name = 'loaded_qty'`
    );
    if (Array.from(loadedCol).length === 0) {
      await db.execute(
        sql`ALTER TABLE transaction_items ADD COLUMN loaded_qty double precision NOT NULL DEFAULT 0`
      );
      results.push("Added loaded_qty column");
    } else {
      results.push("loaded_qty column: already exists");
    }

    // 4. Create index if missing
    const idxCheck = await db.execute(
      sql`SELECT 1 FROM pg_indexes WHERE tablename = 'transactions' AND indexname = 'idx_transactions_fulfillment'`
    );
    if (Array.from(idxCheck).length === 0) {
      await db.execute(
        sql`CREATE INDEX idx_transactions_fulfillment ON transactions (fulfillment)`
      );
      results.push("Created idx_transactions_fulfillment index");
    } else {
      results.push("idx_transactions_fulfillment: already exists");
    }

    return NextResponse.json({ success: true, results });
  }

  return NextResponse.json({ error: "Unknown action. Use ?action=schema" }, { status: 400 });
}, {
  source: "setup.route",
  operation: "POST /api/setup",
  context: (request) => ({
    action: request.nextUrl.searchParams.get("action") || null,
  }),
});
