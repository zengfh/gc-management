# Release 3 Status

Status: Release 3 complete
Review date: 2026-05-12
Primary audience: engineering, QA, operator

## Completed Milestones

### Milestone 1: Persistent Auth State For Single-Node Hosting

Status: code complete; release gate passed on 2026-05-12.

Delivered:

- Added migration `002_hosted_hardening.sql`.
- Added `web_sessions` for persistent Express session metadata.
- Added `auth_login_attempts` for persistent failed-login counters.
- Express now uses the SQLite-backed session store whenever the app is created with a database.
- Auth login throttling now uses the SQLite-backed attempt store whenever the app is created with a database.
- Session persistence stores user/session metadata only. Data-encryption keys still live only in process memory.
- After an app restart, a persisted session can remain valid, but `dekLoaded` is false and encrypted data access is blocked until the user logs in again.
- ADR 0005, PRD, security, QA, engineering, and roadmap docs have been updated for this milestone.

Verification:

- Database migration test verifies `web_sessions` and `auth_login_attempts` are created.
- Auth integration test verifies session metadata survives app recreation while encrypted data remains locked.
- Auth integration test verifies failed login counters survive app recreation.
- Focused tests passed: `npm test -- server/db/db.test.js server/routes/auth.test.js server/app.test.js`.

### Milestone 2: Credential-Safe Structured Logs

Status: code complete; release gate passed on 2026-05-12.

Delivered:

- Added structured request logging middleware.
- Request logs are enabled in production or when `GC_REQUEST_LOGS=true`.
- Request logs include request ID, method, queryless path, status, duration, account ID, and user ID.
- Logs intentionally exclude query strings, request bodies, cookies, authorization headers, card credentials, unlock secrets, and backup passphrases.
- Internal server errors write structured error metadata without request payloads.
- Engineering, QA, and roadmap docs have been updated for this milestone.

Verification:

- App test verifies request logging emits structured metadata and excludes a card number, `unlockSecret` query key, and unlock-secret query value.
- Focused test passed: `npm test -- server/app.test.js`.

### Milestone 3: Runtime Metrics Summary

Status: code complete; release gate passed on 2026-05-12.

Delivered:

- Added in-process request metrics collector.
- Added authenticated `GET /api/observability/summary`.
- Summary includes metrics start time, uptime, total requests, 5xx count, average/max duration, counts by status class, and counts by method.
- Summary intentionally does not include request paths, query strings, request bodies, headers, cookies, or credential values.
- OpenAPI, engineering, QA, and roadmap docs have been updated for this milestone.

Verification:

- App test verifies authenticated metrics response shape and confirms query details from a prior request are not returned.
- Focused test passed: `npm test -- server/app.test.js`.

### Milestone 4: User Admin And Role-Based Access

Status: code complete; release gate passed on 2026-05-12.

Delivered:

- Added per-user email, disabled status, and last-login tracking.
- Added owner/admin/operator/viewer roles.
- Added admin-only user management API and Settings UI.
- Login accepts email when multiple active users exist and blocks disabled users.
- Viewers can read inventory and audit surfaces but cannot mutate cards/deals or reveal credentials.
- Operators can manage inventory and CSV imports but cannot access admin settings, backup exports, user admin, or support/data policy controls.
- Admin/owner roles can manage users, backup policy, support policy, data policy, observability, and backup/export operations.

Verification:

- Backend RBAC tests cover create/list users, operator permissions, viewer read-only behavior, email-required login, and disabled-user login rejection.
- React tests cover admin user creation and viewer read-only navigation.
- Focused tests passed: `npm test -- server/routes/users.test.js src/App.test.jsx`.

### Milestone 5: Support Policy And Data Governance Workflows

Status: code complete; release gate passed on 2026-05-12.

Delivered:

- Added admin support-access policy settings with explicit support-access enablement, contact, policy URL, notes, updated timestamp, and updater user ID.
- Added admin data-retention policy for audit rows, idempotency records, expired web sessions, and login-attempt records.
- Added retention preview/run endpoint with fresh unlock secret and `PURGE` confirmation for destructive deletion.
- Added sanitized account export that omits card numbers, PINs, billing ZIPs, unlock-secret hashes, encrypted DEKs, and blind indexes.
- Added guarded inventory deletion workflow that removes cards, deals, usage, sale history, import jobs, and idempotency rows while preserving users/settings/audit.
- Added Settings UI controls for support policy, data policy, sanitized export, retention purge, and inventory deletion.

Verification:

- Backend admin tests cover policy updates, redacted audits, sanitized export exclusions, retention preview/purge, and inventory deletion.
- React tests cover support and data policy updates from Settings.
- Focused tests passed: `npm test -- server/routes/admin.test.js src/App.test.jsx`.

### Milestone 6: Production Observability Export And Deployment Gates

Status: code complete; release gate passed on 2026-05-12.

Delivered:

- Added Prometheus text metrics export at `GET /api/observability/metrics`.
- Metrics scraping supports admin session auth or `Authorization: Bearer <GC_METRICS_TOKEN>` for external scrapers.
- Metrics export includes aggregate counters/gauges only; it excludes request paths, query strings, request bodies, headers, cookies, and credential values.
- Added optional external error report hook via `GC_ERROR_REPORT_URL` and `GC_ERROR_REPORT_TOKEN`.
- External error reports send sanitized request ID, method, queryless path, account/user IDs, error name, and error code only.
- Added startup guard that blocks `GC_DEPLOYMENT_MODE=multi-instance` until external shared session/rate-limit stores and server database support are implemented.

Verification:

- App tests cover Prometheus metrics output, absence of query/card details, sanitized external error report payload, production session-secret guard, and multi-instance startup block.
- Focused test passed: `npm test -- server/app.test.js`.

### Milestone 7: Postgres Migration Spike

Status: documentation complete; release gate passed on 2026-05-12.

Delivered:

- Added ADR 0006 documenting the Postgres migration spike findings, blockers, and recommended sequence.
- Confirmed SQLite remains appropriate for local/single-node Release 3.
- Confirmed Postgres/shared stores are required before multi-instance hosting or SaaS-style tenancy.
- Added the runtime multi-instance guard described in ADR 0006.

Verification:

- ADR added: `docs/adr/0006-postgres-migration-spike.md`.

## Add Deal Reference Index

Status: implemented on 2026-05-12.

- Added account-scoped reference values for deal names, sources, and card brands.
- Add Deal now uses substring typeahead for indexed values.
- Unknown values are reviewed before create, with typo suggestions from existing indexed values.
- Plaintext/sanitized exports include reference values; replace imports and account data deletion clear the index.

## Current Verification

- `npm run lint` passed.
- `npm test` passed: 15 files, 125 tests.
- `npm run test:perf` passed.
- `npm run test:e2e` passed: 8 Chromium tests.
- `npm run build` passed.
- `npm audit --audit-level=high` passed with 0 vulnerabilities.
- `docs/openapi.yaml` parses successfully.
- `git diff --check` passed.

## Remaining Productization Scope

- External shared session/rate-limit stores and Postgres implementation remain required before multi-instance deployment; Release 3 now blocks that mode at startup.
- Production alert rules still need to be installed in the target monitoring platform; Release 3 documents the recommended signals and exports metrics.
- SaaS/customer support tooling remains out of scope beyond the admin support-policy record and sanitized export/delete workflows.
