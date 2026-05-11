import { Router } from 'express';
import { parse as parseCsv } from 'csv-parse/sync';
import { z } from 'zod';
import { insertAuditEvent } from '../audit/index.js';
import { requireUnlockedSession } from '../auth/requireAuth.js';
import { transitionFor } from '../cards/stateMachine.js';
import { asyncHandler, badRequest, conflict, notFound } from '../http/errors.js';
import { objectResponse } from '../http/response.js';
import {
  cardNumberHash as hashCardNumber,
  cardNumberLast4,
  decryptString,
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

const importCsvPreviewSchema = z
  .object({
    csv: z.string().min(1).max(1_000_000),
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
const cardSortColumns = {
  brand: 'brand',
  expirationDate: 'expirationDate',
  faceValueCents: 'faceValueCents',
  purchaseCostCents: 'purchaseCostCents',
  remainingBalanceCents: 'remainingBalanceCents',
  status: 'status',
  updatedAt: 'updatedAt',
};

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

function queryValidationError(field, code, message) {
  return badRequest('VALIDATION_FAILED', 'Request validation failed.', [
    {
      field,
      code,
      message,
    },
  ]);
}

function parseDateFilter(value, field) {
  if (value == null || value === '') {
    return null;
  }

  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw queryValidationError(field, 'invalid_date', 'Expected date in YYYY-MM-DD format.');
  }
  return normalized;
}

function parseCardSort(query) {
  const rawSortBy = query.sortBy == null || query.sortBy === '' ? null : String(query.sortBy);
  const sortBy = rawSortBy || 'updatedAt';
  const sortColumn = cardSortColumns[sortBy];
  if (!sortColumn) {
    throw queryValidationError('sortBy', 'invalid_enum', 'Unsupported card sort field.');
  }

  const rawSortDir = query.sortDir == null || query.sortDir === '' ? null : String(query.sortDir).toLowerCase();
  const sortDir = rawSortDir || (rawSortBy ? 'asc' : 'desc');
  if (!['asc', 'desc'].includes(sortDir)) {
    throw queryValidationError('sortDir', 'invalid_enum', 'Sort direction must be asc or desc.');
  }

  return {
    column: sortColumn,
    direction: sortDir.toUpperCase(),
  };
}

function encryptedOrNull(value, key) {
  return value ? encryptString(value, key) : null;
}

function decryptedOrNull(value, key) {
  return value ? decryptString(value, key) : null;
}

function normalizeHeader(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function csvValue(record, aliases) {
  const normalizedAliases = aliases.map(normalizeHeader);
  const entry = Object.entries(record).find(([key]) => normalizedAliases.includes(normalizeHeader(key)));
  if (!entry) {
    return '';
  }
  return String(entry[1] ?? '').trim();
}

function rowError(field, code, message) {
  return { field, code, message };
}

function parseMoneyInput(raw, field, { required = false, positive = false } = {}) {
  const value = String(raw || '').trim();
  if (!value) {
    return {
      cents: required ? null : 0,
      error: required ? rowError(field, 'required', `${field} is required.`) : null,
    };
  }

  const normalized = value.replace(/[$,]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return {
      cents: null,
      error: rowError(field, 'invalid_money', `${field} must be a non-negative money amount.`),
    };
  }

  const cents = Math.round(Number(normalized) * 100);
  if ((positive && cents <= 0) || cents < 0) {
    return {
      cents: null,
      error: rowError(field, 'invalid_money', `${field} must be greater than zero.`),
    };
  }
  return { cents, error: null };
}

function parseCsvRecords(csv) {
  try {
    return parseCsv(csv, {
      bom: true,
      columns: true,
      relaxColumnCount: true,
      skipEmptyLines: true,
      trim: true,
    });
  } catch (error) {
    throw badRequest('CSV_PARSE_FAILED', 'CSV could not be parsed.', [
      rowError('csv', 'invalid_csv', error.message),
    ]);
  }
}

function previewCsvRow(record, rowNumber, auth, importHashes) {
  const errors = [];
  const brand = csvValue(record, ['brand']);
  const cardType = csvValue(record, ['cardType', 'card type', 'type']) || 'merchant';
  const faceValue = parseMoneyInput(
    csvValue(record, ['faceValue', 'face value', 'faceValueCents', 'face value cents']),
    'faceValue',
    { required: true, positive: true },
  );
  const purchaseCost = parseMoneyInput(
    csvValue(record, ['purchaseCost', 'purchase cost', 'purchaseCostCents', 'purchase cost cents']),
    'purchaseCost',
  );
  const normalizedCardNumber = normalizeCardNumber(csvValue(record, ['cardNumber', 'card number']));
  const pin = csvValue(record, ['pin']);
  const billingZip = csvValue(record, ['billingZip', 'billing zip', 'zip']);
  const expirationDate = csvValue(record, ['expirationDate', 'expiration date', 'expires']);
  const format = csvValue(record, ['format']);

  if (!brand) {
    errors.push(rowError('brand', 'required', 'Brand is required.'));
  }
  if (!['merchant', 'prepaid'].includes(cardType)) {
    errors.push(rowError('cardType', 'invalid_enum', 'Card type must be merchant or prepaid.'));
  }
  if (faceValue.error) {
    errors.push(faceValue.error);
  }
  if (purchaseCost.error) {
    errors.push(purchaseCost.error);
  }
  if (format && !['digital', 'physical'].includes(format)) {
    errors.push(rowError('format', 'invalid_enum', 'Format must be digital or physical.'));
  }

  let cardNumberHash = null;
  if (normalizedCardNumber) {
    cardNumberHash = hashCardNumber(normalizedCardNumber, auth.blindIndexKey);
    if (brand) {
      const duplicateKey = `${brand}\0${cardNumberHash}`;
      if (importHashes.has(duplicateKey)) {
        errors.push(rowError('cardNumber', 'duplicate_import_row', 'Duplicate card number in this import.'));
      } else {
        importHashes.add(duplicateKey);
      }
    }
  }

  return {
    rowNumber,
    valid: errors.length === 0,
    parsed: {
      brand: brand || null,
      cardType: ['merchant', 'prepaid'].includes(cardType) ? cardType : null,
      faceValueCents: faceValue.cents,
      purchaseCostCents: purchaseCost.cents,
      cardNumberLast4: normalizedCardNumber ? cardNumberLast4(normalizedCardNumber) : null,
      hasPin: Boolean(pin),
      hasBillingZip: Boolean(billingZip),
      expirationDate: expirationDate || null,
      format: ['digital', 'physical'].includes(format) ? format : null,
      source: csvValue(record, ['source']) || null,
      notes: csvValue(record, ['notes']) || null,
    },
    cardNumberHash,
    errors,
  };
}

function applyCsvConflicts(db, auth, rows) {
  const lookup = db.prepare(
    `SELECT id
     FROM cards
     WHERE accountId = ?
       AND brand = ?
       AND cardNumberHash = ?
       AND status IN ('available', 'reserved', 'in_use')
     LIMIT 1`,
  );

  return rows.map((row) => {
    if (!row.cardNumberHash || !row.parsed.brand) {
      const responseRow = { ...row };
      delete responseRow.cardNumberHash;
      return responseRow;
    }

    const conflictRow = lookup.get(auth.accountId, row.parsed.brand, row.cardNumberHash);
    const errors = conflictRow
      ? [
          ...row.errors,
          rowError('cardNumber', 'duplicate_active_card', 'Active duplicate card number already exists.'),
        ]
      : row.errors;
    const responseRow = {
      ...row,
      valid: errors.length === 0,
      errors,
    };
    delete responseRow.cardNumberHash;
    return responseRow;
  });
}

function buildCsvPreview(db, auth, csv) {
  const records = parseCsvRecords(csv);
  const importHashes = new Set();
  const previewRows = records.map((record, index) =>
    previewCsvRow(record, index + 2, auth, importHashes),
  );
  const rows = applyCsvConflicts(db, auth, previewRows);
  const validCount = rows.filter((row) => row.valid).length;

  return {
    importType: 'csv',
    summary: {
      rowCount: rows.length,
      validCount,
      invalidCount: rows.length - validCount,
    },
    rows,
  };
}

function csvRecordToCardInput(record) {
  return {
    brand: csvValue(record, ['brand']),
    cardType: csvValue(record, ['cardType', 'card type', 'type']) || 'merchant',
    faceValueCents: parseMoneyInput(
      csvValue(record, ['faceValue', 'face value', 'faceValueCents', 'face value cents']),
      'faceValue',
      { required: true, positive: true },
    ).cents,
    purchaseCostCents: parseMoneyInput(
      csvValue(record, ['purchaseCost', 'purchase cost', 'purchaseCostCents', 'purchase cost cents']),
      'purchaseCost',
    ).cents,
    cardNumber: normalizeCardNumber(csvValue(record, ['cardNumber', 'card number'])),
    pin: csvValue(record, ['pin']) || null,
    billingZip: csvValue(record, ['billingZip', 'billing zip', 'zip']) || null,
    expirationDate: csvValue(record, ['expirationDate', 'expiration date', 'expires']) || null,
    format: csvValue(record, ['format']) || null,
    source: csvValue(record, ['source']) || null,
    notes: csvValue(record, ['notes']) || null,
  };
}

function toImportJobResponse(row) {
  return {
    id: row.id,
    accountId: row.accountId,
    userId: row.userId,
    type: row.type,
    status: row.status,
    rowCount: row.rowCount,
    validCount: row.validCount,
    invalidCount: row.invalidCount,
    summary: row.summaryJson ? JSON.parse(row.summaryJson) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
      const sort = parseCardSort(req.query);
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

      if (req.query.source) {
        where.push('source = ?');
        params.push(String(req.query.source).trim());
      }

      const dealId = parsePositiveInt(req.query.dealId, null, { min: 1 });
      if (dealId) {
        where.push('dealId = ?');
        params.push(dealId);
      }

      const expiresBefore = parseDateFilter(req.query.expiresBefore, 'expiresBefore');
      if (expiresBefore) {
        where.push('expirationDate IS NOT NULL AND expirationDate <= ?');
        params.push(expiresBefore);
      }

      const expiresAfter = parseDateFilter(req.query.expiresAfter, 'expiresAfter');
      if (expiresAfter) {
        where.push('expirationDate IS NOT NULL AND expirationDate >= ?');
        params.push(expiresAfter);
      }

      if (req.query.text) {
        const text = String(req.query.text).trim().toLowerCase();
        if (text) {
          const pattern = `%${text}%`;
          where.push(
            `(LOWER(brand) LIKE ? OR LOWER(COALESCE(source, '')) LIKE ? OR LOWER(COALESCE(notes, '')) LIKE ?)`,
          );
          params.push(pattern, pattern, pattern);
        }
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
        .prepare(
          `SELECT *
           FROM cards
           WHERE ${whereClause}
           ORDER BY ${sort.column} ${sort.direction}, id ${sort.direction}
           LIMIT ? OFFSET ?`,
        )
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

  router.post(
    '/import-csv',
    asyncHandler(async (req, res) => {
      const body = validateBody(importCsvPreviewSchema, req.body || {});
      res.json(objectResponse(buildCsvPreview(db, req.auth, body.csv)));
    }),
  );

  router.post(
    '/import-csv/confirm',
    asyncHandler(async (req, res) => {
      const body = validateBody(importCsvPreviewSchema, req.body || {});
      const preview = buildCsvPreview(db, req.auth, body.csv);
      if (preview.summary.invalidCount > 0) {
        throw conflict('CSV_IMPORT_INVALID', 'CSV import has invalid rows.', {
          summary: preview.summary,
          rows: preview.rows,
        });
      }

      const timestamp = nowIso();
      const cards = parseCsvRecords(body.csv).map(csvRecordToCardInput);
      const preparedCards = cards.map((card) => ({
        ...card,
        ...buildCardCredentialFields(card, req.auth),
        status: 'available',
      }));
      assertNoDuplicateInputs(preparedCards);

      try {
        const result = db.transaction(() => {
          const jobInfo = db
            .prepare(
              `INSERT INTO import_jobs (
                accountId, userId, type, status, rowCount, validCount, invalidCount,
                summaryJson, createdAt, updatedAt
              ) VALUES (?, ?, 'csv', 'confirmed', ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              req.auth.accountId,
              req.auth.userId,
              preview.summary.rowCount,
              preview.summary.validCount,
              preview.summary.invalidCount,
              JSON.stringify(preview.summary),
              timestamp,
              timestamp,
            );

          const createdCards = preparedCards.map((card) => {
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
                null,
                card.brand,
                card.cardType,
                null,
                card.faceValueCents,
                card.faceValueCents,
                card.purchaseCostCents,
                card.encryptedCardNumber,
                card.cardNumberHash,
                card.cardNumberLast4,
                card.pin,
                card.billingZip,
                card.expirationDate,
                card.status,
                card.format,
                card.source,
                card.notes,
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

          const importJob = db.prepare('SELECT * FROM import_jobs WHERE id = ?').get(jobInfo.lastInsertRowid);
          insertAuditEvent(db, {
            accountId: req.auth.accountId,
            userId: req.auth.userId,
            requestId: req.requestId,
            entityType: 'import',
            entityId: importJob.id,
            action: 'import.csv_confirm',
            metadata: {
              rowCount: preview.summary.rowCount,
              validCount: preview.summary.validCount,
              invalidCount: preview.summary.invalidCount,
              cardCount: createdCards.length,
            },
            timestamp,
          });

          return {
            importJob,
            cards: createdCards,
          };
        })();

        res.status(201).json(
          objectResponse({
            summary: preview.summary,
            importJob: toImportJobResponse(result.importJob),
            cards: result.cards.map(toCardResponse),
          }),
        );
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

  router.post(
    '/:cardId/reveal',
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const timestamp = nowIso();
      const card = loadCard(req.auth, cardId);

      insertAuditEvent(db, {
        accountId: req.auth.accountId,
        userId: req.auth.userId,
        requestId: req.requestId,
        entityType: 'card',
        entityId: cardId,
        action: 'card.credentials_reveal',
        metadata: {
          cardNumberLast4: card.cardNumberLast4,
          hasPin: Boolean(card.pin),
          hasBillingZip: Boolean(card.billingZip),
        },
        timestamp,
      });

      res.set({
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      });
      res.json(
        objectResponse({
          cardNumber: decryptedOrNull(card.cardNumber, req.auth.dek),
          cardNumberLast4: card.cardNumberLast4,
          pin: decryptedOrNull(card.pin, req.auth.dek),
          billingZip: decryptedOrNull(card.billingZip, req.auth.dek),
        }),
      );
    }),
  );

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
