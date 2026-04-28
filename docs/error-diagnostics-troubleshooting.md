# Superice POS Error Diagnostics and Troubleshooting

Last updated: 2026-04-20

Document role:

- This is the current deep diagnostics and troubleshooting reference for `superice-pos`.
- Use this for error envelopes, log structure, code inventory, and first inspection targets.
- If another app-level doc summarizes diagnostics differently, this playbook wins for `superice-pos`.

This playbook documents the current error-diagnostics behavior implemented in `superice-pos` today.
It applies to `superice-pos` first, not the whole workspace.

Use this document when you need to answer three questions quickly:

- what the client receives on a server-side failure
- what the server logs contain for the same failure
- where to inspect first for a given diagnostic code

## Overview

`superice-pos` now uses a shared diagnostics pipeline for standardized server failures:

- typed failures can be thrown with `DiagnosticError`
- unknown failures are classified by `classifyApiError(...)`
- most 5xx route failures flow through `withErrorHandler(...)` or `createInternalServerErrorResponse(...)`
- standardized 5xx responses include `requestId` and a safe `diagnostic` block
- server logs keep richer internal context, normalized error shape, and nested cause chains

Primary implementation references:

- [src/lib/diagnostic-error.ts](../src/lib/diagnostic-error.ts)
- [src/lib/api-error-diagnostics.ts](../src/lib/api-error-diagnostics.ts)
- [src/lib/error-logging.ts](../src/lib/error-logging.ts)
- [src/lib/api-utils.ts](../src/lib/api-utils.ts)

## 4xx vs 5xx vs Client-Only Diagnostics

There are now three different diagnostic surfaces to keep separate:

- Normal 4xx business or validation errors:
  These are still returned by some routes as ordinary application responses such as `400`, `401`, `403`, `404`, or `409`. They do not always use the standardized 5xx diagnostic envelope.
- Standardized 5xx server failures:
  These include `requestId`, a structured `diagnostic` block, and `x-request-id` on the response headers.
- Client-only offline/network fallback diagnostics:
  The sale page can generate `NET-REQUEST-1000` locally when the request never reaches the server. This is a browser-side fallback, not an API response from the server.

## Public 5xx Response Shape

For standardized `superice-pos` API 5xx failures, the current response shape is:

```json
{
  "error": "เกิดข้อผิดพลาดภายในระบบ",
  "requestId": "req-or-uuid",
  "diagnostic": {
    "code": "FILE-EXPORT-1001",
    "category": "file.export",
    "source": "backup.route",
    "operation": "download-csv-zip",
    "title": "CSV export failed",
    "hint": "การส่งออกไฟล์ CSV ล้มเหลว ให้ตรวจสอบ requestId และ log",
    "retryable": false
  }
}
```

Current guarantees:

- `error` remains for backward compatibility
- `requestId` is included in the JSON body for standardized server failures
- `diagnostic.code` is the stable machine-friendly identifier
- `diagnostic.category` is the failure family
- `diagnostic.source` is the route/system hint
- `diagnostic.operation` is the failing operation hint
- `diagnostic.title` is the operator-facing summary
- `diagnostic.hint` and `diagnostic.retryable` are optional
- `x-request-id` is also set on the response headers

The public response intentionally does not include:

- stack traces
- raw SQL
- env var values
- raw upstream payloads
- full internal error objects

Health route note:

- `GET /api/health` preserves its health-specific shape with `status`, `timestamp`, `db`, plus `requestId` and `diagnostic` on failure

## Server Log Shape

Unhandled route failures are logged through `logApiError(...)`.
Library and stream-related diagnostic events can be logged through `logDiagnosticEvent(...)`.

Current `logApiError(...)` payload shape:

```ts
{
  requestId: string;
  ts: string;
  request: {
    method: string;
    path: string;
    query: string;
  };
  context: Record<string, unknown>;
  diagnostic: ApiErrorDiagnostic;
  error: {
    name?: string;
    message?: string;
    stack?: string;
    postgres?: {
      code?: string | null;
      detail?: string | null;
      hint?: string | null;
      severity?: string | null;
      schema?: string | null;
      table?: string | null;
      column?: string | null;
      constraint?: string | null;
      file?: string | null;
      line?: string | null;
      routine?: string | null;
    } | null;
  };
  causes: Array<Record<string, unknown>>;
}
```

Current log behavior:

- prefix format:
  `[API Error][<category>][<code>][<requestId>] <METHOD> <PATH>`
- `context` merges safe typed error context with route-level context
- `error` is normalized before logging
- `causes` walks nested `cause` chains
- Postgres metadata is captured when available

For non-request diagnostic events, the current `logDiagnosticEvent(...)` payload contains:

- `ts`
- `message`
- `context`
- `diagnostic`
- normalized `error`
- `causes`

## Important Limitation

Streamed JSON backup failures that happen after the response has already started cannot be rewritten into a new HTTP error payload.

In practice this means:

- JSON backup stream startup failures can still surface as request failures
- mid-stream JSON backup failures are primarily diagnosable from server logs
- for those cases, `backup.export` logs are the source of truth

Relevant code:

- [src/lib/backup-export.ts](../src/lib/backup-export.ts)

## Current Error Code Inventory

This is the canonical current code inventory for `superice-pos`.

### Classifier-driven codes

| Code | Category | Default source | Default operation | Typical meaning |
|---|---|---|---|---|
| `REQ-VALIDATION-1001` | `request.validation` | `request.body` | `schema-parse` | Request schema/body validation failed |
| `REQ-VALIDATION-1002` | `request.validation` | `request.body` | `json-parse` | Request body is not valid JSON |
| `SRV-CONFIG-1001` | `server.config` | `server.config` | `load` | Generic server configuration problem |
| `AUTH-SESSION-1001` | `auth.session` | `auth.session` | `verify` | Session, role, or API key failure |
| `DB-SCHEMA-1001` | `database.schema` | `database.schema` | `query` | Missing database table |
| `DB-SCHEMA-1002` | `database.schema` | `database.schema` | `query` | Missing database column |
| `DB-SEQUENCE-1001` | `database.sequence` | `database.sequence` | `insert` | Primary key sequence drift / PK collision |
| `DB-CONSTRAINT-1001` | `database.constraint` | `database.constraint` | `write` | Unique constraint violation |
| `DB-CONSTRAINT-1002` | `database.constraint` | `database.constraint` | `write` | Foreign key violation |
| `DB-CONSTRAINT-1003` | `database.constraint` | `database.constraint` | `write` | Missing required DB value |
| `DB-DATA-1001` | `database.data` | `database.query` | `bind` | Invalid DB input type/format |
| `DB-TIMEOUT-1001` | `database.timeout` | `database.query` | `execute` | DB statement timeout |
| `DB-CONNECTION-1001` | `database.connection` | `database.connection` | `connect` | DB connection or availability failure |
| `EXT-FETCH-1001` | `external.fetch` | `external.fetch` | `request` | Network/fetch/abort failure |
| `EXT-SERVICE-1001` | `external.service` | `external.service` | `respond` | Upstream returned a bad/unexpected response |
| `SRV-UNEXPECTED-1000` | `server.unhandled` | `server` | `unhandled` | Fallback unhandled server error |

### Typed and route-specific codes

| Code | Category | Source | Operation | Typical meaning |
|---|---|---|---|---|
| `SRV-CONFIG-DB-1001` | `server.config` | `database.runtime` | `resolve-connection` | DB runtime could not resolve a usable connection |
| `BACKUP-IO-1001` | `backup.io` | `backup.route` or `backup.export` | `download-*` or `csv-zip` | Backup file generation failed |
| `BACKUP-IO-1002` | `backup.io` | `backup.export` | `iterate-table` | Backup cursor/id progression became invalid |
| `FILE-EXPORT-1001` | `file.export` | `reports.export` or `backup.route` | `build-*-xlsx` or `download-csv-zip` | Export file generation failed |
| `SRV-MIGRATE-1001` | `server.unhandled` | `migrate.dispatcher` | `<action name>` | Migrate action returned a 500-style failure result |
| `SRV-CONFIG-1002` | `server.config` | `migrate.config` | `read-seed-passwords` | Missing migrate seed-password config |
| `SRV-CONFIG-1003` | `server.config` | `migrate.config` | `parse-seed-passwords` | Invalid JSON in migrate seed-password config |
| `SRV-CONFIG-1004` | `server.config` | `migrate.config` | `validate-seed-passwords` | Wrong shape for migrate seed-password config |
| `NET-REQUEST-1000` | `network.request` | `sale.submit` | `offline-queue-fallback` | Browser could not reach server; sale queued locally |

## Main Source and Operation Patterns

These `source` and `operation` labels are the fastest way to locate the real failing layer.

| Source | Operation patterns that matter in practice | Primary file(s) |
|---|---|---|
| `setup.route` | `GET /api/setup`, `POST /api/setup` | [src/app/api/setup/route.ts](../src/app/api/setup/route.ts) |
| `reports.export` | `GET /api/reports/export`, `build-daily-xlsx`, `build-credit-xlsx`, `build-customer-xlsx` | [src/app/api/reports/export/route.ts](../src/app/api/reports/export/route.ts) |
| `backup.route` | `GET /api/backup`, `GET /api/backup/transactions`, `GET /api/backup/customers`, `GET /api/backup/csv`, `download-csv-zip` | [src/app/api/backup/route.ts](../src/app/api/backup/route.ts), [csv](../src/app/api/backup/csv/route.ts), [transactions](../src/app/api/backup/transactions/route.ts), [customers](../src/app/api/backup/customers/route.ts) |
| `backup.export` | `json-stream`, `csv-zip`, `iterate-table` | [src/lib/backup-export.ts](../src/lib/backup-export.ts) |
| `display.route` | `GET /api/display`, `POST /api/display` | [src/app/api/display/route.ts](../src/app/api/display/route.ts) |
| `health.route` | `db-ping` | [src/app/api/health/route.ts](../src/app/api/health/route.ts) |
| `audit.findings` | `PATCH /api/audit/findings/[id]` | [src/app/api/audit/findings/[id]/route.ts](../src/app/api/audit/findings/[id]/route.ts) |
| `migrate.dispatcher` | `<action name>` from the registry/dispatcher | [src/lib/migrate/dispatcher.ts](../src/lib/migrate/dispatcher.ts) |
| `migrate.config` | `read-seed-passwords`, `parse-seed-passwords`, `validate-seed-passwords` | [src/lib/migrate/shared.ts](../src/lib/migrate/shared.ts) |
| `database.runtime` | `resolve-connection` | [src/db/index.ts](../src/db/index.ts) |
| `invoices.detail` | `GET /api/invoices/[id]` | [src/app/api/invoices/[id]/route.ts](../src/app/api/invoices/[id]/route.ts) |
| `invoices.issue` | `POST /api/invoices/[id]/issue` | [src/app/api/invoices/[id]/issue/route.ts](../src/app/api/invoices/[id]/issue/route.ts) |
| `invoices.pay` | `POST /api/invoices/[id]/pay` | [src/app/api/invoices/[id]/pay/route.ts](../src/app/api/invoices/[id]/pay/route.ts) |
| `invoices.void` | `POST /api/invoices/[id]/void` | [src/app/api/invoices/[id]/void/route.ts](../src/app/api/invoices/[id]/void/route.ts) |
| `sale.submit` | `offline-queue-fallback` | [src/app/(dashboard)/sale/page.tsx](../src/app/(dashboard)/sale/page.tsx) |

## Main Route Matrix

This table summarizes the current route coverage that already uses the structured diagnostics system.

| Route / area | Likely code(s) | What user sees | What the logs include | Likely root cause |
|---|---|---|---|---|
| `/api/setup` | `SRV-UNEXPECTED-1000`, `DB-CONNECTION-1001`, `DB-SCHEMA-1001`, `DB-SCHEMA-1002` | Generic Thai internal-error message, `requestId`, safe diagnostic block | `setup.route`, request path/query, normalized DB error, cause chain | Setup query failed, DB unavailable, missing schema piece |
| `/api/reports/export` | `FILE-EXPORT-1001`, `DB-CONNECTION-1001`, `DB-TIMEOUT-1001` | Generic internal-error message, `requestId`, export diagnostic | `reports.export`, export input context, typed export diagnostic, nested cause | XLSX build failed, query failed, DB timeout |
| `/api/backup` | `BACKUP-IO-1001`, `DB-CONNECTION-1001` | Generic internal-error message, `requestId`, backup diagnostic | `backup.route`, scope/factory context, underlying export failure | Full backup generation failed |
| `/api/backup/transactions` | `BACKUP-IO-1001`, `DB-CONNECTION-1001` | Same structured 5xx envelope | `backup.route`, transactions scope context | Transactions backup generation failed |
| `/api/backup/customers` | `BACKUP-IO-1001`, `DB-CONNECTION-1001` | Same structured 5xx envelope | `backup.route`, customers scope context | Customers backup generation failed |
| `/api/backup/csv` | `FILE-EXPORT-1001`, `BACKUP-IO-1001`, `DB-CONNECTION-1001` | Same structured 5xx envelope | `backup.route` plus nested `backup.export` cause details | CSV/ZIP generation failed |
| `backup.export` internals | `BACKUP-IO-1002`, `BACKUP-IO-1001` | Sometimes only a broken stream/download; not always a rewritten HTTP body | `backup.export`, stream/iteration context, counts/duration/output bytes | Cursor progression invalid or stream/export failed mid-flight |
| `/api/display` GET | `SRV-UNEXPECTED-1000`, DB classifier codes | Generic internal-error message, `requestId`, display diagnostic | `display.route`, GET path, normalized DB error | Pending-order or display summary query failed |
| `/api/display` POST | `AUTH-SESSION-1001`, `SRV-CONFIG-1001`, DB classifier codes | 4xx auth/config responses for expected failures, structured 5xx for server failures | `display.route`, POST path, route context, DB cause chain | Invalid API key/session, missing display config, mutation query failure |
| `/api/health` | `DB-CONNECTION-1001`, `DB-TIMEOUT-1001`, `SRV-UNEXPECTED-1000` | Health JSON with `status: error`, `requestId`, `diagnostic`, `db.connected: false` | `health.route`, `db-ping`, request context, normalized DB error | DB ping failed or timed out |
| `/api/audit/findings/[id]` PATCH | `SRV-UNEXPECTED-1000`, `DB-CONSTRAINT-*`, `DB-SCHEMA-*` | Generic internal-error message, `requestId`, audit diagnostic | `audit.findings`, `findingId`, normalized DB error | Audit finding update failed |
| `/api/migrate` thrown failure | `SRV-UNEXPECTED-1000`, classifier codes, migrate config codes | Generic internal-error message, `requestId`, migrate diagnostic | `migrate.dispatcher`, `action`, `callerIp`, cause chain | Handler threw unexpectedly or deep migrate dependency failed |
| `/api/migrate` explicit 500 result | `SRV-MIGRATE-1001` | Same structured 5xx envelope | `migrate.dispatcher`, selected action, safe context, hidden raw result body | Action returned a 500-style result that needs action-specific repair |
| `/api/invoices/[id]` | `SRV-UNEXPECTED-1000`, `DB-CONNECTION-1001`, schema/constraint codes | Generic internal-error message, `requestId`, invoice diagnostic | `invoices.detail`, route context, DB error/cause chain | Invoice detail query failed |
| `/api/invoices/[id]/issue` | `SRV-UNEXPECTED-1000`, `DB-SEQUENCE-1001`, `DB-CONSTRAINT-*`, `DB-CONNECTION-1001` | Generic internal-error message, `requestId`, invoice diagnostic | `invoices.issue`, route context, normalized DB error | Invoice issue/update/idempotency flow failed |
| `/api/invoices/[id]/pay` | `SRV-UNEXPECTED-1000`, `DB-CONSTRAINT-*`, `DB-CONNECTION-1001` | Generic internal-error message, `requestId`, invoice diagnostic | `invoices.pay`, route context, normalized DB error | Payment insert/allocation/update failed |
| `/api/invoices/[id]/void` | `SRV-UNEXPECTED-1000`, `DB-CONSTRAINT-*`, `DB-CONNECTION-1001` | Generic internal-error message, `requestId`, invoice diagnostic | `invoices.void`, route context, normalized DB error | Compensating void/reversal/update failed |
| Sale page network fallback | `NET-REQUEST-1000` | Local toast and offline queue behavior, not a server 5xx body | Browser console warning with diagnostic/meta | Browser could not reach server; sale queued for later sync |

## Troubleshooting Playbook by Code

The goal of this table is to be decision-complete enough that an operator or AI can start with the code and inspect the right places first.

| Code | First 3 places to inspect | Likely fix |
|---|---|---|
| `REQ-VALIDATION-1001` | Route body parser and schema, caller payload shape, failing validator or `ZodError` path | Fix the request payload or align route validation/schema with the caller |
| `REQ-VALIDATION-1002` | Client/body producer, `request.json()` caller path, raw request content type/body format | Send valid JSON and confirm the caller is not truncating or double-encoding the body |
| `SRV-CONFIG-1001` | Route-specific env/config helper, deployment env vars, recent config-dependent code change | Add or correct the missing config and redeploy |
| `AUTH-SESSION-1001` | Session/auth helper, role gate or API key check, calling client headers/cookies | Restore a valid session/API key or fix the route’s auth expectations |
| `DB-SCHEMA-1001` | Missing table name in diagnostic/log, migrations/setup state, target factory DB/schema | Run the required migration/setup against the correct database |
| `DB-SCHEMA-1002` | Missing column in diagnostic/log, migration history, route query/select list | Add the missing column via migration or align the query with deployed schema |
| `DB-SEQUENCE-1001` | Table/constraint from Postgres metadata, recent manual imports/inserts, sequence state for the target table | Repair the sequence so it advances past the current max id |
| `DB-CONSTRAINT-1001` | Constraint name, payload uniqueness assumptions, idempotency/replay key flow | Remove duplicate write, fix uniqueness logic, or use the correct idempotency key |
| `DB-CONSTRAINT-1002` | Referenced table/ids, parent-row existence, mutation ordering | Create or restore the missing parent record or fix write ordering |
| `DB-CONSTRAINT-1003` | Missing column name, request payload completeness, route-side defaulting/normalization | Provide the required value or restore the route’s missing defaulting logic |
| `DB-DATA-1001` | Column/type named in Postgres metadata, request coercion/parsing, route parameter conversion | Correct type coercion and validate the input before binding it to SQL |
| `DB-TIMEOUT-1001` | Slow query in route/helper, DB load/locks, report/export date range or batch size | Optimize the query, reduce scope, or relieve DB pressure |
| `DB-CONNECTION-1001` | [src/db/index.ts](../src/db/index.ts), env/config resolution, route request context / active factory | Fix the DB URL/config, restore database availability, or reduce exhausted connection pressure |
| `EXT-FETCH-1001` | External request caller, network reachability/timeout path, abort/retry handling | Restore network access, increase robustness, or retry the upstream call safely |
| `EXT-SERVICE-1001` | Upstream response handling, response validation logic, external service health | Fix upstream response assumptions or repair the external dependency |
| `SRV-UNEXPECTED-1000` | `diagnostic.source`, `diagnostic.operation`, nested `causes` in server log | Start from the logged source/operation and convert the now-known failure into a more specific typed or classified error if needed |
| `SRV-CONFIG-DB-1001` | [src/db/index.ts](../src/db/index.ts), shared DB env resolution, active factory mapping | Set the missing `DATABASE_URL` or factory DB URL and verify factory routing |
| `BACKUP-IO-1001` | Route-level backup caller, [src/lib/backup-export.ts](../src/lib/backup-export.ts), input scope/factory context | Repair the backup generation path, underlying DB access, or export helper |
| `BACKUP-IO-1002` | Table iteration logic, cursor/id assumptions, source table ids for the failing table | Repair non-monotonic or invalid id progression in backup export assumptions |
| `FILE-EXPORT-1001` | Route-level export builder, backup/export helper, request query params / export inputs | Fix XLSX/ZIP generation, malformed inputs, or the underlying data/query failure |
| `SRV-MIGRATE-1001` | [src/lib/migrate/dispatcher.ts](../src/lib/migrate/dispatcher.ts), selected migrate action, migrate audit/log entry | Repair the specific migrate action that returned a 500-style result |
| `SRV-CONFIG-1002` | [src/lib/migrate/shared.ts](../src/lib/migrate/shared.ts), deployment env, migrate invocation context | Set `MIGRATE_V5_SEED_PASSWORDS_JSON` before running that migration |
| `SRV-CONFIG-1003` | Same migrate config helper, raw env value format, JSON parsing expectations | Make `MIGRATE_V5_SEED_PASSWORDS_JSON` valid JSON |
| `SRV-CONFIG-1004` | Same migrate config helper, parsed JSON shape, expected object-map structure | Change the env value to the required object-map shape |
| `NET-REQUEST-1000` | Browser network state, service worker/offline queue path, server reachability from the POS device | Restore connectivity; queued sales should sync later once the server is reachable |

## Route-Specific First Checks

These shortcuts are useful when you already know the route surface.

### Setup and schema

- Start with [src/app/api/setup/route.ts](../src/app/api/setup/route.ts)
- If the code is schema-related, inspect migration/setup state in the target factory DB
- If the code is connection-related, inspect [src/db/index.ts](../src/db/index.ts)

### Reports and exports

- Start with [src/app/api/reports/export/route.ts](../src/app/api/reports/export/route.ts)
- Then inspect [src/lib/backup-export.ts](../src/lib/backup-export.ts) for backup/export helper failures
- Use query params and request context from the log to reproduce the failing export scope

### Display

- Start with [src/app/api/display/route.ts](../src/app/api/display/route.ts)
- Distinguish auth/config failures on POST from DB failures on GET/POST
- Use `source` + `operation` to decide whether you are debugging the public display read path or the secured mutation path

### Health

- Start with [src/app/api/health/route.ts](../src/app/api/health/route.ts)
- A failing health check is usually a DB availability or timeout problem, not a business-rule problem
- Use the health response `requestId` to find the corresponding server log

### Audit findings

- Start with [src/app/api/audit/findings/[id]/route.ts](../src/app/api/audit/findings/[id]/route.ts)
- If the route returned 400/404, that is a normal business/request response
- If it returned a structured 5xx, inspect the DB update path and the logged `findingId`

### Migrate

- Start with [src/lib/migrate/dispatcher.ts](../src/lib/migrate/dispatcher.ts)
- Then inspect the selected action from the log context and any related migrate audit entry
- For seed-password errors, jump directly to [src/lib/migrate/shared.ts](../src/lib/migrate/shared.ts)

### Invoice detail and mutations

- Detail read path:
  [src/app/api/invoices/[id]/route.ts](../src/app/api/invoices/[id]/route.ts)
- Issue mutation:
  [src/app/api/invoices/[id]/issue/route.ts](../src/app/api/invoices/[id]/issue/route.ts)
- Pay mutation:
  [src/app/api/invoices/[id]/pay/route.ts](../src/app/api/invoices/[id]/pay/route.ts)
- Void mutation:
  [src/app/api/invoices/[id]/void/route.ts](../src/app/api/invoices/[id]/void/route.ts)

For invoice failures, inspect:

- idempotency/replay flow
- DB constraint metadata in the log
- invoice lifecycle assumptions for the current mutation step

## Operator Workflow

When you see a standardized 5xx in `superice-pos`, the fastest workflow is:

1. Capture `requestId`, `diagnostic.code`, `diagnostic.source`, and `diagnostic.operation`
2. Find the matching server log entry using `requestId` or `x-request-id`
3. Read `context`, `error.postgres`, and the nested `causes`
4. Use the code table above to inspect the first three locations that most often contain the real fix

That is the current supported debugging path for `superice-pos`.
