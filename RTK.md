# RTK: Superice POS Re-Entry Guide

Last updated: 2026-04-27

Document role:

- This is the repo-local re-entry guide for `superice-pos`.
- Use this to get productive fast in this app without re-deriving the deployment and DB model.
- If this guide conflicts with [README.md](./README.md) or a deeper app-local runbook, the deeper runbook wins.
- For workspace-wide context outside this app, defer to [../RTK.md](../RTK.md).

This file is intentionally specific to the standalone POS repo.
It focuses on the things that matter most when resuming work here:

- what this app owns
- how database routing works
- how the Render deployment is wired
- where migration and upload flows point
- which commands are safe versus operationally risky
- where to look first when something breaks

## 1. What This Repo Is

`superice-pos` is the main operational app for cashier flow, credit, bags, invoices,
reporting, print, audit, and factory data operations.

What it already owns in practice:

- sales entry and transaction creation
- transfer / invoice-credit workflows
- bag out, return, buy, and balance effects
- invoice preview, create, issue, pay, and void lifecycle
- receipt and Epson pre-printed bill print flows
- offline queue + sync for unstable network environments
- auth and role-gated operational UI
- migration, setup, backfill, and repair endpoints/scripts
- backup and export flows

Read these first after this guide:

1. [README.md](./README.md)
2. [docs/error-diagnostics-troubleshooting.md](./docs/error-diagnostics-troubleshooting.md)
3. [docs/shared-boundary.md](./docs/shared-boundary.md)
4. [docs/factory-database-setup.md](./docs/factory-database-setup.md)

## 2. Current Architecture In One Pass

Core stack:

- Next.js 16 App Router
- TypeScript
- PostgreSQL + Drizzle ORM
- `next-pwa` offline shell and fallback
- Tailwind + shadcn/ui
- Vitest test suite

Important route groups:

- `src/app/(dashboard)` - authenticated business UI
- `src/app/(print)` - receipt, invoice, and pre-printed bill documents
- `src/app/(display)` - display / queue screens
- `src/app/(user)` - user-role constrained screens
- `src/app/api` - all server endpoints

Important app subsystems:

- sales: `src/app/(dashboard)/sale/page.tsx`
- invoices: `src/app/(dashboard)/invoice/page.tsx`
- transactions API: `src/app/api/transactions/route.ts`
- invoices API: `src/app/api/invoices/route.ts`
- migrate route shell: `src/app/api/migrate/route.ts`
- DB runtime: `src/db/index.ts`
- vendored shared layer: `src/shared/`

Deployment boundary note:

- workspace canonical shared code still exists at root `../shared`
- this app deploys from its vendored copy under `src/shared`
- that vendored layer is intentional deployment hardening, not a long-term package design

Reference:

- [docs/shared-boundary.md](./docs/shared-boundary.md)

## 3. Database Topology And Ownership

This app is no longer a single-DB POS.
It uses one central database plus per-factory databases.

### 3.1 Central database

`DATABASE_URL` is the main / central database.

Current responsibilities:

- users
- auth/session-related user records
- shared central app context
- fallback/default DB connection behavior in some runtime paths

Code reference:

- [src/db/index.ts](./src/db/index.ts)

### 3.2 Factory databases

Factory-scoped operational data lives in separate Postgres DBs:

- `DATABASE_URL_SI`
- `DATABASE_URL_BEARING`
- `DATABASE_URL_KTK`

Canonical factory definitions:

- [src/shared/db/runtime/factories.ts](./src/shared/db/runtime/factories.ts)

Current keys:

- `si`
- `bearing`
- `ktk`

### 3.3 How request-time routing works

`src/db/index.ts` is the main file to remember.

Current behavior:

- `getMainDb()` always uses `DATABASE_URL`
- `getDbForFactory(factoryKey)` resolves a specific factory DB
- `getDb()` uses session factory, then `superice_factory` cookie, then default factory
- if request context is unavailable, runtime falls back to the default DB

Important consequence:

- user/auth data is central
- operational reads/writes are factory-routed
- debugging must always separate "main DB problem" from "factory DB problem"

### 3.4 Where DB env resolution lives

Primary env/config files:

- [src/shared/config/shared-db.ts](./src/shared/config/shared-db.ts)
- [src/shared/config/internal.ts](./src/shared/config/internal.ts)
- [src/shared/config/superice.ts](./src/shared/config/superice.ts)

This is where to look when a DB URL, factory key, or runtime env assumption seems wrong.

## 4. Render Deployment Model

Production deploy target is Render.

Important deployment facts:

- release branch is `main`
- this repo is intended to be standalone-deployable
- production scripts and migration helpers default to `https://superice-pos.onrender.com`
- some operational scripts call the deployed app via `/api/migrate`

References:

- [README.md](./README.md)
- [scripts/push-to-render.ts](./scripts/push-to-render.ts)
- [scripts/migrate-mdb-to-render-window.ts](./scripts/migrate-mdb-to-render-window.ts)

### 4.1 Build commands that matter

From `package.json`:

- `npm run build:local` = safe production build verification
- `npm run build` = production build only
- `npm run build:deploy` = `db:push` + `db:seed-users` + `build`

Operational warning:

- `build:deploy` is not just a compile
- it pushes schema before building
- it also seeds users into the main DB
- treat it as a deployment/database mutation command

Code references:

- [package.json](./package.json)
- [scripts/push-schema.ts](./scripts/push-schema.ts)
- [scripts/seed-factory-users.ts](./scripts/seed-factory-users.ts)

### 4.2 What `push-schema` actually does

`scripts/push-schema.ts`:

- reads `DATABASE_URL`
- reads `DATABASE_URL_SI`, `DATABASE_URL_BEARING`, `DATABASE_URL_KTK`
- optionally filters with `SCHEMA_PUSH_TARGETS`
- sanitizes some legacy orphaned user references before push
- runs `drizzle-kit push` against every configured target

Important consequence:

- when multiple DB URLs are present, schema push is multi-database
- a deployment can change central and factory DBs in the same run

### 4.3 What `seed-factory-users` actually does

`scripts/seed-factory-users.ts`:

- loads `.env.local` when present
- connects only to `DATABASE_URL`
- seeds central users with `ON CONFLICT DO NOTHING`
- ensures `users.factory_key` exists

Important consequence:

- user seeding is central-db only
- if login/users break, inspect `DATABASE_URL` first, not factory DBs

## 5. Render And Database Config Locations

When someone asks "where is the database configured?", the answer depends on context.

### 5.1 Local development

First local source of truth:

- `.env.local`

Typical keys used by this app:

- `DATABASE_URL`
- `DATABASE_URL_SI`
- `DATABASE_URL_BEARING`
- `DATABASE_URL_KTK`
- `SUPERICE_SESSION_SECRET`
- `MIGRATE_KEY`
- `MIGRATE_ENABLED`
- `SETUP_KEY`
- `SETUP_ENABLED`
- `DISPLAY_API_KEY`
- `LINE_*`
- `BACKUP_*`
- `FORECAST_*`
- `NEXT_PUBLIC_POSTHOG_*`

Important note:

- do not put actual secret values into docs
- document env names and the file/location instead

### 5.2 Production / Render

Production DB and operational settings live in the Render service environment.

The app code expects these there:

- main DB: `DATABASE_URL`
- factory DBs: `DATABASE_URL_SI`, `DATABASE_URL_BEARING`, `DATABASE_URL_KTK`
- protected migration control: `MIGRATE_KEY`, `MIGRATE_ENABLED`, `MIGRATE_ALLOWED_IPS`
- setup control: `SETUP_KEY`, `SETUP_ENABLED`, `SETUP_ALLOWED_IPS`
- auth/session: `SUPERICE_SESSION_SECRET`
- display, LINE, backup, forecast, analytics settings as needed

The code locations that define these expectations are:

- [src/shared/config/shared-db.ts](./src/shared/config/shared-db.ts)
- [src/shared/config/superice.ts](./src/shared/config/superice.ts)

### 5.3 "Database locations" in practice

Do not think of "location" as a file path in the repo.
For this app, DB location usually means one of these:

- local connection string in `.env.local`
- Render env var value for the deployed service
- factory key to DB mapping in code

The canonical code mapping is:

- `si` -> `DATABASE_URL_SI`
- `bearing` -> `DATABASE_URL_BEARING`
- `ktk` -> `DATABASE_URL_KTK`

Reference:

- [src/shared/db/runtime/factories.ts](./src/shared/db/runtime/factories.ts)

## 6. Migration And Data-Move Paths

This repo has several different migration paths.
They are not interchangeable.

### 6.1 `/api/migrate` is the operational gateway

`/api/migrate` is a protected endpoint shell over the dispatcher/registry/actions system.

Important files:

- [src/app/api/migrate/route.ts](./src/app/api/migrate/route.ts)
- [src/lib/migrate/dispatcher.ts](./src/lib/migrate/dispatcher.ts)
- [src/lib/migrate/registry.ts](./src/lib/migrate/registry.ts)
- [src/lib/migrate/shared.ts](./src/lib/migrate/shared.ts)

Environment protections:

- `MIGRATE_KEY`
- `MIGRATE_ENABLED`
- `MIGRATE_ALLOWED_IPS`

Important rule:

- in production, a valid key alone is not enough if migrate is disabled or IP restriction blocks the caller

### 6.2 Factory bootstrap and import

Main runbook:

- [docs/factory-database-setup.md](./docs/factory-database-setup.md)

Common flows:

1. `init-factory`
2. `upload`
3. `reset-sequences`
4. direct MDB import via `scripts/migrate-from-mdb.ts`

### 6.3 Windowed migration to Render

Use this when pushing a date window from MDB to the deployed Render app:

- [scripts/migrate-mdb-to-render-window.ts](./scripts/migrate-mdb-to-render-window.ts)

Important safety defaults:

- default is `DRY_RUN=1`
- live runs require `DRY_RUN=0`
- production writes require `MIGRATE_KEY` and `RENDER_URL`
- overwrite behavior is controlled by `OVERWRITE` and `OVERWRITE_SCOPE`
- `TRANSACTIONS_ONLY=1` avoids rewriting master data tables

This script defaults to:

- target URL: `https://superice-pos.onrender.com`
- factory: `si` unless overridden

### 6.4 Local DB to Render push

Use this for local Postgres to deployed Render API upload:

- [scripts/push-to-render.ts](./scripts/push-to-render.ts)

It:

- reads from local DB
- uploads table batches to `/api/migrate?action=upload`
- resets sequences afterward

## 7. Safe Commands Vs Operational Commands

### 7.1 Usually safe local verification

- `npm run lint`
- `npm run test`
- `npm run build:local`
- `npm run dev`

### 7.2 Operational / state-changing commands

- `npm run build:deploy`
- `npm run db:push`
- `npm run db:seed-users`
- any script hitting `https://superice-pos.onrender.com`
- any `/api/migrate` action beyond read-only checks
- backfill scripts that mutate production or shared DBs

### 7.3 Practical rule

If a command can touch:

- schema
- user rows
- factory DB data
- Render production endpoints

then treat it as an operational command, not a normal dev command.

## 8. Troubleshooting Entry Points

### 7.4 Invoice Duplicate Workflow Switch

Invoice duplicate behavior is intentionally configurable for rollout/testing.

Primary switch:

- `NEXT_PUBLIC_INVOICE_DUPLICATE_WORKFLOW`

Supported modes:

- `confirm_on_issue`
  - current test-friendly mode
  - duplicate draft invoices are allowed
  - issuing a draft with overlapping line items shows a confirmation popup
  - if the operator confirms, the duplicate issue is allowed
- `strict`
  - restores the older conservative behavior
  - duplicate drafts are blocked
  - duplicate issue attempts are blocked with no confirm override

Primary code locations:

- [src/lib/config/invoice-duplicates.ts](./src/lib/config/invoice-duplicates.ts)
- [src/app/api/invoices/route.ts](./src/app/api/invoices/route.ts)
- [src/app/api/invoices/[id]/issue/route.ts](./src/app/api/invoices/[id]/issue/route.ts)
- [src/app/(dashboard)/invoice/page.tsx](./src/app/(dashboard)/invoice/page.tsx)

Important reminder:

- if this env var changes, restart the Next.js app so both server routes and client UI pick up the new mode

## 8. Troubleshooting Entry Points

### 8.1 Health check

Start with:

- `GET /api/health`

Reference:

- [src/app/api/health/route.ts](./src/app/api/health/route.ts)

This route:

- pings the active DB connection
- returns latency on success
- returns standardized diagnostics on failure

### 8.2 Standard diagnostics

When API failures happen, use:

- [docs/error-diagnostics-troubleshooting.md](./docs/error-diagnostics-troubleshooting.md)

Key things to remember:

- most server 5xx responses include `requestId`
- response headers include `x-request-id`
- diagnostics expose `code`, `category`, `source`, and `operation`
- DB connection/config issues often surface from `database.runtime` or DB classifier codes

### 8.3 Fast triage questions

Ask these first:

1. Is this central DB only, factory DB only, or both?
2. Did this start after schema push, seed-users, or Render deploy?
3. Is the failing flow routed by session/cookie to the expected factory?
4. Is this a true server failure, or an offline/browser fallback case?

## 9. Files Worth Remembering

High-value files for re-entry:

- [README.md](./README.md)
- [src/db/index.ts](./src/db/index.ts)
- [src/shared/config/shared-db.ts](./src/shared/config/shared-db.ts)
- [src/shared/config/superice.ts](./src/shared/config/superice.ts)
- [src/shared/db/runtime/factories.ts](./src/shared/db/runtime/factories.ts)
- [src/app/api/migrate/route.ts](./src/app/api/migrate/route.ts)
- [src/lib/migrate/shared.ts](./src/lib/migrate/shared.ts)
- [scripts/push-schema.ts](./scripts/push-schema.ts)
- [scripts/seed-factory-users.ts](./scripts/seed-factory-users.ts)
- [scripts/migrate-mdb-to-render-window.ts](./scripts/migrate-mdb-to-render-window.ts)
- [scripts/push-to-render.ts](./scripts/push-to-render.ts)
- [docs/factory-database-setup.md](./docs/factory-database-setup.md)
- [docs/error-diagnostics-troubleshooting.md](./docs/error-diagnostics-troubleshooting.md)

## 10. Re-Entry Checklist

When returning to this repo after time away:

1. Read this file and [README.md](./README.md).
2. Confirm whether the task is local-only, DB-touching, or Render-touching.
3. Identify whether the issue belongs to `DATABASE_URL` or a factory DB.
4. Prefer `build:local` for verification unless you explicitly intend schema mutation.
5. Before using `/api/migrate` or Render upload scripts, confirm factory, date window, overwrite mode, and auth/env toggles.
6. If debugging a production failure, capture `requestId` and inspect the diagnostics playbook first.

## 11. Current Mental Model To Keep

The fastest correct mental model for this repo is:

- this is the operational POS app
- auth/users are central-db concerns
- sales and most business data are factory-db concerns
- deployment is standalone on Render
- `src/shared/` is the deploy copy that keeps the app standalone
- `build:deploy` is operational because it can mutate multiple databases
- many data-move scripts target the live Render service through protected API routes

If you keep those seven facts in mind, most of the repo stops being confusing very quickly.
