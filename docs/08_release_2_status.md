# Release 2 Status

Status: Release 2 foundation complete
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

### Milestone 2: Backup Settings Controls

Status: code complete; release gate passed on 2026-05-12.

Delivered:

- `GET /api/settings/backup` returns plaintext-export status, backup reminder interval, backup due state, and last backup timestamps.
- `PUT /api/settings/backup` updates backup reminder days and the plaintext export toggle after validating the current unlock secret.
- Settings updates write redacted audit metadata and never store unlock secrets in audit rows.
- Plaintext JSON export is now server-enforced by the `allowPlaintextExport` setting; disabled exports return 403 and write no export audit event.
- Successful plaintext, encrypted, and raw database exports record last-export timestamps in `app_settings`.
- Settings UI now includes backup status, plaintext export toggle, backup reminder interval, and backup export history.
- OpenAPI, security, UX, PRD, and roadmap docs have been updated for this milestone.

Verification:

- Backend tests for backup settings defaults, secure updates, wrong-secret rejection, plaintext-export disablement, and encrypted backup timestamp recording.
- React tests for backup settings update UX.
- `npm run lint` passed.
- `npm test` passed: 12 files, 94 tests.
- `npm run test:e2e` passed: 7 Chromium tests.
- `npm run build` passed.
- `npm audit --audit-level=high` passed with 0 vulnerabilities.
- `docs/openapi.yaml` parses successfully.
- `git diff --check` passed.

### Milestone 3: Reservation Metadata UX/API Polish

Status: code complete; release gate passed on 2026-05-12.

Delivered:

- Card API responses now include `reservedFor`, `reservedUntil`, and `reservedNotes`.
- Reserve action now opens a UI panel for reserved-for, reserved-until, and reservation notes instead of immediately reserving with an empty payload.
- Card list shows a reservation summary for reserved cards.
- Card detail shows reservation metadata alongside other card metadata.
- Unreserve continues to clear reservation metadata.
- UI/UX, QA, PRD, and roadmap docs have been updated for this milestone.

Verification:

- Backend test now asserts reservation metadata is returned on reserve and cleared on unreserve.
- React test now exercises the reserve metadata panel and verifies the reserve payload.
- `npm run lint` passed.
- `npm test` passed: 12 files, 94 tests.
- `npm run test:e2e` passed: 7 Chromium tests.
- `npm run build` passed.
- `npm audit --audit-level=high` passed with 0 vulnerabilities.
- `docs/openapi.yaml` parses successfully.
- `git diff --check` passed.

### Milestone 4: Better P&L Dashboard

Status: code complete; release gate passed on 2026-05-12.

Delivered:

- Dashboard metrics now include active cost basis, active gross margin, sold proceeds, realized P&L, reserved remaining, in-use remaining, expiring-30-day remaining value, and stale reservation count.
- Card list responses include `latestSalePriceCents` for the latest non-reversed sale, so dashboard P&L can avoid counting undone sales.
- Sell and undo-sale UI updates keep the in-memory dashboard data consistent without requiring a full reload.
- UI/UX, QA, PRD, and roadmap docs have been updated for this milestone.

Verification:

- Backend test verifies `latestSalePriceCents` appears for sold cards and clears after undo sale.
- React test verifies dashboard P&L and risk metrics from mixed inventory data.
- `npm run lint` passed.
- `npm test` passed: 12 files, 95 tests.
- `npm run test:e2e` passed: 7 Chromium tests.
- `npm run build` passed.
- `npm audit --audit-level=high` passed with 0 vulnerabilities.
- `docs/openapi.yaml` parses successfully.
- `git diff --check` passed.

### Milestone 5: Modal Accessibility Polish

Status: code complete; release gate passed on 2026-05-12.

Delivered:

- Shared slide-panel focus hook moves focus into newly opened dialogs.
- Dialogs now support Escape-to-close.
- Tab and Shift+Tab are trapped inside open dialogs.
- Focus restores to the launching control when the dialog closes.
- The behavior is applied across card detail, deal detail, add/edit/delete/reserve/sell/use/void/undo panels.
- UI/UX, QA, PRD, and roadmap docs have been updated for this milestone.

Verification:

- React test verifies reserve dialog initial focus, Escape close, and focus restoration.
- `npm run lint` passed.
- `npm test` passed: 12 files, 96 tests.
- `npm run test:e2e` passed: 7 Chromium tests.
- `npm run build` passed.
- `npm audit --audit-level=high` passed with 0 vulnerabilities.
- `docs/openapi.yaml` parses successfully.
- `git diff --check` passed.

### Milestone 6: Performance Smoke Tests

Status: code complete; release gate passed on 2026-05-12.

Delivered:

- Added `npm run test:perf`.
- Performance smoke seeds 20,000 cards in an in-memory migrated database.
- Smoke coverage exercises first page list, status filtering, text search, 25 high-frequency list reads, and 1,000-row CSV preview through the real Express routes.
- Thresholds are configurable by environment variables and default to smoke-test tolerances suitable for a VPS.
- QA, PRD, and roadmap docs have been updated for this milestone.

Verification:

- `npm run test:perf` passed locally with all measured operations under configured thresholds.

### Milestone 7: CSV Import Templates

Status: code complete; release gate passed on 2026-05-12.

Delivered:

- Backup UI can download GC Manager, marketplace, and prepaid CSV templates.
- CSV import preview/confirm now accept common marketplace/prepaid aliases including merchant/issuer, value/face amount, cost/cost basis, number/account number, claim code, postal code, expires/exp date, delivery/medium, seller/purchase source, and memo/description.
- CSV import normalizes common digital/physical delivery values and prepaid network values.
- Confirmed prepaid imports persist network metadata.
- UI/UX, QA, PRD, and roadmap docs have been updated for this milestone.

Verification:

- Backend tests cover marketplace alias preview and prepaid alias confirm.
- React test covers template download controls.

### Milestone 8: Automated Accessibility Checks

Status: code complete; release gate passed on 2026-05-12.

Delivered:

- Added `@axe-core/playwright` dev dependency.
- Added `e2e/accessibility.spec.js`.
- Automated WCAG A/AA axe checks cover Dashboard, Cards, Add Deal dialog, Backup, and Settings.
- UI/UX, QA, PRD, and roadmap docs have been updated for this milestone.

Verification:

- `npm run test:e2e -- e2e/accessibility.spec.js` passed in Chromium.

### Milestone 9: Hosted Hardening Policy

Status: code complete; release gate passed on 2026-05-12.

Delivered:

- Added deployment-level plaintext export policy lock with `GC_PLAINTEXT_EXPORT_ENABLED=false`.
- Backup settings responses now include `plaintextExportPolicyLocked`.
- Settings updates reject attempts to enable plaintext export when deployment policy locks it off.
- Plaintext export returns 403 when deployment policy disables it, regardless of account-level settings.
- Settings UI shows plaintext export as policy locked and disables the toggle.
- Added ADR 0005 for hosted hardening gates covering persistent session store, persistent rate-limit store, observability, plaintext export policy, and support access policy.
- OpenAPI, security, PRD, and roadmap docs have been updated for this milestone.

Verification:

- Backend tests cover policy-locked settings, enable rejection, and plaintext export block.
- React test covers the policy-locked settings UI.

## Current Verification

- `npm run lint` passed.
- `npm test` passed: 12 files, 101 tests.
- `npm run test:perf` passed.
- `npm run test:e2e` passed: 8 Chromium tests.
- `npm run build` passed.
- `npm audit --audit-level=high` passed with 0 vulnerabilities.
- `docs/openapi.yaml` parses successfully.
- `git diff --check` passed.

## Remaining Productization Scope

- Persistent session store for hosted/team deployment.
- Persistent rate-limit store for hosted/team deployment.
- Production observability: structured logs, metrics, alerts, and error reporting.
- Real account/user admin if the app moves beyond single-owner use.
- Postgres migration spike if concurrent hosted usage outgrows SQLite deployment assumptions.

## Notes

- Backup passphrases are intentionally not recoverable in the current local MVP architecture. A hosted or multi-user product still needs real authentication, account recovery, and documented secret recovery/support policy.
- Plaintext JSON export remains available for local MVP use, but hosted deployments can and should policy-lock it off with `GC_PLAINTEXT_EXPORT_ENABLED=false` unless there is a documented operational need.
