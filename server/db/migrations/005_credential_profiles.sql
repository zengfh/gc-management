ALTER TABLE cards ADD COLUMN credentialProfile TEXT NOT NULL DEFAULT 'merchant_number_pin'
  CHECK (credentialProfile IN ('claim_code','merchant_number_pin','barcode','network_prepaid','custom'));

ALTER TABLE cards ADD COLUMN primaryCredentialLast4 TEXT;
ALTER TABLE cards ADD COLUMN credentialSummaryJson TEXT;

UPDATE cards
SET
  primaryCredentialLast4 = cardNumberLast4,
  credentialSummaryJson = json_object(
    'profile', credentialProfile,
    'primaryLabel', CASE WHEN cardNumberLast4 IS NOT NULL THEN 'Card number' ELSE NULL END,
    'primaryLast4', cardNumberLast4,
    'fieldCount',
      (CASE WHEN cardNumber IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN pin IS NOT NULL THEN 1 ELSE 0 END) +
      (CASE WHEN billingZip IS NOT NULL THEN 1 ELSE 0 END),
    'hasPin', CASE WHEN pin IS NOT NULL THEN json('true') ELSE json('false') END,
    'hasBillingZip', CASE WHEN billingZip IS NOT NULL THEN json('true') ELSE json('false') END,
    'hasBarcode', json('false')
  );

CREATE TABLE card_credential_fields (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL,
  cardId INTEGER NOT NULL,
  fieldKey TEXT NOT NULL,
  label TEXT NOT NULL,
  fieldKind TEXT NOT NULL CHECK (fieldKind IN (
    'primary_code',
    'card_number',
    'pin',
    'access_code',
    'barcode_value',
    'expiration_month',
    'expiration_year',
    'network_security_code',
    'billing_postal_code',
    'cardholder_name',
    'billing_address',
    'metadata'
  )),
  sensitivityClass TEXT NOT NULL CHECK (sensitivityClass IN (
    'spendable_secret',
    'payment_sad',
    'payment_chd',
    'billing_pii',
    'display_metadata'
  )),
  encryptedValue TEXT,
  blindIndex TEXT,
  displayHint TEXT,
  valueLength INTEGER,
  barcodeFormat TEXT,
  sortOrder INTEGER NOT NULL DEFAULT 0,
  copyable INTEGER NOT NULL DEFAULT 1 CHECK (copyable IN (0,1)),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY(accountId) REFERENCES accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY(cardId) REFERENCES cards(id) ON DELETE CASCADE,
  UNIQUE(cardId, fieldKey)
);

CREATE INDEX idx_card_credential_fields_card
  ON card_credential_fields(accountId, cardId, sortOrder, id);

CREATE INDEX idx_card_credential_fields_blind_index
  ON card_credential_fields(accountId, fieldKind, blindIndex)
  WHERE blindIndex IS NOT NULL;

INSERT INTO card_credential_fields (
  accountId, cardId, fieldKey, label, fieldKind, sensitivityClass,
  encryptedValue, blindIndex, displayHint, valueLength, barcodeFormat,
  sortOrder, copyable, createdAt, updatedAt
)
SELECT
  accountId,
  id,
  'card_number',
  'Card number',
  'card_number',
  'spendable_secret',
  cardNumber,
  cardNumberHash,
  CASE WHEN cardNumberLast4 IS NOT NULL THEN '**** ' || cardNumberLast4 ELSE 'Saved' END,
  NULL,
  NULL,
  10,
  1,
  createdAt,
  updatedAt
FROM cards
WHERE cardNumber IS NOT NULL;

INSERT INTO card_credential_fields (
  accountId, cardId, fieldKey, label, fieldKind, sensitivityClass,
  encryptedValue, blindIndex, displayHint, valueLength, barcodeFormat,
  sortOrder, copyable, createdAt, updatedAt
)
SELECT
  accountId,
  id,
  'pin',
  'PIN',
  'pin',
  'spendable_secret',
  pin,
  NULL,
  'Saved',
  NULL,
  NULL,
  20,
  1,
  createdAt,
  updatedAt
FROM cards
WHERE pin IS NOT NULL;

INSERT INTO card_credential_fields (
  accountId, cardId, fieldKey, label, fieldKind, sensitivityClass,
  encryptedValue, blindIndex, displayHint, valueLength, barcodeFormat,
  sortOrder, copyable, createdAt, updatedAt
)
SELECT
  accountId,
  id,
  'billing_postal_code',
  'Billing ZIP',
  'billing_postal_code',
  'billing_pii',
  billingZip,
  NULL,
  'Saved',
  NULL,
  NULL,
  80,
  1,
  createdAt,
  updatedAt
FROM cards
WHERE billingZip IS NOT NULL;
