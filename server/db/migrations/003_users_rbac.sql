ALTER TABLE users ADD COLUMN disabledAt TEXT;
ALTER TABLE users ADD COLUMN lastLoginAt TEXT;

CREATE UNIQUE INDEX idx_users_account_email
  ON users(accountId, email)
  WHERE email IS NOT NULL;
