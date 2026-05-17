import type { BackupSettings, DataPolicy, FeatureFlags, Page, SupportPolicy } from '../shared/domain';

export const defaultPage: Page = {
  limit: 50,
  offset: 0,
  total: 0,
  hasMore: false,
};

export const defaultBackupSettings: BackupSettings = {
  allowPlaintextExport: true,
  plaintextExportPolicyLocked: false,
  backupReminderDays: 30,
  backupReminderDue: true,
  lastBackupAt: null,
  nextBackupDueAt: null,
  lastPlaintextExportAt: null,
  lastEncryptedExportAt: null,
  lastRawDatabaseExportAt: null,
};

export const defaultSupportPolicy: SupportPolicy = {
  supportAccessEnabled: false,
  supportContact: '',
  supportPolicyUrl: '',
  supportNotes: '',
  supportUpdatedAt: null,
  supportUpdatedByUserId: null,
};

export const defaultDataPolicy: DataPolicy = {
  auditRetentionDays: 365,
  idempotencyRetentionDays: 7,
  sessionRetentionDays: 7,
  loginAttemptRetentionDays: 30,
};

export const defaultFeatureFlags: FeatureFlags = {
  plaintextJsonExport: true,
  rawDatabaseExport: true,
  csvImport: true,
  referenceValueHints: true,
  networkSecurityCodeStorage: false,
};
