# Release 4 Privacy and Security Notes

Status: operational draft for private hosted use
Date: 2026-05-12

This document describes the current security and privacy posture of the gift-card manager. It is not legal advice and should be reviewed before commercial or third-party use.

## Data Classification

Highly sensitive data:

- Full gift-card numbers.
- PINs.
- Billing ZIPs.
- Unlock secrets.
- Backup passphrases.
- Raw SQLite database exports.
- Plaintext JSON exports.

Operational data:

- Card brand, type, face value, purchase cost, remaining balance, status, expiration, source, deal metadata, sale records, usage records, reservation metadata, and notes.
- User email, display name, role, disabled status, login timestamps, support policy, data policy, and backup settings.
- Reference values for deal names, sources, and card brands.

Audit and observability data:

- Request IDs, action names, entity IDs, timestamps, redacted old/new values, summary counts, and process-local metrics.
- Logs intentionally omit query strings, request bodies, cookies, authorization headers, card credentials, unlock secrets, and backup passphrases.

## Encryption Model

- Gift-card numbers, PINs, and billing ZIPs are encrypted at rest.
- The data encryption key is wrapped by a key derived from the unlock secret.
- Unlocking loads decrypted key material into process memory for the current session.
- Server restart or logout clears usable key material and requires re-unlock.
- Exact card-number search uses a blind index; partial card-number search remains intentionally out of scope.

## Authentication and Authorization

- The app uses a setup flow to create the first owner user.
- First-run setup records owner email and display name for multi-user login and recovery flows.
- Sessions are HTTP-only and SameSite strict.
- Production mode requires an explicit `SESSION_SECRET`.
- Authenticated roles are owner, admin, operator, and viewer.
- Admin operations are limited to owner/admin roles.
- Inventory mutations are limited to owner/admin/operator roles.
- Viewers can read inventory but cannot reveal credentials or mutate data.
- Owner/admin users can create one-time invites so invited users choose their own unlock secret.
- Each user can generate one-time recovery codes while unlocked; recovery codes rewrap the vault key under a new unlock secret and are shown once.
- Recovery reset does not auto-login the user.

## CSRF, Headers, and Browser Safety

- Mutating requests require CSRF tokens and trusted Origin/Referer checks.
- Security headers include CSP, frame denial, no-referrer policy, and HSTS in production.
- UI renders user-entered strings as text, not HTML.
- Sensitive credentials are hidden by default and revealed only through explicit credential-reveal actions.

## Backup and Export Policy

- Encrypted portable JSON is the preferred backup/export format.
- Plaintext JSON export can be policy-disabled with `GC_PLAINTEXT_EXPORT_ENABLED=false`.
- Raw SQLite export can be disabled with `GC_FEATURE_RAW_DATABASE_EXPORT=false`.
- Plaintext and raw database exports require a fresh unlock secret.
- Backup/export audit events include only summary metadata.
- Raw SQLite exports are sensitive because encrypted card credentials and key material are present in the database file.
- Recovery codes and backup passphrases should be stored in the owner's password manager, not in git, docs, shell history, or chat transcripts.

## Data Retention and Deletion

- Admins can configure retention windows for audit rows, idempotency keys, expired web sessions, and login-attempt records.
- Retention purge requires fresh unlock secret and confirmation.
- Inventory deletion preserves users and audit while deleting deals, cards, transactions, usages, imports, idempotency keys, and reference values.
- Sanitized account export omits card numbers, PINs, billing ZIPs, unlock-secret hashes, encrypted DEKs, and blind indexes.

## Feature Flags

Release 4 centralizes deployment feature flags:

| Flag | Default | Effect when set to `false` |
|---|---:|---|
| `GC_PLAINTEXT_EXPORT_ENABLED` | enabled | Blocks plaintext JSON export and locks the settings toggle off |
| `GC_FEATURE_RAW_DATABASE_EXPORT` | enabled | Blocks raw SQLite database export |
| `GC_FEATURE_CSV_IMPORT` | enabled | Blocks CSV import preview and confirm |
| `GC_FEATURE_REFERENCE_VALUE_HINTS` | enabled | Blocks reference-value API and disables Add Deal indexed hints/review |

Public feature availability is returned by `GET /api/auth/status` so the UI can hide disabled workflows.

## Private Hosted Deployment Baseline

Recommended minimum:

- `NODE_ENV=production`.
- Strong `SESSION_SECRET`.
- `GC_PLAINTEXT_EXPORT_ENABLED=false` unless explicitly approved.
- TLS terminated by a reverse proxy.
- Request logs enabled and rotated.
- Prometheus metrics scraped with `GC_METRICS_TOKEN`.
- Optional sanitized error-report webhook configured through `GC_ERROR_REPORT_URL`.
- Regular encrypted portable backups and periodic restore drills.

Do not run multi-instance deployments yet. `GC_DEPLOYMENT_MODE=multi-instance` fails fast until external shared sessions, shared rate limits, and a server database are implemented.

## Residual Risks

- This is still a single-node SQLite deployment model.
- The process memory contains decrypted key material while a user session is unlocked.
- Browser compromise, host compromise, or leaked backups can expose sensitive value.
- Commercial launch still needs legal/privacy review, compliance review, and independent security assessment.
- Passkey convenience unlock exists for private use, but third-party product use still needs formal MFA policy, account recovery policy, and true multi-tenant isolation.
