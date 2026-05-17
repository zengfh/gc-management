import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../http/errors.js';
import { getUnlockedSession } from './unlockStore.js';

export function requireUnlockedSession(req: Request, _res: Response, next: NextFunction) {
  const unlocked = getUnlockedSession(req.sessionID);
  if (!req.session?.userId || !req.session.accountId || !unlocked) {
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
