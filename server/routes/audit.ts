import { Router } from 'express';
import { requireUnlockedSession } from '../auth/requireAuth.js';
import { asyncHandler, badRequest } from '../http/errors.js';

const entityTypes = new Set(['card', 'deal', 'transaction', 'usage', 'auth', 'backup', 'import', 'system']);

function queryValidationError(field, code, message) {
  return badRequest('VALIDATION_FAILED', 'Request validation failed.', [
    {
      field,
      code,
      message,
    },
  ]);
}

function parsePositiveInt(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value == null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw queryValidationError('query', 'invalid_integer', `Expected an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function parseDateTimeFilter(value, field) {
  if (value == null || value === '') {
    return null;
  }

  const normalized = String(value).trim();
  if (Number.isNaN(Date.parse(normalized))) {
    throw queryValidationError(field, 'invalid_datetime', 'Expected a valid date or timestamp.');
  }
  return normalized;
}

function toAuditResponse(row) {
  return {
    id: row.id,
    accountId: row.accountId,
    userId: row.userId,
    requestId: row.requestId,
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

export function createAuditRouter({ db }) {
  const router = Router();

  router.use(requireUnlockedSession);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const limit = parsePositiveInt(req.query.limit, 50, { min: 1, max: 100 });
      const offset = parsePositiveInt(req.query.offset, 0, { min: 0 });
      const where = ['accountId = ?'];
      const params: any[] = [req.auth.accountId];

      if (req.query.entityType) {
        const entityType = String(req.query.entityType).trim();
        if (!entityTypes.has(entityType)) {
          throw queryValidationError('entityType', 'invalid_enum', 'Unsupported audit entity type.');
        }
        where.push('entityType = ?');
        params.push(entityType);
      }

      if (req.query.entityId) {
        where.push('entityId = ?');
        params.push(parsePositiveInt(req.query.entityId, null, { min: 1 }));
      }

      if (req.query.action) {
        where.push('action = ?');
        params.push(String(req.query.action).trim());
      }

      const from = parseDateTimeFilter(req.query.from, 'from');
      if (from) {
        where.push('timestamp >= ?');
        params.push(from);
      }

      const to = parseDateTimeFilter(req.query.to, 'to');
      if (to) {
        where.push('timestamp <= ?');
        params.push(to);
      }

      const whereClause = where.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS count FROM audit_log WHERE ${whereClause}`).get(...params).count;
      const rows = db
        .prepare(
          `SELECT id, accountId, userId, requestId, entityType, entityId, action, timestamp
           FROM audit_log
           WHERE ${whereClause}
           ORDER BY timestamp DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset);

      res.json(pageResponse(rows.map(toAuditResponse), { limit, offset, total }));
    }),
  );

  return router;
}
