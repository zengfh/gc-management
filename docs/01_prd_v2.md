# Product Requirements Document v2 - Secure Gift Card Manager

Status: Proposed replacement for the current PRD
Review date: 2026-05-10
Primary audience: PM, design, engineering, QA

## 1. Product Vision

Secure Gift Card Manager helps users manage gift-card inventory with high confidence: acquire cards, track cost basis, prevent duplicate or invalid sales, record partial usage, protect spendable credentials, and preserve a clear audit trail.

The product starts as a power-user workflow replacement for spreadsheets, but the design must leave room for future commercial productization around team usage, multiple users, stronger access controls, hosted deployment, and customer support.

## 2. Problem Statement

Gift-card operators often manage inventory in spreadsheets. Spreadsheets are flexible but weak at enforcing state, preventing duplicates, protecting sensitive data, and preserving auditability. Mistakes can directly create financial loss: selling the same card twice, forgetting partial balances, using stale card numbers, losing purchase cost basis, or exporting credentials insecurely.

The product must provide a safer system of record for gift cards and related business events.

## 3. Target Users

### Persona A - Gift Card Operator

- Buys merchant and prepaid gift cards from deal sites or promotions.
- Needs fast batch entry and accurate inventory state.
- Sells cards to dealers, friends, or groups.
- Needs precise P&L and an audit trail.
- Values keyboard efficiency, bulk import, and trust in calculations.

### Persona B - Personal User

- Uses gift cards for personal spending.
- Needs to know exact remaining balances.
- Needs fast reveal/copy of card credentials.
- Values simplicity and backup safety.

### Persona C - Future Team Admin

- Manages multiple operators.
- Needs role-based access, audit, account recovery, and customer support workflows.
- Needs strong security defaults and clear separation of user data.

## 4. Product Goals

| Goal ID | Goal | Success Measure |
|---|---|---|
| G1 | Replace spreadsheet tracking for core inventory lifecycle | Users can complete acquisition, sale, usage, undo, void, search, import, and export without spreadsheet fallback |
| G2 | Prevent high-cost data mistakes | Duplicate sale, overuse, negative balance, invalid transition, and bad import are blocked |
| G3 | Protect spendable credentials | Card number, merchant PIN, permitted sensitive fields, and billing ZIP are encrypted at rest and masked by default in UI |
| G4 | Provide auditability | Every meaningful state, balance, sale, undo, void, import, and export event is logged with redacted details |
| G5 | Support efficient power-user data entry | Batch entry and CSV import allow high-volume card entry with validation and keyboard support |
| G6 | Keep future productization possible | Data model and architecture include account/user/key/version seams even if MVP remains single-user |

## 5. Non-Goals for MVP

The following are intentionally out of MVP scope unless explicitly added later:

- Dealer API integrations.
- OCR scanning of physical cards.
- Mobile-native apps.
- Real-time collaborative editing.
- Automated balance checking against merchants.
- Payment processing.
- Marketplace or customer-facing sale portal.
- Full SaaS billing and subscription management.
- Multi-region high availability.

## 6. Product Modes

### Mode 1 - Local MVP

- Single operator.
- SQLite database.
- Local or trusted private deployment.
- Unlock secret protects encrypted card data.
- This mode is acceptable for early use and validation.

### Mode 2 - Team MVP

- Multiple users in one account/workspace.
- Role-based access begins.
- Persistent sessions and operational backups.
- Stronger audit and admin settings.
- Can still use SQLite for a single-node private deployment if carefully constrained.

### Mode 3 - Commercial SaaS

- Multi-tenant account model.
- Postgres or equivalent server database.
- Redis or managed session/rate-limit store.
- Object storage for encrypted backup artifacts.
- Monitoring, alerting, incident process, privacy controls, support tooling, and data deletion workflows.

MVP implementation should not claim Mode 3 readiness, but it should avoid decisions that make Mode 3 unnecessarily expensive.

## 7. Core Domain Concepts

### Card

A gift card or prepaid card tracked by the system. Cards have face value, remaining inventory balance, purchase cost, brand, type, status, credential profile, optional expiration date, and audit history. Credential profiles cover code-only, number-plus-PIN, barcode, network prepaid, and custom issuer formats.

### Deal

A purchase or acquisition event that can contain one or many cards. A deal can include source, purchase date, notes, and cost allocation behavior.

### Usage

A partial or full consumption event by the operator, reducing remaining balance.

### Sale Transaction

A sale of a card or remaining card balance to another party. The sale records buyer, sale price, platform, transaction date, previous status, and remaining balance snapshot.

### Audit Event

A redacted, append-only record of important actions.

## 8. Functional Requirements

### 8.1 Authentication and Unlock

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---:|---|
| AUTH-01 | First-time setup requires creation of a strong unlock secret | P0 | Weak secrets are rejected; valid setup creates encrypted DEK metadata; setup cannot run twice |
| AUTH-02 | Login unlocks encrypted card data | P0 | Valid unlock secret loads DEK into memory; invalid secret is rejected and rate limited |
| AUTH-03 | Logout clears session and encrypted-data access | P0 | After logout, protected API calls return 401; sensitive UI data is cleared |
| AUTH-04 | Server restart requires re-login | P0 | API reports locked state until user authenticates again |
| AUTH-05 | Change unlock secret re-wraps DEK without rewriting card data | P1 | Existing cards decrypt after change; old secret no longer works |

### 8.2 Deals

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---:|---|
| DEAL-01 | User can create a deal | P0 | Deal name is optional; source, purchase date, notes are optional; audit event is recorded |
| DEAL-02 | User can add multiple cards during deal creation | P0 | Cards are validated as a batch; either all valid cards are saved or invalid rows are shown before commit |
| DEAL-03 | System supports total-cost allocation across cards | P0 | Explicit costs plus proportional allocation sum exactly to total cost in cents; remainder is deterministic |
| DEAL-04 | User can archive/unarchive deals | P1 | Archived deals are hidden by default; cards remain accessible |
| DEAL-05 | Deal P&L is derived from associated card purchase costs and sale outcomes | P1 | Deal detail shows cost basis, sale totals, usage/write-off impact, and profit/loss where data exists |

### 8.3 Card Inventory

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---:|---|
| CARD-01 | User can create merchant and prepaid cards | P0 | Required fields are validated; money is stored as integer cents; credential profile fields are normalized/encrypted according to profile |
| CARD-02 | User can list cards with pagination, filters, and sorting | P0 | Status, card type, brand, source, deal, expiration, credential, and text filters work; unsupported sort fields are rejected |
| CARD-03 | User can view a card detail page | P0 | Detail shows card data, masked credentials, transactions, usages, audit timeline, and the primary edit surface for editable metadata |
| CARD-04 | User can edit allowed fields | P0 | Brand, card type, network, values, expiration, format, source, and notes can be edited from detail when status allows; terminal cards allow notes only; changes are audited |
| CARD-05 | System prevents duplicate active cards when indexed primary credential and brand match | P0 | Normalized code/number/barcode variants match; conflict is surfaced clearly |
| CARD-06 | Terminal cards are protected | P0 | Sold, used-up, and void cards allow notes-only edits unless an explicit admin correction feature is later added |
| CARD-07 | Card credentials are masked by default | P0 | Full codes, card numbers, merchant PINs, barcode values, permitted network prepaid fields, and billing ZIP/address are never displayed by default |

### 8.4 Card Lifecycle

Allowed statuses:

- available
- reserved
- in_use
- sold
- used_up
- void

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---:|---|
| LIFE-01 | User can reserve an available card | P0 | available -> reserved; audit event recorded |
| LIFE-02 | User can unreserve a reserved card | P0 | reserved -> available; audit event recorded |
| LIFE-03 | User can sell an available, reserved, or in-use card | P0 | sale transaction is created; previous status and remaining balance are snapshotted; inventory balance becomes 0 |
| LIFE-04 | User can undo a sale with a reason | P0 | sale reversal is created; card returns to statusAtSale; balance is restored |
| LIFE-05 | User can record usage on available or in-use card | P0 | amount must be greater than 0 and not exceed remaining balance; status updates to in_use or used_up |
| LIFE-06 | User can undo a non-write-off usage with a reason | P0 | usage is marked reversed; balance and status are recalculated |
| LIFE-07 | User can void available, reserved, or in-use card | P0 | write-off usage is created for remaining balance; status becomes void; balance becomes 0 |
| LIFE-08 | Invalid transitions are rejected | P0 | Attempts such as use sold card, sell sold card again, undo write-off, or use void card return errors and create no side effects |

### 8.5 Search and Lookup

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---:|---|
| SEARCH-01 | Exact full card-number search works without plaintext DB search | P0 | Input is normalized and compared against blind index |
| SEARCH-02 | Lookup suggestions help data entry | P1 | Brand, source, buyer, and platform suggestions are derived from existing data and do not expose credentials |
| SEARCH-03 | General list filters do not require decrypting every row | P1 | Brand/status/source/date filters use plaintext metadata or indexed fields |

### 8.6 Credential Reveal and Copy

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---:|---|
| CRED-01 | Credentials are masked by default | P0 | Tables and detail pages show only last four digits where applicable |
| CRED-02 | Reveal requires explicit user action | P0 | Revealed values auto-hide after a short timeout and when user leaves the page |
| CRED-03 | Copy is separate from reveal | P1 | Copy buttons are explicit; success toast does not include secret values |
| CRED-04 | Reveals are auditable at aggregate level | P2 | Optional audit event records that a credential was revealed/copied, without storing the credential |

### 8.7 Import and Export

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---:|---|
| IMP-01 | CSV import has preview mode | P0 | Invalid rows are flagged; no data is committed during preview |
| IMP-02 | Confirm import revalidates data | P0 | Server does not trust preview result; confirm uses current validation and transactions |
| IMP-03 | Replace import auto-backs up current database | P0 | Backup occurs before destructive replace; failure stops import |
| IMP-04 | Merge import avoids false dedup for cards without card numbers | P1 | Null card number rows do not collide by hash |
| EXP-01 | Raw database export is available to authorized user | P0 | Fresh unlock secret, CSRF/origin checks, no-store header, and audit are required |
| EXP-02 | Plaintext JSON export is available with explicit warning | P0 | User must re-enter secret and type confirmation; file clearly warns about plaintext credentials |
| EXP-03 | Encrypted export option is added before broader product use | P1 | User can export a portable encrypted JSON backup using a separate backup passphrase |

### 8.8 Audit

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---:|---|
| AUD-01 | State and balance mutations are audited | P0 | Reserve, unreserve, sell, undo sale, use, undo usage, void, edit, import, export are logged |
| AUD-02 | Audit values are redacted | P0 | Card number shows last four only; PIN/CVV/billing ZIP are never logged in plaintext |
| AUD-03 | Audit entries include actor and timestamp | P0 | MVP actor can be user 1; schema should allow real users later |
| AUD-04 | Audit list is filterable | P1 | Filter by entity, action, actor, and date range |

### 8.9 Dashboard

| ID | Requirement | Priority | Acceptance Criteria |
|---|---|---:|---|
| DASH-01 | Dashboard summarizes inventory value | P1 | Shows available/reserved/in-use face value, remaining balance, cost basis, and counts |
| DASH-02 | Dashboard highlights expiring cards | P1 | Shows cards expiring within configurable windows |
| DASH-03 | Dashboard highlights anomalies | P2 | Duplicate candidates, cards with missing required metadata, and stale reservations are surfaced |

## 9. Non-Functional Requirements

### 9.1 Security

- Sensitive credentials are encrypted at rest using authenticated encryption.
- Exact credential lookup uses blind indexes; no plaintext credential search column is stored.
- Network-branded payment-card CVV/CID must not be persisted in product mode.
- Authenticated state-changing requests require CSRF token and Origin/Referer validation.
- Sessions use secure cookie settings in production.
- XSS defenses are mandatory: React-safe rendering, no unsafe HTML, CSP, and input handling for imported/user text.
- Plaintext exports are treated as critical-risk events.

### 9.2 Data Integrity

- All money uses integer cents.
- State changes occur only through action endpoints.
- Database constraints protect core invariants.
- Import/replace operations run in transactions and verify foreign keys.
- Write transactions are short and explicit.
- Race-prone operations use database-level locking or equivalent transaction isolation.

### 9.3 Performance

MVP targets:

- Card list P95 under 500 ms with 20,000 cards on developer hardware.
- Card detail P95 under 500 ms with normal history.
- CSV preview for 1,000 rows under 5 seconds.
- Critical mutation P95 under 300 ms excluding encryption setup.

Future 1000 DAU planning targets:

- P95 API latency under 300 ms for common reads under expected production load.
- P95 mutations under 500 ms.
- No data corruption under concurrent use/sell/undo requests.
- Load tests cover at least 50 concurrent active users and bursty import/list behavior before team or customer rollout.

### 9.4 Accessibility

- Keyboard access is required for all core flows.
- Text and controls meet WCAG 2.2 AA contrast targets.
- Focus states are visible.
- Color is not the only status indicator.
- Tables support screen-reader labels where practical.

### 9.5 Maintainability

- API contract is versioned.
- Schema migrations are tracked.
- Business rules are centralized in shared backend helpers.
- Tests cover state machine and money math.
- ADRs document major decisions.

## 10. Product Analytics and Privacy

MVP analytics can be local-only or disabled by default. Future product analytics must avoid card numbers, PINs, CVVs, billing ZIPs, buyer names, notes, and any sensitive payload data.

Allowed event examples:

- card_created
- deal_created
- card_sold
- usage_recorded
- import_completed
- export_completed
- validation_error_category

Do not log sensitive field values.

## 11. Release Scope Recommendation

### MVP Release 1

- Setup/login/logout/change secret.
- Deals and batch cards.
- Card list/detail/edit.
- Reserve/unreserve/sell/undo sale.
- Use/undo usage/void.
- Mask/reveal/copy behavior.
- CSV preview/confirm.
- Raw DB export and plaintext JSON export with warnings.
- Audit list/detail.
- Core dashboard.
- P0/P1 tests.

### Release 2

- Encrypted portable export and restore path. Status: implemented in Release 2 milestone 1 on 2026-05-12.
- Settings page backup controls. Status: implemented in Release 2 milestone 2 on 2026-05-12.
- Reservation metadata UX/API polish. Status: implemented in Release 2 milestone 3 on 2026-05-12.
- Better P&L dashboard. Status: implemented in Release 2 milestone 4 on 2026-05-12.
- Accessibility polish. Status: modal focus/keyboard behavior implemented in Release 2 milestone 5 and automated WCAG A/AA axe smoke checks implemented in Release 2 milestone 8 on 2026-05-12.
- More import templates. Status: marketplace and prepaid CSV templates/aliases implemented in Release 2 milestone 7 on 2026-05-12.
- Performance tests. Status: explicit 20,000-card/1,000-row CSV smoke script implemented in Release 2 milestone 6 on 2026-05-12.
- Hosted-use hardening decisions. Status: plaintext export deployment flag implemented and hosted infrastructure gates documented in ADR 0005 on 2026-05-12.

### Release 3

- Team account model. Status: single-account multi-user activation implemented in Release 3 on 2026-05-12; multi-account/team tenancy remains out of scope.
- Role-based access. Status: owner/admin/operator/viewer RBAC implemented in Release 3 on 2026-05-12.
- Persistent session/rate-limit store. Status: SQLite-backed single-node session and login-attempt stores implemented in Release 3 milestone 1 on 2026-05-12; external shared store remains required before multi-instance hosting.
- Admin audit and support tooling. Status: user admin, support-policy record, data-retention policy, sanitized data export, inventory deletion, metrics export, and sanitized error reporting implemented in Release 3 on 2026-05-12.
- Postgres migration spike if productization proceeds. Status: completed in ADR 0006 on 2026-05-12; implementation remains required before multi-instance or SaaS deployment.

## 12. Open Product Questions

1. Are users expected to manage cards for themselves only, or for other people/customers?
2. Should the product support multiple currencies?
3. Should sale price be allowed to exceed remaining balance, and how should profit be calculated?
4. Should reservation have expiration and reserved-for fields?
5. Should sold cards ever be searchable by full card number after sale?
6. Should credential reveal events be audited?
7. What is the minimum supported screen size?
8. Should plaintext export be disabled by default in product/SaaS mode?
9. What customer-support workflows are needed for a future product?
10. What legal/compliance review is required before storing any network-branded prepaid card data?
