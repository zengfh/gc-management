# Constraints, Security & Verification (Supplementary Spec)

Companion to [implementation_plan.md](file:///home/opc/.gemini/antigravity/brain/197a3cfe-9178-4e20-890c-c4bc5243464a/implementation_plan.md).

---

## SQL Constraints

### CHECK Constraints (in `db.js`)

```sql
-- Cards
CHECK(cardType IN ('merchant','prepaid'))
CHECK(status IN ('available','reserved','sold','in_use','used_up','void'))
CHECK(format IS NULL OR format IN ('digital','physical'))
CHECK(faceValueCents >= 0)
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

### Session & Cookies

```text
httpOnly: true
secure: true (in production, false for localhost dev)
sameSite: 'strict'    -- provides CSRF protection for same-origin
maxAge: 24 hours
```

`sameSite: 'strict'` prevents cross-origin request forgery for this same-origin local app. Token-based CSRF deferred to v2 if multi-origin support is needed.

### Encryption Field Decisions

| Field | Encrypted? | Rationale |
|-------|-----------|-----------|
| `cardNumber` | ✅ Yes + blind index | Primary credential |
| `pin` | ✅ Yes | Primary credential |
| `cvv` | ✅ Yes | Primary credential |
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

### Plaintext Export Security

- Requires **PIN re-entry** (or auth within last 5 minutes)
- UI confirmation: user must **type "EXPORT"** to proceed
- Warning text: "This file contains full card numbers, PINs, CVVs, and balances in plaintext. Anyone with this file can spend your cards."
- Filename: `gc-backup-YYYY-MM-DD.json`

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

Sensitive fields (`cardNumber`, `pin`, `cvv`, `billingZip`) exported as **plaintext** (user is authenticated + PIN confirmed). `users` table never exported.

### Import: Replace Mode

1. Auto-backup current `.db` file
2. Validate `schemaVersion` — reject unsupported versions
3. Drop and restore: `deals`, `cards`, `transactions`, `usages`, `audit_log`
4. **Exclude `users` table** — current PIN/DEK untouched
5. Re-encrypt `cardNumber`, `pin`, `cvv`, `billingZip` with current DEK
6. Compute `cardNumberHash` using current HKDF-derived hmacKey
7. Normalize card numbers before re-encryption
8. Redact sensitive fields in imported audit entries
9. **Reset `sqlite_sequence`** for each table to MAX(id)
10. Rebuild indexes

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
| `available` | All non-blocked fields (brand, cardType, cardNumber, pin, cvv, billingZip, expirationDate, cardholderName, format, source, notes, purchaseCostCents, dealId) |
| `reserved` | Same as available |
| `in_use` | Same as available |
| `sold` | `notes` only |
| `used_up` | `notes` only |
| `void` | `notes` only |

**Always blocked** regardless of status: `faceValueCents`, `remainingBalanceCents`, `status`.

---

## Verification Plan (55 tests)

### Auth & Security (1–8)
1. Setup → logout → login → 3x wrong → 30s lockout → retry
2. Setup when PIN exists → 409
3. Server restart → 401 `dekLoaded:false` → re-login → cards readable
4. Change PIN (new salt) → all cards still decryptable
5. Session regeneration on login (new session ID)
6. Session cookie has HttpOnly, SameSite=strict
7. Plaintext export requires PIN re-entry
8. Logout clears DEK and session; old session cookie returns 401

### Encryption (9–13)
9. Inspect `.db` → cardNumber/pin/cvv/billingZip are `IV:AuthTag:Ciphertext`
10. Encrypt same value twice → different IVs
11. JSON export → fields are plaintext + UI warning + type "EXPORT"
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
30. `remainingBalanceCents` never negative (CHECK constraint)
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
50. Malformed JSON → rejected. Auto-backup before replace

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
