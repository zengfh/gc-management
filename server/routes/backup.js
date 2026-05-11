import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { insertAuditEvent } from '../audit/index.js';
import { requireUnlockedSession } from '../auth/requireAuth.js';
import { asyncHandler, badRequest, unauthorized } from '../http/errors.js';
import { objectResponse } from '../http/response.js';
import { decryptString } from '../security/crypto.js';

const plaintextExportSchema = z
  .object({
    unlockSecret: z.string().min(1),
    confirmation: z.literal('EXPORT'),
    acknowledgePlaintext: z.literal(true),
  })
  .strict();

const rawDatabaseExportSchema = z
  .object({
    unlockSecret: z.string().min(1),
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

function exportDate(timestamp) {
  return timestamp.slice(0, 10);
}

function loadPrimaryUser(db, userId, accountId) {
  return db
    .prepare(
      `SELECT id, accountId, unlockSecretHash
       FROM users
       WHERE id = ? AND accountId = ?`,
    )
    .get(userId, accountId);
}

async function verifyFreshUnlockSecret(db, auth, unlockSecret) {
  const user = loadPrimaryUser(db, auth.userId, auth.accountId);
  const passwordMatches = await bcrypt.compare(unlockSecret, user?.unlockSecretHash || '');
  if (!passwordMatches) {
    throw unauthorized('INVALID_UNLOCK_SECRET', 'Invalid unlock secret.');
  }
}

function decryptNullable(value, key) {
  return value ? decryptString(value, key) : null;
}

function toExportDeal(row) {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    source: row.source,
    purchaseDate: row.purchaseDate,
    inputTotalCostCents: row.inputTotalCostCents,
    notes: row.notes,
    archivedAt: row.archivedAt,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    rowVersion: row.rowVersion,
  };
}

function toExportCard(row, key) {
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
    cardNumber: decryptNullable(row.cardNumber, key),
    cardNumberLast4: row.cardNumberLast4,
    pin: decryptNullable(row.pin, key),
    billingZip: decryptNullable(row.billingZip, key),
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

function toExportTransaction(row) {
  return {
    id: row.id,
    accountId: row.accountId,
    cardId: row.cardId,
    type: row.type,
    buyerName: row.buyerName,
    buyerType: row.buyerType,
    salePriceCents: row.salePriceCents,
    feesCents: row.feesCents,
    netProceedsCents: row.netProceedsCents,
    remainingBalanceAtSaleCents: row.remainingBalanceAtSaleCents,
    statusAtSale: row.statusAtSale,
    platform: row.platform,
    reason: row.reason,
    transactionDate: row.transactionDate,
    notes: row.notes,
    idempotencyKey: row.idempotencyKey,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  };
}

function toExportUsage(row) {
  return {
    id: row.id,
    accountId: row.accountId,
    cardId: row.cardId,
    amountCents: row.amountCents,
    merchant: row.merchant,
    description: row.description,
    isReversed: Boolean(row.isReversed),
    isWriteOff: Boolean(row.isWriteOff),
    reversalReason: row.reversalReason,
    reversedAt: row.reversedAt,
    usageDate: row.usageDate,
    idempotencyKey: row.idempotencyKey,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  };
}

function toExportSetting(row) {
  return {
    id: row.id,
    accountId: row.accountId,
    key: row.key,
    value: row.value,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildPlaintextExport(db, auth, exportedAt) {
  const dealRows = db
    .prepare('SELECT * FROM deals WHERE accountId = ? ORDER BY id')
    .all(auth.accountId);
  const cardRows = db
    .prepare('SELECT * FROM cards WHERE accountId = ? ORDER BY id')
    .all(auth.accountId);
  const transactionRows = db
    .prepare('SELECT * FROM transactions WHERE accountId = ? ORDER BY id')
    .all(auth.accountId);
  const usageRows = db
    .prepare('SELECT * FROM usages WHERE accountId = ? ORDER BY id')
    .all(auth.accountId);
  const settingRows = db
    .prepare('SELECT * FROM app_settings WHERE accountId = ? ORDER BY id')
    .all(auth.accountId);

  return {
    schemaVersion: 1,
    exportType: 'plaintext_json',
    exportedAt,
    warning:
      'This plaintext export contains spendable credentials. Store it carefully and delete it when no longer needed.',
    appSettings: settingRows.map(toExportSetting),
    deals: dealRows.map(toExportDeal),
    cards: cardRows.map((row) => toExportCard(row, auth.dek)),
    transactions: transactionRows.map(toExportTransaction),
    usages: usageRows.map(toExportUsage),
  };
}

export function createBackupRouter({ db }) {
  const router = Router();

  router.use(requireUnlockedSession);

  router.post(
    '/export',
    asyncHandler(async (req, res) => {
      const body = validateBody(plaintextExportSchema, req.body || {});
      await verifyFreshUnlockSecret(db, req.auth, body.unlockSecret);

      const timestamp = new Date().toISOString();
      const payload = buildPlaintextExport(db, req.auth, timestamp);
      insertAuditEvent(db, {
        accountId: req.auth.accountId,
        userId: req.auth.userId,
        requestId: req.requestId,
        entityType: 'backup',
        action: 'backup.export_plaintext',
        metadata: {
          exportType: 'plaintext_json',
          dealCount: payload.deals.length,
          cardCount: payload.cards.length,
          transactionCount: payload.transactions.length,
          usageCount: payload.usages.length,
        },
        timestamp,
      });

      res.set({
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        'Content-Disposition': `attachment; filename="gift-card-plaintext-export-${exportDate(timestamp)}.json"`,
      });
      res.json(objectResponse(payload));
    }),
  );

  router.post(
    '/db-file',
    asyncHandler(async (req, res, next) => {
      const body = validateBody(rawDatabaseExportSchema, req.body || {});
      await verifyFreshUnlockSecret(db, req.auth, body.unlockSecret);

      const timestamp = new Date().toISOString();
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-raw-db-export-'));
      const filename = `gift-card-raw-db-export-${exportDate(timestamp)}.sqlite`;
      const exportPath = path.join(tempDir, filename);

      await db.backup(exportPath);
      insertAuditEvent(db, {
        accountId: req.auth.accountId,
        userId: req.auth.userId,
        requestId: req.requestId,
        entityType: 'backup',
        action: 'backup.export_db_file',
        metadata: {
          exportType: 'raw_sqlite',
        },
        timestamp,
      });

      res.set({
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        'Content-Type': 'application/vnd.sqlite3',
      });
      res.download(exportPath, filename, (error) => {
        fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        if (error) {
          next(error);
        }
      });
    }),
  );

  return router;
}
