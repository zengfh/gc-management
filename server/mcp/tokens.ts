import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Role } from '../auth/roles.js';
import { adminRoles, operatorRoles } from '../auth/roles.js';
import { forbidden, unauthorized } from '../http/errors.js';
import {
  deriveBlindIndexKey,
  deriveServerSecretKey,
  unwrapDEK,
  wrapDEK,
} from '../security/crypto.js';
import type { AuthContext } from '../types/express.js';

export const mcpScopes = [
  'cards:read',
  'cards:create',
  'cards:update',
  'cards:delete',
  'cards:lifecycle',
  'cards:reveal',
  'deals:read',
  'deals:write',
  'reference:read',
  'reference:write',
] as const;

export type McpScope = (typeof mcpScopes)[number];

export const mcpScopeSet = new Set<string>(mcpScopes);

export const mcpScopePresets = {
  readOnly: ['cards:read', 'deals:read', 'reference:read'],
  readAndReveal: ['cards:read', 'cards:reveal', 'deals:read', 'reference:read'],
  inventoryOperator: [
    'cards:read',
    'cards:create',
    'cards:update',
    'cards:lifecycle',
    'cards:reveal',
    'deals:read',
    'deals:write',
    'reference:read',
    'reference:write',
  ],
  fullVaultAgent: [...mcpScopes],
} satisfies Record<string, McpScope[]>;

export interface McpTokenRow {
  id: number;
  accountId: number;
  userId: number;
  name: string;
  tokenHash: string;
  tokenHint: string;
  scopesJson: string;
  encryptedDEK: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

interface McpTokenAuthRow extends McpTokenRow {
  email: string | null;
  displayName: string | null;
  role: Role;
  disabledAt: string | null;
}

export interface McpTokenPublic {
  id: string;
  name: string;
  tokenHint: string;
  scopes: McpScope[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedMcpToken extends McpTokenPublic {
  token: string;
}

export interface McpAuthContext extends AuthContext {
  tokenId: number;
  tokenName: string;
  scopes: Set<McpScope>;
}

function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function tokenWrappingKey(token: string): Buffer {
  return deriveServerSecretKey(token, 'gc-mcp-token-dek-wrap-v1');
}

function parseScopes(scopesJson: string): McpScope[] {
  try {
    const parsed = JSON.parse(scopesJson);
    if (Array.isArray(parsed)) {
      return parsed.filter((scope): scope is McpScope => mcpScopeSet.has(String(scope)));
    }
  } catch {
    return [];
  }
  return [];
}

function normalizeScopes(scopes: unknown): McpScope[] {
  if (!Array.isArray(scopes)) {
    return [];
  }
  const normalized = scopes
    .map((scope) => String(scope).trim())
    .filter((scope): scope is McpScope => mcpScopeSet.has(scope));
  return [...new Set(normalized)];
}

function scopesAllowedForRole(role: Role): Set<McpScope> {
  if (adminRoles.has(role as 'owner' | 'admin')) {
    return new Set(mcpScopes);
  }
  if (operatorRoles.has(role as 'owner' | 'admin' | 'operator')) {
    return new Set([
      'cards:read',
      'cards:create',
      'cards:update',
      'cards:lifecycle',
      'cards:reveal',
      'deals:read',
      'deals:write',
      'reference:read',
      'reference:write',
    ]);
  }
  return new Set(['cards:read', 'deals:read', 'reference:read']);
}

export function assertScopesAllowedForRole(role: Role, scopes: McpScope[]) {
  const allowed = scopesAllowedForRole(role);
  const denied = scopes.filter((scope) => !allowed.has(scope));
  if (denied.length > 0) {
    throw forbidden('MCP_SCOPE_FORBIDDEN', `Your role cannot grant these MCP scopes: ${denied.join(', ')}.`);
  }
}

export function requireMcpScope(auth: McpAuthContext, scope: McpScope) {
  const allowedByRole = scopesAllowedForRole(auth.role);
  if (!auth.scopes.has(scope) || !allowedByRole.has(scope)) {
    throw forbidden('MCP_SCOPE_REQUIRED', `MCP token requires ${scope}.`);
  }
}

export function publicMcpToken(row: McpTokenRow): McpTokenPublic {
  return {
    id: String(row.id),
    name: row.name,
    tokenHint: row.tokenHint,
    scopes: parseScopes(row.scopesJson),
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createMcpToken({
  db,
  auth,
  name,
  scopes,
  expiresAt,
}: {
  db: Database.Database;
  auth: AuthContext;
  name: string;
  scopes: unknown;
  expiresAt?: string | null;
}): CreatedMcpToken {
  const normalizedScopes = normalizeScopes(scopes);
  if (normalizedScopes.length === 0) {
    throw forbidden('MCP_SCOPE_REQUIRED', 'At least one MCP scope is required.');
  }
  assertScopesAllowedForRole(auth.role, normalizedScopes);

  const token = `gc_mcp_${crypto.randomBytes(32).toString('base64url')}`;
  const timestamp = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO mcp_tokens (
        accountId, userId, name, tokenHash, tokenHint, scopesJson, encryptedDEK,
        expiresAt, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      auth.accountId,
      auth.userId,
      name,
      tokenHash(token),
      `${token.slice(0, 10)}...${token.slice(-6)}`,
      JSON.stringify(normalizedScopes),
      wrapDEK(auth.dek, tokenWrappingKey(token)),
      expiresAt || null,
      timestamp,
      timestamp,
    );

  const row = db.prepare('SELECT * FROM mcp_tokens WHERE id = ?').get(info.lastInsertRowid) as McpTokenRow;
  return {
    ...publicMcpToken(row),
    token,
  };
}

export function authenticateMcpBearerToken(db: Database.Database, authorizationHeader: string | undefined): McpAuthContext {
  const match = /^Bearer\s+(.+)$/i.exec(String(authorizationHeader || '').trim());
  if (!match) {
    throw unauthorized('MCP_TOKEN_REQUIRED', 'MCP bearer token is required.');
  }

  const token = match[1] || '';
  const row = db
    .prepare(
      `SELECT mcp_tokens.*,
              users.email,
              users.displayName,
              users.role,
              users.disabledAt
       FROM mcp_tokens
       JOIN users ON users.id = mcp_tokens.userId AND users.accountId = mcp_tokens.accountId
       WHERE mcp_tokens.tokenHash = ?
       LIMIT 1`,
    )
    .get(tokenHash(token)) as McpTokenAuthRow | undefined;

  const now = new Date().toISOString();
  if (!row || row.revokedAt || (row.expiresAt && row.expiresAt <= now) || row.disabledAt) {
    throw unauthorized('MCP_TOKEN_INVALID', 'MCP bearer token is invalid, expired, or revoked.');
  }

  const dek = unwrapDEK(row.encryptedDEK, tokenWrappingKey(token));
  db.prepare(
    `UPDATE mcp_tokens
     SET lastUsedAt = ?, updatedAt = ?, rowVersion = rowVersion + 1
     WHERE id = ?`,
  ).run(now, now, row.id);

  return {
    userId: row.userId,
    accountId: row.accountId,
    role: row.role,
    email: row.email,
    displayName: row.displayName,
    dek,
    blindIndexKey: deriveBlindIndexKey(dek),
    tokenId: row.id,
    tokenName: row.name,
    scopes: new Set(parseScopes(row.scopesJson)),
  };
}
