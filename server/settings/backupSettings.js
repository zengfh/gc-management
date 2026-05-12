const backupSettingKeys = {
  allowPlaintextExport: 'backup.allowPlaintextExport',
  backupReminderDays: 'backup.reminderDays',
  lastPlaintextExportAt: 'backup.lastPlaintextExportAt',
  lastEncryptedExportAt: 'backup.lastEncryptedExportAt',
  lastRawDatabaseExportAt: 'backup.lastRawDatabaseExportAt',
};

const defaultBackupSettings = {
  allowPlaintextExport: true,
  backupReminderDays: 30,
};

export function plaintextExportPolicyLocked() {
  return process.env.GC_PLAINTEXT_EXPORT_ENABLED === 'false';
}

function parseBooleanSetting(value, fallback) {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return fallback;
}

function parseIntegerSetting(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function validTimestamp(value) {
  if (!value || Number.isNaN(Date.parse(value))) {
    return null;
  }
  return value;
}

function mostRecentTimestamp(timestamps) {
  return timestamps
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
}

function nextBackupDueAt(lastBackupAt, backupReminderDays) {
  if (!lastBackupAt || backupReminderDays <= 0) {
    return null;
  }
  return new Date(Date.parse(lastBackupAt) + backupReminderDays * 24 * 60 * 60 * 1000).toISOString();
}

function backupDue(lastBackupAt, backupReminderDays, now) {
  if (backupReminderDays <= 0) {
    return false;
  }
  if (!lastBackupAt) {
    return true;
  }
  return Date.parse(now) >= Date.parse(lastBackupAt) + backupReminderDays * 24 * 60 * 60 * 1000;
}

function settingMap(db, accountId) {
  const rows = db
    .prepare('SELECT key, value FROM app_settings WHERE accountId = ?')
    .all(accountId);
  return new Map(rows.map((row) => [row.key, row.value]));
}

export function readBackupSettings(db, accountId, now = new Date().toISOString()) {
  const settings = settingMap(db, accountId);
  const policyLocked = plaintextExportPolicyLocked();
  const lastPlaintextExportAt = validTimestamp(settings.get(backupSettingKeys.lastPlaintextExportAt));
  const lastEncryptedExportAt = validTimestamp(settings.get(backupSettingKeys.lastEncryptedExportAt));
  const lastRawDatabaseExportAt = validTimestamp(settings.get(backupSettingKeys.lastRawDatabaseExportAt));
  const lastBackupAt = mostRecentTimestamp([
    lastPlaintextExportAt,
    lastEncryptedExportAt,
    lastRawDatabaseExportAt,
  ]);
  const backupReminderDays = parseIntegerSetting(
    settings.get(backupSettingKeys.backupReminderDays),
    defaultBackupSettings.backupReminderDays,
  );

  return {
    allowPlaintextExport: policyLocked
      ? false
      : parseBooleanSetting(
          settings.get(backupSettingKeys.allowPlaintextExport),
          defaultBackupSettings.allowPlaintextExport,
        ),
    plaintextExportPolicyLocked: policyLocked,
    backupReminderDays,
    backupReminderDue: backupDue(lastBackupAt, backupReminderDays, now),
    lastBackupAt,
    nextBackupDueAt: nextBackupDueAt(lastBackupAt, backupReminderDays),
    lastPlaintextExportAt,
    lastEncryptedExportAt,
    lastRawDatabaseExportAt,
  };
}

function upsertSetting(db, accountId, key, value, timestamp) {
  db.prepare(
    `INSERT INTO app_settings (accountId, key, value, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(accountId, key) DO UPDATE SET
       value = excluded.value,
       updatedAt = excluded.updatedAt`,
  ).run(accountId, key, value, timestamp, timestamp);
}

export function updateBackupSettings(db, accountId, settings, timestamp) {
  db.transaction(() => {
    upsertSetting(
      db,
      accountId,
      backupSettingKeys.allowPlaintextExport,
      settings.allowPlaintextExport ? 'true' : 'false',
      timestamp,
    );
    upsertSetting(
      db,
      accountId,
      backupSettingKeys.backupReminderDays,
      String(settings.backupReminderDays),
      timestamp,
    );
  })();
}

export function recordBackupExport(db, accountId, exportType, timestamp) {
  const keyByExportType = {
    plaintext_json: backupSettingKeys.lastPlaintextExportAt,
    encrypted_portable_json: backupSettingKeys.lastEncryptedExportAt,
    raw_sqlite: backupSettingKeys.lastRawDatabaseExportAt,
  };
  const key = keyByExportType[exportType];
  if (!key) {
    return;
  }
  upsertSetting(db, accountId, key, timestamp, timestamp);
}
