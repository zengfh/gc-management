# ADR 0001: SQLite for Local MVP

## Status

Accepted

## Context

The MVP targets local/private operation first. The design docs require strict data integrity, explicit migrations, WAL mode, and a future migration path to Postgres before multi-instance or multi-tenant hosting.

## Decision

Use SQLite with `better-sqlite3` for the MVP. Enable WAL mode, foreign keys, busy timeout, and explicit migration tracking from the first implementation slice.

All business tables include `accountId` and row-version style fields where useful so future migration to a server database does not require a domain rewrite.

## Consequences

SQLite keeps local deployment and backup simple, but the app must remain single-process/single-node until a Postgres migration is completed. Critical mutations must use write transactions and re-read state inside the transaction.
