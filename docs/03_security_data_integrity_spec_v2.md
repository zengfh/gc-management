# Security and Data Integrity Spec v2 - Secure Gift Card Manager

Status: Proposed security handoff
Review date: 2026-05-10
Primary audience: backend, security reviewer, QA, PM

## 1. Security Goals

The application stores spendable credentials and money-adjacent inventory data. Security goals are:

1. Protect card credentials at rest.
2. Prevent unauthorized state-changing actions.
3. Prevent accidental plaintext exposure in UI, logs, audit, exports, and backups.
4. Preserve financial and lifecycle integrity under normal and concurrent usage.
5. Keep future productization possible without unsafe shortcuts.

## 2. Threat Model

### 2.1 Assets

Critical assets:

- Full card numbers.
- Merchant gift-card PINs.
- Billing ZIPs and other authorization data.
- Network-branded card CVV/CID if ever entered transiently.
- Unlock secret.
- Encrypted DEK and encryption salt.
- Plaintext export files.
- Raw database files and WAL files.
- Audit records and business relationship data.

### 2.2 Primary Attackers

- Local attacker who copies the database file.
- Web attacker attempting CSRF, XSS, or session theft.
- Malicious or careless authenticated user in future team mode.
- User who accidentally exports plaintext and stores it insecurely.
- Import file attacker using malicious CSV or JSON content.
- Dependency or supply-chain compromise.

### 2.3 High-Risk Scenarios

| Scenario | Risk | Required Control |
|---|---|---|
| Database file copied | Offline secret guessing; encrypted fields exposed if weak secret | Strong unlock secret, slow KDF, backup sensitivity warnings |
| XSS in notes/imported text | Revealed credentials stolen | React safe rendering, no unsafe HTML, CSP, input validation, E2E security tests |
| CSRF state change | Unauthorized sale/use/export | CSRF token, Origin/Referer validation, SameSite cookies |
| Plaintext backup mishandled | Full credential leak | Fresh secret, type confirmation, no-store, warnings, encrypted export option |
| Concurrent sale/use | Financial/data corruption | BEGIN IMMEDIATE, state re-read inside transaction, tests |
| CVV/CID persisted | Compliance and liability risk | Do not persist network-card CVV/CID in product mode |
| Audit logs leak secrets | Sensitive exposure | Central redaction and tests |

## 3. Credential Classification

Release 5 should use credential profiles rather than assuming every card has a card number. See `docs/12_credential_profiles_research_and_design.md` for code-only, claim-link URL, number-plus-PIN, barcode, network prepaid, and custom field handling.

| Field | Storage Policy | Notes |
|---|---|---|
| primary credential code/link/number/barcode | Encrypted + blind index where searchable | Preserve code/link text before encryption; normalize only for non-URL search hashes and field-specific validation |
| merchant gift-card PIN | Encrypted | This is different from payment-card CVV |
| network-branded card CVV/CID | Do not persist in product mode | If collected, use transiently only and never export/log/store |
| billing ZIP/address | Encrypted if stored | Needed for some network prepaid online use |
| expirationDate | Plaintext by design | Needed for expiration queries; not sufficient alone to spend card |
| cardholderName | Plaintext only if needed | Treat as personal data |
| notes | Plaintext | Escape in UI; never render HTML |
| buyerName | Plaintext | Business relationship data; avoid analytics/logging |
| unlock secret | Never stored | Store only password hash/KDF metadata |

## 4. CVV/CID Policy

For future product/commercial mode, network-branded prepaid Visa, Mastercard, American Express, Discover, or similar CVV/CID values must not be stored, even encrypted.

Implementation rules:

- UI should not show a persisted CVV/CID field for network-branded cards.
- API must reject persisted cvv for network-branded card types unless the deployment explicitly disables product-mode policy for a private/local-only build.
- Plaintext export must omit network-card CVV/CID.
- Audit and logs must never contain CVV/CID.
- Merchant gift-card PIN remains allowed and encrypted.

Recommended product copy:

"For network-branded prepaid cards, security codes are not saved. Keep the physical card or original source available if you need the code. Merchant gift-card PINs can be saved encrypted."

## 5. Encryption Design

### 5.1 Envelope Encryption

- At setup, generate a random Data Encryption Key (DEK).
- Derive Key Encryption Key (KEK) from unlock secret and encryptionSalt.
- Store encryptedDEK in users or account key table.
- Keep DEK in process memory only after successful login/unlock.
- On server restart, DEK is gone and user must log in again.
- On unlock secret change, rotate salt and rewrap DEK; card data does not need rewriting.
- Passkey login is a convenience unlock path, not the only recovery path. Registered passkeys store the WebAuthn public key and a separate DEK copy encrypted by a stable server-side passkey wrap secret (`GC_PASSKEY_WRAP_SECRET`, falling back to `SESSION_SECRET`). If that server secret is rotated without migration, passkey unlock can fail; the unlock secret and recovery codes remain the authoritative recovery mechanisms.

### 5.2 Field Encryption

Use authenticated encryption such as AES-256-GCM.

Persist format:

```text
base64(iv):base64(authTag):base64(ciphertext)
```

Add keyVersion for future rotation.

### 5.3 Blind Index

- Derive HMAC key from DEK using HKDF with context string such as blind-index-hmac.
- Normalize card number before HMAC.
- Store HMAC-SHA256 output as cardNumberHash.
- Search only supports exact full card number matching unless a safer tokenization strategy is added.

### 5.4 Card Number Normalization

Normalize by removing non-digits:

```js
function normalizeCardNumber(input) {
  return input ? input.replace(/\D/g, '') : null;
}
```

Apply before:

- Encrypting.
- HMAC hashing.
- Searching.
- Dedup comparison.
- Redacting last four digits.

## 6. Unlock Secret Policy

Requirements:

- Reject 4-6 digit PINs.
- Allow passphrases with at least 12 characters.
- Allow 8+ digit random numeric codes only if they are not obvious sequences.
- Reject common passwords and obvious patterns.
- Rate-limit failed attempts.
- Do not use the term PIN for the unlock secret in product UI unless the code is truly strong.

Recommended:

- Use zxcvbn-style strength checking for passphrases.
- Show clear guidance: "Use a long passphrase you can remember. Anyone with your database and this passphrase can unlock your card data."

## 7. Authentication and Session Security

### 7.1 Cookie Settings

Production session cookie:

- httpOnly: true
- secure: true
- sameSite: strict or lax based on product needs; strict is acceptable for local/private MVP
- reasonable maxAge
- regenerate session on login
- destroy session on logout

### 7.2 CSRF

All authenticated state-changing endpoints require:

- Valid session.
- Valid X-CSRF-Token.
- Origin or Referer matching configured app origin.
- Failure returns 403 with no side effects.

Sensitive export endpoints also require CSRF protection even if they primarily return data.

### 7.2.1 Passkeys

- Passkey registration requires an already unlocked session and CSRF protection.
- Passkey login uses WebAuthn challenge/response and regenerates the server session before loading DEK material into memory.
- Store only WebAuthn public key material, counters, non-sensitive transport metadata, and the server-wrapped DEK convenience copy.
- Do not treat a passkey as secret recovery. Device/browser loss must fall back to unlock secret or one-time recovery codes.
- Production deployments should set a stable `GC_PASSKEY_WRAP_SECRET` before users register passkeys; rotating `SESSION_SECRET` alone must not unexpectedly invalidate passkeys.

### 7.3 Reauthentication for Sensitive Actions

Require fresh unlock secret re-entry for:

- Plaintext export.
- Raw DB export.
- Import replace.
- Change unlock secret.
- User creation and role/disabled-state changes.
- Support policy and data retention policy updates.
- Sanitized account export.
- Retention purge and inventory deletion.

Freshness window should be short, e.g. immediate prompt or a 5-minute reauth token.

### 7.4 Rate Limiting

MVP:

- SQLite-backed rate limiting is implemented for local and single-node hosted usage.

Product mode:

- A shared persistent rate-limit store such as Redis or the production database is required for multi-instance deployments.
- Scope by account, user, IP, and action type.
- Alert on repeated failed login and repeated export attempts.

### 7.5 Authorization Roles

Release 3 roles:

- owner/admin: manage users, backup/export settings, support policy, data policy, observability, and destructive data operations.
- operator: create and mutate cards/deals and run CSV import, but cannot reveal admin settings or full backup/export controls.
- viewer: read inventory and audit surfaces only; cannot mutate inventory or reveal card credentials.

Role changes and disabled-user changes clear that user's unlocked sessions. The app remains single-account in Release 3; multi-account tenancy remains out of scope.

## 8. XSS and Frontend Security

XSS is critical because authenticated users can reveal spendable credentials.

Requirements:

- Never use dangerouslySetInnerHTML for user/imported content.
- React-render all user text as text, not HTML.
- Sanitize CSV-derived values if displayed in preview.
- Add Content Security Policy.
- Avoid inline scripts.
- Add frame-ancestors 'none' or equivalent unless embedding is required.
- Add X-Content-Type-Options: nosniff.
- Add Referrer-Policy.
- Add HSTS in HTTPS production.
- Do not log frontend API payloads containing credentials.
- Clear revealed secrets on navigation, logout, tab hidden, or timeout.

Suggested CSP for MVP, to be refined during implementation:

```text
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data:;
connect-src 'self';
frame-ancestors 'none';
base-uri 'self';
form-action 'self'
```

If inline styles are avoidable, remove 'unsafe-inline'.

## 9. Clipboard and Reveal Security

Requirements:

- Mask credentials by default.
- Reveal requires explicit click.
- Copy requires explicit click; do not automatically copy on reveal.
- Show only safe toast text such as "Copied".
- Never include full secrets in toast, page title, URL, logs, or analytics.
- Auto-hide revealed secrets after a short timeout.
- Clear revealed secrets on blur/navigation/logout.

Note: browsers do not provide reliable guaranteed clipboard clearing. Do not promise that the clipboard is cleared.

## 10. Backup and Export Security

### 10.1 Plaintext JSON Export

Required controls:

- POST only.
- Valid session.
- Fresh unlock secret.
- Valid CSRF token and Origin/Referer.
- Type-to-confirm phrase such as EXPORT.
- Clear warning that file contains spendable credentials.
- Cache-Control: no-store.
- Audit event without payload.
- File name includes date.
- No network-card CVV/CID values.
- Account setting can disable plaintext export; disabled export returns 403 and writes no export audit event.

### 10.2 Raw Database Export

Required controls:

- POST only.
- Fresh unlock secret.
- Valid CSRF token and Origin/Referer.
- Cache-Control: no-store.
- Audit event.
- Warning: raw DB still contains sensitive metadata and encrypted credentials.
- Include SQLite WAL safety in runbook: when copying WAL-mode databases, handle DB/WAL/SHM correctly or use SQLite backup API.

### 10.3 Encrypted Portable Export

Release 2 milestone 1 implementation status: code complete on 2026-05-12.

Implemented controls:

- `/api/backup/export-encrypted` exports JSON encrypted with a separate backup passphrase.
- The server rejects backup passphrases that exactly reuse the current unlock secret.
- The portable file uses scrypt parameters in the envelope and AES-256-GCM authenticated encryption.
- The envelope includes `schemaVersion`, `payloadSchemaVersion`, `appVersion`, `exportedAt`, `encryptedAt`, KDF parameters, IV, auth tag, and ciphertext.
- The plaintext payload is never returned in the encrypted file and export audit metadata stores counts only.
- `/api/backup/import` restores encrypted portable JSON backups after validating the current unlock secret and backup passphrase.
- Restore tests cover a valid encrypted import and a wrong-passphrase rejection with no database side effects.

Remaining product hardening:

- Add customer-facing backup passphrase recovery/rotation guidance before hosted use.
- Hosted deployments can set `GC_PLAINTEXT_EXPORT_ENABLED=false` to policy-lock plaintext JSON export off regardless of account settings. Implemented in Release 2 milestone 9.
- Decide whether plaintext export should be disabled or feature-flagged in product/SaaS mode.

## 11. Import Security

CSV risks:

- Formula injection in exported CSVs.
- Malicious text causing XSS if rendered unsafely.
- Oversized file DoS.
- Duplicates and conflicts.
- Bad date/money parsing.

Required controls:

- File size limit.
- Row count limit.
- Preview step with row-level validation.
- Confirm step revalidates on server.
- All import text is displayed escaped.
- CSV export, if added, should prefix formula-leading cells as needed.
- Replace import auto-backs up current database before mutation.
- Replace import runs in one transaction and verifies foreign keys before commit.

## 12. Audit Redaction

Central redaction function must cover:

- cardNumber -> masked last4 only.
- pin -> ***.
- cvv -> never store.
- billingZip -> ***.
- unlockSecret -> never store.
- encrypted values -> do not log.
- plaintext export data -> never log.

Audit events should include:

- actor userId.
- accountId.
- entity type/id.
- action.
- requestId.
- timestamp.
- safe before/after diff where applicable.

## 13. Data Integrity Constraints

### 13.1 Database Constraints

Cards:

- cardType in merchant/prepaid.
- status in available/reserved/in_use/sold/used_up/void.
- format null or digital/physical.
- faceValueCents > 0.
- remainingBalanceCents >= 0.
- remainingBalanceCents <= faceValueCents.
- purchaseCostCents >= 0.

Transactions:

- type in sale/sale_reversal.
- salePriceCents is null or >= 0.
- buyerType is null or whitelisted.

Usages:

- amountCents > 0.
- isReversed in 0/1.
- isWriteOff in 0/1.

Foreign keys:

- cards.dealId -> deals.id ON DELETE SET NULL.
- transactions.cardId -> cards.id ON DELETE RESTRICT.
- usages.cardId -> cards.id ON DELETE RESTRICT.

### 13.2 Application Constraints

- use amount must be > 0 and <= current remaining balance.
- sell allowed only from available, reserved, in_use.
- void allowed only from available, reserved, in_use.
- undo-sale allowed only for sold card with sale transaction.
- undo-usage rejects write-off and already reversed usage.
- update restrictions by status.
- import costs must allocate exactly in cents.

## 14. Concurrency Controls

Critical mutations must:

- Use BEGIN IMMEDIATE or equivalent.
- Re-read current card state inside transaction.
- Validate from current DB state, not UI state.
- Write card update, child record, and audit record atomically.
- Have concurrency tests for double sell and rapid use.

Recommended additional control:

- rowVersion or updatedAt precondition for generic PUT to prevent silent stale overwrites.

## 15. Privacy and Data Retention

MVP:

- No third-party analytics by default.
- Logs must not contain sensitive payloads.
- Backups are user-managed and clearly labeled.
- Release 3 includes sanitized data export, support-policy records, retention policy settings, retention purge, and inventory deletion while preserving users and audit trail.

Future product:

- Privacy policy.
- Full legal/privacy review for data deletion/export workflow.
- Retention settings for backups and external monitoring systems.
- Customer support access controls beyond the in-app support-policy record.
- Tenant isolation tests.
- Security incident process.

## 16. Security Test Matrix

| Area | Required Tests |
|---|---|
| Auth | setup, login, logout, restart lock, weak secret rejection, lockout |
| Session | cookie flags, session regeneration, old session invalidation |
| CSRF | missing token, invalid token, bad Origin/Referer, no side effects |
| Encryption | no plaintext credentials in DB, IV uniqueness, deterministic blind index |
| CVV | network-card CVV rejected/not persisted/not exported |
| XSS | notes, buyer, merchant, brand, CSV fields render as text |
| Audit | sensitive fields redacted in old/new values |
| Export | fresh secret, confirmation, no-store, audit, no CVV, encrypted export redaction, plaintext export disablement |
| Import | malformed JSON/CSV rejected, revalidation, encrypted restore, backup before replace |
| Settings | fresh secret for backup setting updates, no secrets in settings audit |
| Concurrency | double sell, rapid use, stale PUT |
| Access control | future account isolation tests before product mode |

## 17. Production Hardening Checklist

Before team/product deployment:

- HTTPS enforced.
- Secure cookies enabled.
- Session secret from environment or secret manager.
- Persistent session store.
- Persistent rate-limit store.
- CSP enabled and tested.
- HSTS enabled.
- Dependency scanning enabled.
- Secret scanning enabled.
- Logs redaction tested.
- Backup/restore runbook tested.
- Monitoring and alerting configured.
- Admin/support access policy documented.
- Legal/compliance review completed for network-branded prepaid card data.
