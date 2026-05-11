import { Router } from 'express';
import { z } from 'zod';
import { insertAuditEvent } from '../audit/index.js';
import { requireUnlockedSession } from '../auth/requireAuth.js';
import { transitionFor } from '../cards/stateMachine.js';
import { asyncHandler, badRequest, conflict, notFound } from '../http/errors.js';
import { objectResponse } from '../http/response.js';
import {
  cardNumberHash as hashCardNumber,
  cardNumberLast4,
  encryptString,
  normalizeCardNumber,
} from '../security/crypto.js';

const activeStatuses = new Set(['available', 'reserved', 'in_use']);
const cardInputSchema = z
  .object({
    dealId: z.number().int().positive().nullable().optional(),
    brand: z.string().trim().min(1).max(120),
    cardType: z.enum(['merchant', 'prepaid']),
    network: z.enum(['visa', 'mastercard', 'amex', 'discover', 'other']).nullable().optional(),
    faceValueCents: z.number().int().positive(),
    purchaseCostCents: z.number().int().nonnegative().default(0),
    cardNumber: z.string().trim().nullable().optional(),
    pin: z.string().trim().nullable().optional(),
    billingZip: z.string().trim().nullable().optional(),
    expirationDate: z.string().trim().nullable().optional(),
    format: z.enum(['digital', 'physical']).nullable().optional(),
    source: z.string().trim().nullable().optional(),
    notes: z.string().trim().nullable().optional(),
  })
  .strict();

const createCardsSchema = z
  .object({
    cards: z.array(cardInputSchema).min(1).max(100),
  })
  .strict();

const reserveCardSchema = z
  .object({
    reservedFor: z.string().trim().nullable().optional(),
    reservedUntil: z.string().trim().nullable().optional(),
    reservedNotes: z.string().trim().nullable().optional(),
  })
  .strict();

const updateCardSchema = z
  .object({
    rowVersion: z.number().int().positive().optional(),
    brand: z.string().trim().min(1).max(120).optional(),
    expirationDate: z.string().trim().nullable().optional(),
    notes: z.string().trim().nullable().optional(),
  })
  .strict();

const sellCardSchema = z
  .object({
    salePriceCents: z.number().int().nonnegative(),
    buyerName: z.string().trim().nullable().optional(),
    buyerType: z.enum(['dealer', 'group_chat', 'friend', 'self', 'other']).nullable().optional(),
    platform: z.string().trim().nullable().optional(),
    transactionDate: z.string().trim().nullable().optional(),
    notes: z.string().trim().nullable().optional(),
  })
  .strict();

const terminalStatuses = new Set(['sold', 'used_up', 'void']);

const undoSaleSchema = z
  .object({
    reason: z.string().trim().min(1),
  })
  .strict();

const useCardSchema = z
  .object({
    amountCents: z.number().int().positive(),
    merchant: z.string().trim().nullable().optional(),
    description: z.string().trim().nullable().optional(),
    usageDate: z.string().trim().nullable().optional(),
  })
  .strict();

const undoUsageSchema = z
  .object({
    usageId: z.number().int().positive(),
    reason: z.string().trim().min(1),
  })
  .strict();

const voidCardSchema = z
  .object({
    reason: z.string().trim().nullable().optional(),
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

function encryptedOrNull(value, key) {
  return value ? encryptString(value, key) : null;
}

function buildCardCredentialFields(input, auth) {
  const normalizedCardNumber = normalizeCardNumber(input.cardNumber);
  return {
    encryptedCardNumber: normalizedCardNumber ? encryptString(normalizedCardNumber, auth.dek) : null,
    cardNumberHash: normalizedCardNumber ? hashCardNumber(normalizedCardNumber, auth.blindIndexKey) : null,
    cardNumberLast4: normalizedCardNumber ? cardNumberLast4(normalizedCardNumber) : null,
    pin: encryptedOrNull(input.pin, auth.dek),
    billingZip: encryptedOrNull(input.billingZip, auth.dek),
  };
}

function toCardResponse(row) {
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
    cardNumberLast4: row.cardNumberLast4,
    expirationDate: row.expirationDate,
    status: row.status,
    format: row.format,
    source: row.source,
    notes: row.notes,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAuditResponse(row) {
  return {
    id: row.id,
    accountId: row.accountId,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    timestamp: row.timestamp,
  };
}

function pageResponse(data, { limit, offset, total }) {
  return {
    data,
    page: {
      limit,
      offset,
      total,
      hasMore: offset + data.length < total,
    },
  };
}

function createCardAuditValue(card) {
  return {
    brand: card.brand,
    cardType: card.cardType,
    faceValueCents: card.faceValueCents,
    purchaseCostCents: card.purchaseCostCents,
    cardNumberLast4: card.cardNumberLast4,
    status: card.status,
  };
}

function mutationAuditValue(card) {
  return {
    brand: card.brand,
    status: card.status,
    remainingBalanceCents: card.remainingBalanceCents,
    rowVersion: card.rowVersion,
  };
}

function assertNoDuplicateInputs(cards) {
  const seen = new Set();
  for (const card of cards) {
    if (!card.cardNumberHash) {
      continue;
    }

    const key = `${card.brand}\0${card.cardNumberHash}`;
    if (seen.has(key)) {
      throw conflict('DUPLICATE_ACTIVE_CARD', 'Active duplicate card number for this brand already exists.');
    }
    seen.add(key);
  }
}

function translateSqliteError(error) {
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.message?.includes('idx_cards_active_dedupe')) {
    return conflict('DUPLICATE_ACTIVE_CARD', 'Active duplicate card number for this brand already exists.');
  }

  if (error.code?.startsWith('SQLITE_CONSTRAINT')) {
    return badRequest('VALIDATION_FAILED', 'Request validation failed.');
  }

  return error;
}

export function createCardsRouter({ db }) {
  const router = Router();

  router.use(requireUnlockedSession);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const limit = parsePositiveInt(req.query.limit, 50, { min: 1, max: 100 });
      const offset = parsePositiveInt(req.query.offset, 0, { min: 0 });
      const where = ['accountId = ?'];
      const params = [req.auth.accountId];

      if (req.query.status) {
        if (!activeStatuses.has(req.query.status) && !['sold', 'used_up', 'void'].includes(req.query.status)) {
          throw badRequest('VALIDATION_FAILED', 'Request validation failed.', [
            {
              field: 'status',
              code: 'invalid_enum',
              message: 'Unsupported card status.',
            },
          ]);
        }
        where.push('status = ?');
        params.push(req.query.status);
      }

      if (req.query.brand) {
        where.push('brand = ?');
        params.push(String(req.query.brand).trim());
      }

      if (req.query.cardNumber) {
        const normalizedCardNumber = normalizeCardNumber(req.query.cardNumber);
        if (!normalizedCardNumber) {
          throw badRequest('VALIDATION_FAILED', 'Request validation failed.', [
            {
              field: 'cardNumber',
              code: 'invalid_card_number',
              message: 'Card number search requires digits.',
            },
          ]);
        }
        where.push('cardNumberHash = ?');
        params.push(hashCardNumber(normalizedCardNumber, req.auth.blindIndexKey));
      }

      const whereClause = where.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS count FROM cards WHERE ${whereClause}`).get(...params).count;
      const rows = db
        .prepare(`SELECT * FROM cards WHERE ${whereClause} ORDER BY updatedAt DESC, id DESC LIMIT ? OFFSET ?`)
        .all(...params, limit, offset);

      res.json(pageResponse(rows.map(toCardResponse), { limit, offset, total }));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const { cards } = validateBody(createCardsSchema, req.body);
      const timestamp = nowIso();
      const preparedCards = cards.map((card) => ({
        ...card,
        ...buildCardCredentialFields(card, req.auth),
        status: 'available',
      }));
      assertNoDuplicateInputs(preparedCards);

      try {
        const createCards = db.transaction(() => {
          return preparedCards.map((card) => {
            const info = db
              .prepare(
                `INSERT INTO cards (
                  accountId, dealId, brand, cardType, network, faceValueCents,
                  remainingBalanceCents, purchaseCostCents, cardNumber,
                  cardNumberHash, cardNumberLast4, pin, billingZip,
                  expirationDate, status, format, source, notes, createdByUserId,
                  updatedByUserId, createdAt, updatedAt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                req.auth.accountId,
                card.dealId ?? null,
                card.brand,
                card.cardType,
                card.network ?? null,
                card.faceValueCents,
                card.faceValueCents,
                card.purchaseCostCents,
                card.encryptedCardNumber,
                card.cardNumberHash,
                card.cardNumberLast4,
                card.pin,
                card.billingZip,
                card.expirationDate ?? null,
                card.status,
                card.format ?? null,
                card.source ?? null,
                card.notes ?? null,
                req.auth.userId,
                req.auth.userId,
                timestamp,
                timestamp,
              );

            const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(info.lastInsertRowid);
            insertAuditEvent(db, {
              accountId: req.auth.accountId,
              userId: req.auth.userId,
              requestId: req.requestId,
              entityType: 'card',
              entityId: row.id,
              action: 'card.create',
              newValue: createCardAuditValue(row),
              timestamp,
            });
            return row;
          });
        });

        const created = createCards();
        res
          .status(201)
          .json(pageResponse(created.map(toCardResponse), { limit: created.length, offset: 0, total: created.length }));
      } catch (error) {
        throw translateSqliteError(error);
      }
    }),
  );

  function loadCard(auth, cardId) {
    const card = db
      .prepare('SELECT * FROM cards WHERE accountId = ? AND id = ?')
      .get(auth.accountId, cardId);

    if (!card) {
      throw notFound('CARD_NOT_FOUND', 'Card not found.');
    }

    return card;
  }

  function cardDetail(auth, cardId) {
    const card = loadCard(auth, cardId);
    const transactions = db
      .prepare('SELECT * FROM transactions WHERE accountId = ? AND cardId = ? ORDER BY createdAt DESC, id DESC')
      .all(auth.accountId, cardId);
    const usages = db
      .prepare('SELECT * FROM usages WHERE accountId = ? AND cardId = ? ORDER BY createdAt DESC, id DESC')
      .all(auth.accountId, cardId);
    const audit = db
      .prepare(
        `SELECT id, accountId, entityType, entityId, action, timestamp
         FROM audit_log
         WHERE accountId = ? AND entityType = 'card' AND entityId = ?
         ORDER BY timestamp DESC, id DESC`,
      )
      .all(auth.accountId, cardId);

    return {
      card: toCardResponse(card),
      transactions,
      usages,
      audit: audit.map(toAuditResponse),
    };
  }

  function mutateCardStatus({ req, cardId, transitionAction, body = {} }) {
    const timestamp = nowIso();

    return db.transaction(() => {
      const before = loadCard(req.auth, cardId);
      const transition = transitionFor(transitionAction, before.status);

      db.prepare(
        `UPDATE cards
         SET status = ?,
             reservedFor = ?,
             reservedUntil = ?,
             reservedNotes = ?,
             updatedByUserId = ?,
             updatedAt = ?,
             rowVersion = rowVersion + 1
         WHERE id = ? AND accountId = ?`,
      ).run(
        transition.status,
        transitionAction === 'reserve' ? body.reservedFor ?? null : null,
        transitionAction === 'reserve' ? body.reservedUntil ?? null : null,
        transitionAction === 'reserve' ? body.reservedNotes ?? null : null,
        req.auth.userId,
        timestamp,
        cardId,
        req.auth.accountId,
      );

      const after = loadCard(req.auth, cardId);
      insertAuditEvent(db, {
        accountId: req.auth.accountId,
        userId: req.auth.userId,
        requestId: req.requestId,
        entityType: 'card',
        entityId: cardId,
        action: transition.action,
        oldValue: mutationAuditValue(before),
        newValue: mutationAuditValue(after),
        timestamp,
      });

      return after;
    })();
  }

  router.put(
    '/:cardId',
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const body = validateBody(updateCardSchema, req.body || {});
      const timestamp = nowIso();
      const updateFields = Object.keys(body).filter((field) => field !== 'rowVersion');

      if (updateFields.length === 0) {
        throw badRequest('NO_CHANGES', 'At least one card field must be changed.');
      }

      try {
        const updated = db.transaction(() => {
          const before = loadCard(req.auth, cardId);

          if (body.rowVersion && body.rowVersion !== before.rowVersion) {
            throw conflict('STALE_CARD_VERSION', 'Card has changed since it was loaded.');
          }

          if (terminalStatuses.has(before.status) && updateFields.some((field) => field !== 'notes')) {
            throw conflict('TERMINAL_CARD_EDIT_RESTRICTED', 'Terminal cards only allow notes edits.');
          }

          const next = {
            brand: body.brand ?? before.brand,
            expirationDate: body.expirationDate === undefined ? before.expirationDate : body.expirationDate,
            notes: body.notes === undefined ? before.notes : body.notes,
          };

          db.prepare(
            `UPDATE cards
             SET brand = ?,
                 expirationDate = ?,
                 notes = ?,
                 updatedByUserId = ?,
                 updatedAt = ?,
                 rowVersion = rowVersion + 1
             WHERE id = ? AND accountId = ?`,
          ).run(
            next.brand,
            next.expirationDate,
            next.notes,
            req.auth.userId,
            timestamp,
            cardId,
            req.auth.accountId,
          );

          const after = loadCard(req.auth, cardId);
          insertAuditEvent(db, {
            accountId: req.auth.accountId,
            userId: req.auth.userId,
            requestId: req.requestId,
            entityType: 'card',
            entityId: cardId,
            action: 'card.update',
            oldValue: mutationAuditValue(before),
            newValue: mutationAuditValue(after),
            timestamp,
          });

          return after;
        })();

        res.json(objectResponse(toCardResponse(updated)));
      } catch (error) {
        throw translateSqliteError(error);
      }
    }),
  );

  router.delete(
    '/:cardId',
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const timestamp = nowIso();

      db.transaction(() => {
        const card = loadCard(req.auth, cardId);
        const activity = db
          .prepare(
            `SELECT
              (SELECT COUNT(*) FROM transactions WHERE accountId = ? AND cardId = ?) AS transactionCount,
              (SELECT COUNT(*) FROM usages WHERE accountId = ? AND cardId = ?) AS usageCount`,
          )
          .get(req.auth.accountId, cardId, req.auth.accountId, cardId);

        if (card.status !== 'available' || activity.transactionCount > 0 || activity.usageCount > 0) {
          throw conflict('CARD_DELETE_RESTRICTED', 'Only never-touched available cards can be deleted.');
        }

        insertAuditEvent(db, {
          accountId: req.auth.accountId,
          userId: req.auth.userId,
          requestId: req.requestId,
          entityType: 'card',
          entityId: cardId,
          action: 'card.delete',
          oldValue: createCardAuditValue(card),
          timestamp,
        });

        db.prepare('DELETE FROM cards WHERE id = ? AND accountId = ?').run(cardId, req.auth.accountId);
      })();

      res.status(204).send();
    }),
  );

  router.post(
    '/:cardId/reserve',
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const body = validateBody(reserveCardSchema, req.body || {});
      const card = mutateCardStatus({
        req,
        cardId,
        transitionAction: 'reserve',
        body,
      });

      res.json(objectResponse(toCardResponse(card)));
    }),
  );

  router.post(
    '/:cardId/unreserve',
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const card = mutateCardStatus({
        req,
        cardId,
        transitionAction: 'unreserve',
      });

      res.json(objectResponse(toCardResponse(card)));
    }),
  );

  router.post(
    '/:cardId/sell',
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const body = validateBody(sellCardSchema, req.body);
      const timestamp = nowIso();

      db.transaction(() => {
        const before = loadCard(req.auth, cardId);
        const transition = transitionFor('sell', before.status);

        db.prepare(
          `INSERT INTO transactions (
            accountId, cardId, type, buyerName, buyerType, salePriceCents,
            remainingBalanceAtSaleCents, statusAtSale, platform, transactionDate,
            notes, idempotencyKey, createdByUserId, createdAt
          ) VALUES (?, ?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          req.auth.accountId,
          cardId,
          body.buyerName ?? null,
          body.buyerType ?? null,
          body.salePriceCents,
          before.remainingBalanceCents,
          before.status,
          body.platform ?? null,
          body.transactionDate ?? timestamp.slice(0, 10),
          body.notes ?? null,
          req.get('Idempotency-Key') ?? null,
          req.auth.userId,
          timestamp,
        );

        db.prepare(
          `UPDATE cards
           SET status = ?,
               remainingBalanceCents = 0,
               updatedByUserId = ?,
               updatedAt = ?,
               rowVersion = rowVersion + 1
           WHERE id = ? AND accountId = ?`,
        ).run(transition.status, req.auth.userId, timestamp, cardId, req.auth.accountId);

        const after = loadCard(req.auth, cardId);
        insertAuditEvent(db, {
          accountId: req.auth.accountId,
          userId: req.auth.userId,
          requestId: req.requestId,
          entityType: 'card',
          entityId: cardId,
          action: transition.action,
          oldValue: mutationAuditValue(before),
          newValue: mutationAuditValue(after),
          metadata: {
            salePriceCents: body.salePriceCents,
          },
          timestamp,
        });
      })();

      res.json(objectResponse(cardDetail(req.auth, cardId)));
    }),
  );

  router.post(
    '/:cardId/undo-sale',
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const body = validateBody(undoSaleSchema, req.body);
      const timestamp = nowIso();

      db.transaction(() => {
        const before = loadCard(req.auth, cardId);
        const transition = transitionFor('undo-sale', before.status);
        const sale = db
          .prepare(
            `SELECT *
             FROM transactions
             WHERE accountId = ? AND cardId = ? AND type = 'sale'
             ORDER BY id DESC
             LIMIT 1`,
          )
          .get(req.auth.accountId, cardId);

        if (!sale) {
          throw conflict('SALE_NOT_FOUND', 'No sale transaction is available to undo.');
        }

        const laterReversal = db
          .prepare(
            `SELECT id
             FROM transactions
             WHERE accountId = ? AND cardId = ? AND type = 'sale_reversal' AND id > ?
             LIMIT 1`,
          )
          .get(req.auth.accountId, cardId, sale.id);
        if (laterReversal) {
          throw conflict('SALE_ALREADY_REVERSED', 'Sale has already been reversed.');
        }

        db.prepare(
          `INSERT INTO transactions (
            accountId, cardId, type, remainingBalanceAtSaleCents, statusAtSale,
            reason, idempotencyKey, createdByUserId, createdAt
          ) VALUES (?, ?, 'sale_reversal', ?, ?, ?, ?, ?, ?)`,
        ).run(
          req.auth.accountId,
          cardId,
          sale.remainingBalanceAtSaleCents,
          sale.statusAtSale,
          body.reason,
          req.get('Idempotency-Key') ?? null,
          req.auth.userId,
          timestamp,
        );

        db.prepare(
          `UPDATE cards
           SET status = ?,
               remainingBalanceCents = ?,
               updatedByUserId = ?,
               updatedAt = ?,
               rowVersion = rowVersion + 1
           WHERE id = ? AND accountId = ?`,
        ).run(
          sale.statusAtSale,
          sale.remainingBalanceAtSaleCents,
          req.auth.userId,
          timestamp,
          cardId,
          req.auth.accountId,
        );

        const after = loadCard(req.auth, cardId);
        insertAuditEvent(db, {
          accountId: req.auth.accountId,
          userId: req.auth.userId,
          requestId: req.requestId,
          entityType: 'card',
          entityId: cardId,
          action: transition.action,
          oldValue: mutationAuditValue(before),
          newValue: mutationAuditValue(after),
          metadata: {
            reason: body.reason,
          },
          timestamp,
        });
      })();

      res.json(objectResponse(cardDetail(req.auth, cardId)));
    }),
  );

  router.post(
    '/:cardId/use',
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const body = validateBody(useCardSchema, req.body);
      const timestamp = nowIso();

      db.transaction(() => {
        const before = loadCard(req.auth, cardId);
        const transition = transitionFor('use', before.status);

        if (body.amountCents > before.remainingBalanceCents) {
          throw conflict('INSUFFICIENT_BALANCE', 'Usage amount exceeds remaining card balance.');
        }

        const remainingBalanceCents = before.remainingBalanceCents - body.amountCents;
        const nextStatus = remainingBalanceCents === 0 ? 'used_up' : 'in_use';

        db.prepare(
          `INSERT INTO usages (
            accountId, cardId, amountCents, merchant, description, usageDate,
            idempotencyKey, createdByUserId, createdAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          req.auth.accountId,
          cardId,
          body.amountCents,
          body.merchant ?? null,
          body.description ?? null,
          body.usageDate ?? timestamp.slice(0, 10),
          req.get('Idempotency-Key') ?? null,
          req.auth.userId,
          timestamp,
        );

        db.prepare(
          `UPDATE cards
           SET status = ?,
               remainingBalanceCents = ?,
               updatedByUserId = ?,
               updatedAt = ?,
               rowVersion = rowVersion + 1
           WHERE id = ? AND accountId = ?`,
        ).run(nextStatus, remainingBalanceCents, req.auth.userId, timestamp, cardId, req.auth.accountId);

        const after = loadCard(req.auth, cardId);
        insertAuditEvent(db, {
          accountId: req.auth.accountId,
          userId: req.auth.userId,
          requestId: req.requestId,
          entityType: 'card',
          entityId: cardId,
          action: transition.action,
          oldValue: mutationAuditValue(before),
          newValue: mutationAuditValue(after),
          metadata: {
            amountCents: body.amountCents,
          },
          timestamp,
        });
      })();

      res.json(objectResponse(cardDetail(req.auth, cardId)));
    }),
  );

  router.post(
    '/:cardId/undo-usage',
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const body = validateBody(undoUsageSchema, req.body);
      const timestamp = nowIso();

      db.transaction(() => {
        const before = loadCard(req.auth, cardId);
        const usage = db
          .prepare('SELECT * FROM usages WHERE accountId = ? AND cardId = ? AND id = ?')
          .get(req.auth.accountId, cardId, body.usageId);

        if (!usage) {
          throw notFound('USAGE_NOT_FOUND', 'Usage not found.');
        }

        if (usage.isWriteOff) {
          throw conflict('WRITE_OFF_USAGE_NOT_REVERSIBLE', 'Write-off usages cannot be undone.');
        }

        if (usage.isReversed) {
          throw conflict('USAGE_ALREADY_REVERSED', 'Usage has already been reversed.');
        }

        const transition = transitionFor('undo-usage', before.status);

        db.prepare(
          `UPDATE usages
           SET isReversed = 1,
               reversalReason = ?,
               reversedAt = ?
           WHERE id = ? AND accountId = ? AND cardId = ?`,
        ).run(body.reason, timestamp, usage.id, req.auth.accountId, cardId);

        const activeUsageTotal =
          db
            .prepare(
              `SELECT COALESCE(SUM(amountCents), 0) AS amountCents
               FROM usages
               WHERE accountId = ?
                 AND cardId = ?
                 AND isReversed = 0
                 AND isWriteOff = 0`,
            )
            .get(req.auth.accountId, cardId).amountCents || 0;
        const remainingBalanceCents = before.faceValueCents - activeUsageTotal;
        const nextStatus =
          activeUsageTotal === 0 ? 'available' : remainingBalanceCents === 0 ? 'used_up' : 'in_use';

        db.prepare(
          `UPDATE cards
           SET status = ?,
               remainingBalanceCents = ?,
               updatedByUserId = ?,
               updatedAt = ?,
               rowVersion = rowVersion + 1
           WHERE id = ? AND accountId = ?`,
        ).run(nextStatus, remainingBalanceCents, req.auth.userId, timestamp, cardId, req.auth.accountId);

        const after = loadCard(req.auth, cardId);
        insertAuditEvent(db, {
          accountId: req.auth.accountId,
          userId: req.auth.userId,
          requestId: req.requestId,
          entityType: 'card',
          entityId: cardId,
          action: transition.action,
          oldValue: mutationAuditValue(before),
          newValue: mutationAuditValue(after),
          metadata: {
            usageId: usage.id,
            reason: body.reason,
          },
          timestamp,
        });
      })();

      res.json(objectResponse(cardDetail(req.auth, cardId)));
    }),
  );

  router.post(
    '/:cardId/void',
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const body = validateBody(voidCardSchema, req.body || {});
      const timestamp = nowIso();

      db.transaction(() => {
        const before = loadCard(req.auth, cardId);
        const transition = transitionFor('void', before.status);

        db.prepare(
          `INSERT INTO usages (
            accountId, cardId, amountCents, merchant, description, isWriteOff,
            usageDate, idempotencyKey, createdByUserId, createdAt
          ) VALUES (?, ?, ?, 'Write-off (Voided)', ?, 1, ?, ?, ?, ?)`,
        ).run(
          req.auth.accountId,
          cardId,
          before.remainingBalanceCents,
          body.reason ?? null,
          timestamp.slice(0, 10),
          req.get('Idempotency-Key') ?? null,
          req.auth.userId,
          timestamp,
        );

        db.prepare(
          `UPDATE cards
           SET status = ?,
               remainingBalanceCents = 0,
               updatedByUserId = ?,
               updatedAt = ?,
               rowVersion = rowVersion + 1
           WHERE id = ? AND accountId = ?`,
        ).run(transition.status, req.auth.userId, timestamp, cardId, req.auth.accountId);

        const after = loadCard(req.auth, cardId);
        insertAuditEvent(db, {
          accountId: req.auth.accountId,
          userId: req.auth.userId,
          requestId: req.requestId,
          entityType: 'card',
          entityId: cardId,
          action: transition.action,
          oldValue: mutationAuditValue(before),
          newValue: mutationAuditValue(after),
          metadata: {
            writeOffAmountCents: before.remainingBalanceCents,
          },
          timestamp,
        });
      })();

      res.json(objectResponse(cardDetail(req.auth, cardId)));
    }),
  );

  router.get(
    '/:cardId',
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      res.json(objectResponse(cardDetail(req.auth, cardId)));
    }),
  );

  return router;
}
