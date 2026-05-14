import type Database from 'better-sqlite3';

interface LoginAttemptStoreOptions {
  maxAttempts?: number;
  windowMs?: number;
  now?: () => number;
}

interface SqliteLoginAttemptStoreOptions extends LoginAttemptStoreOptions {
  db: Database.Database;
}

interface LoginAttemptRow {
  key: string;
  failures: number;
  resetAt: number;
}

export function createLoginAttemptStore({
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000,
  now = () => Date.now(),
}: LoginAttemptStoreOptions = {}) {
  const attempts = new Map();

  function currentRecord(key) {
    const record = attempts.get(key);
    if (!record || record.resetAt <= now()) {
      attempts.delete(key);
      return null;
    }
    return record;
  }

  return {
    isBlocked(key) {
      const record = currentRecord(key);
      return Boolean(record && record.failures >= maxAttempts);
    },

    recordFailure(key) {
      const record = currentRecord(key) || {
        failures: 0,
        resetAt: now() + windowMs,
      };
      record.failures += 1;
      attempts.set(key, record);
      return record;
    },

    recordSuccess(key) {
      attempts.delete(key);
    },
  };
}

export function createSqliteLoginAttemptStore({
  db,
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000,
  now = () => Date.now(),
}: SqliteLoginAttemptStoreOptions) {
  function currentRecord(key) {
    const record = db
      .prepare('SELECT key, failures, resetAt FROM auth_login_attempts WHERE key = ?')
      .get(key) as LoginAttemptRow | undefined;
    if (!record) {
      return null;
    }
    if (record.resetAt <= now()) {
      db.prepare('DELETE FROM auth_login_attempts WHERE key = ?').run(key);
      return null;
    }
    return record;
  }

  return {
    isBlocked(key) {
      const record = currentRecord(key);
      return Boolean(record && record.failures >= maxAttempts);
    },

    recordFailure(key) {
      const record = currentRecord(key);
      const failures = (record?.failures || 0) + 1;
      const resetAt = record?.resetAt || now() + windowMs;
      db.prepare(
        `INSERT INTO auth_login_attempts (key, failures, resetAt, updatedAt)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           failures = excluded.failures,
           resetAt = excluded.resetAt,
           updatedAt = excluded.updatedAt`,
      ).run(key, failures, resetAt, new Date(now()).toISOString());
      return { key, failures, resetAt };
    },

    recordSuccess(key) {
      db.prepare('DELETE FROM auth_login_attempts WHERE key = ?').run(key);
    },
  };
}
