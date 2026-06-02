CREATE TABLE mcp_tokens (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  name TEXT NOT NULL,
  tokenHash TEXT NOT NULL UNIQUE,
  tokenHint TEXT NOT NULL,
  scopesJson TEXT NOT NULL,
  encryptedDEK TEXT NOT NULL,
  expiresAt TEXT,
  revokedAt TEXT,
  lastUsedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  rowVersion INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_mcp_tokens_account_user ON mcp_tokens(accountId, userId);
CREATE INDEX idx_mcp_tokens_token_hash ON mcp_tokens(tokenHash);
CREATE INDEX idx_mcp_tokens_account_active ON mcp_tokens(accountId, revokedAt, expiresAt);
