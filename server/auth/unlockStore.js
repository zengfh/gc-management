const unlockedSessions = new Map();

export function unlockSession(sessionId, payload) {
  unlockedSessions.set(sessionId, {
    ...payload,
    unlockedAt: new Date().toISOString(),
  });
}

export function getUnlockedSession(sessionId) {
  return unlockedSessions.get(sessionId) || null;
}

export function clearUnlockedSession(sessionId) {
  unlockedSessions.delete(sessionId);
}
