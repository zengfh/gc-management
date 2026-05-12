import { Router } from 'express';
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

function cutoffIso(nowMs, days) {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

function cutoffMs(nowMs, days) {
  return nowMs - days * 24 * 60 * 60 * 1000;
}

function runCount(db, sql, params) {
  return db.prepare(sql).get(...params).count;
}

function retentionCounts(db, accountId, policy, nowMs) {
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

function purgeRetention(db, accountId, policy, nowMs) {
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

function exportDate(timestamp) {
  return timestamp.slice(0, 10);
}

function selectRows(db, sql, params) {
  return db.prepare(sql).all(...params);
}

function sanitizedCard(row) {
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

function buildSanitizedExport(db, auth, exportedAt) {
  const accountRows = selectRows(db, 'SELECT * FROM accounts WHERE id = ?', [auth.accountId]);
  const userRows = selectRows(
    db,
    `SELECT id, accountId, email, displayName, role, keyVersion, disabledAt,
            lastLoginAt, createdAt, updatedAt
     FROM users
     WHERE accountId = ?
     ORDER BY id`,
    [auth.accountId],
  );
  const cardRows = selectRows(db, 'SELECT * FROM cards WHERE accountId = ? ORDER BY id', [auth.accountId]);
  const dealRows = selectRows(db, 'SELECT * FROM deals WHERE accountId = ? ORDER BY id', [auth.accountId]);
  const transactionRows = selectRows(db, 'SELECT * FROM transactions WHERE accountId = ? ORDER BY id', [
    auth.accountId,
  ]);
  const usageRows = selectRows(db, 'SELECT * FROM usages WHERE accountId = ? ORDER BY id', [auth.accountId]);
  const settingRows = selectRows(db, 'SELECT * FROM app_settings WHERE accountId = ? ORDER BY id', [
    auth.accountId,
  ]);
  const referenceValueRows = selectRows(db, 'SELECT * FROM reference_values WHERE accountId = ? ORDER BY id', [
    auth.accountId,
  ]);
  const importJobRows = selectRows(db, 'SELECT * FROM import_jobs WHERE accountId = ? ORDER BY id', [
    auth.accountId,
  ]);
  const auditRows = selectRows(db, 'SELECT * FROM audit_log WHERE accountId = ? ORDER BY id', [auth.accountId]);

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

function deleteInventoryData(db, auth, timestamp, requestId) {
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

export function createAdminRouter({ db }) {
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
