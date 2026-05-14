import bcrypt from 'bcryptjs';
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { insertAuditEvent } from '../audit/index.js';
import { requireAdminRole, type Role } from '../auth/roles.js';
import { requireUnlockedSession } from '../auth/requireAuth.js';
import { clearUserSessions } from '../auth/sessionRevocation.js';
import { generateOneTimeSecret, normalizeOneTimeSecret } from '../auth/oneTimeSecrets.js';
import { verifyFreshUnlockSecret } from '../auth/verifyUnlockSecret.js';
import { asyncHandler, badRequest, conflict, forbidden, notFound } from '../http/errors.js';
import { objectResponse } from '../http/response.js';
import { deriveKEK, generateSalt, wrapDEK } from '../security/crypto.js';

const bcryptCost = Number(process.env.BCRYPT_COST || (process.env.NODE_ENV === 'test' ? 4 : 12));
const userRoles = ['owner', 'admin', 'operator', 'viewer'] as const;
const assignableRoles = ['admin', 'operator', 'viewer'] as const;

interface UserRow {
  id: number;
  accountId: number;
  email: string | null;
  displayName: string;
  role: Role;
  disabledAt: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface InviteRow {
  id: number;
  accountId: number;
  email: string;
  displayName: string;
  role: Role;
  invitedByUserId: number;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CountRow {
  count: number;
}

const createInviteSchema = z
  .object({
    currentUnlockSecret: z.string().min(1),
    email: z.string().trim().email().max(320),
    displayName: z.string().trim().min(1).max(120),
    role: z.enum(assignableRoles),
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

function zodFieldErrors(error: z.ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || 'body',
    code: issue.code,
    message: issue.message,
  }));
}

function validateBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw badRequest('VALIDATION_FAILED', 'Request validation failed.', zodFieldErrors(result.error));
  }
  return result.data;
}

function normalizeEmail(email: unknown): string {
  return String(email || '').trim().toLowerCase();
}

function parsePositiveInt<T extends number | null>(
  value: unknown,
  fallback: T,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number | T {
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

function toUserResponse(row: UserRow) {
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

function toInviteResponse(row: InviteRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    invitedByUserId: row.invitedByUserId,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function loadUser(db: Database.Database, accountId: number, userId: number): UserRow {
  const user = db.prepare('SELECT * FROM users WHERE accountId = ? AND id = ?').get(accountId, userId) as UserRow | undefined;
  if (!user) {
    throw notFound('USER_NOT_FOUND', 'User not found.');
  }
  return user;
}

function loadInvite(db: Database.Database, accountId: number, inviteId: number | bigint): InviteRow {
  const invite = db.prepare('SELECT * FROM user_invites WHERE accountId = ? AND id = ?').get(accountId, inviteId) as InviteRow | undefined;
  if (!invite) {
    throw notFound('INVITE_NOT_FOUND', 'Invite not found.');
  }
  return invite;
}

function assertOwnerMutationAllowed(actorRole: Role, target: UserRow, nextRole: Role) {
  if (target.role === 'owner' && actorRole !== 'owner') {
    throw forbidden('OWNER_ROLE_REQUIRED', 'Only the owner can modify the owner user.');
  }
  if (nextRole === 'owner' && actorRole !== 'owner') {
    throw forbidden('OWNER_ROLE_REQUIRED', 'Only the owner can assign the owner role.');
  }
}

function activeOwnerCount(db: Database.Database, accountId: number): number {
  return (db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE accountId = ? AND role = 'owner' AND disabledAt IS NULL")
    .get(accountId) as CountRow).count;
}

function activeUserWithEmail(db: Database.Database, accountId: number, email: string): { id: number } | undefined {
  return db
    .prepare('SELECT id FROM users WHERE accountId = ? AND LOWER(email) = LOWER(?) AND disabledAt IS NULL')
    .get(accountId, email) as { id: number } | undefined;
}

function activeInviteWithEmail(db: Database.Database, accountId: number, email: string, timestamp: string): { id: number } | undefined {
  return db
    .prepare(
      `SELECT id FROM user_invites
       WHERE accountId = ?
         AND LOWER(email) = LOWER(?)
         AND usedAt IS NULL
         AND revokedAt IS NULL
         AND expiresAt > ?
       ORDER BY createdAt DESC
       LIMIT 1`,
    )
    .get(accountId, email, timestamp) as { id: number } | undefined;
}

export function createUsersRouter({ db }: { db: Database.Database }) {
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
        .all(req.auth.accountId) as UserRow[];
      res.json({ data: rows.map(toUserResponse) });
    }),
  );

  router.get(
    '/invites',
    asyncHandler(async (req, res) => {
      const timestamp = nowIso();
      const rows = db
        .prepare(
          `SELECT *
           FROM user_invites
           WHERE accountId = ?
             AND usedAt IS NULL
             AND revokedAt IS NULL
             AND expiresAt > ?
           ORDER BY createdAt DESC`,
        )
        .all(req.auth.accountId, timestamp) as InviteRow[];
      res.json({ data: rows.map(toInviteResponse) });
    }),
  );

  router.post(
    '/invites',
    asyncHandler(async (req, res) => {
      const body = validateBody(createInviteSchema, req.body || {});
      await verifyFreshUnlockSecret(db, req.auth, body.currentUnlockSecret);
      const email = normalizeEmail(body.email);
      const timestamp = nowIso();
      if (activeUserWithEmail(db, req.auth.accountId, email)) {
        throw conflict('USER_EMAIL_EXISTS', 'A user with this email already exists.');
      }
      if (activeInviteWithEmail(db, req.auth.accountId, email, timestamp)) {
        throw conflict('INVITE_EXISTS', 'An active invite already exists for this email.');
      }

      const inviteCode = generateOneTimeSecret('GC-INV');
      const normalizedInviteCode = normalizeOneTimeSecret(inviteCode);
      const encryptionSalt = generateSalt();
      const kek = deriveKEK(normalizedInviteCode, encryptionSalt);
      const encryptedDEK = wrapDEK(req.auth.dek, kek);
      const inviteCodeHash = await bcrypt.hash(normalizedInviteCode, bcryptCost);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const invite = db.transaction(() => {
        const info = db
          .prepare(
            `INSERT INTO user_invites (
              accountId, email, displayName, role, inviteCodeHash, encryptionSalt,
              encryptedDEK, invitedByUserId, expiresAt, createdAt, updatedAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            req.auth.accountId,
            email,
            body.displayName,
            body.role,
            inviteCodeHash,
            encryptionSalt,
            encryptedDEK,
            req.auth.userId,
            expiresAt,
            timestamp,
            timestamp,
          );

        const created = loadInvite(db, req.auth.accountId, info.lastInsertRowid);
        insertAuditEvent(db, {
          accountId: req.auth.accountId,
          userId: req.auth.userId,
          requestId: req.requestId,
          entityType: 'auth',
          entityId: created.id,
          action: 'user.invite_create',
          metadata: {
            email,
            role: body.role,
            expiresAt,
          },
          timestamp,
        });
        return created;
      })();

      res.status(201).json(objectResponse({ ...toInviteResponse(invite), inviteCode }));
    }),
  );

  router.delete(
    '/invites/:inviteId',
    asyncHandler(async (req, res) => {
      const inviteId = parsePositiveInt(req.params.inviteId, null, { min: 1 });
      const before = loadInvite(db, req.auth.accountId, inviteId);
      if (before.usedAt || before.revokedAt) {
        res.json(objectResponse(toInviteResponse(before)));
        return;
      }

      const timestamp = nowIso();
      const after = db.transaction(() => {
        db.prepare('UPDATE user_invites SET revokedAt = ?, updatedAt = ? WHERE id = ? AND accountId = ?').run(
          timestamp,
          timestamp,
          inviteId,
          req.auth.accountId,
        );
        const updated = loadInvite(db, req.auth.accountId, inviteId);
        insertAuditEvent(db, {
          accountId: req.auth.accountId,
          userId: req.auth.userId,
          requestId: req.requestId,
          entityType: 'auth',
          entityId: updated.id,
          action: 'user.invite_revoke',
          metadata: {
            email: updated.email,
            role: updated.role,
          },
          timestamp,
        });
        return updated;
      })();

      res.json(objectResponse(toInviteResponse(after)));
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
