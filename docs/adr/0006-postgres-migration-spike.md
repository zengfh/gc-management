# ADR 0006: Postgres Migration Spike

Status: Accepted
Date: 2026-05-12

## Context

SQLite remains the right storage engine for local and single-node Release 3 usage, but the productization docs require a clear stop line before multi-instance or SaaS deployment. The app now has persistent SQLite sessions and login-attempt throttling for a single node, but those stores are not shared across app instances.

## Spike Findings

- Current schema is portable enough for a future Postgres migration because account/user IDs, row versions, migrations, foreign keys, and account scoping already exist.
- SQLite-specific items to replace include `better-sqlite3` synchronous calls, `PRAGMA` setup, `INTEGER PRIMARY KEY` auto IDs, partial-index syntax review, `db.backup()` raw export, and SQLite-backed session/login-attempt stores.
- Multi-instance deployment must remain blocked until the database, sessions, rate limits, and operational locking are backed by shared infrastructure.
- Release 3 adds a startup guard: `GC_DEPLOYMENT_MODE=multi-instance` fails fast instead of silently running unsafe single-node state.

## Decision

Keep SQLite for local and single-node Release 3. Treat Postgres migration as required before multi-instance hosting, customer support/admin queries across accounts, or SaaS-style tenancy.

The next implementation step is not a direct driver swap. It should first extract data-access boundaries for cards, deals, users, audit, settings, idempotency, sessions, and login attempts so integration tests can run against both SQLite and Postgres.

## Consequences

- Release 3 can be used confidently as a local/private or single-node app.
- The app must not be marketed or deployed as horizontally scalable.
- Raw SQLite database export remains SQLite-specific; Postgres mode will need a separate backup/restore runbook.
- Future Postgres work should include migration rehearsal, rollback rehearsal, query-plan checks, and a concurrency/load test that covers at least inventory mutations, imports, auth, and exports.
