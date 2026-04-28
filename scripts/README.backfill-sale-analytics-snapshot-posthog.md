# Backfill `sale_analytics_snapshot` to PostHog

This script replays historical sales into the dedicated snapshot event used for bag analytics.

It sends:

- `items_count`
- `bags_out`
- `bags_returned`
- `bags_bought`
- the existing sale dimensions such as `sale_type`, `payment_status`, and `transaction_type`

Script path: `scripts/backfill-sale-analytics-snapshot-posthog.ts`

## 1) Safe dry-run (recommended first)

```bash
npm run backfill:sale-analytics-snapshot-posthog -- --dry-run --factory si --from 2026-03-27 --to 2026-03-31 --batch-size 300
```

Review the dry-run samples to confirm `items_count`, `bags_out`, `bags_returned`, and `bags_bought` look correct before any live send.

## 2) Live run on Render (recommended)

Run inside the `superice-pos` Render shell so production env vars are already loaded.

```bash
npm run backfill:sale-analytics-snapshot-posthog -- --factory all --batch-size 500
```

For larger history windows, use safer network settings:

```bash
npm run backfill:sale-analytics-snapshot-posthog -- \
  --factory all \
  --batch-size 300 \
  --posthog-flush-at 50 \
  --posthog-request-timeout-ms 8000 \
  --posthog-fetch-retries 2 \
  --posthog-shutdown-timeout-ms 15000
```

## 3) Live run from local machine against Render DBs

Export the same env vars used by the existing PostHog backfill scripts:

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
npm run backfill:sale-analytics-snapshot-posthog -- --factory all --batch-size 500
```

## Notes

- This does not mutate old `sale_completed` rows. It emits historical `sale_analytics_snapshot` events instead.
- Use `sale_analytics_snapshot` for bag-focused insights so historical replays do not double-count `sale_completed`.
- Events are sent with deterministic UUIDs:
  - `sale_analytics_snapshot-${factory}-${transactionId}`
  - This makes reruns safer from duplicate inserts.
