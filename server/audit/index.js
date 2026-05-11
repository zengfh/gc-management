export function insertAuditEvent(
  db,
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
  },
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
