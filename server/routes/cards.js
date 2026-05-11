import { Router } from 'express';
import { z } from 'zod';
import { insertAuditEvent } from '../audit/index.js';
import { requireUnlockedSession } from '../auth/requireAuth.js';
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

  router.get(
    '/:cardId',
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const card = db
        .prepare('SELECT * FROM cards WHERE accountId = ? AND id = ?')
        .get(req.auth.accountId, cardId);

      if (!card) {
        throw notFound('CARD_NOT_FOUND', 'Card not found.');
      }

      const transactions = db
        .prepare('SELECT * FROM transactions WHERE accountId = ? AND cardId = ? ORDER BY createdAt DESC, id DESC')
        .all(req.auth.accountId, cardId);
      const usages = db
        .prepare('SELECT * FROM usages WHERE accountId = ? AND cardId = ? ORDER BY createdAt DESC, id DESC')
        .all(req.auth.accountId, cardId);
      const audit = db
        .prepare(
          `SELECT id, accountId, entityType, entityId, action, timestamp
           FROM audit_log
           WHERE accountId = ? AND entityType = 'card' AND entityId = ?
           ORDER BY timestamp DESC, id DESC`,
        )
        .all(req.auth.accountId, cardId);

      res.json(
        objectResponse({
          card: toCardResponse(card),
          transactions,
          usages,
          audit: audit.map(toAuditResponse),
        }),
      );
    }),
  );

  return router;
}
