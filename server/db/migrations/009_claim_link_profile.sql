-- @disable-foreign-keys

CREATE TABLE cards_new (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL,
  dealId INTEGER,
  brand TEXT NOT NULL,
  cardType TEXT NOT NULL CHECK (cardType IN ('merchant','prepaid')),
  network TEXT CHECK (network IS NULL OR network IN ('visa','mastercard','amex','discover','other')),
  faceValueCents INTEGER NOT NULL CHECK (faceValueCents > 0),
  remainingBalanceCents INTEGER NOT NULL CHECK (remainingBalanceCents >= 0 AND remainingBalanceCents <= faceValueCents),
  purchaseCostCents INTEGER NOT NULL DEFAULT 0 CHECK (purchaseCostCents >= 0),
  cardNumber TEXT,
  cardNumberHash TEXT,
  cardNumberLast4 TEXT,
  pin TEXT,
  cvv TEXT,
  billingZip TEXT,
  expirationDate TEXT,
  cardholderName TEXT,
  status TEXT NOT NULL CHECK (status IN ('available','reserved','in_use','sold','used_up','void')),
  format TEXT CHECK (format IS NULL OR format IN ('digital','physical')),
  source TEXT,
  notes TEXT,
  keyVersion INTEGER NOT NULL DEFAULT 1,
  reservedFor TEXT,
  reservedUntil TEXT,
  reservedNotes TEXT,
  createdByUserId INTEGER,
  updatedByUserId INTEGER,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  rowVersion INTEGER NOT NULL DEFAULT 1,
  credentialProfile TEXT NOT NULL DEFAULT 'merchant_number_pin'
    CHECK (credentialProfile IN ('claim_code','claim_link','merchant_number_pin','barcode','network_prepaid','custom')),
  primaryCredentialLast4 TEXT,
  credentialSummaryJson TEXT,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (dealId) REFERENCES deals(id) ON DELETE SET NULL,
  FOREIGN KEY (createdByUserId) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updatedByUserId) REFERENCES users(id) ON DELETE SET NULL
);

INSERT INTO cards_new (
  id, accountId, dealId, brand, cardType, network, faceValueCents,
  remainingBalanceCents, purchaseCostCents, cardNumber, cardNumberHash,
  cardNumberLast4, pin, cvv, billingZip, expirationDate, cardholderName,
  status, format, source, notes, keyVersion, reservedFor, reservedUntil,
  reservedNotes, createdByUserId, updatedByUserId, createdAt, updatedAt,
  rowVersion, credentialProfile, primaryCredentialLast4, credentialSummaryJson
)
SELECT
  id, accountId, dealId, brand, cardType, network, faceValueCents,
  remainingBalanceCents, purchaseCostCents, cardNumber, cardNumberHash,
  cardNumberLast4, pin, cvv, billingZip, expirationDate, cardholderName,
  status, format, source, notes, keyVersion, reservedFor, reservedUntil,
  reservedNotes, createdByUserId, updatedByUserId, createdAt, updatedAt,
  rowVersion, credentialProfile, primaryCredentialLast4, credentialSummaryJson
FROM cards;

DROP TABLE cards;
ALTER TABLE cards_new RENAME TO cards;

CREATE INDEX idx_cards_account_status ON cards(accountId, status);
CREATE INDEX idx_cards_account_brand ON cards(accountId, brand);
CREATE INDEX idx_cards_account_deal ON cards(accountId, dealId);
CREATE INDEX idx_cards_account_hash_brand ON cards(accountId, cardNumberHash, brand);
CREATE INDEX idx_cards_account_expiration ON cards(accountId, expirationDate);
CREATE INDEX idx_cards_account_updated ON cards(accountId, updatedAt);

CREATE UNIQUE INDEX idx_cards_active_dedupe
  ON cards(accountId, brand, cardNumberHash)
  WHERE cardNumberHash IS NOT NULL
    AND status IN ('available','reserved','in_use');
