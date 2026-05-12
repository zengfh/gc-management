import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { insertAuditEvent } from '../audit/index.js';
import { requireAdminRole } from '../auth/roles.js';
import { requireUnlockedSession } from '../auth/requireAuth.js';
import { clearUnlockedSessionsForUser } from '../auth/unlockStore.js';
import { verifyFreshUnlockSecret } from '../auth/verifyUnlockSecret.js';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { objectResponse } from '../http/response.js';
import { deriveKEK, generateSalt, wrapDEK } from '../security/crypto.js';
import { validateUnlockSecret } from '../security/unlockSecret.js';

const bcryptCost = Number(process.env.BCRYPT_COST || (process.env.NODE_ENV === 'test' ? 4 : 12));
const userRoles = ['owner', 'admin', 'operator', 'viewer'];
const assignableRoles = ['admin', 'operator', 'viewer'];

const createUserSchema = z
  .object({
    currentUnlockSecret: z.string().min(1),
    email: z.string().trim().email().max(320),
    displayName: z.string().trim().min(1).max(120),
    role: z.enum(assignableRoles),
    unlockSecret: z.string().min(1),
  })
  .strict();

const updateUserSchema = z
  .object({
    displayName: z.string().trim().min(1).max(120).optional(),
    role: z.enum(userRoles).optional(),
    disabled: z.boolean().optional(),
  })
  .strict();

function nowIso() {
  return new Date().toISOString();
}

function zodFieldErrors(error) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || 'body',
    code: issue.code,
    message: issue.message,
  }));
}

function validateBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest('VALIDATION_FAILED', 'Request validation failed.', zodFieldErrors(result.error));
  }
  return result.data;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function parsePositiveInt(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw badRequest('VALIDATION_FAILED', 'Request validation failed.', [
      {
        field: 'query',
        code: 'invalid_integer',
        message: `Expected an integer between ${min} and ${max}.`,
      },
    ]);
  }
  return parsed;
}

function toUserResponse(row) {
  return {
    id: row.id,
    accountId: row.accountId,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    disabledAt: row.disabledAt,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function loadUser(db, accountId, userId) {
  const user = db.prepare('SELECT * FROM users WHERE accountId = ? AND id = ?').get(accountId, userId);
  if (!user) {
    throw notFound('USER_NOT_FOUND', 'User not found.');
  }
  return user;
}

function assertOwnerMutationAllowed(actorRole, target, nextRole) {
  if (target.role === 'owner' && actorRole !== 'owner') {
    throw forbidden('OWNER_ROLE_REQUIRED', 'Only the owner can modify the owner user.');
  }
  if (nextRole === 'owner' && actorRole !== 'owner') {
    throw forbidden('OWNER_ROLE_REQUIRED', 'Only the owner can assign the owner role.');
  }
}

function activeOwnerCount(db, accountId) {
  return db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE accountId = ? AND role = 'owner' AND disabledAt IS NULL")
    .get(accountId).count;
}

function clearUserSessions(db, userId) {
  clearUnlockedSessionsForUser(userId);
  db.prepare("DELETE FROM web_sessions WHERE sessionJson LIKE ?").run(`%"userId":${userId}%`);
}

export function createUsersRouter({ db }) {
  const router = Router();

  router.use(requireUnlockedSession);
  router.use(requireAdminRole);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const rows = db
        .prepare(
          `SELECT id, accountId, email, displayName, role, disabledAt, lastLoginAt, createdAt, updatedAt
           FROM users
           WHERE accountId = ?
           ORDER BY disabledAt IS NOT NULL ASC, role = 'owner' DESC, id ASC`,
        )
        .all(req.auth.accountId);
      res.json({ data: rows.map(toUserResponse) });
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = validateBody(createUserSchema, req.body || {});
      await verifyFreshUnlockSecret(db, req.auth, body.currentUnlockSecret);
      const validation = validateUnlockSecret(body.unlockSecret);
      if (!validation.valid) {
        throw badRequest('WEAK_UNLOCK_SECRET', 'Unlock secret does not meet strength requirements.', validation.fieldErrors);
      }

      const timestamp = nowIso();
      const encryptionSalt = generateSalt();
      const kek = deriveKEK(body.unlockSecret, encryptionSalt);
      const encryptedDEK = wrapDEK(req.auth.dek, kek);
      const unlockSecretHash = await bcrypt.hash(body.unlockSecret, bcryptCost);

      try {
        const created = db.transaction(() => {
          const info = db
            .prepare(
              `INSERT INTO users (
                accountId, email, displayName, role, unlockSecretHash,
                encryptionSalt, encryptedDEK, keyVersion, createdAt, updatedAt
              ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            )
            .run(
              req.auth.accountId,
              normalizeEmail(body.email),
              body.displayName,
              body.role,
              unlockSecretHash,
              encryptionSalt,
              encryptedDEK,
              timestamp,
              timestamp,
            );

          const user = loadUser(db, req.auth.accountId, info.lastInsertRowid);
          insertAuditEvent(db, {
            accountId: req.auth.accountId,
            userId: req.auth.userId,
            requestId: req.requestId,
            entityType: 'auth',
            entityId: user.id,
            action: 'user.create',
            metadata: {
              email: user.email,
              role: user.role,
            },
            timestamp,
          });
          return user;
        })();

        res.status(201).json(objectResponse(toUserResponse(created)));
      } catch (error) {
        if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
          throw conflict('USER_EMAIL_EXISTS', 'A user with this email already exists.');
        }
        throw error;
      }
    }),
  );

  router.put(
    '/:userId',
    asyncHandler(async (req, res) => {
      const userId = parsePositiveInt(req.params.userId, null, { min: 1 });
      const body = validateBody(updateUserSchema, req.body || {});
      const before = loadUser(db, req.auth.accountId, userId);
      const nextRole = body.role ?? before.role;
      assertOwnerMutationAllowed(req.auth.role, before, nextRole);
      if (body.disabled === true && userId === req.auth.userId) {
        throw conflict('CANNOT_DISABLE_SELF', 'You cannot disable your own user.');
      }
      if (
        before.role === 'owner'
        && (body.disabled === true || nextRole !== 'owner')
        && activeOwnerCount(db, req.auth.accountId) <= 1
      ) {
        throw conflict('LAST_OWNER_REQUIRED', 'At least one active owner is required.');
      }

      const timestamp = nowIso();
      const after = db.transaction(() => {
        db.prepare(
          `UPDATE users
           SET displayName = ?,
               role = ?,
               disabledAt = ?,
               updatedAt = ?
           WHERE id = ? AND accountId = ?`,
        ).run(
          body.displayName ?? before.displayName,
          nextRole,
          body.disabled === undefined ? before.disabledAt : body.disabled ? before.disabledAt || timestamp : null,
          timestamp,
          userId,
          req.auth.accountId,
        );

        const updated = loadUser(db, req.auth.accountId, userId);
        insertAuditEvent(db, {
          accountId: req.auth.accountId,
          userId: req.auth.userId,
          requestId: req.requestId,
          entityType: 'auth',
          entityId: updated.id,
          action: 'user.update',
          oldValue: {
            displayName: before.displayName,
            role: before.role,
            disabledAt: before.disabledAt,
          },
          newValue: {
            displayName: updated.displayName,
            role: updated.role,
            disabledAt: updated.disabledAt,
          },
          timestamp,
        });
        return updated;
      })();

      if (after.role !== before.role || after.disabledAt !== before.disabledAt) {
        clearUserSessions(db, userId);
      }

      res.json(objectResponse(toUserResponse(after)));
    }),
  );

  return router;
}
