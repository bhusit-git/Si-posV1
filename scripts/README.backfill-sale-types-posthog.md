# Backfill `sale_type` to PostHog

This script re-emits historical sale events with:

- `sale_type`: `cash` | `short_term_credit` | `long_term_credit`
- `sale_type_th`: `เงินสด` | `ค้าง` | `เครดิต`

Script path: `scripts/backfill-sale-types-posthog.ts`

## 1) Safe dry-run (recommended first)

```bash
npm run backfill:sale-types-posthog -- --dry-run --factory all --from 2026-03-01 --to 2026-03-31 --batch-size 500
```

## 2) Live run on Render (recommended)

Run inside the **Render shell** for `superice-pos` so production env vars are already loaded.

```bash
npm run backfill:sale-types-posthog -- --factory all --batch-size 500
```

For very large history windows, use safer network settings:

```bash
npm run backfill:sale-types-posthog -- \
  --factory all \
  --batch-size 300 \
  --posthog-flush-at 50 \
  --posthog-request-timeout-ms 8000 \
  --posthog-fetch-retries 2 \
  --posthog-shutdown-timeout-ms 15000
```

## 3) Live run from local machine against Render DBs

If running from local, export Render DB env vars first (values from Render dashboard):

```bash
export DATABASE_URL='...'
export DATABASE_URL_SI='...'
export DATABASE_URL_BEARING='...'
export DATABASE_URL_KTK='...'
export NEXT_PUBLIC_POSTHOG_KEY='...'
export NEXT_PUBLIC_POSTHOG_HOST='https://us.i.posthog.com'
```

Then run:

```bash
npm run backfill:sale-types-posthog -- --factory all --batch-size 500
```

## Notes

- The script performs a PostHog connectivity pre-check for live runs.
- Use `--skip-posthog-check` only if you are certain network is stable.
- Events are sent with deterministic UUIDs:
  - `${eventName}-backfill-${factory}-${transactionId}`
  - This makes reruns safer from duplicate inserts.
