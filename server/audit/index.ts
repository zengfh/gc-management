import type Database from 'better-sqlite3';

interface AuditEventInput {
  accountId: number;
  userId?: number | null;
  requestId?: string | null | undefined;
  entityType: string;
  entityId?: number | string | null;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  metadata?: unknown;
  timestamp?: string;
}

export function insertAuditEvent(
  db: Database.Database,
  {
    accountId,
    userId,
    requestId,
    entityType,
    entityId,
    action,
    oldValue = null,
    newValue = null,
    metadata = null,
    timestamp = new Date().toISOString(),
  }: AuditEventInput,
) {
  db.prepare(
    `INSERT INTO audit_log (
      accountId, userId, requestId, entityType, entityId, action,
      oldValue, newValue, metadata, timestamp
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    accountId,
    userId,
    requestId,
    entityType,
    entityId,
    action,
    oldValue ? JSON.stringify(oldValue) : null,
    newValue ? JSON.stringify(newValue) : null,
    metadata ? JSON.stringify(metadata) : null,
    timestamp,
  );
}
