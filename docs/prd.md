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
- **Envelope Encryption:** Sensitive data (Card Number, PIN, CVV, Billing ZIP) must be encrypted at rest using AES-256-GCM.
- **Zero-Knowledge Search:** Enable blind indexing (HMAC-SHA256) for card search without decrypting database rows.
- **Immutable Audit Trail:** Log every state change, transaction, and balance update with redacted plaintext diffs.

### 4.3. Import & Export
- **Stateless CSV Import:** Support bulk ingestion with dry-run validation.
- **Encrypted & Plaintext Backups:** Allow full SQLite database backup or PIN-protected plaintext JSON export.

## 5. User Flows
- **Acquisition:** User buys a deal -> Inputs Deal details -> Adds N cards -> System calculates cost basis.
- **Liquidation (Sale):** User reserves card -> Confirms sale to dealer -> System moves to Sold and snapshots balance.
- **Personal Use:** User uses $10 of a $50 prepaid card -> System records Usage -> Balance updates to $40 -> Status moves to In Use.

## 6. Future Considerations (Out of Scope for v1)
- Multi-user RBAC.
- OCR scanning for physical cards.
- Automated dealer API integration.
