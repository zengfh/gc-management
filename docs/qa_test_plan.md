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
- **TC-FIN-03:** Verify `faceValueCents = remainingBalanceCents + SUM(active usages)`.

### 3.2. State Machine Enforcement
- **TC-SM-01:** Attempt to sell an `in_use` card. Verify success and snapshot of `remainingBalanceAtSaleCents`.
- **TC-SM-02:** Attempt to `use` a `sold` card. Verify 400 Bad Request.
- **TC-SM-03:** Undo a sale. Verify status returns to `statusAtSale` and balance is restored.

### 3.3. Security & Encryption
- **TC-SEC-01:** Create a card. Verify database file `.db` contains no plaintext card numbers, PINs, or CVVs.
- **TC-SEC-02:** Search using the exact card number. Verify blind index returns the correct card.
- **TC-SEC-03:** Restart server. Verify API returns 401 until PIN is re-entered (DEK in-memory wipe).
- **TC-SEC-04:** Export JSON backup. Verify PIN prompt appears and exported file contains plaintext.

### 3.4. Edge Cases & Concurrency
- **TC-EDGE-01:** Two concurrent API requests attempt to `/use` the same card simultaneously. Verify `BEGIN IMMEDIATE` transaction lock prevents race condition (one succeeds, one fails or queues).
- **TC-EDGE-02:** Import merge with conflicting card states. Verify 409 Conflict is returned with accurate diff.
- **TC-EDGE-03:** Attempt to `/void` a card with existing usages. Verify it correctly writes off only the `remainingBalanceCents`.
