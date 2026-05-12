# Engineering Implementation Spec v2 - Secure Gift Card Manager

Status: Proposed engineering handoff
Review date: 2026-05-10
Primary audience: backend, frontend, QA, tech lead

## 1. Engineering Objectives

Build a maintainable web application that enforces gift-card inventory rules, protects sensitive credentials, supports fast data entry, and can evolve from a local MVP into a future team/product deployment.

Core engineering principles:

1. Business invariants live on the server and in database constraints, not only in the UI.
2. All money is stored as integer cents.
3. All lifecycle mutations happen through explicit action endpoints.
4. Sensitive credential fields are encrypted at rest.
5. Audit records are append-only and redacted.
6. Import/export operations are transactional and safe by default.
7. Productization seams are added early, even if dormant in MVP.

## 2. Recommended Architecture

### 2.1 MVP Architecture

Frontend:

- React 18
- Vite
- React Query
- Vanilla CSS or a small internal design-token layer
- Playwright-friendly selectors

Backend:

- Node.js
- Express
- better-sqlite3
- SQLite WAL mode
- Server-side session cookie
- Central validation helpers
- Central crypto module

Database:

- SQLite for local/small deployment.
- Migrations tracked explicitly.
- WAL mode enabled.
- Foreign keys enabled on every connection.

### 2.2 Product-Ready Seams

Even in MVP, include:

- accountId/workspaceId on business tables.
- userId fields on audit and future team actions.
- schema_migrations table.
- keyVersion for encrypted fields.
- idempotency_keys table.
- import_jobs table.
- app_settings table.
- clean repository/data-access layer so SQLite can later be replaced by Postgres.

### 2.3 When to Move Beyond SQLite

SQLite can be appropriate for MVP and small single-node deployments. Move to Postgres or another server database before:

- Multi-instance application deployment.
- True multi-tenant SaaS.
- Customer support/admin queries across accounts.
- Heavy concurrent writes.
- Complex reporting workloads.
- Hosted backups and point-in-time recovery requirements.

## 3. Database Model

### 3.1 Naming Recommendations

Avoid legacy names that imply a short PIN for the unlock secret.

Recommended changes:

- users.pinHash -> users.unlockSecretHash
- change-pin endpoint -> change-unlock-secret endpoint, while optionally keeping legacy alias temporarily

### 3.2 Core Tables

#### accounts

MVP can create one default account.

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | Default account id 1 in MVP |
| name | TEXT NOT NULL | e.g. Personal |
| mode | TEXT NOT NULL | local, team, product |
| createdAt | TEXT NOT NULL | ISO timestamp |
| updatedAt | TEXT NOT NULL | ISO timestamp |

#### users

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| accountId | INTEGER NOT NULL | FK accounts.id |
| email | TEXT NULL | Future product use |
| displayName | TEXT NULL | |
| role | TEXT NOT NULL | owner, admin, operator, viewer. MVP owner only |
| unlockSecretHash | TEXT NOT NULL | bcrypt or stronger password hashing strategy |
| encryptionSalt | TEXT NOT NULL | Salt for KEK derivation |
| encryptedDEK | TEXT NOT NULL | DEK wrapped by KEK |
| keyVersion | INTEGER NOT NULL DEFAULT 1 | Supports crypto migration |
| createdAt | TEXT NOT NULL | |
| updatedAt | TEXT NOT NULL | |

#### deals

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| accountId | INTEGER NOT NULL | FK accounts.id |
| name | TEXT NOT NULL | |
| source | TEXT NULL | Deal source, e.g. Staples |
| purchaseDate | TEXT NULL | Date only, YYYY-MM-DD |
| inputTotalCostCents | INTEGER NULL | Optional original total entered by user for auditability |
| notes | TEXT NULL | Plaintext but treated as sensitive-ish |
| archivedAt | TEXT NULL | |
| createdByUserId | INTEGER NULL | FK users.id |
| updatedByUserId | INTEGER NULL | FK users.id |
| createdAt | TEXT NOT NULL | |
| updatedAt | TEXT NOT NULL | |
| rowVersion | INTEGER NOT NULL DEFAULT 1 | Optimistic concurrency |

#### cards

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| accountId | INTEGER NOT NULL | FK accounts.id |
| dealId | INTEGER NULL | FK deals.id ON DELETE SET NULL |
| brand | TEXT NOT NULL | Normalize display case in app |
| cardType | TEXT NOT NULL | merchant, prepaid |
| network | TEXT NULL | visa, mastercard, amex, discover, other; relevant for prepaid |
| faceValueCents | INTEGER NOT NULL | Immutable after meaningful activity; check > 0 |
| remainingBalanceCents | INTEGER NOT NULL | Mutated only by action endpoints |
| purchaseCostCents | INTEGER NOT NULL DEFAULT 0 | check >= 0 |
| cardNumber | TEXT NULL | Encrypted normalized number |
| cardNumberHash | TEXT NULL | HMAC blind index of normalized number |
| cardNumberLast4 | TEXT NULL | Safe display/search helper |
| pin | TEXT NULL | Encrypted merchant gift-card PIN or equivalent |
| cvv | TEXT NULL | Should remain NULL for network-branded cards in product mode |
| billingZip | TEXT NULL | Encrypted if stored |
| expirationDate | TEXT NULL | YYYY-MM-DD or YYYY-MM if exact date unavailable; decide one format |
| cardholderName | TEXT NULL | Plaintext; avoid if not needed |
| status | TEXT NOT NULL | available, reserved, in_use, sold, used_up, void |
| format | TEXT NULL | digital, physical |
| source | TEXT NULL | Snapshot from deal at creation |
| notes | TEXT NULL | Escape in UI; never render HTML |
| keyVersion | INTEGER NOT NULL DEFAULT 1 | Crypto migration |
| createdByUserId | INTEGER NULL | |
| updatedByUserId | INTEGER NULL | |
| createdAt | TEXT NOT NULL | |
| updatedAt | TEXT NOT NULL | |
| rowVersion | INTEGER NOT NULL DEFAULT 1 | Optimistic concurrency |

Recommended constraints:

- cardType IN ('merchant','prepaid')
- status IN ('available','reserved','in_use','sold','used_up','void')
- format IS NULL OR format IN ('digital','physical')
- network IS NULL OR network IN ('visa','mastercard','amex','discover','other')
- faceValueCents > 0
- remainingBalanceCents >= 0
- remainingBalanceCents <= faceValueCents
- purchaseCostCents >= 0

Recommended indexes:

- (accountId, status)
- (accountId, brand)
- (accountId, dealId)
- (accountId, cardNumberHash, brand)
- (accountId, expirationDate)
- (accountId, updatedAt)

Duplicate rule:

- On create/update/import, if cardNumberHash is not null, flag same accountId + brand + cardNumberHash as duplicate candidate.
- Decide whether duplicates are hard-blocked or require explicit override. For MVP, hard-block active duplicate cards unless imported as conflict resolution.

#### reservations

This can be a future table, but add fields early if reservation metadata matters.

Option A - simple card fields:

- reservedFor
- reservedUntil
- reservedNotes

Option B - reservations table:

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| accountId | INTEGER NOT NULL | |
| cardId | INTEGER NOT NULL | |
| reservedFor | TEXT NULL | Buyer/dealer/friend/group |
| reservedUntil | TEXT NULL | Optional expiration |
| releasedAt | TEXT NULL | |
| createdByUserId | INTEGER NULL | |
| createdAt | TEXT NOT NULL | |

Use Option A for MVP unless reservation history becomes important.

#### transactions

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| accountId | INTEGER NOT NULL | |
| cardId | INTEGER NOT NULL | FK cards.id ON DELETE RESTRICT |
| type | TEXT NOT NULL | sale, sale_reversal |
| buyerName | TEXT NULL | Plaintext business data |
| buyerType | TEXT NULL | dealer, group_chat, friend, self, other |
| salePriceCents | INTEGER NULL | check >= 0 |
| feesCents | INTEGER NOT NULL DEFAULT 0 | Future P&L; optional in MVP |
| netProceedsCents | INTEGER NULL | If fees modeled |
| remainingBalanceAtSaleCents | INTEGER NULL | Snapshot |
| statusAtSale | TEXT NULL | available, reserved, in_use |
| platform | TEXT NULL | |
| reason | TEXT NULL | Required for reversals |
| transactionDate | TEXT NULL | |
| notes | TEXT NULL | |
| idempotencyKey | TEXT NULL | |
| createdByUserId | INTEGER NULL | |
| createdAt | TEXT NOT NULL | |

#### usages

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| accountId | INTEGER NOT NULL | |
| cardId | INTEGER NOT NULL | FK cards.id ON DELETE RESTRICT |
| amountCents | INTEGER NOT NULL | check > 0 |
| merchant | TEXT NULL | For use location or Write-off (Voided) |
| description | TEXT NULL | |
| isReversed | INTEGER NOT NULL DEFAULT 0 | 0/1 |
| isWriteOff | INTEGER NOT NULL DEFAULT 0 | 0/1; cannot be undone |
| reversalReason | TEXT NULL | If reversed |
| reversedAt | TEXT NULL | |
| usageDate | TEXT NULL | |
| idempotencyKey | TEXT NULL | |
| createdByUserId | INTEGER NULL | |
| createdAt | TEXT NOT NULL | |

#### audit_log

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| accountId | INTEGER NOT NULL | |
| userId | INTEGER NULL | MVP user 1 |
| requestId | TEXT NULL | Correlates logs |
| entityType | TEXT NOT NULL | card, deal, transaction, usage, auth, backup, import |
| entityId | INTEGER NULL | |
| action | TEXT NOT NULL | e.g. card.sell |
| oldValue | TEXT NULL | Redacted JSON |
| newValue | TEXT NULL | Redacted JSON |
| metadata | TEXT NULL | Redacted JSON: IP hash, user agent hash, import job id, etc. |
| timestamp | TEXT NOT NULL | |

Never store full card number, PIN, CVV/CID, billing ZIP, unlock secret, or plaintext backup content in audit.

#### idempotency_keys

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| accountId | INTEGER NOT NULL | |
| userId | INTEGER NULL | |
| key | TEXT NOT NULL | Client-provided |
| method | TEXT NOT NULL | |
| path | TEXT NOT NULL | |
| requestHash | TEXT NOT NULL | Hash of normalized request body |
| responseStatus | INTEGER NULL | |
| responseBody | TEXT NULL | Safe response only |
| createdAt | TEXT NOT NULL | |
| expiresAt | TEXT NOT NULL | |

Unique index: accountId + key.

Use for sale, use, void, undo, import confirm, export, and destructive operations.

#### import_jobs

| Field | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| accountId | INTEGER NOT NULL | |
| userId | INTEGER NULL | |
| type | TEXT NOT NULL | csv, json_replace, json_merge |
| status | TEXT NOT NULL | previewed, confirmed, failed, canceled |
| rowCount | INTEGER NOT NULL DEFAULT 0 | |
| validCount | INTEGER NOT NULL DEFAULT 0 | |
| invalidCount | INTEGER NOT NULL DEFAULT 0 | |
| summaryJson | TEXT NULL | Redacted summary |
| createdAt | TEXT NOT NULL | |
| updatedAt | TEXT NOT NULL | |

## 4. State Machine

Allowed transitions:

| Action | From | To | Side Effects |
|---|---|---|---|
| reserve | available | reserved | audit; optional reservation metadata |
| unreserve | reserved | available | audit; clear reservation metadata |
| sell | available/reserved/in_use | sold | create sale transaction; snapshot remainingBalance and status; set remainingBalanceCents = 0 |
| undo-sale | sold | statusAtSale | create sale_reversal; restore remainingBalanceAtSaleCents; reason required |
| use | available/in_use | in_use or used_up | create usage; deduct amount; used_up if balance 0 |
| undo-usage | in_use/used_up | available or in_use | mark usage reversed; recalc balance; reason required; reject write-off |
| void | available/reserved/in_use | void | create write-off usage for remaining balance; set balance 0 |

Rules:

- State-changing endpoints must re-read current state inside the transaction.
- UI state is not trusted.
- Invalid transitions return 409 Conflict or 400 Bad Request depending on cause.
- All state transitions write audit entries.
- Terminal statuses sold, used_up, and void allow notes-only edits unless an admin correction feature exists.

## 5. Transaction Pattern

For any mutation:

1. Parse and validate request shape.
2. Normalize inputs.
3. For encrypted fields, perform encryption outside transaction when safe.
4. Start write transaction using BEGIN IMMEDIATE.
5. Re-read current row.
6. Validate current state and rowVersion if provided.
7. Apply writes.
8. Insert audit entry.
9. Commit.
10. Return safe response.

Important:

- Do not perform asynchronous work inside a better-sqlite3 transaction block.
- Keep write transactions short.
- If a request has Idempotency-Key, check/store it transactionally.

## 6. API Contract

Create an OpenAPI file before frontend/backend parallel implementation.

### 6.1 Standard Response Shape

Successful list response:

```json
{
  "data": [],
  "page": {
    "limit": 50,
    "offset": 0,
    "total": 123,
    "hasMore": true
  }
}
```

Successful object response:

```json
{
  "data": {
    "id": 1
  }
}
```

Error response:

```json
{
  "error": {
    "code": "CARD_INVALID_TRANSITION",
    "message": "Sold cards cannot be used.",
    "fieldErrors": [
      { "field": "status", "code": "invalid_state", "message": "Expected available or in_use." }
    ],
    "requestId": "req_abc123"
  }
}
```

### 6.2 Status Code Guidance

| Status | Use |
|---:|---|
| 200 | Successful read or action |
| 201 | Created |
| 204 | Deleted with no body |
| 400 | Invalid input shape or validation failure |
| 401 | Not authenticated or DEK locked |
| 403 | Authenticated but not allowed, CSRF/origin failure |
| 404 | Entity not found in account scope |
| 409 | State conflict, duplicate conflict, stale rowVersion, import conflict |
| 413 | Upload too large |
| 429 | Rate limited |
| 500 | Unexpected server error |

### 6.3 Auth Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | /api/auth/status | Returns setupComplete, sessionValid, dekLoaded, csrfToken if session valid |
| POST | /api/auth/setup | Creates first user/account; 409 if already setup |
| POST | /api/auth/login | Unlocks DEK; regenerates session; rate limited |
| POST | /api/auth/logout | Clears session and user unlock state |
| POST | /api/auth/change-unlock-secret | Old secret required; rewraps DEK with new salt |

### 6.4 Cards Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | /api/cards | Paginated; filterable; exact card-number search through blind index |
| GET | /api/cards/:id | Includes detail, transactions, usages, audit summary |
| POST | /api/cards | Create one or batch; normalized/encrypted by backend |
| PUT | /api/cards/:id | Allowed fields by status; rowVersion recommended |
| DELETE | /api/cards/:id | Only for never-touched available cards; prefer void otherwise |
| POST | /api/cards/:id/reserve | Action endpoint |
| POST | /api/cards/:id/unreserve | Action endpoint |
| POST | /api/cards/:id/sell | Idempotency-Key recommended |
| POST | /api/cards/:id/undo-sale | Reason required |
| POST | /api/cards/:id/use | Idempotency-Key recommended |
| POST | /api/cards/:id/undo-usage | usageId and reason required |
| POST | /api/cards/:id/void | Reason recommended; write-off created |

### 6.5 Deals Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | /api/deals | Excludes archived by default |
| GET | /api/deals/:id | Includes cards and summary |
| POST | /api/deals | May include cards and transient totalCostCents |
| PUT | /api/deals/:id | name/source/purchaseDate/notes; rowVersion recommended |
| POST | /api/deals/:id/archive | |
| POST | /api/deals/:id/unarchive | |

### 6.6 Import/Export Endpoints

| Method | Path | Notes |
|---|---|---|
| POST | /api/cards/import-csv | Preview only; no commit |
| POST | /api/cards/import-csv/confirm | Revalidates and commits |
| POST | /api/backup/export | Plaintext JSON; fresh secret and confirmation required |
| POST | /api/backup/export-encrypted | Implemented Release 2 milestone; encrypted portable JSON with separate backup passphrase |
| POST | /api/backup/db-file | Raw database export; fresh secret required |
| POST | /api/backup/import | Plaintext or encrypted JSON restore; replace or merge; backup before replace |

### 6.7 Settings Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | /api/settings/backup | Returns plaintext-export toggle, reminder interval, last backup timestamps, and due status |
| PUT | /api/settings/backup | Requires current unlock secret; updates backup reminder and plaintext-export toggle; writes redacted audit |

## 7. Validation Rules

Centralize validation in backend modules. Do not duplicate business logic only in route handlers.

Recommended modules:

- money.js: parse cents, format cents, prohibit floats in storage.
- cardNumber.js: normalize, last4, hash input.
- cardValidators.js: create/update/action validation.
- stateMachine.js: allowed transitions and side effects.
- auditRedaction.js: redacts old/new values.
- importValidators.js: CSV and JSON validation.
- errorCodes.js: standard error codes.

## 8. Encryption and Key Management

Required:

- Generate random DEK at setup.
- Derive KEK from unlock secret and salt.
- Wrap DEK with KEK.
- Store encrypted DEK and salt.
- Keep DEK in memory only after login.
- Encrypt cardNumber, merchant PIN, permitted sensitive fields, and billing ZIP.
- Use authenticated encryption such as AES-256-GCM.
- Derive blind-index HMAC key from DEK using HKDF with domain separation.
- Normalize card number before encrypt/hash/search/redact.
- Add keyVersion to allow migration.

Future:

- Per-account DEK in team/product mode.
- Optional per-user wrapping of account DEK.
- Key rotation runbook.
- Emergency recovery policy.

## 9. Frontend Architecture

Recommended structure:

```text
src/
  api/
    client.js
    errors.js
    generated-or-typed-api.js
  app/
    App.jsx
    routes.jsx
  auth/
    AuthContext.jsx
    RequireAuth.jsx
  components/
    common/
    layout/
    cards/
    deals/
    import/
  hooks/
    useCards.js
    useCardDetail.js
    useDeals.js
    useMutations.js
  pages/
    DashboardPage.jsx
    CardsPage.jsx
    CardDetailPage.jsx
    DealsPage.jsx
    DealDetailPage.jsx
    TransactionsPage.jsx
    UsagesPage.jsx
    AuditPage.jsx
    SettingsPage.jsx
  utils/
    formatters.js
    money.js
    dates.js
```

Frontend rules:

- Never trust client validation for integrity.
- Do not store revealed credentials in global state longer than needed.
- Clear sensitive detail on logout/lock.
- Do not log API payloads containing credentials.
- Use stable data-testid values for E2E tests on critical actions.

## 10. Observability

MVP should include:

- Request ID for every request.
- Structured server logs without sensitive fields.
- Health endpoint.
- Error boundary on frontend.
- Client-visible requestId in error responses.
- Audit for sensitive operations.

Product mode should add:

- Metrics: request count, latency, error rate, DB busy count, import duration, export count.
- Alerts for repeated failed login, export spikes, import failures, DB backup failures.
- Centralized error reporting with redaction.

## 11. Migrations

Add explicit migrations from the beginning.

Recommended:

```text
server/db/migrations/
  001_init.sql
  002_add_indexes.sql
  003_add_import_jobs.sql
```

Rules:

- Every schema change has a migration file.
- Migrations are idempotent or tracked in schema_migrations.
- Test migration from previous seeded database.
- Backup before destructive migrations.

## 12. Engineering ADRs to Create

Create short ADRs for:

1. SQLite for MVP and Postgres migration threshold.
2. Single-account MVP with accountId seam.
3. Encryption envelope and blind index.
4. CVV/CID non-storage policy.
5. State machine decisions.
6. Plaintext export risk and encrypted export roadmap.
7. API error and idempotency model.
8. Audit redaction policy.

## 13. Engineering Acceptance Checklist

Before merging a feature:

- Requirement ID is referenced in PR/issue.
- Backend validation is covered by tests.
- Database constraints or transaction logic protect invariants.
- API contract is updated.
- Audit behavior is implemented if relevant.
- UI handles loading, error, empty, and success states.
- Security-sensitive fields are redacted in logs and audit.
- QA test cases are updated.
- No new dependency without review.
