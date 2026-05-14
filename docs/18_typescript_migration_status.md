# TypeScript Migration Status

Date: 2026-05-14
Status: Implemented as a compatibility-first migration

## Completed

- Added TypeScript toolchain and project configs for server, client, e2e, and scripts.
- Converted React source files to `.tsx`.
- Converted backend source and tests to `.ts`.
- Converted Playwright specs and performance scripts to `.ts`.
- Added `npm run typecheck`.
- Added separate client and server build scripts.
- Changed production start to run the compiled backend from `build/server/index.js`.
- Kept Vite frontend output in `dist/`.
- Copied SQL migrations into `build/server/db/migrations` during server build.
- Updated systemd templates to run the compiled server.
- Added Express request/session type augmentation for app-specific auth context.

## Current Type Safety Shape

This is the first safe migration pass. The code now compiles and typechecks, but it is not yet a fully strict domain-typed codebase.

- TypeScript is active for app/server source.
- Runtime behavior is preserved.
- Backend source is typechecked separately from test files.
- Existing tests remain the behavioral safety net.
- `noImplicitAny` is disabled for this pass to avoid a risky all-at-once rewrite of legacy JS route and UI code.

## Remaining Type Hardening

- Turn on `noImplicitAny` once route/service boundaries have explicit request, row, and response types.
- Add shared domain types for cards, deals, users, auth status, settings, and backup payloads.
- Replace broad `any` usage in `src/App.tsx` with typed API models as the frontend is split into smaller modules.
- Type DB row helpers by module instead of allowing dynamic row shapes everywhere.
- Include tests in static typecheck after source types are stable.

## Verification Completed

Completed on 2026-05-14:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `E2E_CLIENT_PORT=5174 E2E_API_PORT=3002 npm run test:e2e`
- `npm audit --audit-level=high`
- `git diff --check`
- `PERF_CARD_COUNT=100 PERF_CSV_ROWS=2 npm run test:perf`
- Compiled backend smoke test against a temporary database
- Hosted smoke test after restarting `gc-management.service` on `build/server/index.js`
