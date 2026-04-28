# Multi-Factory Integration Plan (Current State)

**Last updated:** 2026-03-02

## Status

The active architecture is **one app + separate PostgreSQL database per factory**.

- SI -> `DATABASE_URL_SI`
- Bearing -> `DATABASE_URL_BEARING`
- KTK -> `DATABASE_URL_KTK`

This document replaces the older single-database `factory_id` proposal.

## Design Goals

1. Keep each factory isolated operationally.
2. Allow loading heterogeneous legacy Access files per factory.
3. Keep schema compatible across all factory DBs.
4. Preserve legacy routes while introducing new invoice persistence.

## Current Compatibility Strategy

### 1) Unified Schema, Per-Factory DB

Every factory DB must contain the same current tables/enums:

- transaction classification enums and columns
- provenance columns (`source_*`, `import_batch_id`)
- invoice lifecycle tables (`invoices`, lines, payments, allocations)
- `payment_events` for payment history

### 2) Import Provenance + Idempotency

Imported rows store origin info:

- `source_system`
- `source_factory`
- `source_file`
- `source_row_key`
- `import_batch_id`

`import_batches` records each migration/import run.

### 3) Legacy Format Variants

For old Access variants, normalize into canonical fields during import:

- customer identity/credit fields -> `customers`
- product/price fields -> `customer_prices` + `transaction_items`
- transaction metadata -> `transactions`
- transfer hints in note (`XFER|...`) -> transfer columns and `transaction_kind`

### 4) Behavior Separation Rules

- Transfer rows: `transaction_kind='transfer_out'`
- Credit and outstanding reports: exclude transfer rows unless explicitly requested
- Invoicing workspace: includes bill types by user checkbox filters

## Operational Rollout

1. Apply schema alignment on all factory DBs (`init-factory` or `db:push`).
2. Run factory import/backfill per DB.
3. Validate parity and totals per factory.
4. Switch reads to explicit `transaction_kind`.
5. Keep `/daily-ledger` stable and legacy print/export unchanged during this phase.

## Historical Note

The previous single-DB `factory_id` document was planning-only and is not the active deployment model.
