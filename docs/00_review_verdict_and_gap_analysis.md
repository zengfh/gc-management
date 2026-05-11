# Gift Card Management Web App - Document Review Verdict and Gap Analysis

Review date: 2026-05-10

Reviewed source documents:

- docs/prd.md
- docs/implementation_plan.md
- docs/constraints_and_security.md
- docs/ui_ux_spec.md
- docs/qa_test_plan.md

Assumptions:

- The PRD remains the source of truth for product requirements.
- The current app may start as a personal or small-team tool, but the architecture should not block a future product with about 1000 DAU.
- This review is based on the documentation, not a source-code audit.
- Recommendations are written for a capable but small team that needs clarity, sequencing, and maintainability.

## 1. Executive Verdict

The current documentation has a strong technical core, especially around state transitions, encryption, data constraints, backup/import behavior, and verification scenarios. The largest risk is that the product, UX, and QA documents are much thinner than the implementation and security documents. That imbalance can cause engineers to build a technically sophisticated app whose workflows, acceptance criteria, release process, and productization path are under-specified.

Overall verdict: Proceed, but do not start broad feature implementation until the team aligns on the revised PRD, API contract, UX flows, and QA traceability matrix.

Suggested readiness grades:

| Area | Current Grade | Reason | Target Before Main Build |
|---|---:|---|---:|
| Product requirements | C+ | Clear concept, but too brief for team execution. Missing acceptance criteria, success metrics, scope boundaries, and productization assumptions. | A- |
| Engineering implementation | B+ | Detailed state machine, data model, endpoints, and crypto design. Needs API schemas, migration plan, idempotency, product-scale seams, and operational guidance. | A- |
| Security and data integrity | B+ | Strong encryption, CSRF, backup/import, and verification thinking. Needs XSS/CSP, CVV hardline policy, per-user future model, production rate limiting, and threat model. | A |
| UI/UX | C | Good design direction, but lacks full flows, form behavior, responsive states, accessibility acceptance, empty/error states, and data-entry details. | A- |
| QA | C+ | Good core scenarios, and the supplementary security document has many tests, but QA needs a canonical test plan, automation strategy, and CI gates. | A- |
| Productization readiness | C | Current design is intentionally single-process/single-user. Fine for MVP, but risky unless migration seams are added early. | B+ |

## 2. What Is Already Strong

### 2.1 Data integrity mindset

The docs consistently use integer cents, explicit status values, immutable balances through PUT, and action endpoints for lifecycle changes. This is the right foundation for a money-adjacent inventory tool.

### 2.2 State machine clarity

The implementation plan makes important business decisions explicit: partial-use cards can be sold, undo-sale restores the previous state, void always writes off remaining balance, and undo-usage recalculates balance instead of assuming stack-only reversal. These are high-quality requirements.

### 2.3 Security posture is above typical MVP level

Envelope encryption, AES-GCM, HMAC blind index, strong unlock secret policy, CSRF plus Origin/Referer checks, plaintext export warnings, and database backup sensitivity are all good decisions.

### 2.4 Verification plan covers many high-risk paths

The supplementary verification plan covers authentication, encryption, lifecycle, numeric constraints, audit, import/export, CSV, and concurrency. This is a strong start for engineering QA.

### 2.5 The stack is pragmatic for a small team

Node, Express, React, Vite, React Query, Vanilla CSS, SQLite, and better-sqlite3 are reasonable for a fast MVP. The docs avoid premature microservices.

## 3. Critical Gaps

### Gap 1 - PRD is too thin for product execution

The PRD states the problem, personas, key features, and core flows, but it does not give enough guidance for PM, UX, engineering, or QA to make consistent decisions without the original author present.

Missing items:

- Product goals and non-goals.
- Success metrics.
- Scope boundaries for MVP versus future product.
- User stories with acceptance criteria.
- Non-functional requirements.
- Data-retention and privacy expectations.
- Explicit product assumptions for single-user, small-team, and future SaaS modes.
- Prioritized release plan.
- Requirement IDs for QA traceability.

Impact: teams may overbuild secondary features or underbuild important trust, backup, audit, and data-entry workflows.

### Gap 2 - UI/UX spec is directionally useful but not implementable

The UI/UX spec names dark mode, data density, semantic colors, app shell, tables, slide-overs, and reveal-on-click. It does not yet specify complete user flows or enough interaction detail.

Missing items:

- Full page inventory and route map.
- Dashboard widgets and expected calculations.
- Add deal and batch-card flow details.
- CSV import mapping and validation screens.
- Card detail layout.
- Error, loading, empty, locked, and no-results states.
- Accessibility requirements.
- Keyboard navigation behavior for power users.
- Responsive behavior.
- Confirmation copy for risky actions.
- Copy/reveal security behavior.

Impact: engineers will fill UX gaps ad hoc, leading to inconsistent flows and expensive rework.

### Gap 3 - QA plan is not the canonical source of all tests

The QA plan has useful scenarios, but the supplementary security doc contains the richer 57-test verification plan. QA should not need to search across documents to build the test suite.

Missing items:

- Test IDs mapped to PRD requirement IDs.
- Priority labels such as P0, P1, P2.
- Automation ownership by level: unit, integration, E2E, security, performance, accessibility.
- CI gates.
- Test data factories.
- Regression suite definition.
- Performance and load targets for future 1000 DAU.
- Backup/restore disaster recovery drills.

Impact: the team may pass feature tests while missing release-blocking security, import, concurrency, and backup cases.

### Gap 4 - Future productization is not structurally protected

The implementation plan explicitly says single-process only and currently models userId as always 1. This is acceptable for an MVP if treated as a conscious phase, but it is dangerous if the team later tries to bolt on multi-user product behavior.

Missing seams:

- accountId or workspaceId on business tables.
- Real user model with roles.
- Per-user or per-account key management strategy.
- Persistent session store for production.
- Per-user rate limiting.
- Migration path from SQLite to Postgres or another server database.
- Background job model for import/export, audit retention, and backups.
- Observability, metrics, structured logging, and error reporting.
- Deployment model and environment separation.

Impact: productization could require invasive schema and auth rewrites if these seams are not introduced early.

### Gap 5 - Security documentation misses several high-risk web controls

The current security work is strong on encryption and CSRF but not complete for a web app that reveals spendable credentials.

Missing items:

- XSS threat model and Content Security Policy.
- Strict output encoding and safe rendering requirements for notes, merchant names, buyer names, and imported CSV text.
- Clipboard behavior and limitations.
- Security headers: CSP, HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors.
- Production session storage and cookie secret rotation.
- Abuse monitoring and alerting.
- Dependency scanning and secret scanning.
- Backup encryption option beyond plaintext JSON and raw database export.
- Clear network-branded CVV/CID storage prohibition for product mode.

Impact: one XSS bug could bypass much of the credential protection because the UI intentionally reveals card data to authenticated users.

### Gap 6 - API contract needs exact schemas and error model

The implementation plan lists endpoints, but does not specify request/response bodies, validation errors, pagination contract, sort/filter fields, status codes, idempotency, or examples.

Missing items:

- OpenAPI spec or equivalent API contract.
- Standard error shape.
- Standard pagination response.
- Sort and filter whitelist.
- Request schema for every mutation.
- Idempotency keys for sale, usage, void, import confirm, backup restore.
- Optimistic concurrency behavior for stale UI updates.
- Export/import file size limits and streaming behavior.

Impact: frontend, backend, and QA can interpret the same endpoint differently.

### Gap 7 - Data model needs several future-proofing fields

The current model is simple and good for MVP. To avoid painful future migration, add a few low-cost seams now.

Recommended fields or tables:

- accountId on deals, cards, transactions, usages, audit_log, imports.
- createdByUserId and updatedByUserId where useful.
- keyVersion for encrypted fields.
- rowVersion or updatedAt enforcement for optimistic concurrency.
- reservation metadata: reservedFor, reservedUntil, reservationNotes, or a reservations table.
- idempotency_keys table.
- import_jobs table.
- app_settings table.
- schema_migrations table.

Impact: these additions allow the app to remain simple now while reducing rewrite risk later.

### Gap 8 - Operational model is missing

The docs do not yet define deployment, environments, backups, logging, monitoring, incident response, or release gates.

Missing items:

- Local dev, staging, production environment definitions.
- Database backup and restore runbooks.
- Health checks.
- Error reporting and audit monitoring.
- Migration rollback strategy.
- CI/CD pipeline.
- Security review checklist.
- Dependency update cadence.

Impact: the app can work locally but fail operationally when used by a team or customers.

## 4. Recommended Decisions Before Implementation

### Decision 1 - Define product mode explicitly

Use three modes in the docs:

1. Local MVP: single user, local SQLite, no SaaS claims.
2. Team MVP: hosted single-tenant or small-team, accounts and users enabled, SQLite or Postgres depending on deployment.
3. Product SaaS: multi-tenant, Postgres, Redis/session store, object storage, monitoring, customer support workflows.

Do not pretend local MVP equals product SaaS. Instead, design MVP seams so future productization is not blocked.

### Decision 2 - Keep SQLite for MVP, but add a Postgres migration runway

SQLite with WAL is fine for a small app and may handle a surprising amount of traffic when writes are short. However, product growth adds needs beyond raw database speed: multiple app instances, multi-tenant isolation, managed backups, operational tooling, observability, and admin workflows.

Recommendation:

- MVP: SQLite with WAL, short write transactions, explicit backup discipline.
- Product readiness: add repository/data-access layer, migrations, accountId, schema constraints, and integration tests that can later run against Postgres.
- SaaS threshold: migrate to Postgres before multi-instance deployment or when customer data isolation becomes mandatory.

### Decision 3 - Treat CVV/CID as non-storable for network-branded cards

For product mode, do not store network-branded prepaid Visa, Mastercard, Amex, or Discover CVV/CID values, even encrypted. Keep merchant gift-card PINs as a separate concept from payment-card CVV.

Recommended UX:

- Merchant gift card: allow encrypted PIN storage.
- Network-branded prepaid card: no persisted CVV/CID field. If a user needs it, collect it transiently for immediate use only, or require them to read it from the physical card.
- Plaintext export must never contain network-card CVV/CID.

### Decision 4 - Make the revised PRD the requirement source of truth

The implementation spec is currently more detailed than the PRD. That creates governance risk. Move product-level rules, flows, and acceptance criteria into the PRD. Keep implementation details in the engineering spec.

### Decision 5 - Require OpenAPI before frontend/backend parallel work

An OpenAPI contract will prevent drift between frontend, backend, and QA. It should include request schemas, response schemas, error format, auth behavior, and examples for all endpoints.

## 5. P0 Improvement Plan

These are the highest-priority improvements before broad implementation.

| Priority | Action | Owner | Output | Why It Matters |
|---|---|---|---|---|
| P0 | Adopt revised PRD | PM + Tech Lead | PRD with requirement IDs and acceptance criteria | Prevents ambiguous implementation |
| P0 | Create OpenAPI contract | Backend + Frontend + QA | openapi.yaml | Aligns API, UI, and tests |
| P0 | Consolidate QA plan | QA + Tech Lead | Canonical test matrix | Prevents missing security/lifecycle tests |
| P0 | Add threat model | Security-minded engineer | Threat model and control checklist | Protects high-risk credential flows |
| P0 | Decide CVV/CID policy | PM + Security + Legal/Compliance advisor | Product policy | Avoids compliance and liability risk |
| P0 | Add productization seams to schema | Backend | accountId, keyVersion, migrations, idempotency table | Reduces future rewrite cost |
| P0 | Add UX flow specs | Designer/PM + Frontend | Page-by-page UX spec | Reduces UI rework |
| P0 | Define CI gates | Engineering + QA | Required tests and checks | Protects release quality |

## 6. P1 Improvement Plan

These can happen during main implementation.

| Priority | Action | Owner | Output |
|---|---|---|---|
| P1 | Implement schema constraints and migrations | Backend | db.js plus migrations |
| P1 | Implement shared validation layer | Backend | cardHelpers and schema validators |
| P1 | Implement state-machine action tests | Backend + QA | Unit and integration tests |
| P1 | Build batch deal entry UX | Frontend | Keyboard-friendly grid with validation |
| P1 | Build card detail audit history | Frontend | Detail page with timeline |
| P1 | Build CSV import preview and confirm | Frontend + Backend | Safe import workflow |
| P1 | Add CSP and security headers | Backend | Security middleware config |
| P1 | Add structured logs and health endpoint | Backend | Operability baseline |

## 7. P2 Improvement Plan

These improve product quality after the MVP is stable.

| Priority | Action | Owner | Output |
|---|---|---|---|
| P2 | Add encrypted export option | Backend + Frontend | Safer backup workflow |
| P2 | Add accessibility audit | Frontend + QA | WCAG AA checklist and fixes |
| P2 | Add performance/load tests | QA + Backend | k6 or Artillery scripts |
| P2 | Add feature flags | Backend + Frontend | Controlled rollout |
| P2 | Add admin/settings model | Backend + Frontend | Product foundation |
| P2 | Add migration tests | Backend + QA | Upgrade safety |
| P2 | Add product analytics events | PM + Frontend | Usage insights without sensitive data |

## 8. Risk Register

| Risk | Severity | Likelihood | Mitigation |
|---|---:|---:|---|
| PRD ambiguity leads to divergent implementation | High | High | Adopt revised PRD with requirement IDs and acceptance criteria |
| UX rework due to underspecified flows | Medium | High | Approve page-by-page UX spec before coding flows |
| Future multi-user support requires large rewrite | High | Medium | Add accountId/userId/keyVersion/migrations now |
| XSS exposes card credentials | Critical | Medium | CSP, React safe rendering, no unsafe HTML, input validation, security tests |
| CVV storage creates compliance risk | Critical | Medium | Do not persist network-card CVV/CID in product mode |
| Import corrupts data | High | Medium | Preview, revalidation, transaction, backup before replace, import tests |
| Backup exported in plaintext leaks credentials | Critical | Medium | Fresh secret, type-to-confirm, no-store, encrypted export option, warnings |
| SQLite write contention or backup mistakes | Medium | Medium | Short transactions, WAL discipline, checkpoint/backups runbook, eventual Postgres plan |
| QA misses cross-document requirements | High | Medium | Consolidated test plan with traceability |
| App becomes hard to maintain without original author | High | Medium | ADRs, OpenAPI, schema docs, test factories, runbooks |

## 9. Definition of Ready for Main Build

A feature is ready for engineering when:

- Requirement ID exists in PRD.
- Acceptance criteria are clear.
- API contract is drafted if backend changes are needed.
- UX state is specified, including empty/error/loading states.
- Security and data-integrity implications are reviewed.
- QA test cases are listed.
- Migration impact is known.

## 10. Definition of Done for Release

A release is done when:

- P0 and P1 tests pass in CI.
- No known critical or high security issues remain open.
- Migrations run forward and are tested on seeded data.
- Backup and restore are tested.
- Core flows pass E2E: setup/login, add deal, add cards, reserve, sell, undo sale, use, undo usage, void, import, export.
- Accessibility checks pass for critical screens.
- The release has notes, rollback instructions, and a known-issues list.

