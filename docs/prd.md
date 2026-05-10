# Product Requirements Document (PRD): Secure Gift Card Manager

## 1. Executive Summary
A secure, full-stack web application designed to manage gift card inventory, track purchases and redemptions, and monitor financial P&L. It replaces error-prone spreadsheet tracking with a strict state machine, cryptographic security, and comprehensive audit logging.

## 2. Problem Statement
Managing a high volume of gift cards (merchant and prepaid) via spreadsheets leads to costly errors: duplicate sales, missed partial balances, and poor security. There is a need for a dedicated tool to enforce inventory states and secure sensitive credentials while tracking P&L.

## 3. Target Audience (Personas)
- **Primary User (The Flipper):** Buys gift cards from deal sites (Staples, Best Buy, DoorDash) and resells them to dealers, groups, or friends. Needs high accuracy and bulk operations.
- **Secondary User (The Consumer):** Uses partially redeemed prepaid cards for personal expenses. Needs clear tracking of remaining balances down to the cent.

## 4. Key Features & Requirements
### 4.1. Inventory Management
- **Batched Deal Entry:** Support entering multiple cards from a single deal, with automated proportional cost allocation.
- **Strict State Machine:** Enforce card lifecycle states: Available, Reserved, Sold, In Use, Used Up, Void.
- **Partial Usage Tracking:** Deduct specific amounts from prepaid cards and track exact remaining balances.

### 4.2. Security & Compliance
- **Envelope Encryption:** Sensitive data (card number, card PIN, billing ZIP, and permitted CVV values) must be encrypted at rest using AES-256-GCM.
- **CVV Retention Guardrails:** Network-branded prepaid Visa/MC/Amex CVV/CID values are not persisted by default after authorization, even encrypted. Merchant gift-card PINs may be stored encrypted. Any exception for CVV retention must be documented before enabling storage.
- **Blind-Index Search:** Enable exact-match card-number lookup with an HMAC-SHA256 blind index without decrypting every database row.
- **Audit Trail:** Log every state change, transaction, balance update, backup export, and import with redacted plaintext diffs. Normal app activity is append-only; replace-import restores historical audit entries from backup and also records a local import event.

### 4.3. Import & Export
- **Stateless CSV Import:** Support bulk ingestion with dry-run validation.
- **Encrypted & Plaintext Backups:** Allow full SQLite database backup or unlock-secret-protected plaintext JSON export. Both backup paths require fresh unlock-secret confirmation, CSRF/origin checks, no-store response headers, and audit logging.

## 5. User Flows
- **Acquisition:** User buys a deal -> Inputs Deal details -> Adds N cards -> System calculates cost basis.
- **Liquidation (Sale):** User reserves card -> Confirms sale to dealer -> System moves to Sold and snapshots balance.
- **Personal Use:** User uses $10 of a $50 prepaid card -> System records Usage -> Balance updates to $40 -> Status moves to In Use.

## 6. Future Considerations (Out of Scope for v1)
- Multi-user RBAC.
- OCR scanning for physical cards.
- Automated dealer API integration.
