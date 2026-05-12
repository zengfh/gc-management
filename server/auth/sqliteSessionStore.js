import session from 'express-session';

const oneDayMs = 24 * 60 * 60 * 1000;

function nowIso(now) {
  return new Date(now()).toISOString();
}

function sessionExpiresAt(sessionData, now) {
  const explicitExpires = sessionData?.cookie?.expires;
  if (explicitExpires) {
    const parsed = Date.parse(explicitExpires);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  const originalMaxAge = sessionData?.cookie?.originalMaxAge;
  return now() + (Number.isFinite(originalMaxAge) ? originalMaxAge : oneDayMs);
}

export class SqliteSessionStore extends session.Store {
  constructor({ db, now = () => Date.now() }) {
    super();
    this.db = db;
    this.now = now;
    this.cleanupExpired();
  }

  cleanupExpired() {
    this.db.prepare('DELETE FROM web_sessions WHERE expiresAt <= ?').run(this.now());
  }

  get(sid, callback) {
    try {
      const row = this.db.prepare('SELECT sessionJson, expiresAt FROM web_sessions WHERE sid = ?').get(sid);
      if (!row) {
        callback(null, null);
        return;
      }
      if (row.expiresAt <= this.now()) {
        this.destroy(sid, () => callback(null, null));
        return;
      }

      callback(null, JSON.parse(row.sessionJson));
    } catch (error) {
      callback(error);
    }
  }

  set(sid, sessionData, callback = () => {}) {
    try {
      this.db
        .prepare(
          `INSERT INTO web_sessions (sid, sessionJson, expiresAt, updatedAt)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(sid) DO UPDATE SET
             sessionJson = excluded.sessionJson,
             expiresAt = excluded.expiresAt,
             updatedAt = excluded.updatedAt`,
        )
        .run(
          sid,
          JSON.stringify(sessionData),
          sessionExpiresAt(sessionData, this.now),
          nowIso(this.now),
        );
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  touch(sid, sessionData, callback = () => {}) {
    try {
      this.db
        .prepare('UPDATE web_sessions SET expiresAt = ?, updatedAt = ? WHERE sid = ?')
        .run(sessionExpiresAt(sessionData, this.now), nowIso(this.now), sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    try {
      this.db.prepare('DELETE FROM web_sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

export function createSqliteSessionStore(options) {
  return new SqliteSessionStore(options);
}
