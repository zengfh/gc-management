const supportSettingKeys = {
  accessEnabled: 'support.accessEnabled',
  contact: 'support.contact',
  policyUrl: 'support.policyUrl',
  notes: 'support.notes',
  updatedAt: 'support.updatedAt',
  updatedByUserId: 'support.updatedByUserId',
};

const dataSettingKeys = {
  auditRetentionDays: 'data.auditRetentionDays',
  idempotencyRetentionDays: 'data.idempotencyRetentionDays',
  sessionRetentionDays: 'data.sessionRetentionDays',
  loginAttemptRetentionDays: 'data.loginAttemptRetentionDays',
};

const defaultSupportPolicy: SupportPolicy = {
  supportAccessEnabled: false,
  supportContact: '',
  supportPolicyUrl: '',
  supportNotes: '',
  supportUpdatedAt: null,
  supportUpdatedByUserId: null,
};

const defaultDataPolicy: DataPolicy = {
  auditRetentionDays: 365,
  idempotencyRetentionDays: 7,
  sessionRetentionDays: 7,
  loginAttemptRetentionDays: 30,
};

function parseBooleanSetting(value: string | undefined, fallback: boolean): boolean {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return fallback;
}

function parseIntegerSetting(value: string | undefined, fallback: number | null): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function settingMap(db: Database.Database, accountId: number): Map<string, string> {
  const rows = db
    .prepare('SELECT key, value FROM app_settings WHERE accountId = ?')
    .all(accountId) as SettingRow[];
  return new Map(rows.map((row) => [row.key, row.value]));
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

export function readSupportPolicy(db: Database.Database, accountId: number): SupportPolicy {
  const settings = settingMap(db, accountId);
  return {
    supportAccessEnabled: parseBooleanSetting(
      settings.get(supportSettingKeys.accessEnabled),
      defaultSupportPolicy.supportAccessEnabled,
    ),
    supportContact: settings.get(supportSettingKeys.contact) || defaultSupportPolicy.supportContact,
    supportPolicyUrl: settings.get(supportSettingKeys.policyUrl) || defaultSupportPolicy.supportPolicyUrl,
    supportNotes: settings.get(supportSettingKeys.notes) || defaultSupportPolicy.supportNotes,
    supportUpdatedAt: settings.get(supportSettingKeys.updatedAt) || defaultSupportPolicy.supportUpdatedAt,
    supportUpdatedByUserId:
      parseIntegerSetting(
        settings.get(supportSettingKeys.updatedByUserId),
        defaultSupportPolicy.supportUpdatedByUserId,
      ),
  };
}

export function updateSupportPolicy(
  db: Database.Database,
  accountId: number,
  userId: number,
  policy: Pick<SupportPolicy, 'supportAccessEnabled' | 'supportContact' | 'supportPolicyUrl' | 'supportNotes'>,
  timestamp: string,
) {
  db.transaction(() => {
    upsertSetting(
      db,
      accountId,
      supportSettingKeys.accessEnabled,
      policy.supportAccessEnabled ? 'true' : 'false',
      timestamp,
    );
    upsertSetting(db, accountId, supportSettingKeys.contact, policy.supportContact || '', timestamp);
    upsertSetting(db, accountId, supportSettingKeys.policyUrl, policy.supportPolicyUrl || '', timestamp);
    upsertSetting(db, accountId, supportSettingKeys.notes, policy.supportNotes || '', timestamp);
    upsertSetting(db, accountId, supportSettingKeys.updatedAt, timestamp, timestamp);
    upsertSetting(db, accountId, supportSettingKeys.updatedByUserId, String(userId), timestamp);
  })();
}

export function readDataPolicy(db: Database.Database, accountId: number): DataPolicy {
  const settings = settingMap(db, accountId);
  return {
    auditRetentionDays: parseIntegerSetting(
      settings.get(dataSettingKeys.auditRetentionDays),
      defaultDataPolicy.auditRetentionDays,
    ),
    idempotencyRetentionDays: parseIntegerSetting(
      settings.get(dataSettingKeys.idempotencyRetentionDays),
      defaultDataPolicy.idempotencyRetentionDays,
    ),
    sessionRetentionDays: parseIntegerSetting(
      settings.get(dataSettingKeys.sessionRetentionDays),
      defaultDataPolicy.sessionRetentionDays,
    ),
    loginAttemptRetentionDays: parseIntegerSetting(
      settings.get(dataSettingKeys.loginAttemptRetentionDays),
      defaultDataPolicy.loginAttemptRetentionDays,
    ),
  };
}

export function updateDataPolicy(db: Database.Database, accountId: number, policy: DataPolicy, timestamp: string) {
  db.transaction(() => {
    upsertSetting(
      db,
      accountId,
      dataSettingKeys.auditRetentionDays,
      String(policy.auditRetentionDays),
      timestamp,
    );
    upsertSetting(
      db,
      accountId,
      dataSettingKeys.idempotencyRetentionDays,
      String(policy.idempotencyRetentionDays),
      timestamp,
    );
    upsertSetting(
      db,
      accountId,
      dataSettingKeys.sessionRetentionDays,
      String(policy.sessionRetentionDays),
      timestamp,
    );
    upsertSetting(
      db,
      accountId,
      dataSettingKeys.loginAttemptRetentionDays,
      String(policy.loginAttemptRetentionDays),
      timestamp,
    );
  })();
}
import type Database from 'better-sqlite3';

interface SettingRow {
  key: string;
  value: string;
}

interface SupportPolicy {
  supportAccessEnabled: boolean;
  supportContact: string;
  supportPolicyUrl: string;
  supportNotes: string;
  supportUpdatedAt: string | null;
  supportUpdatedByUserId: number | null;
}

interface DataPolicy {
  auditRetentionDays: number;
  idempotencyRetentionDays: number;
  sessionRetentionDays: number;
  loginAttemptRetentionDays: number;
}
