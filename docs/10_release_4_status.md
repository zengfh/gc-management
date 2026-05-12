# Release 4 Status - Hosted Private-Beta Readiness

Status: implemented
Date: 2026-05-12

Release 4 completes the remaining Phase 5 productization foundation for single-node hosted private-beta use. It does not start the commercial multi-tenant track.

## Milestone 1: Privacy and Security Documentation

Status: implemented.

- Added `docs/privacy_security_release_4.md`.
- Documented data classification, encryption, auth/RBAC, CSRF, headers, backup/export policy, retention/deletion, feature flags, hosted baseline, and residual risks.
- Kept the multi-instance stop line explicit.

## Milestone 2: Feature Flags

Status: implemented.

- Added centralized feature-flag definitions in `server/config/featureFlags.js`.
- `GET /api/auth/status` now returns public feature availability.
- Backend guards block disabled CSV import, raw SQLite export, and reference-value hints.
- Plaintext JSON export continues to use `GC_PLAINTEXT_EXPORT_ENABLED=false`, now through the centralized flag system.
- The frontend hides disabled backup workflows and skips reference-value hinting/review when disabled.

Release 4 flags:

| Flag | Default | Disabled behavior |
|---|---:|---|
| `GC_PLAINTEXT_EXPORT_ENABLED` | enabled | Plaintext export blocked and settings toggle locked |
| `GC_FEATURE_RAW_DATABASE_EXPORT` | enabled | Raw SQLite export blocked |
| `GC_FEATURE_CSV_IMPORT` | enabled | CSV preview/confirm blocked |
| `GC_FEATURE_REFERENCE_VALUE_HINTS` | enabled | Reference API blocked; Add Deal uses plain entry behavior |

## Milestone 3: Performance Load Tests

Status: implemented.

- Added `npm run test:load`.
- The load test seeds 50,000 cards and 1,500 reference values by default.
- It measures p95 latency for first-page reads, status filters, text search, reference substring search, a concurrent mixed-read burst, and 2,000-row CSV preview.
- Existing `npm run test:perf` remains as the faster smoke gate.

## Milestone 4: Hosted Operations Readiness

Status: implemented.

- Added `docs/runbooks/hosted_private_beta_runbook.md`.
- Documented supported deployment shape, required environment, reverse proxy checklist, startup checklist, backup procedure, restore drill, monitoring, incident response, and release gate.
- Reconfirmed raw SQLite exports are sensitive and encrypted portable JSON is the preferred backup path.

## Milestone 5: Release 4 Certification

Status: implemented.

Release gate:

- `npm run lint` passed.
- `npm test` passed.
- `npm run build` passed.
- `npm run test:perf` passed.
- `npm run test:load` passed.
- `npm run test:e2e` passed.
- `npm audit --audit-level=high` passed with 0 vulnerabilities.
- `docs/openapi.yaml` parses successfully.
- `git diff --check` passed.

## Remaining Scope

- Multi-instance deployment still requires external shared session/rate-limit stores and Postgres or another server database.
- Commercial launch still requires legal/privacy review, external security assessment, customer support workflows, and product analytics decisions.
- Production alert rules must be installed in the target monitoring platform.
