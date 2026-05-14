import session from 'express-session';
import type Database from 'better-sqlite3';

const oneDayMs = 24 * 60 * 60 * 1000;

type NowProvider = () => number;

interface SqliteSessionStoreOptions {
  db: Database.Database;
  now?: NowProvider;
}

interface SessionRow {
  sessionJson: string;
  expiresAt: number;
}

function nowIso(now: NowProvider) {
  return new Date(now()).toISOString();
}

function sessionExpiresAt(sessionData: session.SessionData, now: NowProvider) {
  const explicitExpires = sessionData?.cookie?.expires;
  if (explicitExpires) {
    const parsed = explicitExpires instanceof Date ? explicitExpires.getTime() : Date.parse(String(explicitExpires));
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  const originalMaxAge = sessionData?.cookie?.originalMaxAge;
  return now() + (Number.isFinite(originalMaxAge) ? originalMaxAge : oneDayMs);
}

export class SqliteSessionStore extends session.Store {
  private readonly db: Database.Database;
  private readonly now: NowProvider;

  constructor({ db, now = () => Date.now() }: SqliteSessionStoreOptions) {
    super();
    this.db = db;
    this.now = now;
    this.cleanupExpired();
  }

  cleanupExpired() {
    this.db.prepare('DELETE FROM web_sessions WHERE expiresAt <= ?').run(this.now());
  }

  override get(sid: string, callback: (err: any, session?: session.SessionData | null) => void) {
    try {
      const row = this.db.prepare('SELECT sessionJson, expiresAt FROM web_sessions WHERE sid = ?').get(sid) as SessionRow | undefined;
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

  override set(sid: string, sessionData: session.SessionData, callback: (err?: any) => void = () => {}) {
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

  override touch(sid: string, sessionData: session.SessionData, callback: (err?: any) => void = () => {}) {
    try {
      this.db
        .prepare('UPDATE web_sessions SET expiresAt = ?, updatedAt = ? WHERE sid = ?')
        .run(sessionExpiresAt(sessionData, this.now), nowIso(this.now), sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }

  override destroy(sid: string, callback: (err?: any) => void = () => {}) {
    try {
      this.db.prepare('DELETE FROM web_sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (error) {
      callback(error);
    }
  }
}

export function createSqliteSessionStore(options: SqliteSessionStoreOptions) {
  return new SqliteSessionStore(options);
}
