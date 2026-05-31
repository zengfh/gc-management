# Hosted Private-Beta Runbook

Status: Release 5.1 production-style single-node runbook
Date: 2026-05-14

This runbook is for a single-node private hosted deployment. It is not a multi-instance or SaaS runbook.

## Production Hosting Model

The production app is one Node/Express process:

- `npm run build` creates the Vite frontend bundle in `dist/` and compiles the backend into `build/server/`.
- `npm start` runs `build/server/index.js`.
- Express serves both the built frontend and `/api/*` from the same origin.
- Caddy or Nginx should terminate TLS and reverse proxy to the local app port.
- The Vite dev server and `vite preview` are not part of production hosting.

Research basis:

- Vite production deployment uses `vite build`, writes to `dist` by default, and states that `vite preview` is for local preview rather than production serving: https://vite.dev/guide/static-deploy.html
- Express supports serving static files with the built-in `express.static` middleware: https://expressjs.com/en/starter/static-files.html
- Caddy can serve HTTPS sites with automatic certificate management and reverse proxying: https://caddyserver.com/docs/quick-starts/reverse-proxy
- Nginx documents reverse proxying requests to an upstream HTTP server with `proxy_pass`: https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/
- systemd service units provide restart supervision, while `systemd.exec` covers `WorkingDirectory`, `EnvironmentFile`, `StateDirectory`, `LogsDirectory`, and hardening controls: https://www.freedesktop.org/software/systemd/man/systemd.service.html and https://www.freedesktop.org/software/systemd/man/systemd.exec.html

## Supported Deployment Shape

Supported:

- One app process on one host.
- SQLite database on local durable disk.
- TLS via reverse proxy.
- Built frontend served by the app process from `dist/`.
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
PORT=3001
HOST=127.0.0.1
SESSION_SECRET=<long-random-secret>
GC_DB_PATH=/var/lib/gc-management/gcmanager.db
APP_ORIGIN=https://giftcards.example.com
GC_SERVE_STATIC=true
GC_TRUST_PROXY=true
GC_SESSION_COOKIE_SECURE=true
GC_DEPLOYMENT_MODE=single-node
GC_PLAINTEXT_EXPORT_ENABLED=false
GC_FEATURE_RAW_DATABASE_EXPORT=false
GC_FEATURE_CSV_IMPORT=true
GC_FEATURE_REFERENCE_VALUE_HINTS=true
GC_REQUEST_LOGS=true
GC_METRICS_TOKEN=<long-random-token>
GC_EXPIRATION_NOTIFICATIONS_ENABLED=true
GC_NOTIFICATION_FROM_EMAIL=Gift Card Manager <notifications@giftcards.example.com>
GC_SMTP_HOST=smtp.example.com
GC_SMTP_PORT=587
GC_SMTP_SECURE=false
GC_SMTP_USER=<smtp-user>
GC_SMTP_PASS=<smtp-password>
```

Optional:

```bash
GC_ERROR_REPORT_URL=https://errors.example.com/report
GC_ERROR_REPORT_TOKEN=<long-random-token>
GC_NOTIFICATION_RECIPIENT_EMAIL=admin@example.com
```

Expiration notifications are sent to active owner/admin users with email addresses. `GC_NOTIFICATION_RECIPIENT_EMAIL` can override recipients for a private single-user deployment where the existing owner record has no email. Month/year expirations such as `11/2026` are treated as `2026-11-01`; cards without expiration are ignored. The app sends at 28, 21, 14, 7, 5, 4, 3, 2, and 1 days before expiration and records a delivery row so each card/threshold/recipient is sent once.

After SMTP is configured, use Settings -> Data Operations -> Send expiration email test to verify delivery from the browser. The test sends through the same configured mail transport but does not require a card to be near expiration.

Temporary SSH-tunnel testing without TLS can set `GC_SESSION_COOKIE_SECURE=false` and use an `APP_ORIGIN` such as `http://localhost:5180,http://127.0.0.1:5180`. Do not use that setting for a public HTTPS deployment.

## AI Model Refresh

AI Import keeps a short in-memory list of configured model choices. The server refreshes that list on startup, every 24 hours, and when it receives `SIGUSR2`.

For a private VPS deployment, add a daily cron entry that signals the running app process:

```cron
17 9 * * * /usr/bin/pkill -USR2 -f '^/usr/bin/node build/server/index.js$' >> /home/opc/gc-management-data/release5/ai-model-refresh.cron.log 2>&1
```

This cron entry does not store API keys or call an unauthenticated HTTP endpoint. It only asks the already-running app process to refresh provider metadata using its configured environment.

## Deployment Layout

Recommended host layout:

```text
/opt/gc-management/current        # checked-out release or symlink to current release
/etc/gc-management/gc-management.env
/var/lib/gc-management/gcmanager.db
/var/log/gc-management/
```

Repository templates:

- `deploy/env/gc-management.env.example`
- `deploy/caddy/gc-management.Caddyfile`
- `deploy/systemd/gc-management.service`
- `deploy/systemd/gc-management.user.service`
- `deploy/nginx/gc-management.conf`

The user-level systemd template is for private SSH-tunnel trials on a VPS without DNS/TLS. The Caddy template is the preferred HTTPS edge on this VPS because Caddy is already installed and bound to ports 80 and 443. The Nginx template remains available for hosts that standardize on Nginx.

## Reverse Proxy Checklist

- Terminate TLS with modern ciphers.
- Redirect HTTP to HTTPS.
- Preserve `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`.
- Limit request body size to match app limits.
- Do not cache `/api/*`.
- Log request path without query strings where possible.

## Startup Checklist

1. Check out the release on the host.
2. Install dependencies with `npm ci`.
3. Build the frontend with `npm run build`.
4. Copy `deploy/env/gc-management.env.example` to `/etc/gc-management/gc-management.env` and replace all secrets and origins.
5. Copy `deploy/systemd/gc-management.service` to `/etc/systemd/system/gc-management.service`.
6. Configure either Caddy with `deploy/caddy/gc-management.Caddyfile` or Nginx with `deploy/nginx/gc-management.conf`.
7. Run `sudo systemctl daemon-reload`.
8. Run `sudo systemctl enable --now gc-management`.
9. Validate and reload the reverse proxy.
10. Verify `GET /api/health` through both `http://127.0.0.1:$PORT` and the public HTTPS origin.
11. Verify `/` and a deep SPA path such as `/cards` return the built frontend.
12. Complete setup or login.
13. Verify `GET /api/auth/status` returns expected feature flags.
14. Verify `/api/observability/metrics` requires auth or `GC_METRICS_TOKEN`.

Minimal service install commands:

```bash
sudo useradd --system --home /var/lib/gc-management --shell /usr/sbin/nologin gcmanager
sudo install -d -o gcmanager -g gcmanager -m 700 /var/lib/gc-management /var/log/gc-management
sudo install -d -o root -g root -m 755 /etc/gc-management /opt/gc-management
sudo install -o root -g root -m 600 deploy/env/gc-management.env.example /etc/gc-management/gc-management.env
sudo install -o root -g root -m 644 deploy/systemd/gc-management.service /etc/systemd/system/gc-management.service
```

Edit `/etc/gc-management/gc-management.env` before starting the service.

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
