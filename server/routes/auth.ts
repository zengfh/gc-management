import bcrypt from 'bcryptjs';
import { Router, type Request } from 'express';
import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import {
  deriveBlindIndexKey,
  deriveKEK,
  generateDEK,
  generateSalt,
  unwrapDEK,
  wrapDEK,
} from '../security/crypto.js';
import { getPublicFeatureFlags } from '../config/featureFlags.js';
import { validateUnlockSecret } from '../security/unlockSecret.js';
import {
  clearUnlockedSession,
  getUnlockedSession,
  unlockSession,
} from '../auth/unlockStore.js';
import { clearUserSessions } from '../auth/sessionRevocation.js';
import { createLoginAttemptStore } from '../auth/loginAttempts.js';
import { generateOneTimeSecret, normalizeOneTimeSecret } from '../auth/oneTimeSecrets.js';
import { verifyFreshUnlockSecret } from '../auth/verifyUnlockSecret.js';
import {
  asyncHandler,
  badRequest,
  conflict,
  rateLimited,
  unauthorized,
} from '../http/errors.js';
import { objectResponse } from '../http/response.js';
import type { Role } from '../auth/roles.js';

type LoginAttemptStore = ReturnType<typeof createLoginAttemptStore>;

interface CountRow {
  count: number;
}

interface AuthUserRow {
  id: number;
  accountId: number;
  accountMode?: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  unlockSecretHash: string;
  encryptionSalt: string;
  encryptedDEK: string;
  keyVersion: number;
}

interface InviteRow {
  id: number;
  accountId: number;
  email: string;
  displayName: string | null;
  role: Role;
  inviteCodeHash: string;
  encryptionSalt: string;
  encryptedDEK: string;
}

interface RecoveryCodeRow {
  id: number;
  accountId: number;
  userId: number;
  codeHash: string;
  encryptionSalt: string;
  encryptedDEK: string;
}

const bcryptCost = Number(process.env.BCRYPT_COST || (process.env.NODE_ENV === 'test' ? 4 : 12));

function nowIso() {
  return new Date().toISOString();
}

function regenerateSession(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.regenerate((err: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function destroySession(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.destroy((err: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function saveSession(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.save((err: unknown) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getPrimaryUser(db: Database.Database): AuthUserRow | undefined {
  return db
    .prepare(
      `SELECT users.*, accounts.mode AS accountMode
       FROM users
       JOIN accounts ON accounts.id = users.accountId
       WHERE users.disabledAt IS NULL
       ORDER BY users.id
       LIMIT 1`,
    )
    .get() as AuthUserRow | undefined;
}

function normalizeEmail(email: unknown): string | null {
  const normalized = String(email || '').trim().toLowerCase();
  return normalized || null;
}

function getLoginUser(db: Database.Database, email: unknown): AuthUserRow | undefined {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    return db
      .prepare(
        `SELECT users.*, accounts.mode AS accountMode
         FROM users
         JOIN accounts ON accounts.id = users.accountId
         WHERE LOWER(users.email) = ? AND users.disabledAt IS NULL
         ORDER BY users.id
         LIMIT 1`,
      )
      .get(normalizedEmail) as AuthUserRow | undefined;
  }

  const userCount = (db.prepare('SELECT COUNT(*) AS count FROM users WHERE disabledAt IS NULL').get() as CountRow).count;
  if (userCount > 1) {
    throw badRequest('EMAIL_REQUIRED', 'Email is required when multiple users exist.');
  }
  return getPrimaryUser(db);
}

function setupComplete(db: Database.Database) {
  return (db.prepare('SELECT COUNT(*) AS count FROM users').get() as CountRow).count > 0;
}

function ensureCsrfToken(req: Request) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = cryptoRandomToken();
  }
  return req.session.csrfToken;
}

function cryptoRandomToken() {
  return `csrf_${nanoid(32)}`;
}

function activeRecoveryCodeCount(
  db: Database.Database,
  accountId: number,
  userId: number,
  timestamp = nowIso(),
) {
  return (db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM user_recovery_codes
       WHERE accountId = ?
         AND userId = ?
         AND usedAt IS NULL
         AND revokedAt IS NULL
         AND (expiresAt IS NULL OR expiresAt > ?)`,
    )
    .get(accountId, userId, timestamp) as CountRow).count;
}

function authStatus(db: Database.Database, req: Request) {
  const sessionUserId = req.session?.userId;
  const sessionAccountId = req.session?.accountId;
  const sessionValid = sessionUserId !== undefined && sessionAccountId !== undefined;
  const unlocked = sessionValid ? getUnlockedSession(req.sessionID) : null;
  return {
    setupComplete: setupComplete(db),
    sessionValid,
    dekLoaded: Boolean(unlocked),
    features: getPublicFeatureFlags(),
    ...(sessionValid
      ? {
          user: {
            id: sessionUserId,
            accountId: sessionAccountId,
            role: req.session.role || unlocked?.role || null,
            email: req.session.email || unlocked?.email || null,
            displayName: req.session.displayName || unlocked?.displayName || null,
          },
        }
      : {}),
    ...(sessionValid ? { csrfToken: ensureCsrfToken(req) } : {}),
    ...(sessionValid
      ? {
          recoveryCodes: {
            activeCount: activeRecoveryCodeCount(db, sessionAccountId, sessionUserId),
          },
        }
      : {}),
  };
}

function genericInviteError() {
  return unauthorized('INVALID_INVITE', 'Invite code is invalid or expired.');
}

function genericRecoveryError() {
  return unauthorized('INVALID_RECOVERY_CODE', 'Recovery code is invalid or expired.');
}

function loadInviteCandidates(db: Database.Database, email: string, timestamp: string): InviteRow[] {
  return db
    .prepare(
      `SELECT *
       FROM user_invites
       WHERE LOWER(email) = LOWER(?)
         AND usedAt IS NULL
         AND revokedAt IS NULL
         AND expiresAt > ?
       ORDER BY createdAt DESC`,
    )
    .all(email, timestamp) as InviteRow[];
}

function activeUserEmailExists(db: Database.Database, accountId: number, email: string): AuthUserRow | undefined {
  return db
    .prepare('SELECT id FROM users WHERE accountId = ? AND LOWER(email) = LOWER(?) AND disabledAt IS NULL')
    .get(accountId, email) as AuthUserRow | undefined;
}

function loadRecoveryUser(db: Database.Database, email: unknown): AuthUserRow | null {
  const normalizedEmail = normalizeEmail(email);
  if (normalizedEmail) {
    return db
      .prepare(
        `SELECT users.*
         FROM users
         WHERE LOWER(users.email) = ?
           AND users.disabledAt IS NULL
         ORDER BY users.id
         LIMIT 1`,
      )
      .get(normalizedEmail) as AuthUserRow | undefined || null;
  }

  const activeUsers = db.prepare('SELECT * FROM users WHERE disabledAt IS NULL ORDER BY id').all() as AuthUserRow[];
  const onlyActiveUser = activeUsers[0];
  return activeUsers.length === 1 && onlyActiveUser ? onlyActiveUser : null;
}

export function createAuthRouter({
  db,
  loginAttempts = createLoginAttemptStore(),
}: {
  db: Database.Database;
  loginAttempts?: LoginAttemptStore;
}) {
  const router = Router();

  router.get('/status', (req, res) => {
    res.json(objectResponse(authStatus(db, req)));
  });

  router.post(
    '/setup',
    asyncHandler(async (req, res) => {
      if (setupComplete(db)) {
        throw conflict('SETUP_EXISTS', 'Setup has already been completed.');
      }

      const { unlockSecret, displayName = 'Owner', email = null } = req.body || {};
      const validation = validateUnlockSecret(unlockSecret);
      if (!validation.valid) {
        throw badRequest(
          'WEAK_UNLOCK_SECRET',
          'Unlock secret does not meet strength requirements.',
          validation.fieldErrors,
        );
      }

      const dek = generateDEK();
      const encryptionSalt = generateSalt();
      const kek = deriveKEK(unlockSecret, encryptionSalt);
      const encryptedDEK = wrapDEK(dek, kek);
      const unlockSecretHash = await bcrypt.hash(unlockSecret, bcryptCost);
      const timestamp = nowIso();

      const createSetup = db.transaction(() => {
        db.prepare(
          `INSERT INTO accounts (id, name, mode, createdAt, updatedAt)
           VALUES (1, 'Personal', 'local', ?, ?)`,
        ).run(timestamp, timestamp);
        db.prepare(
          `INSERT INTO users (
            id, accountId, email, displayName, role, unlockSecretHash,
            encryptionSalt, encryptedDEK, keyVersion, createdAt, updatedAt
          ) VALUES (1, 1, ?, ?, 'owner', ?, ?, ?, 1, ?, ?)`,
        ).run(normalizeEmail(email), displayName, unlockSecretHash, encryptionSalt, encryptedDEK, timestamp, timestamp);
        db.prepare(
          `INSERT INTO audit_log (
            accountId, userId, requestId, entityType, entityId, action, metadata, timestamp
          ) VALUES (1, 1, ?, 'auth', 1, 'auth.setup', ?, ?)`,
        ).run(req.requestId, JSON.stringify({ mode: 'local' }), timestamp);
      });

      createSetup();
      await regenerateSession(req);
      req.session.userId = 1;
      req.session.accountId = 1;
      req.session.role = 'owner';
      req.session.email = normalizeEmail(email);
      req.session.displayName = displayName;
      ensureCsrfToken(req);
      unlockSession(req.sessionID, {
        userId: 1,
        accountId: 1,
        role: 'owner',
        email: normalizeEmail(email),
        displayName,
        dek,
        blindIndexKey: deriveBlindIndexKey(dek),
      });
      await saveSession(req);

      res.status(201).json(objectResponse(authStatus(db, req)));
    }),
  );

  router.post(
    '/accept-invite',
    asyncHandler(async (req, res) => {
      const { email, inviteCode, unlockSecret } = req.body || {};
      const normalizedEmail = normalizeEmail(email);
      if (!normalizedEmail || !inviteCode) {
        throw genericInviteError();
      }

      const inviteKey = `invite:${req.ip || 'unknown'}:${normalizedEmail}`;
      if (loginAttempts.isBlocked(inviteKey)) {
        throw rateLimited('INVITE_RATE_LIMITED', 'Too many failed invite attempts. Try again later.');
      }

      const validation = validateUnlockSecret(unlockSecret);
      if (!validation.valid) {
        throw badRequest(
          'WEAK_UNLOCK_SECRET',
          'Unlock secret does not meet strength requirements.',
          validation.fieldErrors,
        );
      }

      const timestamp = nowIso();
      const normalizedInviteCode = normalizeOneTimeSecret(inviteCode);
      const candidates = loadInviteCandidates(db, normalizedEmail, timestamp);
      let matchedInvite: InviteRow | null = null;
      for (const candidate of candidates) {
        if (await bcrypt.compare(normalizedInviteCode, candidate.inviteCodeHash)) {
          matchedInvite = candidate;
          break;
        }
      }

      if (!matchedInvite) {
        loginAttempts.recordFailure(inviteKey);
        throw genericInviteError();
      }
      loginAttempts.recordSuccess(inviteKey);

      if (activeUserEmailExists(db, matchedInvite.accountId, normalizedEmail)) {
        throw conflict('USER_EMAIL_EXISTS', 'A user with this email already exists.');
      }

      const inviteKek = deriveKEK(normalizedInviteCode, matchedInvite.encryptionSalt);
      const dek = unwrapDEK(matchedInvite.encryptedDEK, inviteKek);
      const userSalt = generateSalt();
      const userKek = deriveKEK(unlockSecret, userSalt);
      const encryptedDEK = wrapDEK(dek, userKek);
      const unlockSecretHash = await bcrypt.hash(unlockSecret, bcryptCost);

      const user = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO users (
              accountId, email, displayName, role, unlockSecretHash,
              encryptionSalt, encryptedDEK, keyVersion, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          )
          .run(
            matchedInvite.accountId,
            normalizedEmail,
            matchedInvite.displayName,
            matchedInvite.role,
            unlockSecretHash,
            userSalt,
            encryptedDEK,
            timestamp,
            timestamp,
          );
        const created = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as AuthUserRow;
        db.prepare('UPDATE user_invites SET usedAt = ?, acceptedByUserId = ?, updatedAt = ? WHERE id = ?').run(
          timestamp,
          created.id,
          timestamp,
          matchedInvite.id,
        );
        db.prepare(
          `INSERT INTO audit_log (
            accountId, userId, requestId, entityType, entityId, action, metadata, timestamp
          ) VALUES (?, ?, ?, 'auth', ?, 'user.invite_accept', ?, ?)`,
        ).run(
          matchedInvite.accountId,
          created.id,
          req.requestId,
          matchedInvite.id,
          JSON.stringify({ email: normalizedEmail, role: matchedInvite.role }),
          timestamp,
        );
        return created;
      })();

      await regenerateSession(req);
      req.session.userId = user.id;
      req.session.accountId = user.accountId;
      req.session.role = user.role;
      req.session.email = user.email;
      req.session.displayName = user.displayName;
      ensureCsrfToken(req);
      unlockSession(req.sessionID, {
        userId: user.id,
        accountId: user.accountId,
        role: user.role,
        email: user.email,
        displayName: user.displayName,
        dek,
        blindIndexKey: deriveBlindIndexKey(dek),
      });
      await saveSession(req);

      res.status(201).json(objectResponse(authStatus(db, req)));
    }),
  );

  router.post(
    '/login',
    asyncHandler(async (req, res) => {
      const { email, unlockSecret } = req.body || {};
      const user = getLoginUser(db, email);
      if (!user) {
        throw unauthorized(
          setupComplete(db) ? 'INVALID_UNLOCK_SECRET' : 'SETUP_REQUIRED',
          setupComplete(db) ? 'Invalid unlock secret.' : 'Setup has not been completed.',
        );
      }

      const loginKey = `${req.ip || 'unknown'}:${user.id}`;
      if (loginAttempts.isBlocked(loginKey)) {
        throw rateLimited('LOGIN_RATE_LIMITED', 'Too many failed login attempts. Try again later.');
      }

      const passwordMatches = await bcrypt.compare(unlockSecret || '', user.unlockSecretHash);
      if (!passwordMatches) {
        loginAttempts.recordFailure(loginKey);
        throw unauthorized('INVALID_UNLOCK_SECRET', 'Invalid unlock secret.');
      }
      loginAttempts.recordSuccess(loginKey);

      const kek = deriveKEK(unlockSecret, user.encryptionSalt);
      const dek = unwrapDEK(user.encryptedDEK, kek);

      clearUnlockedSession(req.sessionID);
      await regenerateSession(req);
      req.session.userId = user.id;
      req.session.accountId = user.accountId;
      req.session.role = user.role;
      req.session.email = user.email;
      req.session.displayName = user.displayName;
      ensureCsrfToken(req);
      unlockSession(req.sessionID, {
        userId: user.id,
        accountId: user.accountId,
        role: user.role,
        email: user.email,
        displayName: user.displayName,
        dek,
        blindIndexKey: deriveBlindIndexKey(dek),
      });
      db.prepare('UPDATE users SET lastLoginAt = ?, updatedAt = ? WHERE id = ?').run(nowIso(), nowIso(), user.id);
      await saveSession(req);

      res.json(objectResponse(authStatus(db, req)));
    }),
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      clearUnlockedSession(req.sessionID);
      await destroySession(req);
      res.clearCookie('gc.sid');
      res.json(
        objectResponse({
          setupComplete: setupComplete(db),
          sessionValid: false,
          dekLoaded: false,
          features: getPublicFeatureFlags(),
        }),
      );
    }),
  );

  router.post(
    '/recovery-codes',
    asyncHandler(async (req, res) => {
      const unlocked = getUnlockedSession(req.sessionID);
      if (!req.session?.userId || !unlocked) {
        throw unauthorized('LOCKED', 'Encrypted data is locked.');
      }

      const { currentUnlockSecret } = req.body || {};
      await verifyFreshUnlockSecret(db, unlocked, currentUnlockSecret);

      const timestamp = nowIso();
      const codes = Array.from({ length: 10 }, () => generateOneTimeSecret('GC-REC'));
      db.transaction(() => {
        db.prepare(
          `UPDATE user_recovery_codes
           SET revokedAt = ?
           WHERE accountId = ?
             AND userId = ?
             AND usedAt IS NULL
             AND revokedAt IS NULL`,
        ).run(timestamp, unlocked.accountId, unlocked.userId);

        const insertCode = db.prepare(
          `INSERT INTO user_recovery_codes (
            accountId, userId, codeHash, encryptionSalt, encryptedDEK, createdAt
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        );
        for (const code of codes) {
          const normalizedCode = normalizeOneTimeSecret(code);
          const encryptionSalt = generateSalt();
          const kek = deriveKEK(normalizedCode, encryptionSalt);
          insertCode.run(
            unlocked.accountId,
            unlocked.userId,
            bcrypt.hashSync(normalizedCode, bcryptCost),
            encryptionSalt,
            wrapDEK(unlocked.dek, kek),
            timestamp,
          );
        }
        db.prepare(
          `INSERT INTO audit_log (
            accountId, userId, requestId, entityType, entityId, action, metadata, timestamp
          ) VALUES (?, ?, ?, 'auth', ?, 'auth.recovery_codes_generate', ?, ?)`,
        ).run(
          unlocked.accountId,
          unlocked.userId,
          req.requestId,
          unlocked.userId,
          JSON.stringify({ count: codes.length }),
          timestamp,
        );
      })();

      res.status(201).json(
        objectResponse({
          codes,
          generatedAt: timestamp,
          activeCount: activeRecoveryCodeCount(db, unlocked.accountId, unlocked.userId, timestamp),
        }),
      );
    }),
  );

  router.post(
    '/recover',
    asyncHandler(async (req, res) => {
      const { email, recoveryCode, newUnlockSecret } = req.body || {};
      if (!recoveryCode) {
        throw genericRecoveryError();
      }

      const recoveryKey = `recovery:${req.ip || 'unknown'}:${normalizeEmail(email) || 'single-user'}`;
      if (loginAttempts.isBlocked(recoveryKey)) {
        throw rateLimited('RECOVERY_RATE_LIMITED', 'Too many failed recovery attempts. Try again later.');
      }

      const validation = validateUnlockSecret(newUnlockSecret);
      if (!validation.valid) {
        throw badRequest(
          'WEAK_UNLOCK_SECRET',
          'Unlock secret does not meet strength requirements.',
          validation.fieldErrors,
        );
      }

      const user = loadRecoveryUser(db, email);
      const timestamp = nowIso();
      const normalizedCode = normalizeOneTimeSecret(recoveryCode);
      const candidates = user
        ? db
            .prepare(
              `SELECT *
               FROM user_recovery_codes
               WHERE accountId = ?
                 AND userId = ?
                 AND usedAt IS NULL
                 AND revokedAt IS NULL
                 AND (expiresAt IS NULL OR expiresAt > ?)
               ORDER BY createdAt DESC`,
            )
            .all(user.accountId, user.id, timestamp) as RecoveryCodeRow[]
        : [];

      let matchedCode: RecoveryCodeRow | null = null;
      for (const candidate of candidates) {
        if (await bcrypt.compare(normalizedCode, candidate.codeHash)) {
          matchedCode = candidate;
          break;
        }
      }

      if (!user || !matchedCode) {
        loginAttempts.recordFailure(recoveryKey);
        throw genericRecoveryError();
      }
      loginAttempts.recordSuccess(recoveryKey);

      const recoveryKek = deriveKEK(normalizedCode, matchedCode.encryptionSalt);
      const dek = unwrapDEK(matchedCode.encryptedDEK, recoveryKek);
      const encryptionSalt = generateSalt();
      const kek = deriveKEK(newUnlockSecret, encryptionSalt);
      const encryptedDEK = wrapDEK(dek, kek);
      const unlockSecretHash = await bcrypt.hash(newUnlockSecret, bcryptCost);

      db.transaction(() => {
        db.prepare(
          `UPDATE users
           SET unlockSecretHash = ?, encryptionSalt = ?, encryptedDEK = ?, updatedAt = ?
           WHERE id = ? AND accountId = ?`,
        ).run(unlockSecretHash, encryptionSalt, encryptedDEK, timestamp, user.id, user.accountId);
        db.prepare('UPDATE user_recovery_codes SET usedAt = ? WHERE id = ?').run(timestamp, matchedCode.id);
        db.prepare(
          `INSERT INTO audit_log (
            accountId, userId, requestId, entityType, entityId, action, timestamp
          ) VALUES (?, ?, ?, 'auth', ?, 'auth.recovery_reset', ?)`,
        ).run(user.accountId, user.id, req.requestId, user.id, timestamp);
      })();
      clearUserSessions(db, user.id);

      res.json(objectResponse({ reset: true }));
    }),
  );

  router.post(
    '/change-unlock-secret',
    asyncHandler(async (req, res) => {
      const unlocked = getUnlockedSession(req.sessionID);
      if (!req.session?.userId || !unlocked) {
        throw unauthorized('LOCKED', 'Encrypted data is locked.');
      }

      const { oldUnlockSecret, newUnlockSecret } = req.body || {};
      const user = db
        .prepare('SELECT * FROM users WHERE id = ? AND accountId = ?')
        .get(req.session.userId, req.session.accountId) as AuthUserRow | undefined;
      if (!user) {
        throw unauthorized('LOCKED', 'Encrypted data is locked.');
      }
      const passwordMatches = await bcrypt.compare(oldUnlockSecret || '', user.unlockSecretHash);
      if (!passwordMatches) {
        throw unauthorized('INVALID_UNLOCK_SECRET', 'Invalid unlock secret.');
      }

      const validation = validateUnlockSecret(newUnlockSecret);
      if (!validation.valid) {
        throw badRequest(
          'WEAK_UNLOCK_SECRET',
          'Unlock secret does not meet strength requirements.',
          validation.fieldErrors,
        );
      }

      const encryptionSalt = generateSalt();
      const kek = deriveKEK(newUnlockSecret, encryptionSalt);
      const encryptedDEK = wrapDEK(unlocked.dek, kek);
      const unlockSecretHash = await bcrypt.hash(newUnlockSecret, bcryptCost);
      const timestamp = nowIso();

      db.prepare(
        `UPDATE users
         SET unlockSecretHash = ?, encryptionSalt = ?, encryptedDEK = ?, updatedAt = ?
         WHERE id = ?`,
      ).run(unlockSecretHash, encryptionSalt, encryptedDEK, timestamp, user.id);
      db.prepare(
        `INSERT INTO audit_log (
          accountId, userId, requestId, entityType, entityId, action, timestamp
        ) VALUES (?, ?, ?, 'auth', ?, 'auth.change_unlock_secret', ?)`,
      ).run(user.accountId, user.id, req.requestId, user.id, timestamp);

      res.json(objectResponse({ changed: true }));
    }),
  );

  return router;
}
