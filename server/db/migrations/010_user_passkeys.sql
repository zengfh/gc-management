CREATE TABLE user_passkeys (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  credentialId TEXT NOT NULL,
  publicKey TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transportsJson TEXT,
  deviceType TEXT,
  backedUp INTEGER NOT NULL DEFAULT 0 CHECK (backedUp IN (0,1)),
  name TEXT,
  encryptedDEK TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  lastUsedAt TEXT,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE (credentialId)
);

CREATE INDEX idx_user_passkeys_account_user ON user_passkeys(accountId, userId);
