import { unauthorized } from '../http/errors.js';
import { getUnlockedSession } from './unlockStore.js';

export function requireUnlockedSession(req, _res, next) {
  const unlocked = getUnlockedSession(req.sessionID);
  if (!req.session?.userId || !unlocked) {
    next(unauthorized('LOCKED', 'Encrypted data is locked.'));
    return;
  }

  req.auth = {
    userId: req.session.userId,
    accountId: req.session.accountId,
    role: unlocked.role,
    email: unlocked.email,
    displayName: unlocked.displayName,
    dek: unlocked.dek,
    blindIndexKey: unlocked.blindIndexKey,
  };
  next();
}
