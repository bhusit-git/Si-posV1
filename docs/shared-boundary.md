# Shared Boundary Note

Last updated: 2026-04-20

Document role:

- This is the app-local shared-boundary clarification for `superice-pos`.
- Use it to understand how root `shared/` and `superice-pos/src/shared/` coexist today.
- For broader workspace architecture, defer to [../../docs/architecture/current-state.md](../../docs/architecture/current-state.md).

Current boundary:

- root `shared/` is the workspace canonical source for shared schema, runtime, and config modules
- `superice-pos/src/shared/` is the vendored deploy copy used by the standalone `superice-pos` app
- `superice-pos` consumes shared behavior through thin local wrappers such as `src/lib/shared/*`, `src/lib/config/env.ts`, and `src/db/index.ts`

Current local usage:

- `src/shared/db/schema` is the vendored schema copy used by this app at build and runtime
- `src/shared/db/runtime` is the vendored shared DB runtime copy used by the thin wrappers in `src/lib/shared`
- `src/shared/config` is the vendored shared env/config copy consumed through `src/lib/config/env.ts`

This is a deployment hardening step, not the long-term packaging model. Until the shared layer becomes a real internal package, keep the wording explicit:

- workspace truth: root `shared/`
- standalone app deploy copy: `superice-pos/src/shared/`
