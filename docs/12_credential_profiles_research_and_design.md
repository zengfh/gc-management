# Gift Card Credential Profiles - Research and Design

Status: proposed Release 5 design
Date: 2026-05-12

## Problem

The current implementation models a card credential as:

- one optional `cardNumber`
- one optional `pin`
- one optional `billingZip`
- one masked `cardNumberLast4`

That is not enough for mainstream gift cards. Real cards fall into several credential shapes:

- account-redeemed claim-code cards
- merchant stored-value cards with number plus PIN/access code
- barcode or QR cards used at point of sale
- network prepaid cards that behave like Visa/Mastercard/Amex/Discover payment cards
- long-tail cards with issuer-specific fields

Release 5 should replace the "card number only" mental model with explicit credential profiles.

## Research Findings

### Mainstream Credential Shapes

| Shape | Examples | Required or common fields | Product implication |
|---|---|---|---|
| Claim code only | Apple, Amazon, Uber/Uber Eats, DoorDash-style redeem flows | one redeemable code, sometimes called PIN/gift code/claim code | UI should label the primary field by brand, not always "Card number" |
| Number plus PIN/access code | Best Buy, Target, Walmart, many retailer cards | gift-card number plus PIN/access number | Store both as encrypted, copyable fields |
| Barcode or QR first | store cards, loyalty/gift wallets, some physical cards | barcode value, barcode format, optional printed number/PIN | Store barcode value and render scannable code on reveal |
| Network prepaid/open-loop | Visa, Mastercard, Amex, Discover prepaid/gift cards | PAN/card number, expiration, security code, sometimes billing ZIP/address/cardholder name | Needs separate security policy because CVV/CID is payment-card sensitive authentication data |
| Custom issuer | long-tail merchants and marketplace-sourced cards | arbitrary labeled fields | Use flexible encrypted fields instead of schema changes per brand |

### Sources Consulted

- Best Buy says online use requires gift-card number plus 4-digit PIN: https://www.bestbuy.com/site/gift-card-help/gift-card-faq/pcmcat1526048189330.c?id=pcmcat1526048189330
- Target balance/use requires a 15-digit card number plus Access Number or PIN: https://help.target.com/help/subcategoryarticle?childcat=Target+GiftCard+balance&parentcat=Gift+Cards&searchQuery=search+help
- Walmart balance check uses card number plus PIN: https://business.walmart.com/account/giftcards/balance
- Uber gift cards are redeemed with a PIN/gift code: https://www.uber.com/us/en/gift-cards/info/
- Apple gift cards use a 16-digit code that can be entered or scanned: https://support.apple.com/en-ie/118242
- Visa gift cards used online require card number, expiration date, and CVV: https://www.visa.com/en-us/personal/cards/gift/gift-card-balance
- Mastercard prepaid cards can be used anywhere Debit Mastercard is accepted and online/phone use may require issuer registration: https://www.mastercard.com/us/en/personal/get-support/frequently-asked-questions.html
- American Express gift-card terms reference card number, CSC, CID, valid-thru date, and customer-service identity details: https://www.americanexpress.com/en-us/prepaid/view-all-cards/gift-cards/business-cma/
- PCI SSC states sensitive authentication data such as card verification code/PIN data must not be stored after authorization, even encrypted: https://www.pcisecuritystandards.org/faqs/1533/
- Bitwarden's card model is a useful open-source-adjacent reference for payment-card fields: https://sdk-api-docs.bitwarden.com/bitwarden_api_api/models/cipher_card_model/struct.CipherCardModel.html
- Catima is a useful open-source reference for local-first barcode/loyalty-card wallet behavior: https://catima.app/
- Braintree's `credit-card-type` can detect card networks and formatting gaps as users type: https://github.com/braintree/credit-card-type
- `bwip-js` can generate Code128, QR, EAN/UPC, PDF417, and other barcodes in browser/server contexts: https://www.npmjs.com/package/bwip-js
- ZXing JS can scan many 1D/2D barcode formats from images/camera if scanner import is added later: https://github.com/zxing-js/library

## Product Decision

Release 5 should support five credential profiles:

| Profile | Purpose | Default fields |
|---|---|---|
| `claim_code` | One-code cards such as Apple/Uber/Amazon-style cards | redemption code |
| `merchant_number_pin` | Retailer cards with printed number plus PIN/access code | card number, PIN/access code |
| `barcode` | Cards redeemed mainly by scanner | barcode value, barcode format, optional printed number/PIN |
| `network_prepaid` | Visa/Mastercard/Amex/Discover gift cards | PAN, expiration month/year, cardholder name, billing postal code/address; security code only per policy |
| `custom` | Long-tail issuer-specific credentials | user-defined encrypted fields |

Brand templates should preselect a profile and field labels. The profile can always be changed manually.

Initial template examples:

| Brand/template | Profile | Labels |
|---|---|---|
| Amazon | `claim_code` | Claim code |
| Apple | `claim_code` | 16-digit code |
| Uber/Uber Eats | `claim_code` | PIN/gift code |
| DoorDash | `claim_code` | Gift card code |
| Best Buy | `merchant_number_pin` | Gift card number, PIN |
| Target | `merchant_number_pin` | Card number, Access Number/PIN |
| Walmart | `merchant_number_pin` | Card number, PIN |
| Visa | `network_prepaid` | Card number, valid through, CVV, ZIP/address |
| Mastercard | `network_prepaid` | Card number, valid through, CVC, ZIP/address |
| American Express | `network_prepaid` | Card number, valid through, CID/CSC, ZIP/address |
| Unknown barcode | `barcode` | Barcode value, barcode format |

## Security Policy

### Merchant PIN vs Payment-Card Security Code

Merchant gift-card PIN/access numbers are stored encrypted. They are spendable secrets, but they are not PCI card verification values.

Network prepaid CVV/CVC/CID/CSC values are payment-card sensitive authentication data. Official hosted or commercial product mode must not persist them.

Release 5 should implement:

- `GC_FEATURE_NETWORK_SECURITY_CODE_STORAGE=false` by default.
- Hosted/private-beta runbook keeps it disabled.
- If a single-user local deployment enables it, the UI must show a high-risk warning, store the value encrypted, never log/audit it, and include it only in encrypted portable backups.
- Plaintext JSON export should omit network security codes by default even in local mode. Add a separate explicit option only if we intentionally accept that risk.
- Sanitized account export always omits all credential fields and indexes.

### Data Sensitivity Classes

| Class | Examples | Storage |
|---|---|---|
| `spendable_secret` | claim code, card number, PIN/access code, barcode value | encrypted; exact-search blind index where useful |
| `payment_sad` | CVV/CVC/CID/CSC | not stored in product mode; optional local-only encrypted field if enabled |
| `payment_chd` | PAN/card number, cardholder name, expiration | PAN encrypted + blind index; name/expiration encrypted for this app |
| `billing_pii` | ZIP, address, phone | encrypted |
| `display_metadata` | profile type, barcode format, field labels, last4/display hints | plaintext if not spendable |

## Storage Design

Do not keep adding columns to `cards`. Use a normalized credential-field model.

### Cards Table Additions

Add:

```sql
ALTER TABLE cards ADD COLUMN credentialProfile TEXT NOT NULL DEFAULT 'merchant_number_pin';
ALTER TABLE cards ADD COLUMN primaryCredentialLast4 TEXT;
ALTER TABLE cards ADD COLUMN credentialSummaryJson TEXT;
```

`credentialSummaryJson` stores safe display metadata only, such as:

```json
{
  "profile": "merchant_number_pin",
  "primaryLabel": "Gift card number",
  "primaryLast4": "1234",
  "hasPin": true,
  "hasBarcode": false,
  "requiresPhysicalCard": false
}
```

### Credential Fields Table

Add:

```sql
CREATE TABLE card_credential_fields (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL,
  cardId INTEGER NOT NULL,
  fieldKey TEXT NOT NULL,
  label TEXT NOT NULL,
  fieldKind TEXT NOT NULL,
  sensitivityClass TEXT NOT NULL,
  encryptedValue TEXT,
  blindIndex TEXT,
  displayHint TEXT,
  valueLength INTEGER,
  barcodeFormat TEXT,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  copyable INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (cardId) REFERENCES cards(id) ON DELETE CASCADE,
  UNIQUE(cardId, fieldKey)
);

CREATE INDEX idx_card_credential_fields_blind_index
  ON card_credential_fields(accountId, fieldKind, blindIndex)
  WHERE blindIndex IS NOT NULL;
```

Recommended `fieldKind` values:

- `primary_code`
- `card_number`
- `pin`
- `access_code`
- `barcode_value`
- `expiration_month`
- `expiration_year`
- `network_security_code`
- `cardholder_name`
- `billing_postal_code`
- `billing_address_line1`
- `billing_address_line2`
- `billing_city`
- `billing_region`
- `billing_country`
- `custom`

### Encryption and Indexing

- Encrypt every credential field value with the existing DEK and AES-GCM envelope.
- Store blind indexes only for fields users need to exact-search or dedupe:
  - `primary_code`
  - `card_number`
  - `pin` only if a brand uses PIN as the sole redeemable code
  - `access_code` only if needed for duplicate checks
  - `barcode_value`
- Do not blind-index CVV/CVC/CID/CSC, billing address, or cardholder name.
- Preserve exact-card-number search by querying both legacy `cards.cardNumberHash` during migration and new `card_credential_fields.blindIndex`.

### Migration Strategy

1. Add the new fields/table.
2. Backfill existing rows:
   - Existing cards with `cardNumber` and `pin` become `merchant_number_pin`.
   - Existing cards with only `cardNumber` become `claim_code` if brand template says code-only, otherwise `merchant_number_pin` with no PIN.
   - Existing `billingZip` becomes `billing_postal_code`.
3. Keep legacy columns for one release as read-compatible fallback.
4. New writes populate the new table and may also shadow-write legacy fields for rollback.
5. After backup/restore/import/export are verified, remove legacy writes in a later release.

## API Design

### Card Input

Replace `cardNumber`, `pin`, and `billingZip` with `credentials`, while accepting legacy fields temporarily.

```json
{
  "brand": "Best Buy",
  "cardType": "merchant",
  "faceValueCents": 5000,
  "credentials": {
    "profile": "merchant_number_pin",
    "fields": [
      { "fieldKey": "card_number", "label": "Gift card number", "value": "5555555555555555" },
      { "fieldKey": "pin", "label": "PIN", "value": "1234" }
    ]
  }
}
```

Network prepaid example:

```json
{
  "brand": "Visa",
  "cardType": "prepaid",
  "network": "visa",
  "faceValueCents": 10000,
  "credentials": {
    "profile": "network_prepaid",
    "fields": [
      { "fieldKey": "card_number", "label": "Card number", "value": "4111111111111111" },
      { "fieldKey": "expiration_month", "label": "Exp month", "value": "12" },
      { "fieldKey": "expiration_year", "label": "Exp year", "value": "2028" },
      { "fieldKey": "billing_postal_code", "label": "ZIP", "value": "94105" }
    ]
  }
}
```

If `network_security_code` is submitted while storage is disabled, return:

```json
{
  "error": {
    "code": "NETWORK_SECURITY_CODE_NOT_STORED",
    "message": "Network-card security codes are not stored by this deployment policy."
  }
}
```

### Card Response

List/detail responses return safe summaries:

```json
{
  "credentialProfile": "merchant_number_pin",
  "credentialSummary": {
    "primaryLabel": "Gift card number",
    "primaryLast4": "5555",
    "hasPin": true,
    "hasBarcode": false
  }
}
```

Reveal response returns structured fields:

```json
{
  "credentials": {
    "profile": "merchant_number_pin",
    "fields": [
      { "fieldKey": "card_number", "label": "Gift card number", "value": "5555555555555555", "copyable": true },
      { "fieldKey": "pin", "label": "PIN", "value": "1234", "copyable": true }
    ]
  }
}
```

Audit metadata for reveal should include only:

- profile
- field keys revealed
- whether a barcode was shown
- primary last4 if present

Never include field values.

## UI/UX Design

### Add Deal / Add Card

Replace the single "Card number" field with a Credential section:

1. Brand/typeahead.
2. Credential profile picker:
   - Code only
   - Number + PIN/access code
   - Network prepaid
   - Barcode / QR
   - Custom
3. Profile-specific fields.
4. Optional "Add another field" for custom or issuer-specific data.

Behavior:

- Selecting a known brand applies a template automatically.
- User can override the template.
- Field labels match the brand template. Example: Target says "Access Number/PIN"; Apple says "16-digit code".
- Hidden irrelevant fields should not appear. A code-only card should not show ZIP/address.
- Network prepaid cards show a warning near the security-code field:
  - "Security codes are not saved in hosted/product mode. Keep the physical card or original source available."
- If local-only storage is enabled, require an explicit checkbox before saving a network security code.

### Card Table

Replace "Last 4" with "Credential":

- `Code **** 1234`
- `Number **** 1111 + PIN`
- `Barcode Code128`
- `Visa **** 1111 exp 12/28`
- `Custom 3 fields`

Search should become "Exact credential search" and match any indexed credential field, not just card number.

### Card Detail

Credentials section should be generated from the profile:

- Masked grouped summary by default.
- "Reveal credentials" button.
- Individual copy buttons for each revealed field.
- For barcode profile, render the scannable barcode/QR after reveal and include "Copy value".
- For network prepaid, group fields:
  - Payment details: number, expiration
  - Billing details: name/address/ZIP
  - Security code: shown only if local-only storage is enabled and value exists
- Auto-hide revealed fields on timeout, navigation, logout, and page visibility loss.

### CSV Import

Add template variants:

- Code-only cards
- Retailer number + PIN
- Network prepaid
- Barcode cards
- Custom fields

Accept columns:

- `credentialProfile`
- `redemptionCode`
- `giftCode`
- `claimCode`
- `cardNumber`
- `pin`
- `accessNumber`
- `barcodeValue`
- `barcodeFormat`
- `expirationMonth`
- `expirationYear`
- `validThru`
- `securityCode`
- `billingPostalCode`
- `billingAddressLine1`
- `billingAddressLine2`
- `billingCity`
- `billingRegion`
- `billingCountry`
- `cardholderName`
- `custom:<label>`

Preview must show only masked summaries and validation warnings, never full credential values.

### Backup and Export

- Encrypted portable JSON includes all encrypted credential fields allowed by deployment policy.
- Plaintext JSON export should include merchant credentials only after confirmation.
- Plaintext JSON export should omit network security codes by default and state that omission in the export warning.
- Raw database export remains highly sensitive because encrypted fields and key material are present.
- Import must re-encrypt credential fields into the current vault and rebuild blind indexes.

## Validation Rules

Common:

- At least one credential field is required for a card unless explicitly marked "credential pending".
- Field labels max 80 chars.
- Field values max 4,096 chars.
- No credential values in request logs, audit logs, errors, URLs, or toast text.

By profile:

- `claim_code`: require one primary code.
- `merchant_number_pin`: require card number or code; PIN/access code optional but recommended.
- `barcode`: require barcode value and format.
- `network_prepaid`: require card number and expiration month/year; billing fields optional; security code follows policy.
- `custom`: require at least one custom field.

Network card helpers:

- Use `credit-card-type` or equivalent for type-as-you-type network detection and spacing hints.
- Do not treat network detection as validation. Still allow "other" and issuer-specific oddities.

## QA Matrix Additions

- Create each profile from UI.
- Create each profile through API.
- CSV preview and confirm for each profile.
- Encrypted backup/restore round-trip for each profile.
- Plaintext export redaction/omission behavior for network security code.
- Exact credential search finds code-only, number+PIN, barcode, and network prepaid PAN.
- Duplicate detection catches same primary code/card number/barcode within active statuses.
- Reveal/copy shows only profile fields and hides after timeout.
- Viewer cannot reveal credentials.
- Audit reveal metadata has field keys but no values.
- Logs do not include credential field names with values.
- Feature flag rejects network security code storage when disabled.
- Migration backfills existing card rows without losing reveal/search behavior.

## Release 5 Milestones

1. Credential profile design and API contract.
2. Migration and backend credential-field service.
3. Add Deal/Add Card profile UI and card-detail reveal UI.
4. CSV import/export/backup support.
5. Tests, migration drill, and docs certification.

## Non-Goals

- Autofilling third-party checkout pages.
- Automatically redeeming cards.
- Scraping gift-card balances.
- Real-time issuer integrations.
- Multi-tenant commercial PCI compliance certification.
