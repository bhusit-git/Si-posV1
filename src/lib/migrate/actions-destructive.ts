import type { MigrateActionContext, MigrateActionResult, UnsafeExecutor } from "./types";
import {
  getConfiguredFactoryConnection,
  isIsoDate,
  isIsoTime,
} from "./shared";

export async function runWipeFactoryDataAction(
  context: MigrateActionContext
): Promise<MigrateActionResult> {
  const factoryKey = context.factoryKey;
  if (!factoryKey) return { status: 400, body: { error: "Missing ?factory= parameter" } };
  const connection = getConfiguredFactoryConnection(factoryKey);
  if (!connection) return { status: 400, body: { error: `No DB configured for factory '${factoryKey}'` } };

  const wipeOrder = [
    "idempotency_keys",
    "payment_events",
    "invoice_payment_allocations",
    "invoice_payments",
    "invoice_lines",
    "invoices",
    "invoice_counters",
    "transaction_items",
    "bag_ledger",
    "production_logs",
    "customer_prices",
    "transactions",
    "customers",
    "product_types",
    "import_batches",
  ];

  try {
    const pg = (await import("postgres")).default;
    const fSql = pg(connection.url, { max: 1, connect_timeout: 15 });
    const existingRows = await fSql`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = ANY(${wipeOrder})
    `;
    const existingSet = new Set(Array.from(existingRows).map((r) => String(r.tablename)));
    const existing = wipeOrder.filter((t) => existingSet.has(t));
    if (existing.length > 0) {
      const truncateSql = `TRUNCATE TABLE ${existing.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`;
      await fSql.unsafe(truncateSql);
    }
    const counts: Record<string, number> = {};
    for (const t of existing) {
      const [row] = await fSql`SELECT COUNT(*)::int as cnt FROM ${fSql(t)}`;
      counts[t] = Number(row.cnt);
    }
    await fSql.end();
    return {
      body: { success: true, factory: factoryKey, wipedTables: existing, postWipeCounts: counts },
      auditSummary: { factoryKey, wipedTables: existing, mode: "factory" },
    };
  } catch (error) {
    return { status: 500, body: { error: String(error) } };
  }
}

export async function runWipeTransactionsDataAction(
  context: MigrateActionContext
): Promise<MigrateActionResult> {
  const factoryKey = context.factoryKey;
  if (!factoryKey) return { status: 400, body: { error: "Missing ?factory= parameter" } };
  const connection = getConfiguredFactoryConnection(factoryKey);
  if (!connection) return { status: 400, body: { error: `No DB configured for factory '${factoryKey}'` } };

  try {
    const pg = (await import("postgres")).default;
    const fSql = pg(connection.url, { max: 1, connect_timeout: 15 });
    const statements = [
      "DELETE FROM idempotency_keys",
      "DELETE FROM payment_events",
      "DELETE FROM invoice_payment_allocations",
      "DELETE FROM invoice_payments",
      "DELETE FROM invoice_lines",
      "DELETE FROM invoices",
      "DELETE FROM bag_ledger WHERE transaction_id IS NOT NULL",
      "DELETE FROM transaction_items",
      "DELETE FROM transactions",
    ];
    const results: string[] = [];
    for (const stmt of statements) {
      try {
        const r = await fSql.unsafe(stmt);
        results.push(`${stmt}: ${r.count ?? 0}`);
      } catch (e) {
        results.push(`${stmt}: ERROR ${String(e).slice(0, 120)}`);
        await fSql.end();
        return { status: 500, body: { error: "wipe-transactions-data failed", results } };
      }
    }
    const postCounts: Record<string, number> = {};
    for (const t of [
      "transactions",
      "transaction_items",
      "bag_ledger",
      "invoices",
      "invoice_lines",
      "invoice_payments",
      "invoice_payment_allocations",
      "payment_events",
      "idempotency_keys",
    ]) {
      const [row] = await fSql`SELECT COUNT(*)::int as cnt FROM ${fSql(t)}`;
      postCounts[t] = Number(row.cnt);
    }
    await fSql.end();
    return {
      body: {
        success: true,
        factory: factoryKey,
        mode: "transactions_only",
        results,
        postCounts,
      },
      auditSummary: { factoryKey, mode: "transactions_only", resultCount: results.length },
    };
  } catch (error) {
    return { status: 500, body: { error: String(error) } };
  }
}

export async function runWipeTransactionsWindowAction(
  context: MigrateActionContext
): Promise<MigrateActionResult> {
  const factoryKey = context.factoryKey;
  if (!factoryKey) return { status: 400, body: { error: "Missing ?factory= parameter" } };
  const startDate = context.request.nextUrl.searchParams.get("startDate");
  const endDate = context.request.nextUrl.searchParams.get("endDate");
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
    return {
      status: 400,
      body: { error: "Missing or invalid ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD" },
    };
  }
  const connection = getConfiguredFactoryConnection(factoryKey);
  if (!connection) return { status: 400, body: { error: `No DB configured for factory '${factoryKey}'` } };

  try {
    const pg = (await import("postgres")).default;
    const fSql = pg(connection.url, { max: 1, connect_timeout: 15 });
    const txResult = await fSql.begin(async (tx) => {
      const targetRows = await tx.unsafe(
        `SELECT COUNT(*)::int as cnt FROM transactions WHERE sale_date >= $1 AND sale_date <= $2`,
        [startDate, endDate]
      );
      const targetRow = Array.isArray(targetRows) ? targetRows[0] : undefined;
      const results: string[] = [];
      const runDelete = async (label: string, statement: Promise<{ count?: number | null }>) => {
        const r = await statement;
        results.push(`${label}: ${r.count ?? 0}`);
      };
      await runDelete("invoice_payment_allocations", tx.unsafe(`DELETE FROM invoice_payment_allocations WHERE transaction_id IN (SELECT id FROM transactions WHERE sale_date >= $1 AND sale_date <= $2)`, [startDate, endDate]));
      await runDelete("payment_events", tx.unsafe(`DELETE FROM payment_events WHERE transaction_id IN (SELECT id FROM transactions WHERE sale_date >= $1 AND sale_date <= $2)`, [startDate, endDate]));
      await runDelete("audit_findings", tx.unsafe(`DELETE FROM audit_findings WHERE transaction_id IN (SELECT id FROM transactions WHERE sale_date >= $1 AND sale_date <= $2)`, [startDate, endDate]));
      await runDelete("invoice_lines", tx.unsafe(`DELETE FROM invoice_lines WHERE transaction_id IN (SELECT id FROM transactions WHERE sale_date >= $1 AND sale_date <= $2)`, [startDate, endDate]));
      await runDelete("bag_ledger", tx.unsafe(`DELETE FROM bag_ledger WHERE transaction_id IN (SELECT id FROM transactions WHERE sale_date >= $1 AND sale_date <= $2)`, [startDate, endDate]));
      await runDelete("transaction_items", tx.unsafe(`DELETE FROM transaction_items WHERE transaction_id IN (SELECT id FROM transactions WHERE sale_date >= $1 AND sale_date <= $2)`, [startDate, endDate]));
      await runDelete("transactions", tx.unsafe(`DELETE FROM transactions WHERE sale_date >= $1 AND sale_date <= $2`, [startDate, endDate]));
      const remainingRows = await tx.unsafe(
        `SELECT COUNT(*)::int as cnt FROM transactions WHERE sale_date >= $1 AND sale_date <= $2`,
        [startDate, endDate]
      );
      const remainingRow = Array.isArray(remainingRows) ? remainingRows[0] : undefined;
      return {
        targetTransactions: Number(targetRow?.cnt ?? 0),
        remainingTransactions: Number(remainingRow?.cnt ?? 0),
        results,
      };
    });
    const [txTotalRow] = await fSql`SELECT COUNT(*)::int as cnt FROM transactions`;
    const [itemTotalRow] = await fSql`SELECT COUNT(*)::int as cnt FROM transaction_items`;
    await fSql.end();
    return {
      body: {
        success: true,
        factory: factoryKey,
        mode: "transactions_window",
        startDate,
        endDate,
        targetTransactions: txResult.targetTransactions,
        remainingTransactionsInWindow: txResult.remainingTransactions,
        postCounts: {
          transactions: Number(txTotalRow?.cnt ?? 0),
          transaction_items: Number(itemTotalRow?.cnt ?? 0),
        },
        results: txResult.results,
      },
      auditSummary: {
        factoryKey,
        startDate,
        endDate,
        targetTransactions: txResult.targetTransactions,
      },
    };
  } catch (error) {
    return { status: 500, body: { error: String(error) } };
  }
}

export async function runCleanupLegacyItemsWindowAction(
  context: MigrateActionContext
): Promise<MigrateActionResult> {
  const factoryKey = context.factoryKey;
  if (!factoryKey) return { status: 400, body: { error: "Missing ?factory= parameter" } };
  const startDate = context.request.nextUrl.searchParams.get("startDate");
  const endDate = context.request.nextUrl.searchParams.get("endDate");
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || startDate > endDate) {
    return {
      status: 400,
      body: { error: "Missing or invalid ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD" },
    };
  }
  const startTime = context.request.nextUrl.searchParams.get("startTime") || "00:00:00";
  const endTime = context.request.nextUrl.searchParams.get("endTime") || "23:59:59";
  if (!isIsoTime(startTime) || !isIsoTime(endTime)) {
    return {
      status: 400,
      body: { error: "Missing or invalid ?startTime=HH:MM:SS&endTime=HH:MM:SS" },
    };
  }

  const includeVoided = context.request.nextUrl.searchParams.get("includeVoided") === "1";
  const dryRun = context.dryRunRequested;
  const legacyIdsRaw = context.request.nextUrl.searchParams.get("legacyIds");
  const legacyIds = legacyIdsRaw
    ? Array.from(
        new Set(
          legacyIdsRaw
            .split(",")
            .map((v) => Number.parseInt(v.trim(), 10))
            .filter((v) => Number.isFinite(v) && v > 0)
        )
      ).sort((a, b) => a - b)
    : [91, 92, 93, 94, 95, 96];
  if (legacyIds.length === 0) return { status: 400, body: { error: "No valid legacyIds provided" } };

  const connection = getConfiguredFactoryConnection(factoryKey);
  if (!connection) return { status: 400, body: { error: `No DB configured for factory '${factoryKey}'` } };

  const scopeWhere = `
    (
      t.sale_date > $1
      OR (t.sale_date = $1 AND COALESCE(t.sale_time, '00:00:00') >= $3)
    )
    AND (
      t.sale_date < $2
      OR (t.sale_date = $2 AND COALESCE(t.sale_time, '23:59:59') <= $4)
    )
    ${includeVoided ? "" : "AND t.status <> 'voided'"}
  `;

  try {
    const pg = (await import("postgres")).default;
    const fSql = pg(connection.url, { max: 1, connect_timeout: 15 });
    const scopeArgs: [string, string, string, string] = [startDate, endDate, startTime, endTime];
    const scopeLegacyArgs: [string, string, string, string, number[]] = [
      startDate,
      endDate,
      startTime,
      endTime,
      legacyIds,
    ];

    const summarize = async (executor: UnsafeExecutor) => {
      const [summaryRow] = await executor.unsafe(
        `
          WITH scoped AS (
            SELECT t.id, t.total_amount
            FROM transactions t
            WHERE ${scopeWhere}
          ),
          item_sums AS (
            SELECT
              s.id AS tx_id,
              COUNT(*) FILTER (WHERE ti.product_type_id = ANY($5::int[]))::int AS legacy_rows,
              COUNT(*) FILTER (WHERE ti.product_type_id <> ALL($5::int[]))::int AS nonlegacy_rows,
              COALESCE(SUM(ti.subtotal) FILTER (WHERE ti.product_type_id <> ALL($5::int[])), 0)::numeric AS nonlegacy_sum
            FROM scoped s
            LEFT JOIN transaction_items ti ON ti.transaction_id = s.id
            GROUP BY s.id
          )
          SELECT
            (SELECT COUNT(*)::int FROM scoped) AS scoped_transactions,
            (SELECT COALESCE(SUM(CASE WHEN i.legacy_rows > 0 THEN 1 ELSE 0 END), 0)::int FROM item_sums i) AS tx_with_legacy,
            (SELECT COALESCE(SUM(i.legacy_rows), 0)::int FROM item_sums i) AS legacy_item_rows,
            (SELECT COALESCE(SUM(CASE WHEN i.legacy_rows > 0 AND i.nonlegacy_rows = 0 THEN 1 ELSE 0 END), 0)::int FROM item_sums i) AS legacy_only_tx,
            (SELECT COALESCE(SUM(CASE WHEN i.legacy_rows > 0 AND i.nonlegacy_rows > 0 THEN 1 ELSE 0 END), 0)::int FROM item_sums i) AS mixed_tx,
            (
              SELECT COALESCE(SUM(CASE WHEN i.legacy_rows > 0 AND i.nonlegacy_rows > 0 AND ABS(COALESCE(s.total_amount, 0) - COALESCE(i.nonlegacy_sum, 0)) > 0.0001 THEN 1 ELSE 0 END), 0)::int
              FROM item_sums i
              JOIN scoped s ON s.id = i.tx_id
            ) AS mixed_total_mismatch
        `,
        scopeLegacyArgs
      );

      const deleteTxRows = await executor.unsafe(
        `
          WITH scoped AS (
            SELECT t.id
            FROM transactions t
            WHERE ${scopeWhere}
          )
          SELECT s.id
          FROM scoped s
          WHERE EXISTS (
            SELECT 1 FROM transaction_items ti
            WHERE ti.transaction_id = s.id
              AND ti.product_type_id = ANY($5::int[])
          )
          AND NOT EXISTS (
            SELECT 1 FROM transaction_items ti
            WHERE ti.transaction_id = s.id
              AND ti.product_type_id <> ALL($5::int[])
          )
          ORDER BY s.id
        `,
        scopeLegacyArgs
      );
      const deleteRows = deleteTxRows as ReadonlyArray<{ id: unknown }>;
      return {
        scopedTransactions: Number(summaryRow?.scoped_transactions ?? 0),
        txWithLegacy: Number(summaryRow?.tx_with_legacy ?? 0),
        legacyItemRows: Number(summaryRow?.legacy_item_rows ?? 0),
        legacyOnlyTransactions: Number(summaryRow?.legacy_only_tx ?? 0),
        mixedTransactions: Number(summaryRow?.mixed_tx ?? 0),
        mixedTotalMismatch: Number(summaryRow?.mixed_total_mismatch ?? 0),
        deleteTransactionIds: deleteRows.map((row) => Number(row.id)),
      };
    };

    if (dryRun) {
      const preview = await summarize(fSql as unknown as UnsafeExecutor);
      await fSql.end();
      return {
        body: {
          success: true,
          factory: factoryKey,
          mode: "cleanup_legacy_items_window",
          dryRun: true,
          startDate,
          endDate,
          startTime,
          endTime,
          includeVoided,
          legacyIds,
          preview,
        },
        auditSummary: {
          factoryKey,
          dryRun: true,
          preview,
        },
      };
    }

    const txResult = await fSql.begin(async (tx) => {
      const before = await summarize(tx as unknown as UnsafeExecutor);
      const results: string[] = [];
      const addResult = (label: string, count: number | undefined | null) => {
        results.push(`${label}: ${Number(count ?? 0)}`);
      };
      const deletedLegacyItems = await tx.unsafe(
        `
          DELETE FROM transaction_items ti
          USING transactions t
          WHERE ti.transaction_id = t.id
            AND ${scopeWhere}
            AND ti.product_type_id = ANY($5::int[])
        `,
        scopeLegacyArgs
      );
      addResult("transaction_items.legacy_deleted", deletedLegacyItems.count);

      const deleteEmptyScope = `
        WITH scoped AS (
          SELECT t.id
          FROM transactions t
          WHERE ${scopeWhere}
        ),
        empty_tx AS (
          SELECT s.id
          FROM scoped s
          LEFT JOIN transaction_items ti ON ti.transaction_id = s.id
          GROUP BY s.id
          HAVING COUNT(ti.id) = 0
        )
      `;
      const delAlloc = await tx.unsafe(
        `${deleteEmptyScope}
         DELETE FROM invoice_payment_allocations ipa
         USING empty_tx e
         WHERE ipa.transaction_id = e.id`,
        scopeArgs
      );
      addResult("invoice_payment_allocations.empty_tx_deleted", delAlloc.count);
      const delEvents = await tx.unsafe(
        `${deleteEmptyScope}
         DELETE FROM payment_events pe
         USING empty_tx e
         WHERE pe.transaction_id = e.id`,
        scopeArgs
      );
      addResult("payment_events.empty_tx_deleted", delEvents.count);
      const delLines = await tx.unsafe(
        `${deleteEmptyScope}
         DELETE FROM invoice_lines il
         USING empty_tx e
         WHERE il.transaction_id = e.id`,
        scopeArgs
      );
      addResult("invoice_lines.empty_tx_deleted", delLines.count);
      const delBag = await tx.unsafe(
        `${deleteEmptyScope}
         DELETE FROM bag_ledger bl
         USING empty_tx e
         WHERE bl.transaction_id = e.id`,
        scopeArgs
      );
      addResult("bag_ledger.empty_tx_deleted", delBag.count);
      const delTx = await tx.unsafe(
        `${deleteEmptyScope}
         DELETE FROM transactions t
         USING empty_tx e
         WHERE t.id = e.id`,
        scopeArgs
      );
      addResult("transactions.empty_tx_deleted", delTx.count);

      const after = await summarize(tx as unknown as UnsafeExecutor);
      return { before, after, results };
    });
    await fSql.end();
    return {
      body: {
        success: true,
        factory: factoryKey,
        mode: "cleanup_legacy_items_window",
        dryRun: false,
        startDate,
        endDate,
        startTime,
        endTime,
        includeVoided,
        legacyIds,
        before: txResult.before,
        after: txResult.after,
        results: txResult.results,
      },
      auditSummary: {
        factoryKey,
        dryRun: false,
        before: txResult.before,
        after: txResult.after,
      },
    };
  } catch (error) {
    return { status: 500, body: { error: String(error) } };
  }
}

export async function runResetSequencesAction(
  context: MigrateActionContext
): Promise<MigrateActionResult> {
  const factoryKey = context.factoryKey;
  if (!factoryKey) return { status: 400, body: { error: "Missing ?factory= parameter" } };
  const connection = getConfiguredFactoryConnection(factoryKey);
  if (!connection) return { status: 400, body: { error: `No DB configured for factory '${factoryKey}'` } };
  try {
    const pg = (await import("postgres")).default;
    const fSql = pg(connection.url, { max: 1, connect_timeout: 15 });
    const tables = [
      "product_types",
      "customers",
      "customer_prices",
      "transactions",
      "transaction_items",
      "bag_ledger",
      "production_logs",
      "audit_log",
      "audit_findings",
      "users",
      "import_batches",
      "invoice_counters",
      "invoices",
      "invoice_lines",
      "invoice_payments",
      "invoice_payment_allocations",
      "payment_events",
      "audit_findings",
      "idempotency_keys",
    ];
    const results: string[] = [];
    for (const t of tables) {
      try {
        const [row] = await fSql`SELECT COALESCE(MAX(id), 0) + 1 as next_val FROM ${fSql(t)}`;
        await fSql`SELECT setval(pg_get_serial_sequence(${t}, 'id'), ${row.next_val}, false)`;
        results.push(`${t}: next_id=${row.next_val}`);
      } catch (e) {
        results.push(`${t}: ${String(e).slice(0, 60)}`);
      }
    }
    const counts: Record<string, number> = {};
    for (const t of [
      "product_types",
      "customers",
      "customer_prices",
      "transactions",
      "transaction_items",
      "bag_ledger",
      "import_batches",
      "invoices",
      "invoice_lines",
      "invoice_payments",
      "payment_events",
      "audit_findings",
      "idempotency_keys",
    ]) {
      try {
        const [row] = await fSql`SELECT COUNT(*)::int as cnt FROM ${fSql(t)}`;
        counts[t] = Number(row.cnt);
      } catch {}
    }
    await fSql.end();
    return {
      body: { success: true, factory: factoryKey, sequences: results, counts },
      auditSummary: { factoryKey, repairedTables: results.length },
    };
  } catch (error) {
    return { status: 500, body: { error: String(error) } };
  }
}
