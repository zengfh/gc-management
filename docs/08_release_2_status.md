# Release 2 Status

Status: In progress
Review date: 2026-05-12
Primary audience: engineering, QA, operator

## Completed Milestones

### Milestone 1: Encrypted Portable Backup

Status: code complete; release gate passed on 2026-05-12.

Delivered:

- `POST /api/backup/export-encrypted` creates an encrypted portable JSON backup.
- Encrypted export requires a valid session, CSRF/Origin checks, the current unlock secret, a separate backup passphrase, and `ENCRYPT` confirmation.
- The server rejects an encrypted export when the backup passphrase exactly reuses the unlock secret.
- Portable backup envelope includes schema version, app version, export timestamps, scrypt KDF parameters, and AES-256-GCM ciphertext/authentication metadata.
- Encrypted export and import audit events store counts/metadata only, not card numbers, PINs, ZIPs, unlock secrets, or backup passphrases.
- `POST /api/backup/import` can restore either plaintext JSON or encrypted portable JSON in merge/replace mode.
- Encrypted JSON import re-encrypts credentials into the current vault and rejects wrong backup passphrases with no database side effects.
- Backup UI now includes encrypted JSON export and encrypted JSON import blocks.
- OpenAPI, security, QA, PRD, and roadmap docs have been updated for this milestone.

Verification:

- Backend integration tests for encrypted export, passphrase reuse rejection, encrypted restore, and wrong-passphrase rejection.
- React tests for encrypted export and encrypted import UI submission.
- Browser E2E drill for encrypted export followed by encrypted replace import.
- `npm run lint` passed.
- `npm test` passed: 11 files, 89 tests.
- `npm run test:e2e` passed: 7 Chromium tests.
- `npm run build` passed.
- `npm audit --audit-level=high` passed with 0 vulnerabilities.
- `docs/openapi.yaml` parses successfully.
- `git diff --check` passed.

## Remaining Release 2 Scope

- Settings page expansion beyond unlock-secret rotation.
- Reservation metadata UX and API polish.
- Better P&L dashboard.
- Accessibility polish and formal WCAG-oriented checks.
- More import templates.
- Performance smoke/load tests.
- Hosted-use hardening decisions: persistent session store, persistent rate-limit store, observability, and plaintext export feature flag policy.

## Notes

- Backup passphrases are intentionally not recoverable in the current local MVP architecture. A hosted or multi-user product still needs real authentication, account recovery, and documented secret recovery/support policy.
- Plaintext JSON export remains available for local MVP use, but should be disabled or gated before broader product/SaaS usage unless there is a clear operational need.
