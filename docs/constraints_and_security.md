# Constraints, Security & Verification (Supplementary Spec)

Companion to [implementation_plan.md](implementation_plan.md).

---

## SQL Constraints

### CHECK Constraints (in `db.js`)

```sql
-- Cards
CHECK(cardType IN ('merchant','prepaid'))
CHECK(status IN ('available','reserved','sold','in_use','used_up','void'))
CHECK(format IS NULL OR format IN ('digital','physical'))
CHECK(faceValueCents > 0)
CHECK(remainingBalanceCents >= 0)
CHECK(remainingBalanceCents <= faceValueCents)
CHECK(purchaseCostCents >= 0)

-- Transactions
CHECK(type IN ('sale','sale_reversal'))
CHECK(buyerType IS NULL OR buyerType IN ('dealer','group_chat','friend','self'))
CHECK(salePriceCents IS NULL OR salePriceCents >= 0)

-- Usages
CHECK(amountCents > 0)
```

### Application-Level Validation (in `cardHelpers.js`)

```text
POST /use:   amountCents > 0 AND amountCents <= remainingBalanceCents
POST /sell:  card status in (available, reserved, in_use)
POST /deals: sum(explicit purchaseCostCents) <= transient totalCostCents
```

### Indexes (in `db.js`)

```sql
CREATE INDEX idx_cards_status ON cards(status);
CREATE INDEX idx_cards_brand ON cards(brand);
CREATE INDEX idx_cards_dealId ON cards(dealId);
CREATE INDEX idx_cards_cardNumberHash ON cards(cardNumberHash);
CREATE INDEX idx_cards_hash_brand ON cards(cardNumberHash, brand);  -- dedup
CREATE INDEX idx_cards_expirationDate ON cards(expirationDate);     -- Expiring Soon
CREATE INDEX idx_transactions_cardId ON transactions(cardId);
CREATE INDEX idx_usages_cardId ON usages(cardId);
CREATE INDEX idx_audit_entity ON audit_log(entityType, entityId);
CREATE INDEX idx_deals_archivedAt ON deals(archivedAt);
```

### Foreign Keys

```sql
PRAGMA foreign_keys = ON;

cards.dealId     → deals.id        ON DELETE SET NULL
transactions.cardId → cards.id     ON DELETE RESTRICT
usages.cardId    → cards.id        ON DELETE RESTRICT
```

**DELETE card rule**: Only if `status IN ('available','void')` AND `0 transactions` AND `0 usages`. Otherwise use void.

---

## Security

### Session, Cookies & CSRF

```text
httpOnly: true
secure: true (in production, false for localhost dev)
sameSite: 'strict'    -- defense-in-depth, not the only CSRF control
maxAge: 24 hours
```

`sameSite: 'strict'` reduces ambient cross-site cookie use, but it is not a complete same-origin authorization policy.

Authenticated state-changing endpoints and sensitive export endpoints must enforce:

```text
Origin/Referer: must match configured app origin
X-CSRF-Token: per-session token returned by GET /api/auth/status after login
Failure: 403 with no side effects
```

All `GET` endpoints remain read-only. Plaintext export and raw `.db` export are `POST` because they are sensitive actions even though they primarily return data.

Setup/login do not have an authenticated CSRF token yet, so they enforce Origin/Referer validation and never accept cross-origin form posts.

### Encryption Field Decisions

| Field | Encrypted? | Rationale |
|-------|-----------|-----------|
| `cardNumber` | ✅ Yes + blind index | Primary credential |
| `pin` | ✅ Yes | Primary credential |
| `cvv` | ⚠️ Conditional | Store encrypted only when retention is allowed. For network-branded prepaid Visa/MC/Amex CVV/CID, default behavior is **do not persist** after authorization; keep NULL/export null unless the operator has a documented issuing/support exception |
| `billingZip` | ✅ Yes | Direct payment auth field for prepaid cards |
| `expirationDate` | ❌ No | **Tradeoff**: needed for "Expiring Soon" dashboard queries (date range filtering). Without card number (encrypted), expiration alone is not actionable |
| `cardholderName` | ❌ No | Needed for display. Not directly exploitable without card number |
| `notes` | ❌ No | Needed for search. May contain user context, not credentials |
| `buyerName` | ❌ No | Business relationship data, not payment credentials |

### Card Number Normalization

All operations on card numbers use normalized form:

```js
function normalizeCardNumber(input) {
  return input ? input.replace(/\D/g, '') : null;
}
```

Applied before: encrypt, HMAC hash, search query, dedup comparison, redaction (last 4 digits).

Ensures `4111 1111 1111 1111`, `4111-1111-1111-1111`, and `4111111111111111` are treated identically.

### Rate Limiting

```text
3 failed attempts  → 30 second lockout
5 failed attempts  → 5 minute lockout
10 failed attempts → 30 minute lockout
Scope: global (= per-identity for single-user app)
Storage: in-memory (resets on server restart — acceptable for local app)
```

### Unlock Secret & Offline Database Threat

The `.db` contains `pinHash`, `encryptedDEK`, and `encryptionSalt`. If an attacker copies the database, they can make offline guesses; online rate limiting does not help.

Requirements:

- Do not allow 4-6 digit PINs.
- Require either a passphrase with at least 12 characters or an 8+ digit random numeric code.
- Reject common secrets and obvious sequences (`password1234`, `12345678`, repeated digits).
- Keep bcrypt cost at 12+ for `pinHash`; keep scrypt at `N=2^17, r=8, p=1` for KEK derivation.
- Treat raw `.db` backups as sensitive even though card credentials are encrypted.

### Plaintext Export Security

- Uses `POST /api/backup/export`
- Requires **fresh unlock secret re-entry**
- Requires valid `X-CSRF-Token` and matching Origin/Referer
- UI confirmation: user must **type "EXPORT"** to proceed
- Warning text: "This file contains full card numbers, card PINs, permitted/stored CVVs, billing ZIPs, and balances in plaintext. Anyone with this file can spend your cards."
- Filename: `gc-backup-YYYY-MM-DD.json`
- Response headers: `Cache-Control: no-store`
- Audit: record export event without sensitive payload contents

Raw `.db` export uses `POST /api/backup/db-file` and the same fresh secret, CSRF/origin, no-store, and audit requirements.

---

## Backup/Import Details

### Export JSON Format

```json
{
  "schemaVersion": 1,
  "appVersion": "1.0.0",
  "exportedAt": "2026-05-07T17:00:00Z",
  "data": {
    "deals": [...],
    "cards": [...],
    "transactions": [...],
    "usages": [...],
    "auditLog": [...]
  }
}
```

Sensitive fields (`cardNumber`, `pin`, permitted/stored `cvv`, `billingZip`) exported as **plaintext** (user is authenticated + unlock secret confirmed). `users` table never exported. Network-branded prepaid CVV/CID values that were not retained are exported as `null`/omitted.

### Import: Replace Mode

1. Auto-backup current `.db` file
2. Validate `schemaVersion` — reject unsupported versions
3. Restore in one transaction with FK-safe ordering:
   - Delete children before parents: `usages`, `transactions`, `cards`, `deals`, then `audit_log`
   - Insert parents before children: `deals`, `cards`, `transactions`, `usages`, then `audit_log`
   - Run `PRAGMA foreign_key_check` before commit and abort on any row
4. **Exclude `users` table** — current unlock secret/DEK untouched
5. Re-encrypt `cardNumber`, `pin`, permitted/stored `cvv`, `billingZip` with current DEK
6. Compute `cardNumberHash` using current HKDF-derived hmacKey
7. Normalize card numbers before re-encryption
8. Redact sensitive fields in imported audit entries
9. Record a local import audit event without sensitive payload contents
10. **Reset `sqlite_sequence`** for each table to MAX(id)
11. Rebuild indexes

### Import: Merge Mode

1. **Cards only** — transactions, usages, audit from backup are **ignored**
2. Cards get **new auto-increment IDs**, `dealId` set to NULL
3. Dedup by normalized `cardNumberHash + brand` (skip dedup when `cardNumber` is null)
4. **409 with conflict list** if matching card exists in different status — user must resolve
5. Re-encrypt + compute hashes using current DEK

---

## PUT Restrictions by Status

| Status | Editable Fields |
|--------|----------------|
| `available` | All non-blocked fields (brand, cardType, cardNumber, pin, permitted cvv, billingZip, expirationDate, cardholderName, format, source, notes, purchaseCostCents, dealId) |
| `reserved` | Same as available |
| `in_use` | Same as available |
| `sold` | `notes` only |
| `used_up` | `notes` only |
| `void` | `notes` only |

**Always blocked** regardless of status: `faceValueCents`, `remainingBalanceCents`, `status`.

---

## Verification Plan (57 tests)

### Auth & Security (1–8)
1. Setup rejects weak unlock secret; valid setup → logout → login → 3x wrong → 30s lockout → retry
2. Setup when unlock secret exists → 409
3. Server restart → 401 `dekLoaded:false` → re-login → cards readable
4. Change unlock secret (new salt) → all cards still decryptable
5. Session regeneration on login (new session ID)
6. Session cookie has HttpOnly, SameSite=strict; missing/invalid CSRF token or Origin rejected for mutating endpoints
7. Plaintext export and raw DB export require fresh unlock secret, CSRF/origin checks, `Cache-Control: no-store`, and audit
8. Logout clears DEK and session; old session cookie returns 401

### Encryption (9–13)
9. Inspect `.db` → cardNumber/pin/permitted cvv/billingZip are `IV:AuthTag:Ciphertext`
10. Encrypt same value twice → different IVs
11. JSON export → retained sensitive fields are plaintext + UI warning + type "EXPORT"; non-retained prepaid CVV/CID is null/omitted
12. `cardNumberHash` is deterministic (same input → same hash)
13. `expirationDate` is plaintext in DB (verified for Expiring Soon feature)

### Card Lifecycle (14–19)
14. Add → reserve → sell → verify transaction + `remainingBalanceAtSaleCents` + `statusAtSale`
15. Quick sell (available → sold) → verify
16. **Sell partially-used card** (in_use → sold) → verify balance snapshot
17. Undo sale → status restored from `statusAtSale` + balance restored + reversal created
18. Double-sell → 400
19. PUT sold card with non-notes field → rejected

### Partial Usage (20–21)
20. $10 prepaid → $3.50 → $4.00 → verify 250¢ → $2.50 → `used_up`
21. $1.00 → 10¢, 20¢, 30¢ → remaining = exactly 40¢

### Undo Usage (22–25)
22. $50 usage (meant $5) → undo with reason → balance restored, `isReversed=1`
23. Undo write-off → 409
24. Undo last active usage → card → `available`
25. **Undo middle usage** (not latest) → verify balance recalculated correctly

### Void Invariant (26–29)
26. Void available card → write-off usage created for full `faceValueCents`, balance = 0
27. Void reserved card → write-off usage created for full balance, balance = 0
28. Void in_use card → write-off usage for `remainingBalanceCents`, balance = 0
29. All voided cards: verify `faceValueCents = SUM(amountCents WHERE isReversed=0)`

### Numeric Constraints (30–33)
30. `faceValueCents > 0` and `remainingBalanceCents` never negative (CHECK constraints)
31. `remainingBalanceCents` never exceeds `faceValueCents`
32. Usage with `amountCents > remainingBalanceCents` → rejected
33. Usage with `amountCents = 0` → rejected

### Audit (34–35)
34. Create card → audit shows `"••••4321"` / `"***"` (redacted, plaintext JSON)
35. Audit entries include `userId`

### Foreign Keys & DELETE (36–38)
36. Cannot delete card with transaction history → RESTRICT
37. Cannot delete card with usage history → RESTRICT
38. Deleting deal sets `cards.dealId = NULL`

### Normalization (39–40)
39. Search with `4111 1111 1111 1111` finds card stored as `4111111111111111`
40. Dedup treats `4111-1111` and `41111111` as same

### Card Number Update (41–42)
41. PUT card with new cardNumber → re-encrypted + hash recomputed
42. Search by old number → not found. Search by new number → found

### Backup & Import (43–50)
43. JSON export → fresh setup → import (replace) → re-encrypted, readable
44. Import (replace) → `users` table untouched
45. Import (replace) → `sqlite_sequence` reset correctly
46. Import unsupported `schemaVersion` → rejected
47. Import (merge) → cards-only, new IDs. Transactions/usages/audit ignored
48. Merge with null cardNumber → all inserted (no false dedup)
49. Merge with conflicting status → 409 with conflict list
50. Malformed JSON → rejected. Auto-backup before replace. Replace import records a local import audit event and passes `PRAGMA foreign_key_check`

### Deals & Batch (51–53)
51. Deal with transient `totalCostCents`, mixed explicit/proportional → verify allocation + remainder to last card
52. Explicit costs exceeding total → 400 error
53. Archive → hidden, cards accessible. P&L = SUM(purchaseCostCents)

### CSV (54–55)
54. Upload → preview → confirm (re-validated) → cards created
55. Invalid rows → flagged in preview, not committed

### Concurrent (56–57)
56. Two tabs sell same card → one succeeds (two `fetch()` same microtick)
57. Two rapid `/use` → correct serial execution via BEGIN IMMEDIATE
