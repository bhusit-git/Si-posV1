# Factory Database Setup (Current)

**Last updated:** 2026-03-02

## Environment Variables

Add to `.env.local`:

```bash
DATABASE_URL_SI=postgresql://user:pass@localhost:5432/superice_si
DATABASE_URL_BEARING=postgresql://user:pass@localhost:5432/superice_bearing
DATABASE_URL_KTK=postgresql://user:pass@localhost:5432/superice_ktk
```

The app runs per-factory database mode when these are set.

## Current Migration/Bootstrap Paths

1. **Schema bootstrap (factory DB):** `POST /api/migrate?action=init-factory&factory=<si|bearing|ktk>`
2. **Bulk upload helper (table-by-table):** `POST /api/migrate?action=upload&factory=<...>`
3. **Sequence repair after imports:** `POST /api/migrate?action=reset-sequences&factory=<...>`
4. **Direct MDB import script:** `npx tsx scripts/migrate-from-mdb.ts <path-to-mdb> <factory-key>`

## Window Migration to Render (Any Date Range)

Use the windowed script first in dry-run mode (set your own dates):

```bash
START_DATE=YYYY-MM-DD END_DATE=YYYY-MM-DD FACTORY=si DRY_RUN=1 \
npx tsx scripts/migrate-mdb-to-render-window.ts "/Users/win/AI/superice sale/extracted/โปรแกรมขายน้ำแข็ง SI.mdb"
```

Live run after validation (transactions-only overwrite):

```bash
START_DATE=YYYY-MM-DD END_DATE=YYYY-MM-DD FACTORY=si DRY_RUN=0 \
TRANSACTIONS_ONLY=1 \
OVERWRITE=1 \
OVERWRITE_SCOPE=window \
MIGRATE_KEY="..." RENDER_URL="https://superice-pos.onrender.com" \
npx tsx scripts/migrate-mdb-to-render-window.ts "/Users/win/AI/superice sale/extracted/โปรแกรมขายน้ำแข็ง SI.mdb"
```

Example (February 2026):

```bash
START_DATE=2026-02-01 END_DATE=2026-02-28 FACTORY=si DRY_RUN=0 \
TRANSACTIONS_ONLY=1 \
OVERWRITE=1 \
OVERWRITE_SCOPE=window \
MIGRATE_KEY="..." RENDER_URL="https://superice-pos.onrender.com" \
npx tsx scripts/migrate-mdb-to-render-window.ts "/Users/win/AI/superice sale/extracted/โปรแกรมขายน้ำแข็ง SI.mdb"
```

Notes:
- The migration endpoint must be enabled in production (`MIGRATE_ENABLED=true`) before live run.
- Script uses `Authorization: Bearer <MIGRATE_KEY>` (not `?key=` query auth).
- Default ID offsets are high to reduce collisions on non-empty targets. Set `ID_OFFSET_BASE=0` only when target is empty and you want original-style low IDs.
- `OVERWRITE=1` calls `POST /api/migrate?action=wipe-factory-data&factory=<...>&confirm=WIPE_FACTORY_DATA` before upload.
- `TRANSACTIONS_ONLY=1` uploads only `transactions` and `transaction_items`, preserving existing `product_types`, `customers`, `customer_prices`, and `bag_ledger` master/opening data.
- With `TRANSACTIONS_ONLY=1` + `OVERWRITE=1` + `OVERWRITE_SCOPE=window`, script wipes only selected date range via:
  `POST /api/migrate?action=wipe-transactions-window&factory=<...>&startDate=<YYYY-MM-DD>&endDate=<YYYY-MM-DD>&confirm=WIPE_TRANSACTIONS_WINDOW`
- With `TRANSACTIONS_ONLY=1` + `OVERWRITE=1` + `OVERWRITE_SCOPE=all`, script wipes all transactions via:
  `POST /api/migrate?action=wipe-transactions-data&factory=<...>&confirm=WIPE_TRANSACTIONS_DATA`

## SI-Only Local Migration (Recommended for your current request)

Run only against SI DB:

```bash
npx tsx scripts/migrate-from-mdb.ts "/Users/win/AI/superice sale/SI.mdb" si
```

What it now does:

1. Creates/aligns schema to current tables/enums (including invoice + provenance tables).
2. Truncates SI data and reseeds product types.
3. Creates an `import_batches` record.
4. Imports customers with `source_*` provenance fields.
5. Imports transactions with:
   - `outstanding_amount`
   - `transaction_kind`
   - transfer metadata parsed from `XFER|...` notes
   - `source_*` + `import_batch_id`
6. Imports line items and seeds users.
7. Finalizes import batch row counts.

## Post-Migration Checks

After SI migration:

1. Run schema sync check/build:
```bash
npm run db:push --prefix superice-pos
npm run build:local --prefix superice-pos
```
2. Validate data counts and kinds:
```bash
npx tsx scripts/freeze-baseline.ts si
npx tsx scripts/backfill-transaction-kind.ts
```
3. Verify app pages:
- `/daily-ledger` still loads
- `/invoice` preview returns rows
- transfer list excludes normal credit bills

## Important Compatibility Notes

- Existing per-factory DB topology remains unchanged.
- Legacy imports from different factory Access formats are still supported via additive schema + provenance fields.
- New invoice tables are additive and do not break legacy print/export routes in this phase.

## Related Runbooks

- Product taxonomy and live catalog rollout:
  [docs/product-catalog-live-rollout.md](./product-catalog-live-rollout.md)
