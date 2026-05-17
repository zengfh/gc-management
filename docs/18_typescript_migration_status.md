# TypeScript Migration Status

Date: 2026-05-17
Status: TypeScript migration and second hardening pass complete

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
- Added shared domain/API types in `shared/domain.ts` for auth, users, cards, deals, reference values, backup/settings, pagination, and API envelopes.
- Split frontend API transport into `src/api.ts` with typed JSON/download helpers and a structured `ApiError`.
- Replaced broad frontend `any` surfaces in `src/App.tsx` with typed app state, API payloads, form models, detail models, and handlers.
- Added explicit row/input/helper types across backend auth, card, deal, backup, admin, settings, observability, security, database, and route modules.
- Added static type coverage for React unit tests, Playwright e2e specs, and performance scripts.
- Enabled `noImplicitAny` globally in `tsconfig.base.json`.
- Split shared frontend app state/API handler types into `src/appTypes.ts`.
- Split reference-value indexing, substring matching, and typo-suggestion helpers into `src/referenceValues.ts`.
- Enabled `noUncheckedIndexedAccess` globally in `tsconfig.base.json`.

## Current Type Safety Shape

This is still a compatibility-first TypeScript codebase rather than a fully strict rewrite, but implicit `any` and unchecked indexed access are now blocked across the checked source tree.

- TypeScript is active for app/server source.
- Runtime behavior is preserved.
- Backend, frontend, shared types, React tests, Playwright specs, and performance scripts are included in static typecheck.
- Existing tests remain the behavioral safety net.
- `noImplicitAny` is enabled globally.
- `noUncheckedIndexedAccess` is enabled globally.
- Database row shapes are now explicit at the module boundary for the main route/helper modules touched during the migration.
- `src/App.tsx` remains large, but common app types and reference-value behavior now have dedicated modules.

## Remaining Type Hardening

- Continue splitting `src/App.tsx` into smaller feature modules, starting with backup/settings panels or card/deal panels.
- Gradually enable stricter compiler flags after module splitting: `strictNullChecks`, `exactOptionalPropertyTypes`, then full `strict`.
- Consider generated or hand-maintained OpenAPI-derived request/response types so server route responses and frontend API calls cannot drift.
- Add more focused unit coverage around backup import/export typing and CSV credential-profile parsing before stricter null/index checks.
- Keep any future scripts and test helpers in `npm run typecheck` so new implicit-any regressions fail early.

## Verification Completed For Strict Implicit-Any Pass

Completed on 2026-05-14:

- `npx tsc -p tsconfig.client.json --pretty false`
- `npx tsc -p tsconfig.server.json --noImplicitAny true --pretty false`
- `npm run typecheck -- --pretty false`

## Verification Completed For Second Hardening Pass

Completed on 2026-05-17:

- `npx tsc -p tsconfig.client.json --noUncheckedIndexedAccess true --pretty false`
- `npx tsc -p tsconfig.server.json --noUncheckedIndexedAccess true --pretty false`
- `npx tsc -p tsconfig.e2e.json --noUncheckedIndexedAccess true --pretty false`
- `npx tsc -p tsconfig.client.json --strict true --pretty false` was probed but not enabled; remaining errors are mostly deliberate nullability and exact-optional cleanup in `src/App.tsx`, test URL mocks, `src/main.tsx`, and `src/api.ts`.
- `npx tsc -p tsconfig.client.json --strictNullChecks true --exactOptionalPropertyTypes true --pretty false` was probed but not enabled for the same reason.
- `npm run typecheck -- --pretty false`

## Verification Completed

Completed for the original migration pass on 2026-05-14:

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
