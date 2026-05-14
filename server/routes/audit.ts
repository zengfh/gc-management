import { Router } from 'express';
import type Database from 'better-sqlite3';
import { requireUnlockedSession } from '../auth/requireAuth.js';
import { asyncHandler, badRequest } from '../http/errors.js';

const entityTypes = new Set(['card', 'deal', 'transaction', 'usage', 'auth', 'backup', 'import', 'system']);

interface AuditRow {
  id: number;
  accountId: number;
  userId: number | null;
  requestId: string | null;
  entityType: string;
  entityId: number | null;
  action: string;
  timestamp: string;
}

interface CountRow {
  count: number;
}

function queryValidationError(field: string, code: string, message: string) {
  return badRequest('VALIDATION_FAILED', 'Request validation failed.', [
    {
      field,
      code,
      message,
    },
  ]);
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
    throw queryValidationError('query', 'invalid_integer', `Expected an integer between ${min} and ${max}.`);
  }
  return parsed;
}

function parseDateTimeFilter(value: unknown, field: string): string | null {
  if (value == null || value === '') {
    return null;
  }

  const normalized = String(value).trim();
  if (Number.isNaN(Date.parse(normalized))) {
    throw queryValidationError(field, 'invalid_datetime', 'Expected a valid date or timestamp.');
  }
  return normalized;
}

function toAuditResponse(row: AuditRow) {
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

function pageResponse<T>(data: T[], { limit, offset, total }: { limit: number; offset: number; total: number }) {
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

export function createAuditRouter({ db }: { db: Database.Database }) {
  const router = Router();

  router.use(requireUnlockedSession);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const limit = parsePositiveInt(req.query.limit, 50, { min: 1, max: 100 });
      const offset = parsePositiveInt(req.query.offset, 0, { min: 0 });
      const where = ['accountId = ?'];
      const params: unknown[] = [req.auth.accountId];

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
      const total = (db.prepare(`SELECT COUNT(*) AS count FROM audit_log WHERE ${whereClause}`).get(...params) as CountRow).count;
      const rows = db
        .prepare(
          `SELECT id, accountId, userId, requestId, entityType, entityId, action, timestamp
           FROM audit_log
           WHERE ${whereClause}
           ORDER BY timestamp DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as AuditRow[];

      res.json(pageResponse(rows.map(toAuditResponse), { limit, offset, total }));
    }),
  );

  return router;
}
