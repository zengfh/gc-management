import { Router } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { insertAuditEvent } from '../audit/index.js';
import { requireUnlockedSession } from '../auth/requireAuth.js';
import { requireAdminRole } from '../auth/roles.js';
import { verifyFreshUnlockSecret } from '../auth/verifyUnlockSecret.js';
import {
  createMcpToken,
  mcpScopes,
  mcpScopePresets,
  publicMcpToken,
  type McpTokenRow,
} from '../mcp/tokens.js';
import { asyncHandler, badRequest, notFound } from '../http/errors.js';
import { objectResponse } from '../http/response.js';

const createMcpTokenSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    scopes: z.array(z.enum(mcpScopes)).min(1).max(mcpScopes.length),
    expiresAt: z.string().trim().nullable().optional(),
    currentUnlockSecret: z.string().min(1),
  })
  .strict();

function zodFieldErrors(error: z.ZodError) {
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

function tokenExists(db: Database.Database, accountId: number, userId: number, tokenId: number) {
  return db
    .prepare('SELECT * FROM mcp_tokens WHERE accountId = ? AND userId = ? AND id = ?')
    .get(accountId, userId, tokenId) as McpTokenRow | undefined;
}

function parseTokenId(raw: unknown) {
  const tokenId = Number(raw);
  if (!Number.isInteger(tokenId) || tokenId < 1) {
    throw badRequest('VALIDATION_FAILED', 'Request validation failed.', [
      {
        field: 'tokenId',
        code: 'invalid_integer',
        message: 'Token id must be a positive integer.',
      },
    ]);
  }
  return tokenId;
}

export function createMcpTokensRouter({ db }: { db: Database.Database }) {
  const router = Router();

  router.use(requireUnlockedSession);
  router.use(requireAdminRole);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const rows = db
        .prepare(
          `SELECT *
           FROM mcp_tokens
           WHERE accountId = ? AND userId = ?
           ORDER BY createdAt DESC, id DESC`,
        )
        .all(req.auth.accountId, req.auth.userId) as McpTokenRow[];

      res.json(objectResponse({
        tokens: rows.map(publicMcpToken),
        scopes: mcpScopes,
        presets: mcpScopePresets,
      }));
    }),
  );

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const body = validateBody(createMcpTokenSchema, req.body || {});
      await verifyFreshUnlockSecret(db, req.auth, body.currentUnlockSecret);
      const timestamp = new Date().toISOString();
      const token = createMcpToken({
        db,
        auth: req.auth,
        name: body.name,
        scopes: body.scopes,
        expiresAt: body.expiresAt || null,
      });

      insertAuditEvent(db, {
        accountId: req.auth.accountId,
        userId: req.auth.userId,
        requestId: req.requestId,
        entityType: 'auth',
        entityId: token.id,
        action: 'mcp.token_create',
        metadata: {
          name: token.name,
          scopes: token.scopes,
          expiresAt: token.expiresAt,
        },
        timestamp,
      });

      res.status(201).json(objectResponse(token));
    }),
  );

  router.delete(
    '/:tokenId',
    asyncHandler(async (req, res) => {
      const tokenId = parseTokenId(req.params.tokenId);
      const token = tokenExists(db, req.auth.accountId, req.auth.userId, tokenId);
      if (!token) {
        throw notFound('MCP_TOKEN_NOT_FOUND', 'MCP token not found.');
      }

      const timestamp = new Date().toISOString();
      db.prepare(
        `UPDATE mcp_tokens
         SET revokedAt = COALESCE(revokedAt, ?),
             updatedAt = ?,
             rowVersion = rowVersion + 1
         WHERE id = ? AND accountId = ? AND userId = ?`,
      ).run(timestamp, timestamp, tokenId, req.auth.accountId, req.auth.userId);

      insertAuditEvent(db, {
        accountId: req.auth.accountId,
        userId: req.auth.userId,
        requestId: req.requestId,
        entityType: 'auth',
        entityId: tokenId,
        action: 'mcp.token_revoke',
        metadata: {
          name: token.name,
          scopes: publicMcpToken(token).scopes,
        },
        timestamp,
      });

      res.json(objectResponse({ revoked: true, tokenId: String(tokenId) }));
    }),
  );

  return router;
}
