# Release 3 Status

Status: In progress
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

## Current Verification

- `npm run lint` passed.
- `npm test` passed: 12 files, 103 tests.
- `npm run test:perf` passed.
- `npm run test:e2e` passed: 8 Chromium tests.
- `npm run build` passed.
- `npm audit --audit-level=high` passed with 0 vulnerabilities.
- `docs/openapi.yaml` parses successfully.
- `git diff --check` passed.

## Remaining Productization Scope

- Production observability: structured logs, metrics, alerts, and error reporting.
- Real account/user admin if the app moves beyond single-owner use.
- Role-based access controls.
- Support/admin access policy implementation.
- Data retention and deletion/export workflows.
- External shared session/rate-limit stores before multi-instance deployment.
- Postgres migration spike if concurrent hosted usage outgrows SQLite deployment assumptions.
