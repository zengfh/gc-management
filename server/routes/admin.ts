import { Router } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { insertAuditEvent } from '../audit/index.js';
import { requireUnlockedSession } from '../auth/requireAuth.js';
import { requireAdminRole } from '../auth/roles.js';
import { verifyFreshUnlockSecret } from '../auth/verifyUnlockSecret.js';
import { parseCredentialSummary } from '../cards/credentials.js';
import { asyncHandler, badRequest } from '../http/errors.js';
import { objectResponse } from '../http/response.js';
import {
  readDataPolicy,
  readSupportPolicy,
  updateDataPolicy,
  updateSupportPolicy,
} from '../settings/adminSettings.js';
import type { AuthContext } from '../types/express.js';

interface CountRow {
  count: number;
}

interface RetentionPolicy {
  auditRetentionDays: number;
  idempotencyRetentionDays: number;
  sessionRetentionDays: number;
  loginAttemptRetentionDays: number;
}

interface RetentionCounts {
  auditLog: number;
  idempotencyKeys: number;
  webSessions: number;
  loginAttempts: number;
}

interface SanitizedCardRow {
  id: number;
  accountId: number;
  dealId: number | null;
  brand: string;
  cardType: string;
  network: string | null;
  faceValueCents: number;
  remainingBalanceCents: number;
  purchaseCostCents: number;
  cardNumberLast4?: string | null;
  primaryCredentialLast4?: string | null;
  credentialProfile?: string | null;
  credentialSummaryJson?: string | null;
  cardNumber?: string | null;
  pin?: string | null;
  billingZip?: string | null;
  expirationDate: string | null;
  cardholderName: string | null;
  status: string;
  format: string | null;
  source: string | null;
  notes: string | null;
  keyVersion: number;
  reservedFor: string | null;
  reservedUntil: string | null;
  reservedNotes: string | null;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

interface SanitizedExportPayload {
  [key: string]: unknown;
  counts: {
    users: number;
    cards: number;
    deals: number;
    transactions: number;
    usages: number;
    referenceValues: number;
    auditEvents: number;
  };
}

const retentionDays = z.number().int().min(1).max(3650);

const supportPolicyUpdateSchema = z
  .object({
    unlockSecret: z.string().min(1),
    supportAccessEnabled: z.boolean(),
    supportContact: z.string().trim().max(200).default(''),
    supportPolicyUrl: z.string().trim().max(500).default(''),
    supportNotes: z.string().trim().max(1000).default(''),
  })
  .strict();

const dataPolicyUpdateSchema = z
  .object({
    unlockSecret: z.string().min(1),
    auditRetentionDays: retentionDays,
    idempotencyRetentionDays: retentionDays,
    sessionRetentionDays: retentionDays,
    loginAttemptRetentionDays: retentionDays,
  })
  .strict();

const retentionRunSchema = z
  .object({
    unlockSecret: z.string().min(1),
    dryRun: z.boolean().default(false),
    confirmation: z.string().optional(),
  })
  .strict()
  .superRefine((body, context) => {
    if (!body.dryRun && body.confirmation !== 'PURGE') {
      context.addIssue({
        code: 'custom',
        path: ['confirmation'],
        message: 'Type PURGE to confirm retention deletion.',
      });
    }
  });

const sanitizedExportSchema = z
  .object({
    unlockSecret: z.string().min(1),
    confirmation: z.literal('EXPORT'),
  })
  .strict();

const deleteInventorySchema = z
  .object({
    unlockSecret: z.string().min(1),
    confirmation: z.literal('DELETE_ACCOUNT_DATA'),
  })
  .strict();

function zodFieldErrors(error: z.ZodError) {
  return error.issues.map((issue: z.core.$ZodIssue) => ({
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

function cutoffIso(nowMs: number, days: number) {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

function cutoffMs(nowMs: number, days: number) {
  return nowMs - days * 24 * 60 * 60 * 1000;
}

function runCount(db: Database.Database, sql: string, params: unknown[]) {
  return (db.prepare(sql).get(...params) as CountRow).count;
}

function retentionCounts(
  db: Database.Database,
  accountId: number,
  policy: RetentionPolicy,
  nowMs: number,
): RetentionCounts {
  return {
    auditLog: runCount(
      db,
      'SELECT COUNT(*) AS count FROM audit_log WHERE accountId = ? AND timestamp < ?',
      [accountId, cutoffIso(nowMs, policy.auditRetentionDays)],
    ),
    idempotencyKeys: runCount(
      db,
      `SELECT COUNT(*) AS count
       FROM idempotency_keys
       WHERE accountId = ? AND (expiresAt < ? OR createdAt < ?)`,
      [
        accountId,
        new Date(nowMs).toISOString(),
        cutoffIso(nowMs, policy.idempotencyRetentionDays),
      ],
    ),
    webSessions: runCount(
      db,
      'SELECT COUNT(*) AS count FROM web_sessions WHERE expiresAt < ?',
      [cutoffMs(nowMs, policy.sessionRetentionDays)],
    ),
    loginAttempts: runCount(
      db,
      'SELECT COUNT(*) AS count FROM auth_login_attempts WHERE resetAt < ?',
      [cutoffMs(nowMs, policy.loginAttemptRetentionDays)],
    ),
  };
}

function purgeRetention(
  db: Database.Database,
  accountId: number,
  policy: RetentionPolicy,
  nowMs: number,
): RetentionCounts {
  return db.transaction(() => {
    const counts = retentionCounts(db, accountId, policy, nowMs);
    db.prepare('DELETE FROM audit_log WHERE accountId = ? AND timestamp < ?').run(
      accountId,
      cutoffIso(nowMs, policy.auditRetentionDays),
    );
    db.prepare(
      `DELETE FROM idempotency_keys
       WHERE accountId = ? AND (expiresAt < ? OR createdAt < ?)`,
    ).run(
      accountId,
      new Date(nowMs).toISOString(),
      cutoffIso(nowMs, policy.idempotencyRetentionDays),
    );
    db.prepare('DELETE FROM web_sessions WHERE expiresAt < ?').run(
      cutoffMs(nowMs, policy.sessionRetentionDays),
    );
    db.prepare('DELETE FROM auth_login_attempts WHERE resetAt < ?').run(
      cutoffMs(nowMs, policy.loginAttemptRetentionDays),
    );
    return counts;
  })();
}

function exportDate(timestamp: string) {
  return timestamp.slice(0, 10);
}

function selectRows<Row>(db: Database.Database, sql: string, params: unknown[]): Row[] {
  return db.prepare(sql).all(...params) as Row[];
}

function sanitizedCard(row: SanitizedCardRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    dealId: row.dealId,
    brand: row.brand,
    cardType: row.cardType,
    network: row.network,
    faceValueCents: row.faceValueCents,
    remainingBalanceCents: row.remainingBalanceCents,
    purchaseCostCents: row.purchaseCostCents,
    cardNumberLast4: row.cardNumberLast4 ?? row.primaryCredentialLast4,
    credentialProfile: row.credentialProfile,
    credentialSummary: parseCredentialSummary(row),
    expirationDate: row.expirationDate,
    cardholderName: row.cardholderName,
    status: row.status,
    format: row.format,
    source: row.source,
    notes: row.notes,
    keyVersion: row.keyVersion,
    reservedFor: row.reservedFor,
    reservedUntil: row.reservedUntil,
    reservedNotes: row.reservedNotes,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    rowVersion: row.rowVersion,
  };
}

function buildSanitizedExport(
  db: Database.Database,
  auth: AuthContext,
  exportedAt: string,
): SanitizedExportPayload {
  const accountRows = selectRows<Record<string, unknown>>(db, 'SELECT * FROM accounts WHERE id = ?', [auth.accountId]);
  const userRows = selectRows<Record<string, unknown>>(
    db,
    `SELECT id, accountId, email, displayName, role, keyVersion, disabledAt,
            lastLoginAt, createdAt, updatedAt
     FROM users
     WHERE accountId = ?
     ORDER BY id`,
    [auth.accountId],
  );
  const cardRows = selectRows<SanitizedCardRow>(db, 'SELECT * FROM cards WHERE accountId = ? ORDER BY id', [auth.accountId]);
  const dealRows = selectRows<Record<string, unknown>>(db, 'SELECT * FROM deals WHERE accountId = ? ORDER BY id', [auth.accountId]);
  const transactionRows = selectRows<Record<string, unknown>>(db, 'SELECT * FROM transactions WHERE accountId = ? ORDER BY id', [
    auth.accountId,
  ]);
  const usageRows = selectRows<Record<string, unknown>>(db, 'SELECT * FROM usages WHERE accountId = ? ORDER BY id', [auth.accountId]);
  const settingRows = selectRows<Record<string, unknown>>(db, 'SELECT * FROM app_settings WHERE accountId = ? ORDER BY id', [
    auth.accountId,
  ]);
  const referenceValueRows = selectRows<Record<string, unknown>>(db, 'SELECT * FROM reference_values WHERE accountId = ? ORDER BY id', [
    auth.accountId,
  ]);
  const importJobRows = selectRows<Record<string, unknown>>(db, 'SELECT * FROM import_jobs WHERE accountId = ? ORDER BY id', [
    auth.accountId,
  ]);
  const auditRows = selectRows<Record<string, unknown>>(db, 'SELECT * FROM audit_log WHERE accountId = ? ORDER BY id', [auth.accountId]);

  return {
    schemaVersion: 1,
    exportType: 'sanitized_account_json',
    exportedAt,
    warning:
      'This export omits card numbers, PINs, billing ZIPs, unlock-secret hashes, encrypted key material, and blind indexes.',
    accounts: accountRows,
    users: userRows,
    appSettings: settingRows,
    deals: dealRows,
    cards: cardRows.map(sanitizedCard),
    transactions: transactionRows,
    usages: usageRows,
    referenceValues: referenceValueRows,
    importJobs: importJobRows,
    auditLog: auditRows,
    counts: {
      users: userRows.length,
      cards: cardRows.length,
      deals: dealRows.length,
      transactions: transactionRows.length,
      usages: usageRows.length,
      referenceValues: referenceValueRows.length,
      auditEvents: auditRows.length,
    },
  };
}

function deleteInventoryData(db: Database.Database, auth: AuthContext, timestamp: string, requestId: string) {
  return db.transaction(() => {
    const counts = {
      usages: db.prepare('DELETE FROM usages WHERE accountId = ?').run(auth.accountId).changes,
      transactions: db.prepare('DELETE FROM transactions WHERE accountId = ?').run(auth.accountId).changes,
      cards: db.prepare('DELETE FROM cards WHERE accountId = ?').run(auth.accountId).changes,
      deals: db.prepare('DELETE FROM deals WHERE accountId = ?').run(auth.accountId).changes,
      referenceValues: db.prepare('DELETE FROM reference_values WHERE accountId = ?').run(auth.accountId).changes,
      importJobs: db.prepare('DELETE FROM import_jobs WHERE accountId = ?').run(auth.accountId).changes,
      idempotencyKeys: db.prepare('DELETE FROM idempotency_keys WHERE accountId = ?').run(auth.accountId).changes,
    };

    insertAuditEvent(db, {
      accountId: auth.accountId,
      userId: auth.userId,
      requestId,
      entityType: 'system',
      action: 'data.inventory_delete',
      metadata: counts,
      timestamp,
    });

    return counts;
  })();
}

export function createAdminRouter({ db }: { db: Database.Database }) {
  const router = Router();

  router.use(requireUnlockedSession);
  router.use(requireAdminRole);

  router.get('/support-policy', (req, res) => {
    res.json(objectResponse(readSupportPolicy(db, req.auth.accountId)));
  });

  router.put(
    '/support-policy',
    asyncHandler(async (req, res) => {
      const body = validateBody(supportPolicyUpdateSchema, req.body || {});
      await verifyFreshUnlockSecret(db, req.auth, body.unlockSecret);
      const timestamp = new Date().toISOString();
      updateSupportPolicy(db, req.auth.accountId, req.auth.userId, body, timestamp);

      insertAuditEvent(db, {
        accountId: req.auth.accountId,
        userId: req.auth.userId,
        requestId: req.requestId,
        entityType: 'system',
        action: 'support.policy_update',
        metadata: {
          supportAccessEnabled: body.supportAccessEnabled,
          supportContactSet: Boolean(body.supportContact),
          supportPolicyUrlSet: Boolean(body.supportPolicyUrl),
          supportNotesLength: body.supportNotes.length,
        },
        timestamp,
      });

      res.json(objectResponse(readSupportPolicy(db, req.auth.accountId)));
    }),
  );

  router.get('/data-policy', (req, res) => {
    res.json(objectResponse(readDataPolicy(db, req.auth.accountId)));
  });

  router.put(
    '/data-policy',
    asyncHandler(async (req, res) => {
      const body = validateBody(dataPolicyUpdateSchema, req.body || {});
      await verifyFreshUnlockSecret(db, req.auth, body.unlockSecret);
      const timestamp = new Date().toISOString();
      updateDataPolicy(db, req.auth.accountId, body, timestamp);

      insertAuditEvent(db, {
        accountId: req.auth.accountId,
        userId: req.auth.userId,
        requestId: req.requestId,
        entityType: 'system',
        action: 'data.policy_update',
        metadata: {
          auditRetentionDays: body.auditRetentionDays,
          idempotencyRetentionDays: body.idempotencyRetentionDays,
          sessionRetentionDays: body.sessionRetentionDays,
          loginAttemptRetentionDays: body.loginAttemptRetentionDays,
        },
        timestamp,
      });

      res.json(objectResponse(readDataPolicy(db, req.auth.accountId)));
    }),
  );

  router.post(
    '/retention/run',
    asyncHandler(async (req, res) => {
      const body = validateBody(retentionRunSchema, req.body || {});
      await verifyFreshUnlockSecret(db, req.auth, body.unlockSecret);
      const timestamp = new Date().toISOString();
      const nowMs = Date.parse(timestamp);
      const policy = readDataPolicy(db, req.auth.accountId);
      const counts = body.dryRun
        ? retentionCounts(db, req.auth.accountId, policy, nowMs)
        : purgeRetention(db, req.auth.accountId, policy, nowMs);

      if (!body.dryRun) {
        insertAuditEvent(db, {
          accountId: req.auth.accountId,
          userId: req.auth.userId,
          requestId: req.requestId,
          entityType: 'system',
          action: 'data.retention_run',
          metadata: counts,
          timestamp,
        });
      }

      res.json(objectResponse({ dryRun: body.dryRun, counts }));
    }),
  );

  router.post(
    '/data-export',
    asyncHandler(async (req, res) => {
      const body = validateBody(sanitizedExportSchema, req.body || {});
      await verifyFreshUnlockSecret(db, req.auth, body.unlockSecret);
      const timestamp = new Date().toISOString();
      const payload = buildSanitizedExport(db, req.auth, timestamp);

      insertAuditEvent(db, {
        accountId: req.auth.accountId,
        userId: req.auth.userId,
        requestId: req.requestId,
        entityType: 'system',
        action: 'data.export_sanitized',
        metadata: payload.counts,
        timestamp,
      });

      res.set({
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        'Content-Disposition': `attachment; filename="gift-card-sanitized-export-${exportDate(timestamp)}.json"`,
      });
      res.json(objectResponse(payload));
    }),
  );

  router.post(
    '/data-delete',
    asyncHandler(async (req, res) => {
      const body = validateBody(deleteInventorySchema, req.body || {});
      await verifyFreshUnlockSecret(db, req.auth, body.unlockSecret);
      const timestamp = new Date().toISOString();
      const counts = deleteInventoryData(db, req.auth, timestamp, req.requestId);

      res.json(objectResponse({ deleted: true, counts }));
    }),
  );

  return router;
}
