import { Router } from 'express';
import { z } from 'zod';
import { insertAuditEvent } from '../audit/index.js';
import { requireUnlockedSession } from '../auth/requireAuth.js';
import { asyncHandler, badRequest, conflict } from '../http/errors.js';
import {
  cardNumberHash as hashCardNumber,
  cardNumberLast4,
  encryptString,
  normalizeCardNumber,
} from '../security/crypto.js';

const dealCardInputSchema = z
  .object({
    brand: z.string().trim().min(1).max(120),
    cardType: z.enum(['merchant', 'prepaid']),
    network: z.enum(['visa', 'mastercard', 'amex', 'discover', 'other']).nullable().optional(),
    faceValueCents: z.number().int().positive(),
    purchaseCostCents: z.number().int().nonnegative().optional(),
    cardNumber: z.string().trim().nullable().optional(),
    pin: z.string().trim().nullable().optional(),
    billingZip: z.string().trim().nullable().optional(),
    expirationDate: z.string().trim().nullable().optional(),
    format: z.enum(['digital', 'physical']).nullable().optional(),
    source: z.string().trim().nullable().optional(),
    notes: z.string().trim().nullable().optional(),
  })
  .strict();

const createDealSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    source: z.string().trim().nullable().optional(),
    purchaseDate: z.string().trim().nullable().optional(),
    totalCostCents: z.number().int().nonnegative().optional(),
    notes: z.string().trim().nullable().optional(),
    cards: z.array(dealCardInputSchema).max(100).optional(),
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

function toDealResponse(row) {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    source: row.source,
    purchaseDate: row.purchaseDate,
    inputTotalCostCents: row.inputTotalCostCents,
    archivedAt: row.archivedAt,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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

function objectResponse(data) {
  return { data };
}

function encryptedOrNull(value, key) {
  return value ? encryptString(value, key) : null;
}

function allocateCardCosts(cards, rawCards, totalCostCents) {
  if (totalCostCents == null) {
    return cards.map((card) => ({
      ...card,
      purchaseCostCents: card.purchaseCostCents ?? 0,
    }));
  }

  if (cards.length === 0) {
    return cards;
  }

  const explicitIndexes = [];
  const proportionalIndexes = [];
  cards.forEach((_card, index) => {
    if (Object.hasOwn(rawCards[index] || {}, 'purchaseCostCents')) {
      explicitIndexes.push(index);
    } else {
      proportionalIndexes.push(index);
    }
  });

  const explicitSum = explicitIndexes.reduce((sum, index) => sum + cards[index].purchaseCostCents, 0);
  if (explicitSum > totalCostCents) {
    throw badRequest('COST_ALLOCATION_INVALID', 'Explicit card costs exceed total deal cost.');
  }

  if (proportionalIndexes.length === 0) {
    if (explicitSum !== totalCostCents) {
      throw badRequest('COST_ALLOCATION_INVALID', 'Explicit card costs must equal total deal cost.');
    }
    return cards;
  }

  const remainingCost = totalCostCents - explicitSum;
  const totalFaceValue = proportionalIndexes.reduce(
    (sum, index) => sum + cards[index].faceValueCents,
    0,
  );
  let allocated = 0;

  return cards.map((card, index) => {
    if (!proportionalIndexes.includes(index)) {
      return card;
    }

    const isLast = index === proportionalIndexes[proportionalIndexes.length - 1];
    const purchaseCostCents = isLast
      ? remainingCost - allocated
      : Math.floor((remainingCost * card.faceValueCents) / totalFaceValue);
    allocated += purchaseCostCents;

    return {
      ...card,
      purchaseCostCents,
    };
  });
}

function prepareCard(card, auth, dealId, fallbackSource) {
  const normalizedCardNumber = normalizeCardNumber(card.cardNumber);

  return {
    ...card,
    dealId,
    source: card.source ?? fallbackSource ?? null,
    status: 'available',
    cardNumber: normalizedCardNumber ? encryptString(normalizedCardNumber, auth.dek) : null,
    cardNumberHash: normalizedCardNumber ? hashCardNumber(normalizedCardNumber, auth.blindIndexKey) : null,
    cardNumberLast4: normalizedCardNumber ? cardNumberLast4(normalizedCardNumber) : null,
    pin: encryptedOrNull(card.pin, auth.dek),
    billingZip: encryptedOrNull(card.billingZip, auth.dek),
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

function translateSqliteError(error) {
  if (error.code === 'SQLITE_CONSTRAINT_UNIQUE' || error.message?.includes('idx_cards_active_dedupe')) {
    return conflict('DUPLICATE_ACTIVE_CARD', 'Active duplicate card number for this brand already exists.');
  }

  if (error.code?.startsWith('SQLITE_CONSTRAINT')) {
    return badRequest('VALIDATION_FAILED', 'Request validation failed.');
  }

  return error;
}

export function createDealsRouter({ db }) {
  const router = Router();

  router.use(requireUnlockedSession);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const limit = parsePositiveInt(req.query.limit, 50, { min: 1, max: 100 });
      const offset = parsePositiveInt(req.query.offset, 0, { min: 0 });
      const total = db
        .prepare('SELECT COUNT(*) AS count FROM deals WHERE accountId = ? AND archivedAt IS NULL')
        .get(req.auth.accountId).count;
      const rows = db
        .prepare(
          `SELECT *
           FROM deals
           WHERE accountId = ? AND archivedAt IS NULL
           ORDER BY updatedAt DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(req.auth.accountId, limit, offset);

      res.json(pageResponse(rows.map(toDealResponse), { limit, offset, total }));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const rawCards = Array.isArray(req.body?.cards) ? req.body.cards : [];
      const body = validateBody(createDealSchema, req.body || {});
      const timestamp = nowIso();
      const cardsWithCosts = allocateCardCosts(body.cards || [], rawCards, body.totalCostCents);

      try {
        const created = db.transaction(() => {
          const dealInfo = db
            .prepare(
              `INSERT INTO deals (
                accountId, name, source, purchaseDate, inputTotalCostCents, notes,
                createdByUserId, updatedByUserId, createdAt, updatedAt
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              req.auth.accountId,
              body.name,
              body.source ?? null,
              body.purchaseDate ?? null,
              body.totalCostCents ?? null,
              body.notes ?? null,
              req.auth.userId,
              req.auth.userId,
              timestamp,
              timestamp,
            );
          const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealInfo.lastInsertRowid);

          insertAuditEvent(db, {
            accountId: req.auth.accountId,
            userId: req.auth.userId,
            requestId: req.requestId,
            entityType: 'deal',
            entityId: deal.id,
            action: 'deal.create',
            newValue: {
              name: deal.name,
              source: deal.source,
              purchaseDate: deal.purchaseDate,
              inputTotalCostCents: deal.inputTotalCostCents,
            },
            timestamp,
          });

          const preparedCards = cardsWithCosts.map((card) =>
            prepareCard(card, req.auth, deal.id, body.source),
          );
          assertNoDuplicateInputs(preparedCards);

          const cards = preparedCards.map((card) => {
            const cardInfo = db
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
                card.dealId,
                card.brand,
                card.cardType,
                card.network ?? null,
                card.faceValueCents,
                card.faceValueCents,
                card.purchaseCostCents,
                card.cardNumber,
                card.cardNumberHash,
                card.cardNumberLast4,
                card.pin,
                card.billingZip,
                card.expirationDate ?? null,
                card.status,
                card.format ?? null,
                card.source,
                card.notes ?? null,
                req.auth.userId,
                req.auth.userId,
                timestamp,
                timestamp,
              );

            const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardInfo.lastInsertRowid);
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

          return { deal, cards };
        })();

        res.status(201).json(
          objectResponse({
            deal: toDealResponse(created.deal),
            cards: created.cards.map(toCardResponse),
          }),
        );
      } catch (error) {
        throw translateSqliteError(error);
      }
    }),
  );

  return router;
}
