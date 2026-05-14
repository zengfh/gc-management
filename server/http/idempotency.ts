import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Request, Response } from 'express';
import { badRequest, conflict } from './errors.js';

const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{1,128}$/;
const idempotencyTtlMs = 24 * 60 * 60 * 1000;

interface IdempotentResponse {
  status: number;
  body: unknown;
}

interface IdempotentResult extends IdempotentResponse {
  replayed: boolean;
}

interface IdempotencyRow {
  method: string;
  path: string;
  requestHash: string;
  responseStatus: number | null;
  responseBody: string | null;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function requestHash(req: Request): string {
  return crypto
    .createHash('sha256')
    .update(
      stableStringify({
        method: req.method.toUpperCase(),
        path: req.originalUrl || req.url,
        body: req.body ?? null,
      }),
    )
    .digest('hex');
}

function readIdempotencyKey(req: Request): string | null {
  const key = req.get('Idempotency-Key');
  if (key == null || key === '') {
    return null;
  }

  const normalized = String(key).trim();
  if (!idempotencyKeyPattern.test(normalized)) {
    throw badRequest('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 1-128 URL-safe characters.');
  }
  return normalized;
}

function loadExisting(db: Database.Database, accountId: number, key: string): IdempotencyRow | undefined {
  return db
    .prepare(
      `SELECT *
       FROM idempotency_keys
       WHERE accountId = ? AND key = ?`,
    )
    .get(accountId, key) as IdempotencyRow | undefined;
}

export function runIdempotentJson(
  db: Database.Database,
  req: Request,
  buildResponse: () => IdempotentResponse,
): IdempotentResult {
  const key = readIdempotencyKey(req);
  if (!key) {
    return {
      ...buildResponse(),
      replayed: false,
    };
  }

  const method = req.method.toUpperCase();
  const path = req.originalUrl || req.url;
  const hash = requestHash(req);
  const timestamp = new Date().toISOString();
  const expiresAt = new Date(Date.now() + idempotencyTtlMs).toISOString();

  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO idempotency_keys (
        accountId, userId, key, method, path, requestHash, createdAt, expiresAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(req.auth.accountId, req.auth.userId, key, method, path, hash, timestamp, expiresAt);

  if (inserted.changes === 0) {
    const existing = loadExisting(db, req.auth.accountId, key);
    if (!existing || existing.method !== method || existing.path !== path || existing.requestHash !== hash) {
      throw conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was already used for a different request.');
    }

    if (!existing.responseStatus || !existing.responseBody) {
      throw conflict('IDEMPOTENCY_REQUEST_IN_PROGRESS', 'Matching idempotent request is still in progress.');
    }

    return {
      status: existing.responseStatus,
      body: JSON.parse(existing.responseBody),
      replayed: true,
    };
  }

  try {
    const response = buildResponse();
    db.prepare(
      `UPDATE idempotency_keys
       SET responseStatus = ?, responseBody = ?
       WHERE accountId = ? AND key = ?`,
    ).run(response.status, JSON.stringify(response.body), req.auth.accountId, key);
    return {
      ...response,
      replayed: false,
    };
  } catch (error) {
    db.prepare('DELETE FROM idempotency_keys WHERE accountId = ? AND key = ?').run(req.auth.accountId, key);
    throw error;
  }
}

export async function runIdempotentJsonAsync(
  db: Database.Database,
  req: Request,
  buildResponse: () => Promise<IdempotentResponse>,
): Promise<IdempotentResult> {
  const key = readIdempotencyKey(req);
  if (!key) {
    return {
      ...(await buildResponse()),
      replayed: false,
    };
  }

  const method = req.method.toUpperCase();
  const path = req.originalUrl || req.url;
  const hash = requestHash(req);
  const timestamp = new Date().toISOString();
  const expiresAt = new Date(Date.now() + idempotencyTtlMs).toISOString();

  const inserted = db
    .prepare(
      `INSERT OR IGNORE INTO idempotency_keys (
        accountId, userId, key, method, path, requestHash, createdAt, expiresAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(req.auth.accountId, req.auth.userId, key, method, path, hash, timestamp, expiresAt);

  if (inserted.changes === 0) {
    const existing = loadExisting(db, req.auth.accountId, key);
    if (!existing || existing.method !== method || existing.path !== path || existing.requestHash !== hash) {
      throw conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was already used for a different request.');
    }

    if (!existing.responseStatus || !existing.responseBody) {
      throw conflict('IDEMPOTENCY_REQUEST_IN_PROGRESS', 'Matching idempotent request is still in progress.');
    }

    return {
      status: existing.responseStatus,
      body: JSON.parse(existing.responseBody),
      replayed: true,
    };
  }

  try {
    const response = await buildResponse();
    db.prepare(
      `UPDATE idempotency_keys
       SET responseStatus = ?, responseBody = ?
       WHERE accountId = ? AND key = ?`,
    ).run(response.status, JSON.stringify(response.body), req.auth.accountId, key);
    return {
      ...response,
      replayed: false,
    };
  } catch (error) {
    db.prepare('DELETE FROM idempotency_keys WHERE accountId = ? AND key = ?').run(req.auth.accountId, key);
    throw error;
  }
}

export function sendIdempotentJson(res: Response, response: IdempotentResult) {
  if (response.replayed) {
    res.set('Idempotency-Replayed', 'true');
  }
  res.status(response.status).json(response.body);
}
