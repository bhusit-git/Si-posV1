# Bag Workflow Review (Current State)

This document captures how bag tracking works today in the app, based on code review of the current implementation.

## Current Sequence

1. Product setup (`products` page)
   - Admin sets `hasBag` per product.
   - This flag is the main trigger for bag tracking behavior.

2. Sale creation (`POST /api/transactions`)
   - Sale lines are saved to `transaction_items`.
   - For each sold item where `product.hasBag = true`, system auto-creates a `bag_ledger` entry:
     - `type = "out"`
     - `quantity = item.quantity`
   - If user enters bag returns in the sale form, system creates `bag_ledger` entries:
     - `type = "return"`
     - `quantity = bag return qty`

3. Return creation (`POST /api/returns`)
   - Product returns are saved as negative `transaction_items` quantities.
   - Bag returns are saved to `bag_ledger` with:
     - `type = "return"`

4. Void transaction (`PUT /api/transactions`, action = `void`)
   - Transaction is marked voided.
   - Existing bag ledger rows linked to that transaction are reversed:
     - `out -> return`
     - `return -> out`

5. Manual bag adjustment (`POST /api/bags`)
   - Admin can manually add bag entries:
     - `out`, `return`, or `adjust`

6. Balance calculation
   - Bag balance is computed from ledger:
     - `balance = SUM(out) - SUM(return) + SUM(adjust)`

## Important Limitation Found

- Sale and Returns UI currently use one bag return input (`bagReturnQty`).
- That value is mapped to the first product where `hasBag = true`.
- If multiple bag-enabled product types exist, bag returns can be attributed to the wrong product type.
- This means bag tracking is still product-coupled, not fully independent.

## What Needs To Change (When Implementing New Workflow)

1. Decouple bag movement from product `hasBag` auto behavior.
2. Capture bag movement explicitly in Sale/Returns payloads (independent bag logic).
3. Keep `bag_ledger` as source of truth, but write from explicit bag movement inputs.
4. Preserve existing historical data and introduce a safe transition strategy.
5. Add strict validation and audit detail for explicit bag operations.
6. Update relevant UI/report/invoice flows that currently assume product-coupled bag logic.

## Suggested Target Direction

- Treat bags as independent operational movement entries.
- Keep sales items focused on product revenue/quantity.
- Keep bag movement tracked separately but linked to transaction when relevant.
- Support future expansion to multiple bag types without relying on `find(first hasBag product)`.

