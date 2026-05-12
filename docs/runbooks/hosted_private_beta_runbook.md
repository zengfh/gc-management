# Hosted Private-Beta Runbook

Status: Release 4 operational runbook
Date: 2026-05-12

This runbook is for a single-node private hosted deployment. It is not a multi-instance or SaaS runbook.

## Supported Deployment Shape

Supported:

- One app process on one host.
- SQLite database on local durable disk.
- TLS via reverse proxy.
- One account with multiple users and RBAC.
- Encrypted portable backups.

Blocked:

- Multi-instance app deployment.
- Multi-tenant commercial hosting.
- Shared customer-support access across accounts.
- Postgres mode.

`GC_DEPLOYMENT_MODE=multi-instance` must remain unset or set to a non-multi-instance value.

## Required Environment

```bash
NODE_ENV=production
SESSION_SECRET=<long-random-secret>
GC_DB_PATH=/var/lib/gc-management/gcmanager.db
APP_ORIGIN=https://giftcards.example.com
GC_PLAINTEXT_EXPORT_ENABLED=false
GC_FEATURE_RAW_DATABASE_EXPORT=false
GC_REQUEST_LOGS=true
GC_METRICS_TOKEN=<long-random-token>
```

Optional:

```bash
GC_ERROR_REPORT_URL=https://errors.example.com/report
GC_ERROR_REPORT_TOKEN=<long-random-token>
```

## Reverse Proxy Checklist

- Terminate TLS with modern ciphers.
- Redirect HTTP to HTTPS.
- Preserve `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`.
- Limit request body size to match app limits.
- Do not cache `/api/*`.
- Log request path without query strings where possible.

## Startup Checklist

1. Install dependencies with `npm ci`.
2. Set the required environment.
3. Start with `npm run build`.
4. Start server with `node server/index.js` behind the reverse proxy.
5. Verify `GET /api/health`.
6. Verify security headers on `/api/health`.
7. Complete setup or login.
8. Verify `GET /api/auth/status` returns expected feature flags.
9. Verify `/api/observability/metrics` requires auth or `GC_METRICS_TOKEN`.

## Backup Procedure

Preferred backup:

1. Log in as owner/admin.
2. Open Backup.
3. Export encrypted JSON.
4. Store the encrypted JSON outside the app host.
5. Store the backup passphrase separately from the file.
6. Record the export timestamp.

Raw SQLite backup:

- Use only when operationally necessary.
- Prefer the app's raw DB export endpoint or SQLite backup API.
- If copying files manually in WAL mode, copy the database, WAL, and SHM files consistently or stop the app first.
- Treat raw SQLite files as highly sensitive.

## Restore Drill

Monthly private-beta drill:

1. Create a fresh test database.
2. Start the app with the fresh database.
3. Complete setup with a test unlock secret.
4. Import the latest encrypted portable JSON in replace mode.
5. Verify card counts, deal counts, masked last 4 values, balances, reference hints, and audit entries.
6. Reveal one known test credential to verify decryption.
7. Delete the test database after the drill.

## Monitoring

Scrape:

- `GET /api/observability/metrics` with `Authorization: Bearer $GC_METRICS_TOKEN`.

Alert candidates:

- 5xx rate above baseline.
- Repeated failed login attempts.
- Export or import failures.
- Backup overdue according to settings.
- Unexpected app restart.
- Disk space below 20%.
- SQLite database or WAL growth above expected size.

## Incident Response

Credential exposure suspected:

1. Take the app offline.
2. Preserve logs and database snapshots for analysis.
3. Rotate `SESSION_SECRET`.
4. Force logout by clearing `web_sessions`.
5. Change unlock secrets for affected users.
6. Export encrypted backup after containment.
7. Review audit log for reveal/export/import/admin actions.
8. If gift-card credentials may be exposed, treat the affected cards as compromised and follow the owner's business process.

Host compromise suspected:

1. Stop the app.
2. Snapshot host/disk if needed for investigation.
3. Rebuild on a clean host.
4. Restore from known-good encrypted portable backup.
5. Rotate all environment secrets.

## Release Gate

Before marking a hosted private-beta release ready:

- `npm run lint`.
- `npm test`.
- `npm run build`.
- `npm run test:perf`.
- `npm run test:load`.
- `npm run test:e2e`.
- `npm audit --audit-level=high`.
- OpenAPI YAML parses.
- `git diff --check`.
- Backup/restore drill completed on test data.
