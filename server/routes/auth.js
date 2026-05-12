import bcrypt from 'bcryptjs';
import { Router } from 'express';
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
import { createLoginAttemptStore } from '../auth/loginAttempts.js';
import {
  asyncHandler,
  badRequest,
  conflict,
  rateLimited,
  unauthorized,
} from '../http/errors.js';
import { objectResponse } from '../http/response.js';

const bcryptCost = Number(process.env.BCRYPT_COST || (process.env.NODE_ENV === 'test' ? 4 : 12));

function nowIso() {
  return new Date().toISOString();
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function destroySession(req) {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function getPrimaryUser(db) {
  return db
    .prepare(
      `SELECT users.*, accounts.mode AS accountMode
       FROM users
       JOIN accounts ON accounts.id = users.accountId
       WHERE users.disabledAt IS NULL
       ORDER BY users.id
       LIMIT 1`,
    )
    .get();
}

function normalizeEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  return normalized || null;
}

function getLoginUser(db, email) {
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
      .get(normalizedEmail);
  }

  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users WHERE disabledAt IS NULL').get().count;
  if (userCount > 1) {
    throw badRequest('EMAIL_REQUIRED', 'Email is required when multiple users exist.');
  }
  return getPrimaryUser(db);
}

function setupComplete(db) {
  return db.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0;
}

function ensureCsrfToken(req) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = cryptoRandomToken();
  }
  return req.session.csrfToken;
}

function cryptoRandomToken() {
  return `csrf_${nanoid(32)}`;
}

function authStatus(db, req) {
  const sessionValid = Boolean(req.session?.userId);
  const unlocked = sessionValid ? getUnlockedSession(req.sessionID) : null;
  return {
    setupComplete: setupComplete(db),
    sessionValid,
    dekLoaded: Boolean(unlocked),
    features: getPublicFeatureFlags(),
    ...(sessionValid
      ? {
          user: {
            id: req.session.userId,
            accountId: req.session.accountId,
            role: req.session.role || unlocked?.role || null,
            email: req.session.email || unlocked?.email || null,
            displayName: req.session.displayName || unlocked?.displayName || null,
          },
        }
      : {}),
    ...(sessionValid ? { csrfToken: ensureCsrfToken(req) } : {}),
  };
}

export function createAuthRouter({ db, loginAttempts = createLoginAttemptStore() }) {
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
    '/change-unlock-secret',
    asyncHandler(async (req, res) => {
      const unlocked = getUnlockedSession(req.sessionID);
      if (!req.session?.userId || !unlocked) {
        throw unauthorized('LOCKED', 'Encrypted data is locked.');
      }

      const { oldUnlockSecret, newUnlockSecret } = req.body || {};
      const user = db
        .prepare('SELECT * FROM users WHERE id = ? AND accountId = ?')
        .get(req.session.userId, req.session.accountId);
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
