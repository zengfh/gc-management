# QA Test Plan v2 - Secure Gift Card Manager

Status: Proposed QA handoff
Review date: 2026-05-10
Primary audience: QA, engineering, PM

## 1. QA Mission

Verify that Secure Gift Card Manager protects sensitive credentials, preserves financial accuracy, enforces lifecycle rules, supports high-volume workflows, and remains maintainable as the product evolves.

QA must validate both user-visible behavior and invisible integrity/security guarantees.

## 2. Test Strategy

Use a layered test strategy:

| Layer | Purpose | Tools | Owner |
|---|---|---|---|
| Unit | Validate pure functions and state rules | Vitest/Jest | Engineers |
| Backend integration | Validate API, DB constraints, encryption, transactions | Supertest or equivalent | Backend + QA |
| Frontend component | Validate form/table behavior | Testing Library | Frontend |
| E2E | Validate critical user flows | Playwright | QA + Frontend |
| Security | Validate auth, CSRF, XSS, redaction, export controls | Playwright, custom tests, dependency tools | QA + Security-minded engineer |
| Accessibility | Validate keyboard and basic WCAG behavior | axe, Playwright | QA + Frontend |
| Performance | Validate list/import/mutation behavior under load | k6, Artillery, custom scripts | QA + Backend |
| Migration/backup | Validate upgrade, export, restore | Custom scripts | Backend + QA |

## 3. Test Environments

### Local Dev

- Developer SQLite database.
- Seed scripts for common scenarios.
- Fast unit/integration test loop.

### CI

- Fresh database per test run.
- Headless browser E2E.
- Encryption and DB-inspection tests.
- Lint, type check if applicable, unit, integration, critical E2E.

### Staging

- Production-like configuration.
- Secure cookies over HTTPS.
- Import/export tests with non-real dummy data.
- Performance smoke tests.

### Production

- No test credentials or real card data in automated QA.
- Health checks and monitoring only.
- Manual smoke tests use safe dummy data.

## 4. Test Data Strategy

Create factories for:

- Account.
- User with unlock secret.
- Deal.
- Merchant card.
- Prepaid card.
- Available card.
- Reserved card.
- In-use card with one or more usages.
- Sold card with transaction.
- Used-up card.
- Void card with write-off.
- Card with expiration soon.
- Import CSV rows: valid, invalid, duplicate, missing number.
- Malicious text values for XSS tests.

Never use real card numbers or real gift-card credentials in tests. Use clearly fake values.

## 5. Release Gates

### PR Gate

A PR cannot merge unless:

- Unit tests pass.
- Backend integration tests for changed area pass.
- Lint/static checks pass.
- No sensitive logs are added.
- Requirement ID is referenced.

### Main Branch Gate

Main branch requires:

- Full unit suite.
- Full backend integration suite.
- Critical E2E suite.
- Security smoke suite.
- Migration tests.

### Release Gate

Release requires:

- All P0 and P1 tests passing.
- P0 accessibility checks passing.
- Backup/restore drill passing.
- No open Critical or High bugs.
- Known Medium bugs accepted by PM and tech lead.
- Release notes and rollback plan.

## 6. Requirement Traceability

Every test should map to one or more requirement IDs from the PRD.

Example:

| Test ID | Requirement IDs | Priority |
|---|---|---:|
| AUTH-IT-001 | AUTH-01 | P0 |
| CARD-IT-005 | CARD-05, SEARCH-01 | P0 |
| LIFE-E2E-003 | LIFE-03, LIFE-04 | P0 |
| EXP-E2E-001 | EXP-02, AUD-01 | P0 |

## 7. P0 Test Matrix

### 7.1 Authentication and Unlock

| Test ID | Type | Scenario | Expected Result |
|---|---|---|---|
| AUTH-001 | Integration | Setup with weak secret | 400; no user created |
| AUTH-002 | Integration | Setup with valid secret | User/account/key metadata created; session established or login allowed |
| AUTH-003 | Integration | Setup when already complete | 409; no side effects |
| AUTH-004 | Integration | Login with wrong secret 3 times | Lockout begins according to policy |
| AUTH-005 | Integration | Login after lockout expires | Valid secret succeeds |
| AUTH-006 | Integration | Server restart simulation | Protected endpoints return 401 or locked state until login |
| AUTH-007 | E2E | Logout | UI clears sensitive data; protected API returns 401 |
| AUTH-008 | Integration | Change unlock secret | Old secret fails; new secret unlocks existing cards |
| AUTH-009 | Security | Session ID changes on login | Session fixation prevented |
| AUTH-010 | Security | Cookie flags in production config | HttpOnly, Secure, SameSite set |

### 7.2 CSRF and Session Security

| Test ID | Type | Scenario | Expected Result |
|---|---|---|---|
| CSRF-001 | Integration | Missing CSRF on card create | 403; no card created |
| CSRF-002 | Integration | Invalid CSRF on sale | 403; no transaction created |
| CSRF-003 | Integration | Bad Origin on use | 403; no usage created |
| CSRF-004 | Integration | GET endpoints without CSRF | Allowed only if authenticated and read-only |
| CSRF-005 | Integration | Plaintext export without CSRF | 403; no export/audit payload |
| CSRF-006 | Integration | Setup/login from cross-origin form | Rejected by Origin/Referer policy |

### 7.3 Encryption and Redaction

| Test ID | Type | Scenario | Expected Result |
|---|---|---|---|
| ENC-001 | Integration | Create card with card number and PIN | DB does not contain plaintext values |
| ENC-002 | Unit | Encrypt same value twice | Different IV/ciphertext |
| ENC-003 | Integration | Exact number search | Finds matching card using blind index |
| ENC-004 | Integration | Search with formatted number | Normalization finds same card |
| ENC-005 | Integration | Update card number | Re-encrypted; hash recomputed; old search misses; new search finds |
| ENC-006 | Integration | Audit create card | Audit shows masked card number and redacted PIN |
| ENC-007 | Integration | Network-card CVV submitted in product mode | Rejected or not persisted according to policy |
| ENC-008 | Integration | JSON export | Sensitive allowed fields plaintext by design; no network-card CVV |

### 7.4 Card Creation and Edit

| Test ID | Type | Scenario | Expected Result |
|---|---|---|---|
| CARD-001 | Integration | Create merchant card valid | 201; card available; audit created |
| CARD-002 | Integration | Create prepaid card valid | 201; card available; encrypted fields stored |
| CARD-003 | Integration | faceValueCents <= 0 | 400 or DB constraint; no card |
| CARD-004 | Integration | remainingBalanceCents > faceValueCents | Rejected |
| CARD-005 | Integration | duplicate normalized number and brand | Conflict shown or hard-blocked |
| CARD-006 | Integration | duplicate with different formatting | Treated as duplicate |
| CARD-007 | Integration | PUT available card allowed fields | Updates allowed fields; audit created |
| CARD-008 | Integration | PUT sold card non-notes field | Rejected |
| CARD-009 | Integration | PUT blocked faceValue/balance/status | Rejected |
| CARD-010 | Integration | Stale rowVersion update | 409; no overwrite |

### 7.5 Lifecycle and Money Accuracy

| Test ID | Type | Scenario | Expected Result |
|---|---|---|---|
| LIFE-001 | Integration | Add -> reserve with metadata | status reserved; reservation metadata persisted and returned; audit |
| LIFE-002 | Integration | reserve -> unreserve | status available; reservation metadata cleared; audit |
| LIFE-003 | Integration | available -> sell | status sold; sale transaction; balance 0; snapshot recorded |
| LIFE-004 | Integration | reserved -> sell | status sold; statusAtSale reserved |
| LIFE-005 | Integration | in_use -> sell | status sold; remainingBalanceAtSaleCents snapshot |
| LIFE-006 | Integration | double sell | One succeeds; second rejected |
| LIFE-007 | Integration | undo sale | status and balance restored; reversal transaction; reason required |
| LIFE-008 | Integration | use partial amount | balance reduced exactly; status in_use |
| LIFE-009 | Integration | use exact remaining amount | balance 0; status used_up |
| LIFE-010 | Integration | use amount > balance | Rejected; no usage |
| LIFE-011 | Integration | use amount = 0 | Rejected |
| LIFE-012 | Integration | undo latest usage | balance restored; status recalculated |
| LIFE-013 | Integration | undo middle usage | balance recalculated correctly |
| LIFE-014 | Integration | undo write-off | 409 rejected |
| LIFE-015 | Integration | void available card | write-off for full balance; status void; balance 0 |
| LIFE-016 | Integration | void reserved card | write-off for full balance; status void; balance 0 |
| LIFE-017 | Integration | void in-use card | write-off for remaining balance; active usages sum to face value |
| LIFE-018 | Unit | $1.00 - $0.10 - $0.20 - $0.30 | Remaining exactly 40 cents |
| LIFE-019 | Integration | invalid use sold card | 400/409; no side effects |
| LIFE-020 | Integration | invalid reserve sold card | Rejected |

### 7.6 Deals and Cost Allocation

| Test ID | Type | Scenario | Expected Result |
|---|---|---|---|
| DEAL-001 | Unit | $100 cost across 3 equal cards | 3333, 3333, 3334 cents or documented deterministic allocation |
| DEAL-002 | Integration | Deal with mixed explicit/proportional costs | Total allocated exactly to totalCostCents |
| DEAL-003 | Integration | Explicit costs exceed total | Rejected |
| DEAL-004 | Integration | Archive deal | Hidden by default; cards still accessible |
| DEAL-005 | Integration | Delete deal or archive behavior | Cards dealId set null only if delete is allowed; prefer archive |
| DEAL-006 | Integration | Deal P&L summary | Derived from cards and transactions correctly |

### 7.7 Import and Export

| Test ID | Type | Scenario | Expected Result |
|---|---|---|---|
| IMP-001 | Integration | CSV preview valid file | Returns parsed rows and summary; no cards created |
| IMP-002 | Integration | CSV preview invalid rows | Returns row errors; no commit |
| IMP-003 | Integration | Confirm import valid rows | Cards created; audit/import job created |
| IMP-004 | Integration | Confirm import revalidates after conflict appears | Conflict returned; no partial bad commit |
| IMP-005 | Integration | Merge import duplicate active card | 409 conflict list |
| IMP-006 | Integration | Merge import null cardNumber rows | Does not false-dedup |
| IMP-007 | Integration | Replace import unsupported schemaVersion | Rejected |
| IMP-008 | Integration | Replace import malformed JSON | Rejected |
| IMP-009 | Integration | Replace import valid | Auto-backup, transaction, foreign_key_check, readable cards |
| IMP-010 | Integration | Replace import excludes users | Current unlock secret still works |
| IMP-011 | Integration | Encrypted JSON import valid | Backup passphrase decrypts payload; imported credentials are re-encrypted for current vault |
| IMP-012 | Integration | Encrypted JSON import wrong backup passphrase | Rejected; no cards/import jobs/audit side effects |
| EXP-001 | E2E | Plaintext export happy path | Fresh secret + type EXPORT; file returned; no-store; audit |
| EXP-002 | Integration | Plaintext export wrong secret | Rejected; no file |
| EXP-003 | Integration | Raw DB export | Fresh secret required; no-store; audit |
| EXP-004 | Integration | Export audit redaction | Audit contains export event only, not payload |
| EXP-005 | Integration | Encrypted portable export happy path | Separate backup passphrase; AES-GCM envelope; no plaintext credentials/passphrases in file or audit |
| EXP-006 | Integration | Encrypted export reuses unlock secret | Rejected; no file/audit payload |

### 7.8 Audit

| Test ID | Type | Scenario | Expected Result |
|---|---|---|---|
| AUD-001 | Integration | Create card | Audit event with redacted sensitive fields |
| AUD-002 | Integration | Sell card | Audit and transaction records |
| AUD-003 | Integration | Undo usage | Audit includes reason but no credential values |
| AUD-004 | Integration | Export | Audit includes event metadata only |
| AUD-005 | Integration | Audit filter by entity | Correct results scoped to account |
| AUD-006 | Security | Malicious notes in audit diff | Rendered as text in UI |

### 7.9 Concurrency

| Test ID | Type | Scenario | Expected Result |
|---|---|---|---|
| CONC-001 | Integration | Two simultaneous sell requests | One succeeds; one fails with conflict; no duplicate transaction |
| CONC-002 | Integration | Two rapid use requests within balance | Serialized; final balance correct |
| CONC-003 | Integration | Two rapid use requests exceeding total balance | At most valid total committed; no negative balance |
| CONC-004 | Integration | Edit stale card while action changes status | Stale edit rejected |
| CONC-005 | Integration | Import confirm while duplicate added | Confirm revalidates and returns conflict |

### 7.10 UI E2E Critical Flows

| Test ID | Type | Scenario | Expected Result |
|---|---|---|---|
| E2E-001 | E2E | Setup -> add deal -> add cards | Deal/cards created and visible |
| E2E-002 | E2E | Search exact card number | Correct card found; number masked |
| E2E-003 | E2E | Reserve -> sell -> undo sale | UI state and API state correct |
| E2E-004 | E2E | Use -> undo usage | Balance/status correct |
| E2E-005 | E2E | Void card | Write-off appears; card void |
| E2E-006 | E2E | CSV import preview -> confirm | Rows created; invalid rows blocked |
| E2E-007 | E2E | Plaintext export warning | Requires secret and confirmation phrase |
| E2E-008 | E2E | Encrypted export/import smoke | Export encrypted backup; import into fresh vault using backup passphrase |
| E2E-009 | E2E | Logout while credential revealed | Secret disappears and protected page inaccessible |

## 8. P1 Test Matrix

| Area | Scenarios |
|---|---|
| Dashboard | Counts and balances by status, active cost basis, active gross margin, sold proceeds, realized P&L, expiring soon, stale reservations |
| Lookup | Brand/source/buyer/platform suggestions; no sensitive leakage |
| Settings | Change unlock secret UX, backup settings update, plaintext export disablement, backup timestamp display |
| Accessibility | Keyboard table actions, modal focus trap, form errors, color contrast |
| Import UX | Column mapping, paste behavior, row-level errors |
| Error UX | 400/401/403/409/429/500 user messages |
| Performance | 20,000 card list, 1,000 row import preview, high-frequency reads |
| Security headers | CSP, frame-ancestors, nosniff, HSTS in production config |
| Logging | Request IDs, redaction, no sensitive payloads |
| Migration | Upgrade seeded old DB to latest schema |

## 9. Security-Specific Test Cases

### XSS Inputs

Test these values in brand, notes, buyer, merchant, platform, source, and CSV import:

```text
<script>alert(1)</script>
<img src=x onerror=alert(1)>
javascript:alert(1)
"><svg onload=alert(1)>
=HYPERLINK("http://evil.example","click")
```

Expected:

- Rendered as text.
- No script executes.
- CSV export, if implemented, neutralizes spreadsheet formula injection.

### Sensitive Logging

Search application logs during tests for:

- Full card numbers.
- PINs.
- CVV/CID.
- Billing ZIP.
- Unlock secret.
- Plaintext export payloads.

Expected: none found.

## 10. Accessibility Testing

P0 accessibility flows:

- Setup/login.
- Cards list.
- Add deal/batch cards.
- Card detail.
- Sell/use modal.
- Plaintext export modal.

Checks:

- Keyboard-only completion possible.
- Visible focus indicator.
- Modal focus trap.
- Error messages associated with fields.
- Status not color-only.
- Text contrast passes WCAG AA.
- Icon buttons have accessible labels.

## 11. Performance Testing

### MVP Performance Data Sets

- 1,000 cards.
- 20,000 cards.
- 100 deals.
- 10,000 audit events.
- 5,000 transactions/usages.

### Load Scenarios

| Scenario | Target |
|---|---|
| Cards list with filters | P95 < 500 ms on MVP target hardware |
| Card detail | P95 < 500 ms |
| Create deal with 100 cards | Completes without timeout and exact cost allocation |
| CSV preview 1,000 rows | < 5 seconds |
| CSV confirm 1,000 rows | Transactional; no partial commit on failure |
| 50 concurrent active users simulation | No data corruption; acceptable latency |
| Burst of concurrent sell/use attempts | Correct conflicts; no duplicate sale or negative balance |

## 12. Bug Severity

| Severity | Definition | Example |
|---|---|---|
| Critical | Credential leak, data corruption, auth bypass, destructive import bug | Full card number in logs |
| High | Incorrect money/state, broken backup/restore, security control failure | Double sale succeeds |
| Medium | Important workflow broken with workaround | CSV preview column mapping issue |
| Low | Cosmetic or minor usability issue | Misaligned table cell |

## 13. Regression Suite

Minimum regression before release:

- Auth setup/login/logout/restart.
- Add deal/cards.
- Search exact card number.
- Reserve/unreserve.
- Sell/undo sale.
- Use/undo usage.
- Void.
- Edit allowed/disallowed fields.
- CSV preview/confirm.
- Plaintext export.
- Raw DB export.
- Import replace and merge.
- Audit redaction.
- CSRF rejection.
- XSS rendering.
- Backup/restore drill.

## 14. QA Deliverables

QA should maintain:

- Test plan with IDs and requirement traceability.
- Automated test suite.
- Manual exploratory checklist.
- Test data fixtures.
- Release test report.
- Known issues list.
- Security regression checklist.
- Performance report for product-readiness milestones.

## 15. Manual Exploratory Charters

### Charter A - Power User Batch Entry

Explore creating a deal with many cards using keyboard-only input, paste from spreadsheet, validation errors, cost allocation, save, and correction.

### Charter B - Sensitive Credential Handling

Explore reveal/copy behavior, logout while revealed, browser refresh, modal close, toasts, URL, logs, and screenshots.

### Charter C - Import Failure Recovery

Explore invalid CSV, duplicate conflict, malformed JSON, replace import failure, backup before replace, and retry after correction.

### Charter D - State Machine Abuse

Try invalid transitions from every status and verify errors are clear and no side effects occur.

### Charter E - Productization Readiness

Explore account/user seams, audit actor, export warnings, settings, performance with large data, and DB migration assumptions.
