import type Database from 'better-sqlite3';
import { featureEnabled } from '../config/featureFlags.js';

const backupSettingKeys = {
  allowPlaintextExport: 'backup.allowPlaintextExport',
  backupReminderDays: 'backup.reminderDays',
  lastPlaintextExportAt: 'backup.lastPlaintextExportAt',
  lastEncryptedExportAt: 'backup.lastEncryptedExportAt',
  lastRawDatabaseExportAt: 'backup.lastRawDatabaseExportAt',
};

interface SettingRow {
  key: string;
  value: string;
}

interface BackupSettingsUpdate {
  allowPlaintextExport: boolean;
  backupReminderDays: number;
}

type BackupExportType = 'plaintext_json' | 'encrypted_portable_json' | 'raw_sqlite';

const defaultBackupSettings: BackupSettingsUpdate = {
  allowPlaintextExport: true,
  backupReminderDays: 30,
};

export function plaintextExportPolicyLocked() {
  return !featureEnabled('plaintextJsonExport');
}

function parseBooleanSetting(value: string | undefined, fallback: boolean): boolean {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return fallback;
}

function parseIntegerSetting(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function validTimestamp(value: string | undefined): string | null {
  if (!value || Number.isNaN(Date.parse(value))) {
    return null;
  }
  return value;
}

function mostRecentTimestamp(timestamps: Array<string | null>): string | null {
  return timestamps
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
}

function nextBackupDueAt(lastBackupAt: string | null, backupReminderDays: number): string | null {
  if (!lastBackupAt || backupReminderDays <= 0) {
    return null;
  }
  return new Date(Date.parse(lastBackupAt) + backupReminderDays * 24 * 60 * 60 * 1000).toISOString();
}

function backupDue(lastBackupAt: string | null, backupReminderDays: number, now: string): boolean {
  if (backupReminderDays <= 0) {
    return false;
  }
  if (!lastBackupAt) {
    return true;
  }
  return Date.parse(now) >= Date.parse(lastBackupAt) + backupReminderDays * 24 * 60 * 60 * 1000;
}

function settingMap(db: Database.Database, accountId: number): Map<string, string> {
  const rows = db
    .prepare('SELECT key, value FROM app_settings WHERE accountId = ?')
    .all(accountId) as SettingRow[];
  return new Map(rows.map((row) => [row.key, row.value]));
}

export function readBackupSettings(db: Database.Database, accountId: number, now = new Date().toISOString()) {
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

function upsertSetting(db: Database.Database, accountId: number, key: string, value: string, timestamp: string) {
  db.prepare(
    `INSERT INTO app_settings (accountId, key, value, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(accountId, key) DO UPDATE SET
       value = excluded.value,
       updatedAt = excluded.updatedAt`,
  ).run(accountId, key, value, timestamp, timestamp);
}

export function updateBackupSettings(
  db: Database.Database,
  accountId: number,
  settings: BackupSettingsUpdate,
  timestamp: string,
) {
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

export function recordBackupExport(db: Database.Database, accountId: number, exportType: BackupExportType, timestamp: string) {
  const keyByExportType: Record<BackupExportType, string> = {
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
