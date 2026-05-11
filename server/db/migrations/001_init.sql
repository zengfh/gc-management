CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('local','team','product')),
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL,
  email TEXT,
  displayName TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','operator','viewer')),
  unlockSecretHash TEXT NOT NULL,
  encryptionSalt TEXT NOT NULL,
  encryptedDEK TEXT NOT NULL,
  keyVersion INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE RESTRICT
);

CREATE TABLE app_settings (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE,
  UNIQUE (accountId, key)
);

CREATE TABLE deals (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL,
  name TEXT NOT NULL,
  source TEXT,
  purchaseDate TEXT,
  inputTotalCostCents INTEGER CHECK (inputTotalCostCents IS NULL OR inputTotalCostCents >= 0),
  notes TEXT,
  archivedAt TEXT,
  createdByUserId INTEGER,
  updatedByUserId INTEGER,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  rowVersion INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (createdByUserId) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updatedByUserId) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE cards (
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
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (dealId) REFERENCES deals(id) ON DELETE SET NULL,
  FOREIGN KEY (createdByUserId) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updatedByUserId) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL,
  cardId INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('sale','sale_reversal')),
  buyerName TEXT,
  buyerType TEXT CHECK (buyerType IS NULL OR buyerType IN ('dealer','group_chat','friend','self','other')),
  salePriceCents INTEGER CHECK (salePriceCents IS NULL OR salePriceCents >= 0),
  feesCents INTEGER NOT NULL DEFAULT 0 CHECK (feesCents >= 0),
  netProceedsCents INTEGER CHECK (netProceedsCents IS NULL OR netProceedsCents >= 0),
  remainingBalanceAtSaleCents INTEGER CHECK (remainingBalanceAtSaleCents IS NULL OR remainingBalanceAtSaleCents >= 0),
  statusAtSale TEXT CHECK (statusAtSale IS NULL OR statusAtSale IN ('available','reserved','in_use')),
  platform TEXT,
  reason TEXT,
  transactionDate TEXT,
  notes TEXT,
  idempotencyKey TEXT,
  createdByUserId INTEGER,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (cardId) REFERENCES cards(id) ON DELETE RESTRICT,
  FOREIGN KEY (createdByUserId) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE usages (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL,
  cardId INTEGER NOT NULL,
  amountCents INTEGER NOT NULL CHECK (amountCents > 0),
  merchant TEXT,
  description TEXT,
  isReversed INTEGER NOT NULL DEFAULT 0 CHECK (isReversed IN (0,1)),
  isWriteOff INTEGER NOT NULL DEFAULT 0 CHECK (isWriteOff IN (0,1)),
  reversalReason TEXT,
  reversedAt TEXT,
  usageDate TEXT,
  idempotencyKey TEXT,
  createdByUserId INTEGER,
  createdAt TEXT NOT NULL,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (cardId) REFERENCES cards(id) ON DELETE RESTRICT,
  FOREIGN KEY (createdByUserId) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL,
  userId INTEGER,
  requestId TEXT,
  entityType TEXT NOT NULL CHECK (entityType IN ('card','deal','transaction','usage','auth','backup','import','system')),
  entityId INTEGER,
  action TEXT NOT NULL,
  oldValue TEXT,
  newValue TEXT,
  metadata TEXT,
  timestamp TEXT NOT NULL,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE idempotency_keys (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL,
  userId INTEGER,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  requestHash TEXT NOT NULL,
  responseStatus INTEGER,
  responseBody TEXT,
  createdAt TEXT NOT NULL,
  expiresAt TEXT NOT NULL,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (accountId, key)
);

CREATE TABLE import_jobs (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL,
  userId INTEGER,
  type TEXT NOT NULL CHECK (type IN ('csv','json_replace','json_merge')),
  status TEXT NOT NULL CHECK (status IN ('previewed','confirmed','failed','canceled')),
  rowCount INTEGER NOT NULL DEFAULT 0 CHECK (rowCount >= 0),
  validCount INTEGER NOT NULL DEFAULT 0 CHECK (validCount >= 0),
  invalidCount INTEGER NOT NULL DEFAULT 0 CHECK (invalidCount >= 0),
  summaryJson TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE RESTRICT,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_users_accountId ON users(accountId);
CREATE INDEX idx_deals_account_archived ON deals(accountId, archivedAt);
CREATE INDEX idx_deals_account_updated ON deals(accountId, updatedAt);
CREATE INDEX idx_cards_account_status ON cards(accountId, status);
CREATE INDEX idx_cards_account_brand ON cards(accountId, brand);
CREATE INDEX idx_cards_account_deal ON cards(accountId, dealId);
CREATE INDEX idx_cards_account_hash_brand ON cards(accountId, cardNumberHash, brand);
CREATE INDEX idx_cards_account_expiration ON cards(accountId, expirationDate);
CREATE INDEX idx_cards_account_updated ON cards(accountId, updatedAt);
CREATE INDEX idx_transactions_account_card ON transactions(accountId, cardId);
CREATE INDEX idx_transactions_account_created ON transactions(accountId, createdAt);
CREATE INDEX idx_usages_account_card ON usages(accountId, cardId);
CREATE INDEX idx_usages_account_created ON usages(accountId, createdAt);
CREATE INDEX idx_audit_account_entity ON audit_log(accountId, entityType, entityId);
CREATE INDEX idx_audit_account_timestamp ON audit_log(accountId, timestamp);
CREATE INDEX idx_import_jobs_account_status ON import_jobs(accountId, status);

CREATE UNIQUE INDEX idx_cards_active_dedupe
  ON cards(accountId, brand, cardNumberHash)
  WHERE cardNumberHash IS NOT NULL
    AND status IN ('available','reserved','in_use');
