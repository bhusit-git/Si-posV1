# Super Ice POS

Document role:

- This is the app-local orientation and editing guide for `superice-pos`.
- Use this for active app surfaces, important flows, and where to edit behavior in this app.
- For workspace-wide architecture and boundary truth, defer to [../docs/architecture/current-state.md](../docs/architecture/current-state.md).

Core POS system for ice factory operations, replacing the legacy Access workflow.
Primary language is Thai UI, with modern web architecture and offline-safe sales.

Current architecture references:

- [shared boundary note](./docs/shared-boundary.md)
- [error diagnostics and troubleshooting](./docs/error-diagnostics-troubleshooting.md)

Terminology note:

- this workspace uses `factory` and `factoryKey` as the canonical current-state terms
- stable env, cookie, and DB field names remain unchanged

## What This App Does

- Record daily sales and transfer-out bills.
- Track bag out/return/buy events and customer bag balance.
- Manage credit and payments.
- Generate/print invoices and customer statements.
- Provide Epson pre-printed bill printing and standard receipt printing.
- Run in unstable internet environments with offline queue + sync.

## Tech Stack (Core)

- Next.js 16 (App Router)
- TypeScript
- PostgreSQL + Drizzle ORM
- workspace canonical shared layer at root `../shared`, consumed here through a vendored deploy copy under `src/shared`
- Tailwind + shadcn/ui
- `next-pwa` service worker + offline fallback
- Vitest test suite
- IndexedDB (`idb-keyval`) for offline cache/queue

## Architecture Overview (Current `main`)

- UI routes live under `src/app/(dashboard)`, `src/app/(print)`, `src/app/(display)`, and `src/app/(user)`.
- Database and env access now flow through thin local wrappers over the vendored shared layer copy in this app.
  The workspace canonical source still lives at root `shared/`.
  - `src/db/index.ts`
  - `src/lib/config/env.ts`
  - `src/lib/shared/*`
  - `src/shared/{config,db}`
- `/api/migrate` is now a thin route shell over a dispatcher/registry/action system instead of one large monolithic handler.
- Offline behavior is a first-class subsystem:
  - `next.config.ts` wires `next-pwa`
  - `public/sw.js` and `public/offline.html` provide document fallback
  - `src/lib/offline-session.ts`, `src/lib/offline-reference-cache.ts`, and `src/lib/pwa/runtime-caching.ts` handle cached session/reference behavior
- Sale-page startup logic is split between the route and helper modules to keep the main page component smaller and improve readiness/perf tracking.

## Error Diagnostics

`superice-pos` now standardizes most API 5xx failures through a shared diagnostics pipeline.

- standardized server failures include `requestId` and a structured `diagnostic` block in the JSON body
- the same failures also return `x-request-id` so UI, logs, and operators can correlate one request cleanly
- `diagnostic.source` and `diagnostic.operation` are now the main route/system hints for AI and human debugging
- some routes still return normal 4xx business or validation responses without the 5xx diagnostic envelope

Primary troubleshooting reference:

- [error diagnostics and troubleshooting](./docs/error-diagnostics-troubleshooting.md)

## Core Modules

### 1) Sale Operations

Main page: `/sale`

- Customer search and price auto-load.
- Two transaction modes:
  - `ขายปกติ` (sale)
  - `เครดิต` (transfer_out / invoice-credit)
- Sale entry view modes:
  - `Default View`
  - `Exact Bill View` (fixed bill-entry order)
- Short-term credit (`ค้าง`) supports:
  - `ชำระแล้ว`
  - `ค้าง`
  - `บางส่วน` with `ยอดรับวันนี้`
- Bag return entry in same save flow.
- Admin backdated entry (policy enforced by API precheck + server validation).
- Keyboard-first workflow (`F2`, `Enter`, `Esc`, arrow navigation).

Primary files:
- `src/app/(dashboard)/sale/page.tsx`
- `src/app/(dashboard)/sale/sale-page-utils.ts`
- `src/lib/sale-entry-view.ts`
- `src/lib/sale-readiness.ts`
- `src/lib/client-scheduler.ts`
- `src/lib/sync-engine.ts`
- `src/lib/offline-store.ts`

### 2) Print System

Print modes from sale page:
- `No Print`
- `Receipt Print`
- `Epson Print`

Routes:
- `/print/receipt/[id]`
- `/print/preprinted-bill/[id]`

How printing works:
1. Sale page opens a print route via `window.open(...)`.
2. Print page loads transaction JSON (`/api/transactions?id=...`) or offline token payload.
3. Print page renders HTML/CSS fixed layout.
4. Browser calls `window.print()`.
5. OS spooler + Epson driver send job to LQ-310.

Important operational note:
- Epson driver must be installed on the POS machine connected to printer.
- Browser settings must stay consistent (100% scale, no fit-to-page, correct paper/profile).
- Invoice-credit (`transfer_out`) customer prints hide prices.
- Partial short-term-credit sale prints show total, paid now, and remaining balance.

Primary files:
- `src/app/(print)/print/preprinted-bill/[id]/page.tsx`
- `src/app/(print)/print/receipt/[id]/page.tsx`
- `src/lib/preprinted-bill-mapper.ts`

### 3) Credit, Transactions, Returns, Daily Ledger

- `/credit`: short-term credit (`ค้าง`) workspace and payment actions.
- `/transactions`: history, filtering, void flow.
- `/returns`: return transactions and adjustments.
- `/daily-ledger`: printable operational ledger with bill-detail drill-in, payment-type filters, and compact print/export workflow.

Primary files:
- `src/app/(dashboard)/credit/page.tsx`
- `src/app/(dashboard)/transactions/page.tsx`
- `src/app/(dashboard)/returns/page.tsx`
- `src/app/api/transactions/route.ts`

### 4) Invoicing

Main page: `/invoice`

Includes:
- Invoice preview + generation.
- Lifecycle operations: issue, pay, void.
- Print output for customer invoices.

Reliability hardening implemented:
- Optional idempotency keys on invoice mutations.
- Replay-safe behavior for duplicate submits.
- Conflict handling for same key + different payload.
- Compensating void flow that reverses payment effects before final void state.

Invoice mutation endpoints:
- `POST /api/invoices`
- `POST /api/invoices/[id]/issue`
- `POST /api/invoices/[id]/pay`
- `POST /api/invoices/[id]/void`

Idempotency key input:
- Header: `Idempotency-Key`
- Body fallback: `idempotencyKey`

Primary files:
- `src/app/(dashboard)/invoice/page.tsx`
- `src/app/api/invoices/route.ts`
- `src/app/api/invoices/[id]/issue/route.ts`
- `src/app/api/invoices/[id]/pay/route.ts`
- `src/app/api/invoices/[id]/void/route.ts`
- `src/lib/idempotency.ts`
- `src/lib/idempotency-client.ts`

### 5) Reporting and Operations

- `/dashboard`: KPI summary and operational indicators.
- `/reports`: sales/product/customer/report exports.
- `/daily-ledger`: daily ledger workflow.
- `/bags`: bag ledger and manual adjustments.
- `/audit`: change and behavior audit trails.

### 6) Migration and Factory Operations

- `/api/migrate` is an operational endpoint protected by `MIGRATE_KEY`.
- The route shell delegates to `src/lib/migrate/{dispatcher,registry,actions,shared,audit}`.
- Product migration and rename flows now share canonical product definitions from `src/lib/product-definitions.ts`.
- Factory DB routing uses centralized shared runtime/config helpers instead of ad hoc route-level env parsing.

Primary files:
- `src/app/api/migrate/route.ts`
- `src/lib/migrate/dispatcher.ts`
- `src/lib/migrate/registry.ts`
- `src/lib/migrate/actions-bootstrap.ts`
- `src/lib/migrate/actions-product.ts`
- `src/lib/migrate/actions-destructive.ts`
- `src/lib/product-definitions.ts`

## Developer Editing Guide (Important)

This section is for quickly finding where to change behavior without breaking core flows.

### Sale Flow: Key Functions

File: `src/app/(dashboard)/sale/page.tsx`

- `handleSave()`:
  - Builds transaction payload.
  - Handles online save vs offline queue fallback.
  - Triggers print after save.
  - Sends `status: "partial"` + real `paid` amount for partial short-term-credit sales.
- `triggerPrint(saleId, mode, offlineToken?)`:
  - Routes to receipt or Epson preprinted print page.
- `buildPricedItems(...)`:
  - Builds customer-priced line items (default sort from product sortOrder).
- `buildTransferItems(...)`:
  - Builds transfer-mode line items with real in-system prices for invoice-credit sales.
- `updateItemQuantity(...)` / `updateAddedItemPrice(...)`:
  - Recalculate subtotals and grand total.

### Sale Entry View Mapping

File: `src/lib/sale-entry-view.ts`

- `buildExactBillRows(items)`:
  - Maps sale items into fixed bill slots (line1..line6).
  - Returns `{ rows, extraItems }`.
- `isBillSlotProductName(name)`:
  - Used to keep bill-slot items out of extras add-list in exact-bill mode.
- `parseSaleEntryViewMode(value)`:
  - Parses localStorage view mode safely (`default` fallback).

### Preprinted Bill Mapping + Layout

Files:
- `src/lib/preprinted-bill-mapper.ts`
- `src/app/(print)/print/preprinted-bill/[id]/page.tsx`

Mapping responsibilities:
- Convert transaction items + bag ledger into fixed bill lines:
  - line1..line6 product lines
  - line7 `ซื้อกระสอบ`
  - line8 `ถุงออก`
  - line9 `คืนถุง`
  - line10 `ค้างถุง`
- Alias handling includes typo variants (`หลอดดล็ก` / `หลอดเล็ก`).
- Net bag formula:
  - `line10 = line8 - line9 - line7`

Layout responsibilities:
- Fixed mm coordinates (not fluid table layout).
- `@page` size and absolute-position fields for dot-matrix alignment.
- Partial sale print overlays can add `รับแล้ว` and `ค้างเหลือ`.
- URL offsets:
  - `?ox=<mm>&oy=<mm>`
- Calibration page:
  - `?calibration=1`
- Simple adjust panel:
  - `?adjust=1`

### Invoice Reliability (Idempotency + Void Compensation)

Key files:
- `src/lib/idempotency.ts`
- `src/lib/idempotency-client.ts`
- `src/app/api/invoices/route.ts`
- `src/app/api/invoices/[id]/issue/route.ts`
- `src/app/api/invoices/[id]/pay/route.ts`
- `src/app/api/invoices/[id]/void/route.ts`

Behavior:
- Optional `Idempotency-Key` protects create/issue/pay/void from duplicate submits.
- Replay-safe same-key same-payload requests return success response (no double mutation).
- Same-key different-payload returns conflict.
- Void uses compensating entries to reverse payment/allocation effects before final `void` state.

### LocalStorage Keys Used by App

- `superice-print-mode`
- `superice-sale-entry-view-mode`
- `superice-ui-scale`
- `superice-autoprint` (legacy migration input only)
- `superice-offline-print:<token>` (temporary offline print payload cache)

### Safe Change Checklist

Before pushing changes:
1. Run `npm run lint`
2. Run `npm run test`
3. Run `npm run build:local`
4. For print changes:
   - test `/print/preprinted-bill/[id]?adjust=1`
   - print calibration sample and verify real paper
5. For sale/invoice changes:
   - create normal sale
   - create partial short-term-credit sale
   - create transfer-out sale
   - test offline queue path
   - test invoice issue/pay/void path
6. For daily-ledger changes:
   - test on-screen filter behavior
   - test CSV filename / export shape
   - test print preview and paper fit

## Core Route Groups

- `src/app/(dashboard)` - authenticated business UI
- `src/app/(print)` - print-only document routes
- `src/app/(display)` - floor display views
- `src/app/(user)` - user-role sale/transaction views
- `src/app/api` - server endpoints

## API Quick Reference (Core)

### Transactions

- `GET /api/transactions?id=<id>`
  - Single transaction with customer, items, bag ledger.
- `POST /api/transactions`
  - Create sale/transfer transaction.
  - Supports `clientId` dedupe for offline-safe submit.
- `POST /api/transactions/precheck`
  - Backdated policy + invoice-overlap warning check.
- `PUT /api/transactions`
  - Payment/void actions (legacy transaction lifecycle actions).

### Invoices

- `GET /api/invoices`
  - List/filter invoices.
- `POST /api/invoices`
  - Create invoice draft.
- `POST /api/invoices/[id]/issue`
  - Issue invoice + due date behavior.
- `POST /api/invoices/[id]/pay`
  - Record invoice payment + allocation.
- `POST /api/invoices/[id]/void`
  - Compensating void flow.
- `GET /api/invoices/preview`
  - Preview invoice candidate set/totals before creation.

### Master/Operational Data

- `GET /api/customers`
- `GET /api/products`
- `GET /api/bags`
- `GET /api/reports`
- `GET /api/audit`

## Core Data Model (High-Level)

- `transactions`
- `transaction_items`
- `bag_ledger`
- `customers`
- `customer_prices`
- `product_types`
- `invoices`
- `invoice_payments`
- `invoice_allocations`
- `invoice_events`
- `payment_events`
- `idempotency_keys`
- `audit_log`

## Roles (RBAC)

- `admin`
- `office`
- `manager`
- `factory`

Access is enforced in API and UI.

## Quick Start (Local)

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- npm

### Setup

1. Install dependencies:
   - `npm ci`
2. Set environment variables in `.env.local`.
3. Push schema:
   - `npm run db:push`
4. Start dev server:
   - `npm run dev`

## Useful Scripts

- `npm run dev` - local dev server
- `npm run lint` - eslint
- `npm run test` - full vitest suite
- `npm run build:local` - production build check (no schema push)
- `npm run build` - production build only
- `npm run build:deploy` - schema push + production build

## Testing

The suite contains API logic tests and lib-level unit tests, including:

- sale logic
- transfer logic
- preprinted bill mapping
- invoice lifecycle routes
- idempotency helper behavior
- migrate dispatcher / registry / product rename flows
- shared env / server-boundary guardrails
- offline fallback, offline session, runtime caching, and sale-readiness helpers

## Current Known Build Note

- `npm run build:local` is the safe production verification command for local and CI checks because it does not push schema changes.
- `npm run build:deploy` runs `scripts/push-schema.ts` before the production build and should be treated as an operational/deployment command, not a pure compile step.
- PWA output lives in `public/`, so local production builds can regenerate service-worker/fallback assets and create noisy Git diffs if those artifacts are already tracked.

## Deployment

Production is deployed on Render.
Use `main` as the release branch and run `lint`, `test`, and `build:local` before release.
Use `build:deploy` only when you intend to push schema + app changes together.
