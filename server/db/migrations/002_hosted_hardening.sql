CREATE TABLE web_sessions (
  sid TEXT PRIMARY KEY,
  sessionJson TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX idx_web_sessions_expires ON web_sessions(expiresAt);

CREATE TABLE auth_login_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  resetAt INTEGER NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX idx_auth_login_attempts_reset ON auth_login_attempts(resetAt);
