# ADR 0005: Hosted Hardening Gates

Status: Accepted
Date: 2026-05-12

## Context

The MVP is local-first and single-owner. Release 2 adds productization seams, but a hosted or small-team deployment changes the risk profile: sessions and rate limits must survive process restarts and multiple app instances, operators need production observability, and plaintext exports need a stricter policy than local personal use.

## Decision

Before hosted team use, the app must pass these gates:

1. Persistent session store: do not use the default in-memory Express session store for hosted multi-user use. Use a persistent store tied to the deployment architecture, such as Redis or the production database.
2. Persistent rate-limit store: login and sensitive-action throttles must use a shared store across processes/instances. In-memory counters are acceptable only for local MVP usage.
3. Observability baseline: structured request logs with request IDs, server error reporting, auth/import/export audit counters, health checks, and alerting on backup/import/export failures.
4. Plaintext export policy: encrypted portable JSON is the default support/backup path. Hosted deployments must set `GC_PLAINTEXT_EXPORT_ENABLED=false` unless a documented operator policy explicitly allows plaintext export for a limited operational reason.
5. Support access policy: admin/support access, audit retention, data deletion/export workflows, and recovery procedures must be written before customer or team rollout.

## Implementation Status

- `GC_PLAINTEXT_EXPORT_ENABLED=false` is implemented. It policy-locks plaintext JSON export off, prevents settings from enabling it, and returns 403 for plaintext export attempts.
- Session and rate-limit persistence are documented gates, not yet implemented infrastructure choices.
- Observability is still limited to request IDs, health checks, security headers, and audit rows. Production logging/metrics/error reporting remain future work.

## Consequences

- Local personal use remains simple and can keep plaintext export available through account settings.
- Hosted use has a clear stop line: do not deploy as a multi-user/team product until persistent stores and observability are in place.
- The plaintext export decision is now enforceable by environment policy rather than relying only on operator behavior.
