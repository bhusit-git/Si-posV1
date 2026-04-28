# Schema Comparison: Access (.mdb) vs PostgreSQL (Current)

**Last updated:** 2026-03-02  
**Scope:** Current app schema in `src/db/schema.ts` and migration bootstrap scripts.

## Overview

| Area | Access (legacy) | PostgreSQL (current) |
|---|---|---|
| Engine | Single `.mdb` file per factory | PostgreSQL (one DB per factory in current deployment) |
| Table count | 4 core tables (`TransTable`, `CustomerTable`, `PasswordTable`, `OthTable`) | 16 tables |
| Transaction model | Flat row with hardcoded product columns | Header (`transactions`) + lines (`transaction_items`) |
| Product model | Product types as columns | Dynamic `product_types` rows |
| Bags | Running mutable balances on customer row | Immutable `bag_ledger` events |
| Transfer/Credit split | Heuristic from note/customer naming | Explicit `transaction_kind` + transfer metadata |
| Invoicing | Report-style only (no durable invoice records) | Persistent `invoices`, `invoice_lines`, `invoice_payments`, allocations |
| Import provenance | Not tracked | `source_*` + `import_batch_id` traceability |

## Current PostgreSQL Tables (16)

1. `product_types`
2. `customers`
3. `users`
4. `customer_prices`
5. `transactions`
6. `transaction_items`
7. `production_logs`
8. `bag_ledger`
9. `audit_log`
10. `import_batches`
11. `invoice_counters`
12. `invoices`
13. `invoice_lines`
14. `invoice_payments`
15. `invoice_payment_allocations`
16. `payment_events`

## Key Schema Upgrades vs Legacy

### Transactions

`transactions` now has explicit classification and accounting metadata:

- `transaction_kind`: `sale | transfer_out | return | adjustment`
- `outstanding_amount`
- `transfer_ref`, `transfer_destination`, `transfer_truck`
- `transfer_accounting_status`: `open | closed`
- `original_transaction_id` (return traceability)
- provenance fields: `source_system`, `source_factory`, `source_file`, `source_row_key`, `import_batch_id`

### Customers

`customers` now also carries provenance fields:

- `source_system`, `source_factory`, `source_file`, `source_row_key`, `import_batch_id`

### Invoice Persistence

New durable invoice lifecycle model:

- Header: `invoices` (`draft | issued | paid | void`)
- Item linkage: `invoice_lines`
- Payments: `invoice_payments`
- Allocation map: `invoice_payment_allocations`
- Statement-grade payment history: `payment_events`
- Numbering sequence support: `invoice_counters`

### Import Provenance

`import_batches` stores batch-level metadata and row/error counts. Imported rows can be traced by source file and source row key.

## Access-to-Postgres Mapping (High-Level)

### `TransTable` ->

- `transactions` (header amounts/date/status/classification)
- `transaction_items` (product quantity/price lines)
- `bag_ledger` (bag movement events)

### `CustomerTable` ->

- `customers` (identity/contact/credit)
- `customer_prices` (per-product unit + bag deposit pricing)
- `bag_ledger` (opening bag adjustments)

### `PasswordTable` ->

- `users` (role-based users; app runtime uses hashed passwords)

### `OthTable` ->

- represented through dynamic product definitions (`product_types`) and dry-good product IDs.

## Notes for Migration Compatibility

- Scripts and bootstrap endpoints are idempotent (`IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).
- Old databases can still be loaded, with new fields defaulted/backfilled.
- Legacy transfer heuristics can still be interpreted, but explicit `transaction_kind` is now the target source of truth.
