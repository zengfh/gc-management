import { Router } from 'express';
import { z } from 'zod';
import { insertAuditEvent } from '../audit/index.js';
import { requireUnlockedSession } from '../auth/requireAuth.js';
import { requireOperatorRole, requireViewerRole } from '../auth/roles.js';
import { requireFeatureFlag } from '../config/featureFlags.js';
import { asyncHandler, badRequest } from '../http/errors.js';
import { objectResponse } from '../http/response.js';

const referenceTypes = new Set(['deal_name', 'source', 'card_brand']);

const referenceValueInputSchema = z
  .object({
    type: z.enum(['deal_name', 'source', 'card_brand']),
    value: z.string().trim().min(1).max(160),
  })
  .strict();

const upsertReferenceValuesSchema = z
  .object({
    values: z.array(referenceValueInputSchema).min(1).max(50),
  })
  .strict();

function zodFieldErrors(error) {
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

function parsePositiveInt(value, fallback, { min = 1, max = 200 } = {}) {
  if (value == null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw badRequest('VALIDATION_FAILED', 'Request validation failed.', [
      {
        field: 'limit',
        code: 'invalid_integer',
        message: `Expected an integer between ${min} and ${max}.`,
      },
    ]);
  }
  return parsed;
}

function normalizeReferenceValue(value) {
  return value.trim().toLowerCase();
}

function parseTypes(value) {
  if (!value) {
    return [...referenceTypes];
  }

  const types = String(value)
    .split(',')
    .map((type) => type.trim())
    .filter(Boolean);

  if (types.length === 0 || types.some((type) => !referenceTypes.has(type))) {
    throw badRequest('VALIDATION_FAILED', 'Request validation failed.', [
      {
        field: 'types',
        code: 'invalid_enum',
        message: 'Types must be one or more of deal_name, source, card_brand.',
      },
    ]);
  }

  return [...new Set(types)];
}

function toReferenceValueResponse(row) {
  return {
    id: row.id,
    type: row.type,
    value: row.value,
    usageCount: row.usageCount,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function selectReferenceValues(db, { accountId, type, q, limit }) {
  const normalizedQuery = q ? normalizeReferenceValue(q) : '';
  if (!normalizedQuery) {
    return db
      .prepare(
        `SELECT *
         FROM reference_values
         WHERE accountId = ? AND type = ?
         ORDER BY usageCount DESC, lastUsedAt DESC, value COLLATE NOCASE ASC
         LIMIT ?`,
      )
      .all(accountId, type, limit)
      .map(toReferenceValueResponse);
  }

  return db
    .prepare(
      `SELECT *
       FROM reference_values
       WHERE accountId = ? AND type = ? AND normalizedValue LIKE ?
       ORDER BY
         CASE
           WHEN normalizedValue = ? THEN 0
           WHEN normalizedValue LIKE ? THEN 1
           ELSE 2
         END,
         usageCount DESC,
         lastUsedAt DESC,
         value COLLATE NOCASE ASC
       LIMIT ?`,
    )
    .all(accountId, type, `%${normalizedQuery}%`, normalizedQuery, `${normalizedQuery}%`, limit)
    .map(toReferenceValueResponse);
}

function upsertReferenceValues(db, { accountId, values, timestamp }) {
  const statement = db.prepare(
    `INSERT INTO reference_values (
      accountId, type, value, normalizedValue, usageCount, lastUsedAt, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(accountId, type, normalizedValue) DO UPDATE SET
      usageCount = reference_values.usageCount + 1,
      lastUsedAt = excluded.lastUsedAt,
      updatedAt = excluded.updatedAt`,
  );
  const select = db.prepare(
    'SELECT * FROM reference_values WHERE accountId = ? AND type = ? AND normalizedValue = ?',
  );

  return db.transaction(() => {
    const seen = new Set();
    const rows = [];
    for (const item of values) {
      const value = item.value.trim();
      const normalizedValue = normalizeReferenceValue(value);
      const key = `${item.type}\0${normalizedValue}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      statement.run(accountId, item.type, value, normalizedValue, timestamp, timestamp, timestamp);
      rows.push(select.get(accountId, item.type, normalizedValue));
    }
    return rows.map(toReferenceValueResponse);
  })();
}

export function createReferenceValuesRouter({ db }) {
  const router = Router();

  router.use(requireUnlockedSession);
  router.use(requireFeatureFlag('referenceValueHints'));

  router.get(
    '/',
    requireViewerRole,
    asyncHandler(async (req, res) => {
      const types = parseTypes(req.query.types);
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const limit = parsePositiveInt(req.query.limit, 50, { min: 1, max: 200 });
      const data = Object.fromEntries(types.map((type) => [type, []]));

      for (const type of types) {
        data[type] = selectReferenceValues(db, {
          accountId: req.auth.accountId,
          type,
          q,
          limit,
        });
      }

      res.json(objectResponse(data));
    }),
  );

  router.post(
    '/',
    requireOperatorRole,
    asyncHandler(async (req, res) => {
      const body = validateBody(upsertReferenceValuesSchema, req.body || {});
      const timestamp = new Date().toISOString();
      const values = upsertReferenceValues(db, {
        accountId: req.auth.accountId,
        values: body.values,
        timestamp,
      });

      insertAuditEvent(db, {
        accountId: req.auth.accountId,
        userId: req.auth.userId,
        requestId: req.requestId,
        entityType: 'system',
        action: 'reference_values.upsert',
        metadata: {
          count: values.length,
          types: [...new Set(values.map((value) => value.type))],
        },
        timestamp,
      });

      res.json(objectResponse(values));
    }),
  );

  return router;
}
