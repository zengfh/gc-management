CREATE TABLE user_invites (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL,
  email TEXT NOT NULL,
  displayName TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','operator','viewer')),
  inviteCodeHash TEXT NOT NULL,
  encryptionSalt TEXT NOT NULL,
  encryptedDEK TEXT NOT NULL,
  invitedByUserId INTEGER,
  acceptedByUserId INTEGER,
  expiresAt TEXT NOT NULL,
  usedAt TEXT,
  revokedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (invitedByUserId) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (acceptedByUserId) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_user_invites_account_email
  ON user_invites(accountId, email, expiresAt);

CREATE INDEX idx_user_invites_account_status
  ON user_invites(accountId, usedAt, revokedAt, expiresAt);

CREATE TABLE user_recovery_codes (
  id INTEGER PRIMARY KEY,
  accountId INTEGER NOT NULL,
  userId INTEGER NOT NULL,
  codeHash TEXT NOT NULL,
  encryptionSalt TEXT NOT NULL,
  encryptedDEK TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  expiresAt TEXT,
  usedAt TEXT,
  revokedAt TEXT,
  FOREIGN KEY (accountId) REFERENCES accounts(id) ON DELETE CASCADE,
  FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_user_recovery_codes_user_status
  ON user_recovery_codes(accountId, userId, usedAt, revokedAt, expiresAt);
