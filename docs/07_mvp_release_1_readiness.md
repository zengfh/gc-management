# MVP Release 1 Readiness

Status: Release candidate checklist
Review date: 2026-05-11
Primary audience: engineering, QA, operator

## Scope

MVP Release 1 covers the local secure gift-card manager described in the PRD:

- Unlock-secret setup, login, logout, and unlock-secret rotation.
- Deal creation, edit, archive, restore, and deal detail.
- Card inventory list, filters, exact-number search, detail, edit, delete, and masked credential reveal/copy.
- Reserve, unreserve, sell, undo sale, record usage, undo usage, and void workflows.
- CSV import preview and confirm.
- Plaintext JSON export/import and raw SQLite database export.
- Audit list/filtering with redacted sensitive values.
- Security headers, CSRF protection, request IDs, and production session-secret validation.

## Release Gate

Run these commands from the repository root before tagging or deploying:

```bash
npm run lint
npm test
npm run test:perf
npm run test:e2e
npm run build
npm audit --audit-level=high
python3 - <<'PY'
import yaml
with open('docs/openapi.yaml') as f:
    yaml.safe_load(f)
print('openapi yaml ok')
PY
```

The release should not proceed if any gate fails, if any Critical/High bug is open, or if a backup/restore drill has not been performed on non-production sample data.

## Backup And Restore Drill

1. Create a sample vault with at least one deal, one card, one sale, one usage, and one audit entry.
2. Export a plaintext JSON backup from the Backup view using the current unlock secret and `EXPORT` confirmation.
3. Export the raw SQLite database file from the Backup view.
4. In a fresh local database, set up the same unlock secret.
5. Import the plaintext JSON backup in merge mode and verify cards, deals, balances, and audit entries.
6. Repeat with replace mode and `REPLACE` confirmation after creating different existing data.
7. Verify the replace import reports `backupCreated: true`.
8. Run `PRAGMA foreign_key_check` or `/api/health` after import.

## Rollback Plan

For local MVP usage:

1. Stop the running app process.
2. Copy the current SQLite database file to a timestamped quarantine location.
3. Restore the most recent known-good raw SQLite export to the configured `GC_DB_PATH`.
4. Restart the app with the same `SESSION_SECRET` and environment.
5. Open `/api/health` and confirm the database status is `ok`.
6. Log in with the unlock secret and verify card counts, balances, and recent audit entries.

For code rollback:

1. Identify the last known-good Git commit.
2. Deploy or run that commit against a restored known-good database copy.
3. Do not run destructive JSON replace imports until the restored app has passed the release gate.

## Known Limitations

- SQLite remains the MVP database and is intended for local/single-node usage.
- Accessibility coverage is focused on keyboard-reachable controls, visible focus states, labeled icon buttons, and critical-flow browser coverage; a formal WCAG audit remains a future hardening task.
- Load testing beyond MVP-scale sample data remains a productization-track task.
