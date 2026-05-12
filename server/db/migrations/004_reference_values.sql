CREATE TABLE reference_values (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('deal_name','source','card_brand')),
  value TEXT NOT NULL,
  normalizedValue TEXT NOT NULL,
  usageCount INTEGER NOT NULL DEFAULT 0 CHECK (usageCount >= 0),
  lastUsedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE,
  UNIQUE (accountId, type, normalizedValue)
);

CREATE INDEX idx_reference_values_account_type_normalized
  ON reference_values(accountId, type, normalizedValue);

CREATE INDEX idx_reference_values_account_type_usage
  ON reference_values(accountId, type, usageCount, lastUsedAt);

INSERT INTO reference_values (
  accountId, type, value, normalizedValue, usageCount, lastUsedAt, createdAt, updatedAt
)
SELECT
  accountId,
  'deal_name',
  MIN(TRIM(name)),
  LOWER(TRIM(name)),
  COUNT(*),
  MAX(updatedAt),
  MIN(createdAt),
  MAX(updatedAt)
FROM deals
WHERE TRIM(name) <> ''
GROUP BY accountId, LOWER(TRIM(name));

INSERT INTO reference_values (
  accountId, type, value, normalizedValue, usageCount, lastUsedAt, createdAt, updatedAt
)
SELECT
  accountId,
  'source',
  MIN(TRIM(value)),
  LOWER(TRIM(value)),
  COUNT(*),
  MAX(updatedAt),
  MIN(createdAt),
  MAX(updatedAt)
FROM (
  SELECT accountId, source AS value, createdAt, updatedAt FROM deals
  UNION ALL
  SELECT accountId, source AS value, createdAt, updatedAt FROM cards
)
WHERE TRIM(value) <> ''
GROUP BY accountId, LOWER(TRIM(value));

INSERT INTO reference_values (
  accountId, type, value, normalizedValue, usageCount, lastUsedAt, createdAt, updatedAt
)
SELECT
  accountId,
  'card_brand',
  MIN(TRIM(brand)),
  LOWER(TRIM(brand)),
  COUNT(*),
  MAX(updatedAt),
  MIN(createdAt),
  MAX(updatedAt)
FROM cards
WHERE TRIM(brand) <> ''
GROUP BY accountId, LOWER(TRIM(brand));
