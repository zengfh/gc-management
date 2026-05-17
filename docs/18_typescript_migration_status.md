# TypeScript Migration Status

Date: 2026-05-17
Status: TypeScript migration and compiler hardening complete

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
- Split reusable frontend display/date/money helpers into `src/display.ts`.
- Split file download/import helpers into `src/fileHelpers.ts`.
- Split dialog focus management into `src/useDialogFocus.ts`.
- Split credential-profile inference and credential summary helpers into `src/credentialHelpers.ts`.
- Split barcode preview rendering into `src/BarcodePreview.tsx`.
- Split shared form error rendering into `src/formUi.tsx`.
- Split shared frontend defaults into `src/defaults.ts`.
- Split backup import/export and backup settings UI into `src/backupComponents.tsx`.
- Split user access, recovery, support policy, data policy, data operations, and unlock-secret UI into `src/settingsComponents.tsx`.
- Split reusable status badge rendering into `src/StatusBadge.tsx`.
- Split card/deal detail and card/deal mutation panels into `src/cardDealPanels.tsx`.
- Split add-deal, credential-mode, and reference-review UI into `src/AddDealPanel.tsx`.
- Split metrics, cards/deals tables, audit table/filter, card search, and pagination UI into `src/tableComponents.tsx`.
- Split first-run setup, unlock, invite acceptance, and recovery screens into `src/authScreens.tsx`.
- Split the authenticated app shell and view orchestration into `src/WorkSurface.tsx`.
- Enabled `noUncheckedIndexedAccess` globally in `tsconfig.base.json`.
- Enabled `strictNullChecks` for the client and React test TypeScript project.
- Enabled `strictNullChecks` for the server TypeScript project.
- Enabled `strictNullChecks` for the e2e and performance-script TypeScript project.
- Enabled `exactOptionalPropertyTypes` globally in `tsconfig.base.json`.
- Enabled full `strict` mode globally in `tsconfig.base.json`.
- Split card search query/criteria handling into `src/cardSearch.ts` with focused unit coverage.
- Split repeated card/deal list update behavior into `src/appStateReducers.ts` with focused unit coverage.
- Split authenticated card/deal inventory workflows into `src/useInventoryController.ts`, reducing `src/App.tsx` to auth, admin/settings, backup, reference-value, and top-level screen orchestration.
- Split reference-value loading and upsert workflows into `src/useReferenceValuesController.ts`.
- Split backup settings and backup import/export workflows into `src/useBackupController.ts`.

## Current Type Safety Shape

This is now a strict TypeScript codebase with compatibility-focused runtime behavior preserved during migration.

- TypeScript is active for app/server source.
- Runtime behavior is preserved.
- Backend, frontend, shared types, React tests, Playwright specs, and performance scripts are included in static typecheck.
- Existing tests remain the behavioral safety net.
- `noImplicitAny` is enabled globally.
- `noUncheckedIndexedAccess` is enabled globally.
- `exactOptionalPropertyTypes` is enabled globally.
- `strict` is enabled globally.
- `strictNullChecks` is enabled for frontend, React tests, backend, Playwright specs, and performance scripts.
- Database row shapes are now explicit at the module boundary for the main route/helper modules touched during the migration.
- `src/App.tsx` now mostly owns auth status, data state, and API handlers, while common app types, reference-value behavior, credential display logic, file helpers, display helpers, dialog focus behavior, auth/setup screens, the authenticated app shell, backup workflows, settings/admin panels, card/deal panels, add-deal/reference UI, table/search UI, shared status rendering, and default state have dedicated modules.

## Remaining Type Hardening

- Group API handlers and state reducers to keep `src/App.tsx` smaller and make authenticated request paths easier to audit.
- Continue reducing module size by extracting admin/settings workflows from `src/App.tsx`.
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
- `npx tsc -p tsconfig.client.json --strict true --pretty false` was probed but not enabled; remaining errors are mostly deliberate nullability and exact-optional cleanup.
- `npx tsc -p tsconfig.client.json --strictNullChecks true --pretty false` passed after nullability cleanup in root auth reads, detail-card guards, backup CSV template fallback narrowing, reference-value indexed arrays, `src/main.tsx` root lookup, and test URL mocks. The flag is enabled in `tsconfig.client.json`.
- `npx tsc -p tsconfig.server.json --strictNullChecks true --pretty false` passed after hardening auth/session request boundaries, encrypted backup import passphrase narrowing, credential sorting, CSV import parsing, route ID handling, settings parsing, and nullable database aggregate reads. The flag is enabled in `tsconfig.server.json`.
- `npx tsc -p tsconfig.e2e.json --pretty false` passed after enabling strict null checks and hardening the performance load percentile helper for empty samples. The flag is enabled in `tsconfig.e2e.json`.
- `npx tsc -p tsconfig.client.json --exactOptionalPropertyTypes true --pretty false`, `npx tsc -p tsconfig.server.json --exactOptionalPropertyTypes true --pretty false`, and `npx tsc -p tsconfig.e2e.json --exactOptionalPropertyTypes true --pretty false` passed after tightening optional React props, API error fields, card search criteria, credential DTO inputs, and reserve mutation bodies. The flag is enabled globally in `tsconfig.base.json`.
- `npx tsc -p tsconfig.client.json --strict true --pretty false`, `npx tsc -p tsconfig.server.json --strict true --pretty false`, and `npx tsc -p tsconfig.e2e.json --strict true --pretty false` passed. Full strict mode is enabled globally in `tsconfig.base.json`.
- `npm run typecheck -- --pretty false`

## Verification Completed For Frontend Module Split

Completed on 2026-05-17:

- `npm run lint`
- `npm run typecheck -- --pretty false`
- `npm test`
- `npm run build`
- `git diff --check`

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
