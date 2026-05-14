import type Database from 'better-sqlite3';
import { clearUnlockedSessionsForUser } from './unlockStore.js';

interface SessionRow {
  sid: string;
  sessionJson: string;
}

export function clearUserSessions(db: Database.Database, userId: number | string) {
  const normalizedUserId = Number(userId);
  clearUnlockedSessionsForUser(normalizedUserId);

  const rows = db.prepare('SELECT sid, sessionJson FROM web_sessions').all() as SessionRow[];
  const sids = rows
    .filter((row) => {
      try {
        const sessionData = JSON.parse(row.sessionJson);
        return Number(sessionData?.userId) === normalizedUserId;
      } catch {
        return false;
      }
    })
    .map((row) => row.sid);

  if (!sids.length) {
    return;
  }

  const deleteSession = db.prepare('DELETE FROM web_sessions WHERE sid = ?');
  db.transaction(() => {
    for (const sid of sids) {
      deleteSession.run(sid);
    }
  })();
}
