import type { Role } from './roles.js';

interface UnlockedSessionPayload {
  userId: number;
  accountId: number;
  role: Role;
  email: string | null;
  displayName: string | null;
  dek: Buffer;
  blindIndexKey: Buffer;
}

interface UnlockedSession extends UnlockedSessionPayload {
  unlockedAt: string;
}

const unlockedSessions = new Map<string, UnlockedSession>();

export function unlockSession(sessionId: string, payload: UnlockedSessionPayload) {
  unlockedSessions.set(sessionId, {
    ...payload,
    unlockedAt: new Date().toISOString(),
  });
}

export function getUnlockedSession(sessionId: string): UnlockedSession | null {
  return unlockedSessions.get(sessionId) || null;
}

export function clearUnlockedSession(sessionId: string) {
  unlockedSessions.delete(sessionId);
}

export function clearUnlockedSessionsForUser(userId: number) {
  for (const [sessionId, payload] of unlockedSessions.entries()) {
    if (payload.userId === userId) {
      unlockedSessions.delete(sessionId);
    }
  }
}
