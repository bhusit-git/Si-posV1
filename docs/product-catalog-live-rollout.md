# Product Catalog Taxonomy Live Rollout

**Last updated:** 2026-04-12

## Purpose

This runbook explains how the product taxonomy rollout was implemented, why the local
fix required direct per-factory cleanup, and how to deploy the same change safely to
live.

This rollout adds taxonomy metadata to `product_types`:

- `family` (`หมวด`)
- `form`
- `package_type` (`บรรจุภัณฑ์`)
- `size_value`
- `size_unit`
- `size_label` (`ขนาด`)

It also standardizes the active ice catalog to the canonical product IDs `1-21`,
keeps internal IDs stable, inserts the new rows `19`, `20`, `21`, and deactivates
legacy and duplicate non-canonical rows.

## Source Of Truth

The canonical product seed lives in:

- [src/lib/product-definitions.ts](../src/lib/product-definitions.ts)

The schema fields live in:

- [src/shared/db/schema/index.ts](../src/shared/db/schema/index.ts)

The product API accepts and persists the taxonomy fields via:

- [src/app/api/products/route.ts](../src/app/api/products/route.ts)

The product admin UI displays the seeded fields via:

- [src/app/(dashboard)/products/page.tsx](../src/app/(dashboard)/products/page.tsx)

The bootstrap/import paths that already include the taxonomy seed are:

- [src/lib/migrate/actions-bootstrap.ts](../src/lib/migrate/actions-bootstrap.ts)
- [scripts/migrate-from-mdb.ts](../scripts/migrate-from-mdb.ts)
- [scripts/migrate-to-pg.ts](../scripts/migrate-to-pg.ts)

## What Was Actually Done

The local fix had two parts:

1. Code changes:
- Added the new taxonomy columns to the `product_types` schema.
- Added the taxonomy fields to the product API and admin UI.
- Updated the canonical `NEW_ICE_PRODUCTS` seed to include `หมวด`, `บรรจุภัณฑ์`,
  and `ขนาด`.
- Updated bootstrap/import scripts so fresh or reimported databases get the new
  catalog automatically.

2. One-time data cleanup in the active factory databases:
- Upserted the canonical product rows `1-21`.
- Added/updated taxonomy values for each active product.
- Deactivated legacy rows `91-96`.
- Deactivated duplicate non-canonical rows whose names matched canonical products.
  In local, this caught duplicate row `98` for `ซอง (ครึ่ง)`.

## Important Deployment Caveat

The current default migration is **not enough** by itself for existing live factory
databases.

Why:

- `POST /api/migrate` with no `action` uses `default-migration`.
- In current code, `default-migration` targets the central `DATABASE_URL`.
- Existing live product catalogs live in the per-factory databases:
  - `DATABASE_URL_SI`
  - `DATABASE_URL_BEARING`
  - `DATABASE_URL_KTK`

That means:

- New factory DB bootstrap/import flows are already covered.
- Existing live factory DBs still need a one-time per-factory rollout.

## Dev-First Remote Rollout

For the Render dev service, use a scoped schema push plus the new factory-scoped
`/api/migrate` actions instead of relying on `default-migration`.

### Scoped schema push

`build:deploy` still runs `npm run db:push`, but `scripts/push-schema.ts` now accepts
`SCHEMA_PUSH_TARGETS` as a comma-separated allowlist of env var names.

Example for SI-only dev rollout:

```env
SCHEMA_PUSH_TARGETS=DATABASE_URL,DATABASE_URL_SI
```

If `SCHEMA_PUSH_TARGETS` is omitted, schema push keeps the previous behavior and
targets every configured `DATABASE_URL*`.

### New additive migrate actions

After deploy, run these against the intended factory database:

- `GET /api/migrate?action=check-products&factory=si`
- `POST /api/migrate?action=rollout-product-taxonomy&factory=si`
- `POST /api/migrate?action=seed-bill-counter&factory=si`

`rollout-product-taxonomy` is idempotent and:

- ensures taxonomy columns exist on `product_types`
- upserts canonical product IDs `1-21`
- deactivates legacy rows `91-96`
- deactivates duplicate non-canonical rows whose names match canonical products
- returns verification counts for taxonomy coverage and duplicate active names

`seed-bill-counter` is idempotent and:

- requires an explicit `nextNumber` in the JSON body
- validates `0-9999`
- ensures `bill_counters` exists
- upserts the target factory row in `bill_counters`

Example request body:

```json
{
  "nextNumber": 1234
}
```

## Recommended Live Rollout Strategy

1. Deploy the application code first.
This ensures the schema, API, UI, and bootstrap scripts all understand the new
taxonomy fields.

2. Take a DB backup of each live factory database before touching `product_types`.

3. Run the one-time catalog rollout SQL against each target live factory DB.

4. Verify the result in SQL.

5. Verify the product page in the app.

## One-Time SQL Rollout For Existing Live Factory DBs

Run the following SQL **once per live factory database**.

It is safe to re-run because it uses:

- `ADD COLUMN IF NOT EXISTS`
- `INSERT ... ON CONFLICT (id) DO UPDATE`

```sql
ALTER TABLE product_types ADD COLUMN IF NOT EXISTS family text;
ALTER TABLE product_types ADD COLUMN IF NOT EXISTS form text;
ALTER TABLE product_types ADD COLUMN IF NOT EXISTS package_type text;
ALTER TABLE product_types ADD COLUMN IF NOT EXISTS size_value integer;
ALTER TABLE product_types ADD COLUMN IF NOT EXISTS size_unit text;
ALTER TABLE product_types ADD COLUMN IF NOT EXISTS size_label text;

WITH canonical(id, name, name_en, has_bag, decreases_bag, is_active, sort_order, family, form, package_type, size_value, size_unit, size_label) AS (
  VALUES
    (1, 'ซอง', 'Block', false, false, true, 1, 'block', 'standard', 'loose', 160, 'piece', '160 ก้อน'),
    (2, 'ซอง (กั๊ก)', 'Small Block', false, false, true, 3, 'block', 'standard', 'loose', 13, 'piece', '13 ก้อน'),
    (3, 'ซอง โม่', 'Crushed Block', true, false, true, 4, 'block', 'crushed', 'returnable_bag', 20, 'kg', '20 กก.'),
    (4, 'หลอดใหญ่ โม่', 'Crushed Large Tube', true, false, true, 9, 'large_tube', 'crushed', 'returnable_bag', 20, 'kg', '20 กก.'),
    (5, 'หลอดดล็ก โม่', 'Crushed Small Tube', true, false, true, 14, 'small_tube', 'crushed', 'returnable_bag', 20, 'kg', '20 กก.'),
    (6, 'หลอดใหญ่ 20กก.', 'Large Tube 20kg', true, false, true, 7, 'large_tube', 'standard', 'returnable_bag', 20, 'kg', '20 กก.'),
    (7, 'หลอดดล็ก 20กก.', 'Small Tube 20kg', true, false, true, 13, 'small_tube', 'standard', 'returnable_bag', 20, 'kg', '20 กก.'),
    (8, 'แพ็ค 15', 'Pack 15', true, false, false, 99, 'large_tube', 'standard', 'returnable_bag', 15, 'kg', '15 กก.'),
    (9, 'แพ็ค 20', 'Pack 20', true, false, true, 10, 'large_tube', 'standard', 'returnable_bag', 20, 'kg', '20 กก.'),
    (10, 'ถุงใสป่น 20กก.', 'Crushed Clear Bag 20kg', false, false, true, 6, 'block', 'crushed', 'clear_bag', 20, 'kg', '20 กก.'),
    (11, 'ถุงใสป่น 13กก.', 'Crushed Clear Bag 13kg', false, false, true, 5, 'block', 'crushed', 'clear_bag', 13, 'kg', '13 กก.'),
    (12, 'ถุงใสหลอดเล็ก 13กก.', 'Small Tube Clear Bag 13kg', false, false, true, 16, 'small_tube', 'standard', 'clear_bag', 13, 'kg', '13 กก.'),
    (13, 'ถุงใสหลอดเล็ก 20กก.', 'Small Tube Clear Bag 20kg', false, false, true, 17, 'small_tube', 'standard', 'clear_bag', 20, 'kg', '20 กก.'),
    (14, 'ถุงใสหลอดใหญ่ 13กก.', 'Large Tube Clear Bag 13kg', false, false, true, 11, 'large_tube', 'standard', 'clear_bag', 13, 'kg', '13 กก.'),
    (15, 'ถุงใสหลอดใหญ่ 20กก.', 'Large Tube Clear Bag 20kg', false, false, true, 12, 'large_tube', 'standard', 'clear_bag', 20, 'kg', '20 กก.'),
    (16, 'Iceberg 1กก.ตะกร้า 20 ถุง', 'Iceberg Basket', false, false, true, 18, 'iceberg', 'standard', 'basket', 20, 'basket', '1 กก. x 20 ถุง'),
    (17, 'Iceberg ถุงฟ้า 1.5 นิ้ว 10กก.', 'Iceberg Blue Bag 1.5''', false, false, true, 19, 'iceberg', 'standard', 'clear_bag', 10, 'kg', '10 กก.'),
    (18, 'Iceberg ถุงชมพู 1.3 นิ้ว 10กก.', 'Iceberg Pink Bag 1.3''', false, false, true, 20, 'iceberg', 'standard', 'clear_bag', 10, 'kg', '10 กก.'),
    (19, 'ซอง (ครึ่ง)', 'Half-Block', false, false, true, 2, 'block', 'standard', 'loose', 80, 'piece', '80 ก้อน'),
    (20, 'หลอดใหญ่ 30kg', 'Large Tube 30kg', true, false, true, 8, 'large_tube', 'standard', 'returnable_bag', 30, 'kg', '30 กก.'),
    (21, 'แพ็ค 10', 'Pack 10', true, false, true, 15, 'small_tube', 'standard', 'returnable_bag', 10, 'kg', '10 กก.')
)
INSERT INTO product_types (
  id, name, name_en, has_bag, decreases_bag, is_active, sort_order,
  family, form, package_type, size_value, size_unit, size_label
)
SELECT
  id, name, name_en, has_bag, decreases_bag, is_active, sort_order,
  family, form, package_type, size_value, size_unit, size_label
FROM canonical
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  name_en = EXCLUDED.name_en,
  has_bag = EXCLUDED.has_bag,
  decreases_bag = EXCLUDED.decreases_bag,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  family = EXCLUDED.family,
  form = EXCLUDED.form,
  package_type = EXCLUDED.package_type,
  size_value = EXCLUDED.size_value,
  size_unit = EXCLUDED.size_unit,
  size_label = EXCLUDED.size_label;

UPDATE product_types
SET is_active = false,
    sort_order = 900 + id
WHERE id BETWEEN 91 AND 96;

UPDATE product_types p
SET is_active = false,
    sort_order = COALESCE(sort_order, 900) + 1000
WHERE p.id NOT BETWEEN 1 AND 21
  AND EXISTS (
    SELECT 1
    FROM product_types c
    WHERE c.id BETWEEN 1 AND 21
      AND c.name = p.name
  );
```

## Verification Queries

Run these after the rollout on each factory DB.

### 1. Confirm the canonical active catalog

```sql
SELECT
  id,
  sort_order,
  name,
  family,
  package_type,
  size_label,
  has_bag,
  is_active
FROM product_types
WHERE id BETWEEN 1 AND 21
ORDER BY sort_order, id;
```

Expected high-level results:

- `1-21` exist
- `19`, `20`, `21` exist
- `8` (`แพ็ค 15`) is inactive
- active rows show populated `family`, `package_type`, and `size_label`

### 2. Confirm there are no duplicate active product names

```sql
SELECT
  name,
  array_agg(id ORDER BY id) AS ids,
  count(*)
FROM product_types
WHERE is_active = true
GROUP BY name
HAVING count(*) > 1
ORDER BY name;
```

Expected result: `0 rows`

### 3. Confirm legacy rows are inactive

```sql
SELECT id, name, is_active, sort_order
FROM product_types
WHERE id BETWEEN 91 AND 96
ORDER BY id;
```

Expected result:

- all rows inactive
- sort order moved to `900 + id`

## Seed Reference: หมวด / บรรจุภัณฑ์ / ขนาด

This is the canonical seed used by the code and by the SQL rollout above.

| ID | ชื่อสินค้า | หมวด | บรรจุภัณฑ์ | ขนาด | มีถุง | ใช้งาน |
|---:|---|---|---|---|---|---|
| 1 | ซอง | block | loose | 160 ก้อน | no | yes |
| 19 | ซอง (ครึ่ง) | block | loose | 80 ก้อน | no | yes |
| 2 | ซอง (กั๊ก) | block | loose | 13 ก้อน | no | yes |
| 3 | ซอง โม่ | block | returnable_bag | 20 กก. | yes | yes |
| 11 | ถุงใสป่น 13กก. | block | clear_bag | 13 กก. | no | yes |
| 10 | ถุงใสป่น 20กก. | block | clear_bag | 20 กก. | no | yes |
| 6 | หลอดใหญ่ 20กก. | large_tube | returnable_bag | 20 กก. | yes | yes |
| 20 | หลอดใหญ่ 30kg | large_tube | returnable_bag | 30 กก. | yes | yes |
| 4 | หลอดใหญ่ โม่ | large_tube | returnable_bag | 20 กก. | yes | yes |
| 9 | แพ็ค 20 | large_tube | returnable_bag | 20 กก. | yes | yes |
| 14 | ถุงใสหลอดใหญ่ 13กก. | large_tube | clear_bag | 13 กก. | no | yes |
| 15 | ถุงใสหลอดใหญ่ 20กก. | large_tube | clear_bag | 20 กก. | no | yes |
| 7 | หลอดดล็ก 20กก. | small_tube | returnable_bag | 20 กก. | yes | yes |
| 5 | หลอดดล็ก โม่ | small_tube | returnable_bag | 20 กก. | yes | yes |
| 21 | แพ็ค 10 | small_tube | returnable_bag | 10 กก. | yes | yes |
| 12 | ถุงใสหลอดเล็ก 13กก. | small_tube | clear_bag | 13 กก. | no | yes |
| 13 | ถุงใสหลอดเล็ก 20กก. | small_tube | clear_bag | 20 กก. | no | yes |
| 16 | Iceberg 1กก.ตะกร้า 20 ถุง | iceberg | basket | 1 กก. x 20 ถุง | no | yes |
| 17 | Iceberg ถุงฟ้า 1.5 นิ้ว 10กก. | iceberg | clear_bag | 10 กก. | no | yes |
| 18 | Iceberg ถุงชมพู 1.3 นิ้ว 10กก. | iceberg | clear_bag | 10 กก. | no | yes |
| 8 | แพ็ค 15 | large_tube | returnable_bag | 15 กก. | yes | no |

## Operational Notes

- `has_bag` remains the operational flag used by bag-tracking logic.
- `package_type` is taxonomy metadata for grouping/sorting/display.
- `size_label` is the UI-friendly display for `ขนาด`.
- Existing historical transactions remain intact because product IDs `1-18` were not
  renumbered.
- The cleanup intentionally deactivates legacy and duplicate rows instead of deleting
  them, so historical references remain safe.

## Recommended Future Improvement

If we want this rollout to be fully self-service for existing live factory DBs, add a
new factory-scoped migrate action dedicated to the product catalog taxonomy rollout.

Right now the implementation is correct, but the operational gap is that
`default-migration` only hits the central DB while the active product catalogs live in
the per-factory DBs.
