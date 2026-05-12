# Implementation Roadmap - Secure Gift Card Manager

Status: Proposed execution plan
Review date: 2026-05-10
Primary audience: PM, tech lead, engineering, QA

## 1. Roadmap Principles

1. Build the integrity foundation before UI polish.
2. Keep MVP small, but include productization seams that are cheap now and expensive later.
3. Treat security and backup as core product features, not add-ons.
4. Use requirement IDs, API contracts, and tests to keep a smaller team aligned.
5. Avoid implementing future SaaS complexity too early; document migration thresholds instead.

## 2. Workstreams

| Workstream | Owner | Purpose |
|---|---|---|
| Product | PM | Requirements, scope, acceptance criteria, release decisions |
| UX | Designer/Frontend lead | Flows, screens, accessibility, content for risky actions |
| Backend | Backend lead | Data model, crypto, APIs, constraints, imports, backups |
| Frontend | Frontend lead | App shell, pages, forms, tables, state handling |
| QA | QA lead | Test plan, automation, release gates |
| Security/Ops | Tech lead | Threat model, headers, deployment, backup/restore, monitoring |

Small team note: one person can own multiple workstreams, but the workstream responsibilities should still be explicit.

## 3. Phase 0 - Alignment and Specifications

Goal: prevent expensive rework before coding broadly.

Duration: should be short, but do not skip.

Deliverables:

- Adopt PRD v2 or equivalent.
- Assign requirement IDs.
- Approve MVP scope and non-goals.
- Create OpenAPI draft.
- Create UI flow map for P0 flows.
- Consolidate QA test matrix.
- Create ADRs for major decisions.
- Decide CVV/CID product policy.
- Decide SQLite MVP and Postgres migration threshold.

Exit criteria:

- PM, engineering, QA agree on P0/P1 scope.
- API contract exists for core endpoints.
- Critical UX flows are wireframed or specified.
- P0 tests are identified.

## 4. Phase 1 - Secure Data Foundation

Goal: implement the backend substrate correctly before complex UI.

Backend tasks:

- Project setup.
- SQLite connection setup.
- WAL mode and foreign keys.
- Migration system.
- accounts/users baseline tables.
- deals/cards/transactions/usages/audit tables.
- constraints and indexes.
- encryption module.
- unlock secret setup/login/logout/change.
- CSRF and Origin/Referer checks.
- session security.
- audit redaction helper.
- stateMachine helper.
- validation helpers.

QA tasks:

- Auth integration tests.
- Encryption DB-inspection tests.
- Constraint tests.
- CSRF tests.
- Redaction tests.

Exit criteria:

- Can create user/account and unlock.
- Can encrypt/decrypt test payloads.
- DB does not store plaintext credentials.
- Core constraints enforced.
- Security smoke tests pass.

## 5. Phase 2 - Core Card and Deal Workflows

Goal: support the main inventory lifecycle end to end.

Backend tasks:

- Deals CRUD.
- Card create/list/detail/update/delete rules.
- Batch card creation.
- Cost allocation.
- Reserve/unreserve.
- Sell/undo sale.
- Use/undo usage.
- Void.
- Lookup endpoints.
- Idempotency keys for critical actions.

Frontend tasks:

- App shell.
- Setup/login pages.
- Dashboard basic shell.
- Cards list.
- Card detail.
- Deal list/detail.
- Add deal and batch-card flow.
- Action modals: reserve, sell, use, undo, void.
- Toast and error handling.

QA tasks:

- Lifecycle integration tests.
- Money math tests.
- E2E core flows.
- Concurrent sell/use tests.
- Stale update tests.

Exit criteria:

- User can run acquisition -> sale and acquisition -> usage flows.
- All state machine P0 tests pass.
- Money math tests pass.
- Invalid transitions are rejected with clear errors.

## 6. Phase 3 - Import, Export, Backup, and Audit

Goal: make bulk data and recovery safe.

Backend tasks:

- CSV preview parser.
- CSV confirm with revalidation.
- import_jobs table.
- JSON plaintext export.
- Raw DB export using safe backup approach.
- JSON import replace.
- JSON import merge.
- Auto-backup before replace.
- foreign_key_check before import commit.
- Audit list filters.

Frontend tasks:

- Import page/modal.
- Preview table with errors.
- Import conflict UI.
- Export/backup page.
- Plaintext export warning and type-to-confirm.
- Raw DB export warning.
- Audit log page.

QA tasks:

- Import/export integration tests.
- Backup/restore drill.
- Malformed file tests.
- Conflict tests.
- Audit redaction tests.
- E2E import/export flow.

Exit criteria:

- CSV preview does not commit data.
- Confirm revalidates.
- Replace import auto-backs up and restores safely.
- Exports require fresh unlock secret.
- Audit never leaks credentials.

## 7. Phase 4 - UX Polish, Accessibility, and Release Hardening

Goal: make MVP usable and safe enough for real usage.

UX/frontend tasks:

- Empty states.
- Loading states.
- Error states with request IDs.
- Keyboard navigation for batch grid and modals.
- Focus management.
- Accessibility fixes.
- Responsive table/card layout where feasible.
- Copy/reveal final behavior.
- Dashboard metrics.

Backend/security tasks:

- Security headers.
- CSP.
- Structured logs.
- Health endpoint.
- Request ID propagation.
- Production config validation.
- Dependency scan.

QA tasks:

- Full regression.
- Accessibility P0 tests.
- XSS tests.
- Performance smoke tests.
- Backup/restore release test.

Exit criteria:

- Release gate passes.
- No Critical/High bugs open.
- Core flows are keyboard accessible.
- No sensitive data appears in logs/toasts/URLs.
- Release notes and rollback plan exist.

## 8. Phase 5 - Productization Foundation for 1000 DAU

Goal: prepare for team/customer usage without prematurely rebuilding everything.

Tasks:

- [x] Encrypted portable export and restore path. Completed 2026-05-12.
- [x] Settings page backup controls. Completed 2026-05-12.
- [ ] Real account/user admin if needed.
- [ ] Persistent session store for hosted deployment.
- [ ] Persistent rate limit store.
- [ ] Observability: metrics, alerts, error reporting.
- [ ] Data retention policy.
- [ ] Privacy/security documentation.
- [ ] Performance load tests.
- [ ] Postgres migration spike.
- [ ] Admin/support access policy.
- [ ] Feature flags.

Exit criteria:

- System can be safely hosted for a small team.
- Operational runbooks exist.
- Load tests meet targets.
- Migration strategy is documented and tested on sample data.

## 9. Phase 6 - Commercial Product Track

Start this phase only if the team decides to commercialize.

Major initiatives:

- Postgres migration.
- Multi-tenant account isolation.
- RBAC.
- MFA or stronger account security.
- Billing and subscription management.
- Customer support tooling.
- Legal/privacy/compliance review.
- Data deletion/export workflows.
- Security audit or penetration test.
- Incident response process.
- Hosted backup and restore.
- Dealer/integration roadmap.

Do not start Phase 6 until the product's target customer, compliance posture, and hosting model are clear.

## 10. Suggested Backlog by Priority

### P0 Backlog

- PRD v2 approval.
- OpenAPI contract.
- Database migrations.
- Encryption and unlock.
- CSRF/origin checks.
- Core tables and constraints.
- State machine helpers.
- Card/deal CRUD.
- Sale/use/void/undo action endpoints.
- Audit redaction.
- Cards/deals UI.
- Core action modals.
- P0 test suite.

### P1 Backlog

- CSV import preview/confirm.
- Backup/export/import.
- Audit UI.
- Dashboard metrics.
- Idempotency keys.
- RowVersion stale update prevention.
- Security headers and CSP.
- Accessibility improvements.
- Performance smoke tests.

### P2 Backlog

- Encrypted portable export. Completed 2026-05-12 as Release 2 milestone 1.
- Reservation metadata.
- Settings page backup controls. Completed 2026-05-12 as Release 2 milestone 2.
- Observability.
- Team/user model activation.
- Postgres migration spike.
- Feature flags.
- Product analytics without sensitive data.

## 11. Change Management Process

Because the PRD is expected to change, use a lightweight change process.

For each requirement change:

1. PM writes change summary.
2. Assign or update requirement IDs.
3. Engineering assesses data/API/security impact.
4. UX assesses screen/flow impact.
5. QA updates test cases.
6. Tech lead decides if ADR is needed.
7. Change is merged into docs before or with code.

For high-risk changes, require explicit review:

- Data model changes.
- Security/crypto changes.
- Import/export changes.
- State machine changes.
- Authentication/session changes.
- Multi-user/account changes.

## 12. Team Operating Model

Recommended recurring rituals:

- Weekly scope review: PM + tech lead + QA.
- Twice-weekly bug triage during active build.
- Architecture review for P0/P1 backend changes.
- Test review before release candidate.
- Security checklist review before release.

Recommended artifacts:

- PRD.
- OpenAPI spec.
- UX flow spec.
- QA test matrix.
- ADR folder.
- Runbooks: setup, backup/restore, release, rollback.

## 13. Minimum Runbooks

### Setup Runbook

- Install dependencies.
- Start backend/frontend.
- Create local database.
- Run migrations.
- Seed test data.
- Run tests.

### Backup/Restore Runbook

- Export raw database safely.
- Export plaintext JSON safely.
- Restore replace import.
- Verify foreign keys.
- Verify encrypted fields decrypt.
- Verify users table untouched.

### Release Runbook

- Confirm release branch.
- Run full test suite.
- Run migration test.
- Run backup/restore drill.
- Generate release notes.
- Tag version.
- Deploy.
- Smoke test.
- Monitor.

### Incident Runbook

- Credential exposure suspected.
- Database corruption suspected.
- Bad import performed.
- Unlock secret lost.
- Production app unavailable.

## 14. Recommended First Sprint

A realistic first sprint for a small team:

1. Finalize PRD v2 and OpenAPI skeleton.
2. Implement migration framework and initial schema.
3. Implement encryption module with tests.
4. Implement setup/login/status/logout.
5. Implement CSRF/origin middleware.
6. Implement audit redaction helper.
7. Build minimal setup/login UI.
8. Add CI with unit/integration tests.

Do not start advanced dashboard or styling before these foundations are stable.
