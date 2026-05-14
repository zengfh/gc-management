# Release 5.1 Production-Style Hosting Status

Date: 2026-05-14
Status: Implemented and ready for private VPS trial

## Research Summary

The production hosting path is based on current official deployment guidance:

- Vite builds production frontend assets into `dist/`; `vite preview` is for local preview rather than production serving.
- Express has first-party static file middleware, which is sufficient for this single-node private deployment when paired with explicit SPA fallback behavior.
- Nginx is the recommended edge process for TLS termination and reverse proxying to the local Node process.
- systemd is the recommended process supervisor for restart behavior, environment loading, working directory control, persistent state directories, log directories, and filesystem hardening.

References:

- https://vite.dev/guide/static-deploy.html
- https://expressjs.com/en/starter/static-files.html
- https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/
- https://www.freedesktop.org/software/systemd/man/systemd.service.html
- https://www.freedesktop.org/software/systemd/man/systemd.exec.html

## Completed

- Added production static serving to the Express app.
- Kept `/api/*` as API-only routes so missing API endpoints still return JSON 404 responses instead of the frontend shell.
- Added SPA fallback for non-file frontend routes such as `/cards`.
- Added long-lived immutable cache headers for built Vite assets under `/assets`.
- Added no-cache headers for `index.html` and SPA fallback responses.
- Added production startup failure when static serving is enabled but `dist/index.html` is missing.
- Added environment controls for static serving, reverse-proxy trust, and secure session cookies.
- Added `npm start` and `npm run start:prod` scripts.
- Added deploy templates for systemd, Nginx, and production environment variables.
- Updated the hosted private-beta runbook for the single-process production shape.

## Current VPS Private-Trial Runtime

The private VPS trial can run the same production build through one local port:

- UI and API: `http://127.0.0.1:5180`
- Runtime database: `/home/opc/gc-management-data/release5/gcmanager.db`
- Runtime logs: `/home/opc/gc-management-data/release5/prod.log`
- Runtime PID file: `/home/opc/gc-management-data/release5/prod.pid`

Because this private trial is normally reached through an SSH tunnel over plain HTTP, it should set `GC_SESSION_COOKIE_SECURE=false`. A real public HTTPS deployment should keep `GC_SESSION_COOKIE_SECURE=true`.

Laptop access for the private-trial runtime:

```bash
ssh -L 5180:127.0.0.1:5180 <user>@<vps-host>
```

Then open `http://localhost:5180`.

## Production Deployment Target

For an actual hosted deployment:

- Install the app under `/opt/gc-management/current`.
- Store environment config in `/etc/gc-management/gc-management.env`.
- Store the SQLite database under `/var/lib/gc-management/gcmanager.db`.
- Run the app under systemd using `deploy/systemd/gc-management.service`.
- Terminate HTTPS in Nginx using `deploy/nginx/gc-management.conf`.
- Keep real gift-card data, backups, logs, and passphrases out of git.

## Verification

Required gate after code changes:

- `npm run lint`
- `npm test`
- `npm run build`
- Production smoke test against a temporary database
- `git diff --check`

## Remaining Work

- Install the systemd and Nginx templates on a real DNS-backed HTTPS host when one is available.
- Run a restore drill with real encrypted portable backups after the owner has entered real private data.
- Keep collecting Release 5.1 polish issues from the private trial.
