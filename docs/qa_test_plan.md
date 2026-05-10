# QA Test Plan

## 1. Testing Strategy
- **Unit Testing:** Focus on helper functions, cost allocation math, and state transitions.
- **Integration Testing:** API endpoint validation, database constraints, and encryption/decryption cycles.
- **E2E / UI Testing:** Critical user flows (Add Deal -> Sell Card, Add Deal -> Use Card -> Undo Usage).
- **Security Testing:** Session management, rate limiting, and ciphertext verification.

## 2. Test Environments
- **Local Dev:** SQLite in WAL mode.
- **CI/CD:** Automated headless browser testing (Playwright/Cypress).

## 3. Core Test Scenarios

### 3.1. Financial Accuracy (Integer Math)
- **TC-FIN-01:** Batch deal with $100 total cost and 3 identical cards. Verify costs are $33.33, $33.33, $33.34.
- **TC-FIN-02:** Use $10.05 from a $50.00 card. Verify remaining balance is exactly $39.95 (handled as 3995 cents).
- **TC-FIN-03:** For available/in_use/used_up/void cards, verify `faceValueCents = remainingBalanceCents + SUM(active usages)` except sold cards, where sale snapshots live in `transactions` and `remainingBalanceCents` is 0.

### 3.2. State Machine Enforcement
- **TC-SM-01:** Attempt to sell an `in_use` card. Verify success and snapshot of `remainingBalanceAtSaleCents`.
- **TC-SM-02:** Attempt to `use` a `sold` card. Verify 400 Bad Request.
- **TC-SM-03:** Undo a sale. Verify status returns to `statusAtSale` and balance is restored.

### 3.3. Security & Encryption
- **TC-SEC-01:** Setup rejects weak unlock secrets and accepts a valid passphrase/code.
- **TC-SEC-02:** Create a card. Verify database file `.db` contains no plaintext card numbers, card PINs, billing ZIPs, or permitted/stored CVVs.
- **TC-SEC-03:** For a network-branded prepaid card, verify CVV/CID is not persisted by default and exports it as null/omitted.
- **TC-SEC-04:** Search using the exact card number. Verify blind index returns the correct card.
- **TC-SEC-05:** Restart server. Verify API returns 401 until the unlock secret is re-entered (DEK in-memory wipe).
- **TC-SEC-06:** Mutating endpoints and sensitive export endpoints reject missing/invalid CSRF token or mismatched Origin/Referer.
- **TC-SEC-07:** Export JSON backup. Verify fresh unlock-secret prompt, type-EXPORT confirmation, `Cache-Control: no-store`, audit entry, and plaintext retained credentials in the downloaded JSON.
- **TC-SEC-08:** Export raw DB backup. Verify fresh unlock-secret prompt, CSRF/origin enforcement, `Cache-Control: no-store`, and audit entry.
- **TC-SEC-09:** Reveal/copy credential UI requires valid session + loaded DEK, masks again after 5 seconds, records audit metadata without secrets, and does not offer prepaid CVV/CID reveal when the value was not retained.

### 3.4. Edge Cases & Concurrency
- **TC-EDGE-01:** Two concurrent API requests attempt to `/use` the same card simultaneously. Verify `BEGIN IMMEDIATE` transaction lock prevents race condition (one succeeds, one fails or queues).
- **TC-EDGE-02:** Import merge with conflicting card states. Verify 409 Conflict is returned with accurate diff.
- **TC-EDGE-03:** Attempt to `/void` a card with existing usages. Verify it correctly writes off only the `remainingBalanceCents`.
- **TC-EDGE-04:** Replace import deletes/inserts in FK-safe order, excludes `users`, resets `sqlite_sequence`, records a local import audit event, and passes `PRAGMA foreign_key_check`.
