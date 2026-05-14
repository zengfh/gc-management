import bcrypt from 'bcryptjs';
import type Database from 'better-sqlite3';
import type { AuthContext } from '../types/express.js';
import { unauthorized } from '../http/errors.js';

interface PrimaryUserRow {
  id: number;
  accountId: number;
  unlockSecretHash: string;
}

export function loadPrimaryUser(db: Database.Database, userId: number, accountId: number): PrimaryUserRow | undefined {
  return db
    .prepare(
      `SELECT id, accountId, unlockSecretHash
       FROM users
       WHERE id = ? AND accountId = ?`,
    )
    .get(userId, accountId) as PrimaryUserRow | undefined;
}

export async function verifyFreshUnlockSecret(db: Database.Database, auth: AuthContext, unlockSecret: string) {
  const user = loadPrimaryUser(db, auth.userId, auth.accountId);
  const passwordMatches = await bcrypt.compare(unlockSecret || '', user?.unlockSecretHash || '');
  if (!passwordMatches) {
    throw unauthorized('INVALID_UNLOCK_SECRET', 'Invalid unlock secret.');
  }
}
