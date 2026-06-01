import bcrypt from 'bcryptjs';
import { Router, type Request } from 'express';
import type Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import {
  deriveBlindIndexKey,
  deriveServerSecretKey,
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

interface PasskeyRow {
  id: number;
  accountId: number;
  userId: number;
  credentialId: string;
  publicKey: string;
  counter: number;
  transportsJson: string | null;
  deviceType: string | null;
  backedUp: number;
  name: string | null;
  encryptedDEK: string;
  createdAt: string;
  lastUsedAt: string | null;
  updatedAt: string;
}

interface PasskeyAuthRow extends PasskeyRow {
  email: string | null;
  displayName: string | null;
  role: Role;
  disabledAt?: string | null;
}

const bcryptCost = Number(process.env.BCRYPT_COST || (process.env.NODE_ENV === 'test' ? 4 : 12));
const defaultAppOrigins = [
  'http://localhost:3001',
  'http://127.0.0.1:3001',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

function nowIso() {
  return new Date().toISOString();
}

function appOrigins() {
  const raw = process.env.APP_ORIGIN;
  if (!raw) {
    return defaultAppOrigins;
  }

  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function originFromRequest(req: Request): string | null {
  const origin = req.get('Origin');
  if (origin) {
    return origin;
  }

  const referer = req.get('Referer');
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }

  const host = req.get('host');
  if (!host) {
    return null;
  }
  return `${req.protocol}://${host}`;
}

function webAuthnRelyingParty(req: Request) {
  const origins = appOrigins();
  const requestOrigin = originFromRequest(req);
  const selectedOrigin = requestOrigin && origins.includes(requestOrigin)
    ? requestOrigin
    : origins[0] || requestOrigin || 'http://localhost:3001';
  const rpID = new URL(selectedOrigin).hostname;
  return {
    rpName: 'Gift Card Manager',
    rpID,
    expectedOrigins: origins.length > 0 ? origins : [selectedOrigin],
  };
}

function passkeyWrapSecret() {
  const secret = process.env.GC_PASSKEY_WRAP_SECRET || process.env.SESSION_SECRET;
  if (secret) {
    return secret;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('GC_PASSKEY_WRAP_SECRET or SESSION_SECRET is required for passkey unlock in production.');
  }
  return 'dev-passkey-wrap-secret-change-me';
}

function passkeyWrappingKey() {
  return deriveServerSecretKey(passkeyWrapSecret(), 'gc-passkey-dek-wrap-v1');
}

function parseTransports(value: string | null | undefined): AuthenticatorTransportFuture[] | undefined {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((transport): transport is AuthenticatorTransportFuture => typeof transport === 'string');
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function credentialDescriptor(id: string, transportsJson: string | null | undefined) {
  const transports = parseTransports(transportsJson);
  return transports ? { id, transports } : { id };
}

function publicPasskey(row: PasskeyRow) {
  return {
    id: String(row.id),
    name: row.name,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    transports: parseTransports(row.transportsJson) || [],
    deviceType: row.deviceType,
    backedUp: Boolean(row.backedUp),
  };
}

function passkeyCount(db: Database.Database, accountId: number, userId: number) {
  return (db
    .prepare('SELECT COUNT(*) AS count FROM user_passkeys WHERE accountId = ? AND userId = ?')
    .get(accountId, userId) as CountRow).count;
}

function storeWebAuthnChallenge(
  req: Request,
  type: 'registration' | 'authentication',
  challenge: string,
  userId?: number,
) {
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  req.session.webauthn = {
    type,
    challenge,
    ...(userId === undefined ? {} : { userId }),
    expiresAt,
  };
}

function readWebAuthnChallenge(req: Request, type: 'registration' | 'authentication', userId?: number) {
  const stored = req.session.webauthn;
  if (!stored || stored.type !== type || stored.expiresAt <= nowIso()) {
    throw unauthorized('PASSKEY_CHALLENGE_EXPIRED', 'Passkey challenge expired. Try again.');
  }
  if (userId !== undefined && stored.userId !== undefined && stored.userId !== userId) {
    throw unauthorized('PASSKEY_CHALLENGE_MISMATCH', 'Passkey challenge does not match this user.');
  }
  return stored.challenge;
}

function clearWebAuthnChallenge(req: Request) {
  delete req.session.webauthn;
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
          passkeys: {
            count: passkeyCount(db, sessionAccountId, sessionUserId),
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

  router.get(
    '/passkeys',
    asyncHandler(async (req, res) => {
      const unlocked = getUnlockedSession(req.sessionID);
      if (!req.session?.userId || !unlocked) {
        throw unauthorized('LOCKED', 'Encrypted data is locked.');
      }

      const rows = db
        .prepare(
          `SELECT *
           FROM user_passkeys
           WHERE accountId = ?
             AND userId = ?
           ORDER BY lastUsedAt IS NULL, lastUsedAt DESC, createdAt DESC`,
        )
        .all(unlocked.accountId, unlocked.userId) as PasskeyRow[];

      res.json(objectResponse(rows.map(publicPasskey)));
    }),
  );

  router.post(
    '/passkeys/register/options',
    asyncHandler(async (req, res) => {
      const unlocked = getUnlockedSession(req.sessionID);
      if (!req.session?.userId || !unlocked) {
        throw unauthorized('LOCKED', 'Encrypted data is locked.');
      }

      const user = db
        .prepare('SELECT * FROM users WHERE id = ? AND accountId = ? AND disabledAt IS NULL')
        .get(unlocked.userId, unlocked.accountId) as AuthUserRow | undefined;
      if (!user) {
        throw unauthorized('LOCKED', 'Encrypted data is locked.');
      }

      const existing = db
        .prepare(
          `SELECT credentialId, transportsJson
           FROM user_passkeys
           WHERE accountId = ?
             AND userId = ?`,
        )
        .all(unlocked.accountId, unlocked.userId) as Array<{ credentialId: string; transportsJson: string | null }>;
      const rp = webAuthnRelyingParty(req);
      const options = await generateRegistrationOptions({
        rpName: rp.rpName,
        rpID: rp.rpID,
        userID: Buffer.from(String(user.id)),
        userName: user.email || `user-${user.id}`,
        userDisplayName: user.displayName || user.email || `User ${user.id}`,
        attestationType: 'none',
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'required',
        },
        excludeCredentials: existing.map((credential) =>
          credentialDescriptor(credential.credentialId, credential.transportsJson)),
        timeout: 120_000,
      });

      storeWebAuthnChallenge(req, 'registration', options.challenge, user.id);
      await saveSession(req);

      res.json(objectResponse({ options }));
    }),
  );

  router.post(
    '/passkeys/register/verify',
    asyncHandler(async (req, res) => {
      const unlocked = getUnlockedSession(req.sessionID);
      if (!req.session?.userId || !unlocked) {
        throw unauthorized('LOCKED', 'Encrypted data is locked.');
      }

      const response = req.body?.response as RegistrationResponseJSON | undefined;
      if (!response) {
        throw badRequest('VALIDATION_FAILED', 'Request validation failed.', [
          { field: 'response', code: 'required', message: 'Passkey response is required.' },
        ]);
      }

      const challenge = readWebAuthnChallenge(req, 'registration', unlocked.userId);
      const rp = webAuthnRelyingParty(req);
      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: rp.expectedOrigins,
        expectedRPID: rp.rpID,
        requireUserVerification: true,
      });
      if (!verification.verified) {
        throw unauthorized('PASSKEY_VERIFICATION_FAILED', 'Passkey registration failed.');
      }

      const credential = verification.registrationInfo.credential;
      const timestamp = nowIso();
      const name = String(req.body?.name || '').trim() || 'Passkey';
      const encryptedDEK = wrapDEK(unlocked.dek, passkeyWrappingKey());
      if (!encryptedDEK) {
        throw new Error('Unable to wrap passkey data encryption key.');
      }

      const created = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO user_passkeys (
              accountId, userId, credentialId, publicKey, counter, transportsJson,
              deviceType, backedUp, name, encryptedDEK, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            unlocked.accountId,
            unlocked.userId,
            credential.id,
            Buffer.from(credential.publicKey).toString('base64'),
            credential.counter,
            JSON.stringify(credential.transports || response.response.transports || []),
            verification.registrationInfo.credentialDeviceType,
            verification.registrationInfo.credentialBackedUp ? 1 : 0,
            name,
            encryptedDEK,
            timestamp,
            timestamp,
          );
        db.prepare(
          `INSERT INTO audit_log (
            accountId, userId, requestId, entityType, entityId, action, metadata, timestamp
          ) VALUES (?, ?, ?, 'auth', ?, 'auth.passkey_register', ?, ?)`,
        ).run(
          unlocked.accountId,
          unlocked.userId,
          req.requestId,
          info.lastInsertRowid,
          JSON.stringify({
            name,
            deviceType: verification.registrationInfo.credentialDeviceType,
            backedUp: verification.registrationInfo.credentialBackedUp,
          }),
          timestamp,
        );
        return db.prepare('SELECT * FROM user_passkeys WHERE id = ?').get(info.lastInsertRowid) as PasskeyRow;
      })();

      clearWebAuthnChallenge(req);
      await saveSession(req);

      res.status(201).json(objectResponse({ passkey: publicPasskey(created) }));
    }),
  );

  router.post(
    '/passkeys/login/options',
    asyncHandler(async (req, res) => {
      const user = getLoginUser(db, req.body?.email);
      if (!user) {
        throw unauthorized(
          setupComplete(db) ? 'PASSKEY_LOGIN_FAILED' : 'SETUP_REQUIRED',
          setupComplete(db) ? 'Passkey login failed.' : 'Setup has not been completed.',
        );
      }

      const passkeys = db
        .prepare(
          `SELECT *
           FROM user_passkeys
           WHERE accountId = ?
             AND userId = ?
           ORDER BY lastUsedAt IS NULL, lastUsedAt DESC, createdAt DESC`,
        )
        .all(user.accountId, user.id) as PasskeyRow[];
      if (passkeys.length === 0) {
        throw unauthorized('PASSKEY_NOT_CONFIGURED', 'No passkey is registered for this user.');
      }

      const rp = webAuthnRelyingParty(req);
      const options = await generateAuthenticationOptions({
        rpID: rp.rpID,
        allowCredentials: passkeys.map((passkey) =>
          credentialDescriptor(passkey.credentialId, passkey.transportsJson)),
        userVerification: 'required',
        timeout: 120_000,
      });

      storeWebAuthnChallenge(req, 'authentication', options.challenge, user.id);
      await saveSession(req);

      res.json(objectResponse({ options }));
    }),
  );

  router.post(
    '/passkeys/login/verify',
    asyncHandler(async (req, res) => {
      const response = req.body?.response as AuthenticationResponseJSON | undefined;
      const credentialId = response?.id;
      if (!response || !credentialId) {
        throw badRequest('VALIDATION_FAILED', 'Request validation failed.', [
          { field: 'response', code: 'required', message: 'Passkey response is required.' },
        ]);
      }

      const passkey = db
        .prepare(
          `SELECT user_passkeys.*, users.email, users.displayName, users.role, users.disabledAt
           FROM user_passkeys
           JOIN users ON users.id = user_passkeys.userId
             AND users.accountId = user_passkeys.accountId
           WHERE user_passkeys.credentialId = ?
             AND users.disabledAt IS NULL
           LIMIT 1`,
        )
        .get(credentialId) as PasskeyAuthRow | undefined;
      if (!passkey) {
        throw unauthorized('PASSKEY_LOGIN_FAILED', 'Passkey login failed.');
      }

      const challenge = readWebAuthnChallenge(req, 'authentication', passkey.userId);
      const rp = webAuthnRelyingParty(req);
      const transports = parseTransports(passkey.transportsJson);
      const credential: WebAuthnCredential = {
        id: passkey.credentialId,
        publicKey: Buffer.from(passkey.publicKey, 'base64'),
        counter: passkey.counter,
        ...(transports ? { transports } : {}),
      };
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: rp.expectedOrigins,
        expectedRPID: rp.rpID,
        credential,
        requireUserVerification: true,
      });
      if (!verification.verified) {
        throw unauthorized('PASSKEY_LOGIN_FAILED', 'Passkey login failed.');
      }

      const dek = unwrapDEK(passkey.encryptedDEK, passkeyWrappingKey());
      const timestamp = nowIso();
      clearUnlockedSession(req.sessionID);
      await regenerateSession(req);
      req.session.userId = passkey.userId;
      req.session.accountId = passkey.accountId;
      req.session.role = passkey.role;
      req.session.email = passkey.email;
      req.session.displayName = passkey.displayName;
      ensureCsrfToken(req);
      unlockSession(req.sessionID, {
        userId: passkey.userId,
        accountId: passkey.accountId,
        role: passkey.role,
        email: passkey.email,
        displayName: passkey.displayName,
        dek,
        blindIndexKey: deriveBlindIndexKey(dek),
      });
      db.transaction(() => {
        db.prepare(
          `UPDATE user_passkeys
           SET counter = ?, deviceType = ?, backedUp = ?, lastUsedAt = ?, updatedAt = ?
           WHERE id = ?`,
        ).run(
          verification.authenticationInfo.newCounter,
          verification.authenticationInfo.credentialDeviceType,
          verification.authenticationInfo.credentialBackedUp ? 1 : 0,
          timestamp,
          timestamp,
          passkey.id,
        );
        db.prepare('UPDATE users SET lastLoginAt = ?, updatedAt = ? WHERE id = ?').run(
          timestamp,
          timestamp,
          passkey.userId,
        );
        db.prepare(
          `INSERT INTO audit_log (
            accountId, userId, requestId, entityType, entityId, action, metadata, timestamp
          ) VALUES (?, ?, ?, 'auth', ?, 'auth.passkey_login', ?, ?)`,
        ).run(
          passkey.accountId,
          passkey.userId,
          req.requestId,
          passkey.id,
          JSON.stringify({
            deviceType: verification.authenticationInfo.credentialDeviceType,
            backedUp: verification.authenticationInfo.credentialBackedUp,
          }),
          timestamp,
        );
      })();
      clearWebAuthnChallenge(req);
      await saveSession(req);

      res.json(objectResponse(authStatus(db, req)));
    }),
  );

  router.delete(
    '/passkeys/:passkeyId',
    asyncHandler(async (req, res) => {
      const unlocked = getUnlockedSession(req.sessionID);
      if (!req.session?.userId || !unlocked) {
        throw unauthorized('LOCKED', 'Encrypted data is locked.');
      }

      const passkeyId = Number(req.params.passkeyId);
      if (!Number.isInteger(passkeyId) || passkeyId <= 0) {
        throw badRequest('VALIDATION_FAILED', 'Request validation failed.', [
          { field: 'passkeyId', code: 'invalid_integer', message: 'Passkey ID is invalid.' },
        ]);
      }

      const timestamp = nowIso();
      const deleted = db.transaction(() => {
        const row = db
          .prepare('SELECT * FROM user_passkeys WHERE id = ? AND accountId = ? AND userId = ?')
          .get(passkeyId, unlocked.accountId, unlocked.userId) as PasskeyRow | undefined;
        if (!row) {
          return null;
        }
        db.prepare('DELETE FROM user_passkeys WHERE id = ?').run(passkeyId);
        db.prepare(
          `INSERT INTO audit_log (
            accountId, userId, requestId, entityType, entityId, action, metadata, timestamp
          ) VALUES (?, ?, ?, 'auth', ?, 'auth.passkey_delete', ?, ?)`,
        ).run(
          unlocked.accountId,
          unlocked.userId,
          req.requestId,
          passkeyId,
          JSON.stringify({ name: row.name }),
          timestamp,
        );
        return row;
      })();

      if (!deleted) {
        throw unauthorized('PASSKEY_NOT_FOUND', 'Passkey not found.');
      }

      res.json(objectResponse({ deleted: true, passkeyId: String(passkeyId) }));
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
