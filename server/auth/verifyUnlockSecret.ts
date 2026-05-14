import bcrypt from 'bcryptjs';
import { unauthorized } from '../http/errors.js';

export function loadPrimaryUser(db, userId, accountId) {
  return db
    .prepare(
      `SELECT id, accountId, unlockSecretHash
       FROM users
       WHERE id = ? AND accountId = ?`,
    )
    .get(userId, accountId);
}

export async function verifyFreshUnlockSecret(db, auth, unlockSecret) {
  const user = loadPrimaryUser(db, auth.userId, auth.accountId);
  const passwordMatches = await bcrypt.compare(unlockSecret || '', user?.unlockSecretHash || '');
  if (!passwordMatches) {
    throw unauthorized('INVALID_UNLOCK_SECRET', 'Invalid unlock secret.');
  }
}
