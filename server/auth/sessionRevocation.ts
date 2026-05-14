import { clearUnlockedSessionsForUser } from './unlockStore.js';

export function clearUserSessions(db, userId) {
  const normalizedUserId = Number(userId);
  clearUnlockedSessionsForUser(normalizedUserId);

  const rows = db.prepare('SELECT sid, sessionJson FROM web_sessions').all();
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
