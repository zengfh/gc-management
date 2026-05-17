import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { insertAuditEvent } from '../audit/index.js';
import { requireUnlockedSession } from '../auth/requireAuth.js';
import { requireAdminRole } from '../auth/roles.js';
import { verifyFreshUnlockSecret } from '../auth/verifyUnlockSecret.js';
import {
  barcodeFormats,
  buildCredentialModel,
  CredentialValidationError,
  type CredentialInput,
  credentialFieldKinds,
  credentialProfiles,
  insertCredentialFields,
  parseCredentialSummary,
} from '../cards/credentials.js';
import { featureEnabled, requireFeatureFlag } from '../config/featureFlags.js';
import { asyncHandler, badRequest, forbidden } from '../http/errors.js';
import { runIdempotentJsonAsync, sendIdempotentJson } from '../http/idempotency.js';
import { objectResponse } from '../http/response.js';
import { readBackupSettings, recordBackupExport } from '../settings/backupSettings.js';
import { decryptString } from '../security/crypto.js';
import type { AuthContext } from '../types/express.js';

type DatabaseId = number | bigint;

interface ExportCredentialFieldRow {
  id: number;
  accountId: number;
  cardId: number;
  fieldKey: string;
  label: string;
  fieldKind: string;
  sensitivityClass: string;
  encryptedValue: string | null;
  displayHint: string | null;
  barcodeFormat: string | null;
  sortOrder: number;
  copyable: number;
}

interface ExportDealRow {
  id: number;
  accountId: number;
  name: string;
  source: string | null;
  purchaseDate: string | null;
  inputTotalCostCents: number | null;
  notes: string | null;
  archivedAt: string | null;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

interface ExportCardRow {
  id: number;
  accountId: number;
  dealId: number | null;
  brand: string;
  cardType: string;
  network: string | null;
  faceValueCents: number;
  remainingBalanceCents: number;
  purchaseCostCents: number;
  credentialProfile?: string | null;
  credentialSummaryJson?: string | null;
  cardNumber: string | null;
  cardNumberLast4: string | null;
  primaryCredentialLast4?: string | null;
  pin: string | null;
  billingZip: string | null;
  expirationDate: string | null;
  cardholderName: string | null;
  status: string;
  format: string | null;
  source: string | null;
  notes: string | null;
  keyVersion: number;
  reservedFor: string | null;
  reservedUntil: string | null;
  reservedNotes: string | null;
  createdByUserId: number | null;
  updatedByUserId: number | null;
  createdAt: string;
  updatedAt: string;
  rowVersion: number;
}

interface ExportTransactionRow {
  id: number;
  accountId: number;
  cardId: number;
  type: string;
  buyerName: string | null;
  buyerType: string | null;
  salePriceCents: number | null;
  feesCents: number;
  netProceedsCents: number | null;
  remainingBalanceAtSaleCents: number | null;
  statusAtSale: string | null;
  platform: string | null;
  reason: string | null;
  transactionDate: string | null;
  notes: string | null;
  idempotencyKey: string | null;
  createdByUserId: number | null;
  createdAt: string;
}

interface ExportUsageRow {
  id: number;
  accountId: number;
  cardId: number;
  amountCents: number;
  merchant: string | null;
  description: string | null;
  isReversed: number;
  isWriteOff: number;
  reversalReason: string | null;
  reversedAt: string | null;
  usageDate: string | null;
  idempotencyKey: string | null;
  createdByUserId: number | null;
  createdAt: string;
}

interface ExportSettingRow {
  id: number;
  accountId: number;
  key: string;
  value: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ExportReferenceValueRow {
  id: number;
  accountId: number;
  type: string;
  value: string;
  normalizedValue: string;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ImportJobRow {
  id: number;
  type: string;
  status: string;
  rowCount: number;
  validCount: number;
  invalidCount: number;
  createdAt: string;
  updatedAt: string;
}

interface BackupInfo {
  tempDir: string;
  filename: string;
  path: string;
}

interface SqliteErrorLike {
  code?: string;
}

interface HttpErrorLike {
  status?: number;
}

const plaintextExportSchema = z
  .object({
    unlockSecret: z.string().min(1),
    confirmation: z.literal('EXPORT'),
    acknowledgePlaintext: z.literal(true),
  })
  .strict();

const rawDatabaseExportSchema = z
  .object({
    unlockSecret: z.string().min(1),
  })
  .strict();

const portableBackupKdfOptions = {
  name: 'scrypt',
  N: 2 ** 17,
  r: 8,
  p: 1,
  keyLength: 32,
  maxmem: 256 * 1024 * 1024,
} as const;
const portableBackupCipher = 'aes-256-gcm';
const portableBackupIvBytes = 12;
const portableBackupAuthTagBytes = 16;
const portableBackupSaltBytes = 16;
const portableBackupAad = Buffer.from('gc-management:portable-backup:v1', 'utf8');

const encryptedExportSchema = z
  .object({
    unlockSecret: z.string().min(1),
    backupPassphrase: z.string().min(12),
    backupPassphraseConfirmation: z.string().optional(),
    confirmation: z.literal('ENCRYPT'),
  })
  .strict()
  .superRefine((body, context) => {
    if (body.backupPassphrase === body.unlockSecret) {
      context.addIssue({
        code: 'custom',
        path: ['backupPassphrase'],
        message: 'Use a backup passphrase that is different from the unlock secret.',
      });
    }
    if (
      body.backupPassphraseConfirmation != null
      && body.backupPassphraseConfirmation !== body.backupPassphrase
    ) {
      context.addIssue({
        code: 'custom',
        path: ['backupPassphraseConfirmation'],
        message: 'Backup passphrase confirmation does not match.',
      });
    }
  });

const nullableString = z.string().nullable().optional();
const nullableInteger = z.number().int().nullable().optional();
const positiveInteger = z.number().int().positive();
const nonnegativeInteger = z.number().int().nonnegative();

const importSettingSchema = z
  .object({
    key: z.string().trim().min(1).max(120),
    value: nullableString,
    createdAt: nullableString,
    updatedAt: nullableString,
  })
  .passthrough();

const importReferenceValueSchema = z
  .object({
    type: z.enum(['deal_name', 'source', 'card_brand']),
    value: z.string().trim().min(1).max(160),
    normalizedValue: z.string().trim().min(1).max(160).optional(),
    usageCount: nonnegativeInteger.default(0),
    lastUsedAt: nullableString,
    createdAt: nullableString,
    updatedAt: nullableString,
  })
  .passthrough();

const importDealSchema = z
  .object({
    id: positiveInteger.optional(),
    name: z.string().trim().min(1).max(120),
    source: nullableString,
    purchaseDate: nullableString,
    inputTotalCostCents: nullableInteger,
    notes: nullableString,
    archivedAt: nullableString,
    createdAt: nullableString,
    updatedAt: nullableString,
    rowVersion: positiveInteger.optional(),
  })
  .passthrough();

const importCredentialFieldSchema = z
  .object({
    fieldKey: z.string().trim().min(1).max(80).optional(),
    key: z.string().trim().min(1).max(80).optional(),
    label: z.string().trim().min(1).max(80).optional(),
    fieldKind: z.enum(credentialFieldKinds).optional(),
    sensitivityClass: z.string().trim().nullable().optional(),
    value: nullableString,
    displayHint: nullableString,
    barcodeFormat: z.enum(barcodeFormats).nullable().optional(),
    sortOrder: z.number().int().optional(),
    copyable: z.boolean().optional(),
  })
  .passthrough();

const importCredentialsSchema = z
  .object({
    profile: z.enum(credentialProfiles).optional(),
    fields: z.array(importCredentialFieldSchema).default([]),
  })
  .passthrough();

const importCardSchema = z
  .object({
    id: positiveInteger.optional(),
    dealId: nullableInteger,
    brand: z.string().trim().min(1).max(120),
    cardType: z.enum(['merchant', 'prepaid']),
    network: z.enum(['visa', 'mastercard', 'amex', 'discover', 'other']).nullable().optional(),
    faceValueCents: positiveInteger,
    remainingBalanceCents: nonnegativeInteger,
    purchaseCostCents: nonnegativeInteger.default(0),
    credentialProfile: z.enum(credentialProfiles).optional(),
    credentialSummary: z.record(z.string(), z.unknown()).nullable().optional(),
    credentials: importCredentialsSchema.optional(),
    cardNumber: nullableString,
    cardNumberLast4: nullableString,
    pin: nullableString,
    billingZip: nullableString,
    expirationDate: nullableString,
    cardholderName: nullableString,
    status: z.enum(['available', 'reserved', 'in_use', 'sold', 'used_up', 'void']),
    format: z.enum(['digital', 'physical']).nullable().optional(),
    source: nullableString,
    notes: nullableString,
    keyVersion: positiveInteger.optional(),
    reservedFor: nullableString,
    reservedUntil: nullableString,
    reservedNotes: nullableString,
    createdAt: nullableString,
    updatedAt: nullableString,
    rowVersion: positiveInteger.optional(),
  })
  .passthrough()
  .refine((card) => card.remainingBalanceCents <= card.faceValueCents, {
    path: ['remainingBalanceCents'],
    message: 'Remaining balance cannot exceed face value.',
  });

const importTransactionSchema = z
  .object({
    cardId: positiveInteger,
    type: z.enum(['sale', 'sale_reversal']),
    buyerName: nullableString,
    buyerType: z.enum(['dealer', 'group_chat', 'friend', 'self', 'other']).nullable().optional(),
    salePriceCents: nullableInteger,
    feesCents: nonnegativeInteger.default(0),
    netProceedsCents: nullableInteger,
    remainingBalanceAtSaleCents: nullableInteger,
    statusAtSale: z.enum(['available', 'reserved', 'in_use']).nullable().optional(),
    platform: nullableString,
    reason: nullableString,
    transactionDate: nullableString,
    notes: nullableString,
    idempotencyKey: nullableString,
    createdAt: nullableString,
  })
  .passthrough();

const importUsageSchema = z
  .object({
    cardId: positiveInteger,
    amountCents: positiveInteger,
    merchant: nullableString,
    description: nullableString,
    isReversed: z.boolean().optional(),
    isWriteOff: z.boolean().optional(),
    reversalReason: nullableString,
    reversedAt: nullableString,
    usageDate: nullableString,
    idempotencyKey: nullableString,
    createdAt: nullableString,
  })
  .passthrough();

const plaintextImportPayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    exportType: z.literal('plaintext_json'),
    appSettings: z.array(importSettingSchema).default([]),
    referenceValues: z.array(importReferenceValueSchema).default([]),
    deals: z.array(importDealSchema).default([]),
    cards: z.array(importCardSchema).default([]),
    transactions: z.array(importTransactionSchema).default([]),
    usages: z.array(importUsageSchema).default([]),
  })
  .passthrough();

const encryptedPortablePayloadSchema = z
  .object({
    schemaVersion: z.literal(1),
    exportType: z.literal('encrypted_portable_json'),
    payloadSchemaVersion: z.literal(1),
    appVersion: z.string().min(1),
    exportedAt: z.string().min(1),
    encryptedAt: z.string().min(1),
    kdf: z
      .object({
        name: z.literal('scrypt'),
        salt: z.string().min(1),
        N: z.number().int().positive(),
        r: z.number().int().positive(),
        p: z.number().int().positive(),
        keyLength: z.number().int().positive(),
      })
      .strict(),
    cipher: z
      .object({
        name: z.literal(portableBackupCipher),
        iv: z.string().min(1),
        authTag: z.string().min(1),
        ciphertext: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const importPayloadSchema = z.discriminatedUnion('exportType', [
  plaintextImportPayloadSchema,
  encryptedPortablePayloadSchema,
]);

const backupImportSchema = z
  .object({
    unlockSecret: z.string().min(1),
    mode: z.enum(['merge', 'replace']),
    confirmation: z.string().optional(),
    backupPassphrase: z.string().optional(),
    payload: importPayloadSchema,
  })
  .strict()
  .superRefine((body, context) => {
    if (body.mode === 'replace' && body.confirmation !== 'REPLACE') {
      context.addIssue({
        code: 'custom',
        path: ['confirmation'],
        message: 'Type REPLACE to confirm destructive import.',
      });
    }
    if (body.payload.exportType === 'encrypted_portable_json' && !body.backupPassphrase) {
      context.addIssue({
        code: 'custom',
        path: ['backupPassphrase'],
        message: 'Backup passphrase is required for encrypted imports.',
      });
    }
  });

type ImportSetting = z.infer<typeof importSettingSchema>;
type ImportReferenceValue = z.infer<typeof importReferenceValueSchema>;
type ImportDeal = z.infer<typeof importDealSchema>;
type ImportCard = z.infer<typeof importCardSchema>;
type ImportTransaction = z.infer<typeof importTransactionSchema>;
type ImportUsage = z.infer<typeof importUsageSchema>;
type PlaintextImportPayload = z.infer<typeof plaintextImportPayloadSchema>;
type EncryptedPortablePayload = z.infer<typeof encryptedPortablePayloadSchema>;
type ImportMode = z.infer<typeof backupImportSchema>['mode'];
type PortableBackupKdf = EncryptedPortablePayload['kdf'];

function zodFieldErrors(error: z.ZodError) {
  return error.issues.map((issue: z.core.$ZodIssue) => ({
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

function exportDate(timestamp: string) {
  return timestamp.slice(0, 10);
}

function decryptNullable(value: string | null | undefined, key: Buffer) {
  return value ? decryptString(value, key) : null;
}

function toSqlBoolean(value: boolean | null | undefined) {
  return value ? 1 : 0;
}

function timestampOrNow(value: string | null | undefined, timestamp: string) {
  return value || timestamp;
}

function rowVersionOrDefault(value: number | null | undefined) {
  return value || 1;
}

function buildImportedCredentialFields(card: ImportCard, auth: AuthContext) {
  try {
    const model = buildCredentialModel(card as CredentialInput, auth, {
      allowNetworkSecurityCodeStorage: featureEnabled('networkSecurityCodeStorage'),
    });
    return {
      credentialProfile: model.credentialProfile,
      primaryCredentialLast4: model.primaryCredentialLast4 ?? card.cardNumberLast4 ?? null,
      credentialSummaryJson: model.credentialSummaryJson,
      credentialFields: model.fields,
      encryptedCardNumber: model.encryptedCardNumber,
      cardNumberHash: model.cardNumberHash,
      cardNumberLast4: model.cardNumberLast4 ?? card.cardNumberLast4 ?? null,
      pin: model.pin,
      billingZip: model.billingZip,
    };
  } catch (error) {
    if (error instanceof CredentialValidationError) {
      throw badRequest('VALIDATION_FAILED', 'Request validation failed.', error.fieldErrors);
    }
    throw error;
  }
}

function toExportDeal(row: ExportDealRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    source: row.source,
    purchaseDate: row.purchaseDate,
    inputTotalCostCents: row.inputTotalCostCents,
    notes: row.notes,
    archivedAt: row.archivedAt,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    rowVersion: row.rowVersion,
  };
}

interface ExportOptions {
  includeNetworkSecurityCodes?: boolean;
}

function toExportCredentialField(row: ExportCredentialFieldRow, key: Buffer, options: ExportOptions = {}) {
  if (row.fieldKind === 'network_security_code' && !options.includeNetworkSecurityCodes) {
    return null;
  }

  return {
    fieldKey: row.fieldKey,
    label: row.label,
    fieldKind: row.fieldKind,
    sensitivityClass: row.sensitivityClass,
    value: decryptNullable(row.encryptedValue, key),
    displayHint: row.displayHint,
    barcodeFormat: row.barcodeFormat,
    sortOrder: row.sortOrder,
    copyable: row.copyable === 1,
  };
}

function toExportCard(
  row: ExportCardRow,
  key: Buffer,
  credentialRows: ExportCredentialFieldRow[] = [],
  options: ExportOptions = {},
) {
  const credentialFields = credentialRows
    .map((credentialRow) => toExportCredentialField(credentialRow, key, options))
    .filter(Boolean);
  return {
    id: row.id,
    accountId: row.accountId,
    dealId: row.dealId,
    brand: row.brand,
    cardType: row.cardType,
    network: row.network,
    faceValueCents: row.faceValueCents,
    remainingBalanceCents: row.remainingBalanceCents,
    purchaseCostCents: row.purchaseCostCents,
    credentialProfile: row.credentialProfile,
    credentialSummary: parseCredentialSummary(row),
    credentials: {
      profile: row.credentialProfile,
      fields: credentialFields,
    },
    cardNumber: decryptNullable(row.cardNumber, key),
    cardNumberLast4: row.cardNumberLast4,
    pin: decryptNullable(row.pin, key),
    billingZip: decryptNullable(row.billingZip, key),
    expirationDate: row.expirationDate,
    cardholderName: row.cardholderName,
    status: row.status,
    format: row.format,
    source: row.source,
    notes: row.notes,
    keyVersion: row.keyVersion,
    reservedFor: row.reservedFor,
    reservedUntil: row.reservedUntil,
    reservedNotes: row.reservedNotes,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    rowVersion: row.rowVersion,
  };
}

function toExportTransaction(row: ExportTransactionRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    cardId: row.cardId,
    type: row.type,
    buyerName: row.buyerName,
    buyerType: row.buyerType,
    salePriceCents: row.salePriceCents,
    feesCents: row.feesCents,
    netProceedsCents: row.netProceedsCents,
    remainingBalanceAtSaleCents: row.remainingBalanceAtSaleCents,
    statusAtSale: row.statusAtSale,
    platform: row.platform,
    reason: row.reason,
    transactionDate: row.transactionDate,
    notes: row.notes,
    idempotencyKey: row.idempotencyKey,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  };
}

function toExportUsage(row: ExportUsageRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    cardId: row.cardId,
    amountCents: row.amountCents,
    merchant: row.merchant,
    description: row.description,
    isReversed: Boolean(row.isReversed),
    isWriteOff: Boolean(row.isWriteOff),
    reversalReason: row.reversalReason,
    reversedAt: row.reversedAt,
    usageDate: row.usageDate,
    idempotencyKey: row.idempotencyKey,
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt,
  };
}

function toExportSetting(row: ExportSettingRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    key: row.key,
    value: row.value,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toExportReferenceValue(row: ExportReferenceValueRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    type: row.type,
    value: row.value,
    normalizedValue: row.normalizedValue,
    usageCount: row.usageCount,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function buildPlaintextExport(
  db: Database.Database,
  auth: AuthContext,
  exportedAt: string,
  options: ExportOptions = {},
) {
  const dealRows = db
    .prepare('SELECT * FROM deals WHERE accountId = ? ORDER BY id')
    .all(auth.accountId) as ExportDealRow[];
  const cardRows = db
    .prepare('SELECT * FROM cards WHERE accountId = ? ORDER BY id')
    .all(auth.accountId) as ExportCardRow[];
  const credentialRows = db
    .prepare('SELECT * FROM card_credential_fields WHERE accountId = ? ORDER BY cardId, sortOrder, id')
    .all(auth.accountId) as ExportCredentialFieldRow[];
  const transactionRows = db
    .prepare('SELECT * FROM transactions WHERE accountId = ? ORDER BY id')
    .all(auth.accountId) as ExportTransactionRow[];
  const usageRows = db
    .prepare('SELECT * FROM usages WHERE accountId = ? ORDER BY id')
    .all(auth.accountId) as ExportUsageRow[];
  const settingRows = db
    .prepare('SELECT * FROM app_settings WHERE accountId = ? ORDER BY id')
    .all(auth.accountId) as ExportSettingRow[];
  const referenceValueRows = db
    .prepare('SELECT * FROM reference_values WHERE accountId = ? ORDER BY id')
    .all(auth.accountId) as ExportReferenceValueRow[];
  const credentialRowsByCardId = new Map<number, ExportCredentialFieldRow[]>();
  for (const row of credentialRows) {
    const rows = credentialRowsByCardId.get(row.cardId) || [];
    rows.push(row);
    credentialRowsByCardId.set(row.cardId, rows);
  }

  return {
    schemaVersion: 1,
    exportType: 'plaintext_json',
    exportedAt,
    warning:
      options.includeNetworkSecurityCodes
        ? 'This encrypted portable backup payload contains spendable credentials. Store it carefully.'
        : 'This plaintext export contains spendable credentials. Network-card security codes are omitted. Store it carefully and delete it when no longer needed.',
    appSettings: settingRows.map(toExportSetting),
    referenceValues: referenceValueRows.map(toExportReferenceValue),
    deals: dealRows.map(toExportDeal),
    cards: cardRows.map((row) =>
      toExportCard(row, auth.dek, credentialRowsByCardId.get(row.id) || [], options),
    ),
    transactions: transactionRows.map(toExportTransaction),
    usages: usageRows.map(toExportUsage),
  };
}

function portableBackupKdfParams(salt: string): PortableBackupKdf {
  return {
    name: portableBackupKdfOptions.name,
    salt,
    N: portableBackupKdfOptions.N,
    r: portableBackupKdfOptions.r,
    p: portableBackupKdfOptions.p,
    keyLength: portableBackupKdfOptions.keyLength,
  };
}

function ensureSupportedPortableKdf(kdf: PortableBackupKdf) {
  if (
    kdf.name !== portableBackupKdfOptions.name
    || kdf.N !== portableBackupKdfOptions.N
    || kdf.r !== portableBackupKdfOptions.r
    || kdf.p !== portableBackupKdfOptions.p
    || kdf.keyLength !== portableBackupKdfOptions.keyLength
  ) {
    throw badRequest('UNSUPPORTED_BACKUP_KDF', 'Encrypted backup uses unsupported key derivation settings.', [
      {
        field: 'payload.kdf',
        code: 'unsupported',
        message: 'Encrypted backup key derivation settings are not supported by this app version.',
      },
    ]);
  }
}

function derivePortableBackupKey(backupPassphrase: string, kdf: PortableBackupKdf) {
  ensureSupportedPortableKdf(kdf);
  return crypto.scryptSync(
    backupPassphrase,
    Buffer.from(kdf.salt, 'base64'),
    kdf.keyLength,
    {
      N: kdf.N,
      r: kdf.r,
      p: kdf.p,
      maxmem: portableBackupKdfOptions.maxmem,
    },
  );
}

function encryptPortableBackupPayload(
  payload: ReturnType<typeof buildPlaintextExport>,
  backupPassphrase: string,
  timestamp: string,
) {
  const salt = crypto.randomBytes(portableBackupSaltBytes).toString('base64');
  const kdf = portableBackupKdfParams(salt);
  const key = derivePortableBackupKey(backupPassphrase, kdf);
  const iv = crypto.randomBytes(portableBackupIvBytes);

  try {
    const cipher = crypto.createCipheriv(portableBackupCipher, key, iv, {
      authTagLength: portableBackupAuthTagBytes,
    });
    cipher.setAAD(portableBackupAad);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);

    return {
      schemaVersion: 1,
      exportType: 'encrypted_portable_json',
      payloadSchemaVersion: 1,
      appVersion: process.env.npm_package_version || '0.1.0',
      exportedAt: payload.exportedAt,
      encryptedAt: timestamp,
      kdf,
      cipher: {
        name: portableBackupCipher,
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      },
    };
  } finally {
    key.fill(0);
  }
}

function decryptPortableBackupPayload(payload: EncryptedPortablePayload, backupPassphrase: string): PlaintextImportPayload {
  const key = derivePortableBackupKey(backupPassphrase, payload.kdf);

  try {
    const decipher = crypto.createDecipheriv(
      portableBackupCipher,
      key,
      Buffer.from(payload.cipher.iv, 'base64'),
      { authTagLength: portableBackupAuthTagBytes },
    );
    decipher.setAAD(portableBackupAad);
    decipher.setAuthTag(Buffer.from(payload.cipher.authTag, 'base64'));

    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.cipher.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    let parsed: unknown;
    try {
      parsed = JSON.parse(plaintext);
    } catch {
      throw badRequest('INVALID_BACKUP_PAYLOAD', 'Encrypted backup decrypted to invalid JSON.', [
        {
          field: 'payload.cipher.ciphertext',
          code: 'invalid_json',
          message: 'Encrypted backup decrypted to invalid JSON.',
        },
      ]);
    }

    const validation = plaintextImportPayloadSchema.safeParse(parsed);
    if (!validation.success) {
      throw badRequest(
        'INVALID_BACKUP_PAYLOAD',
        'Encrypted backup decrypted to an unsupported payload.',
        zodFieldErrors(validation.error),
      );
    }

    return validation.data;
  } catch (error) {
    if ((error as HttpErrorLike).status) {
      throw error;
    }
    throw badRequest('INVALID_BACKUP_PASSPHRASE', 'Backup passphrase could not decrypt this backup.', [
      {
        field: 'backupPassphrase',
        code: 'decrypt_failed',
        message: 'Backup passphrase could not decrypt this backup.',
      },
    ]);
  } finally {
    key.fill(0);
  }
}

function insertImportedSettings(
  db: Database.Database,
  auth: AuthContext,
  settings: ImportSetting[],
  timestamp: string,
) {
  const statement = db.prepare(
    `INSERT INTO app_settings (accountId, key, value, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(accountId, key) DO UPDATE SET
       value = excluded.value,
       updatedAt = excluded.updatedAt`,
  );

  for (const setting of settings) {
    statement.run(
      auth.accountId,
      setting.key,
      setting.value ?? null,
      timestampOrNow(setting.createdAt, timestamp),
      timestampOrNow(setting.updatedAt, timestamp),
    );
  }
}

function normalizedReferenceValue(value: string) {
  return value.trim().toLowerCase();
}

function insertImportedReferenceValues(
  db: Database.Database,
  auth: AuthContext,
  referenceValues: ImportReferenceValue[],
  timestamp: string,
) {
  const statement = db.prepare(
    `INSERT INTO reference_values (
      accountId, type, value, normalizedValue, usageCount, lastUsedAt, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(accountId, type, normalizedValue) DO UPDATE SET
      value = excluded.value,
      usageCount = MAX(reference_values.usageCount, excluded.usageCount),
      lastUsedAt = COALESCE(excluded.lastUsedAt, reference_values.lastUsedAt),
      updatedAt = excluded.updatedAt`,
  );

  for (const referenceValue of referenceValues) {
    statement.run(
      auth.accountId,
      referenceValue.type,
      referenceValue.value,
      normalizedReferenceValue(referenceValue.value),
      referenceValue.usageCount,
      referenceValue.lastUsedAt ?? null,
      timestampOrNow(referenceValue.createdAt, timestamp),
      timestampOrNow(referenceValue.updatedAt, timestamp),
    );
  }
}

function insertImportedDeals(
  db: Database.Database,
  auth: AuthContext,
  deals: ImportDeal[],
  timestamp: string,
) {
  const dealIdMap = new Map<number, DatabaseId>();
  const statement = db.prepare(
    `INSERT INTO deals (
      accountId, name, source, purchaseDate, inputTotalCostCents, notes, archivedAt,
      createdByUserId, updatedByUserId, createdAt, updatedAt, rowVersion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const deal of deals) {
    const info = statement.run(
      auth.accountId,
      deal.name,
      deal.source ?? null,
      deal.purchaseDate ?? null,
      deal.inputTotalCostCents ?? null,
      deal.notes ?? null,
      deal.archivedAt ?? null,
      auth.userId,
      auth.userId,
      timestampOrNow(deal.createdAt, timestamp),
      timestampOrNow(deal.updatedAt, timestamp),
      rowVersionOrDefault(deal.rowVersion),
    );
    if (deal.id) {
      dealIdMap.set(deal.id, info.lastInsertRowid);
    }
  }

  return dealIdMap;
}

function insertImportedCards(
  db: Database.Database,
  auth: AuthContext,
  cards: ImportCard[],
  dealIdMap: Map<number, DatabaseId>,
  timestamp: string,
) {
  const cardIdMap = new Map<number, DatabaseId>();
  const statement = db.prepare(
    `INSERT INTO cards (
      accountId, dealId, brand, cardType, network, faceValueCents, remainingBalanceCents,
      purchaseCostCents, cardNumber, cardNumberHash, cardNumberLast4, pin, billingZip,
      credentialProfile, primaryCredentialLast4, credentialSummaryJson,
      expirationDate, cardholderName, status, format, source, notes, keyVersion,
      reservedFor, reservedUntil, reservedNotes, createdByUserId, updatedByUserId,
      createdAt, updatedAt, rowVersion
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const card of cards) {
    if (card.dealId && !dealIdMap.has(card.dealId)) {
      throw badRequest('IMPORT_REFERENCE_ERROR', 'Imported card references a missing deal.', [
        {
          field: 'cards.dealId',
          code: 'missing_reference',
          message: 'Imported card references a deal not present in the import payload.',
        },
      ]);
    }

    const credentials = buildImportedCredentialFields(card, auth);
    const info = statement.run(
      auth.accountId,
      card.dealId ? dealIdMap.get(card.dealId) : null,
      card.brand,
      card.cardType,
      card.network ?? null,
      card.faceValueCents,
      card.remainingBalanceCents,
      card.purchaseCostCents,
      credentials.encryptedCardNumber,
      credentials.cardNumberHash,
      credentials.cardNumberLast4,
      credentials.pin,
      credentials.billingZip,
      credentials.credentialProfile,
      credentials.primaryCredentialLast4,
      credentials.credentialSummaryJson,
      card.expirationDate ?? null,
      card.cardholderName ?? null,
      card.status,
      card.format ?? null,
      card.source ?? null,
      card.notes ?? null,
      rowVersionOrDefault(card.keyVersion),
      card.reservedFor ?? null,
      card.reservedUntil ?? null,
      card.reservedNotes ?? null,
      auth.userId,
      auth.userId,
      timestampOrNow(card.createdAt, timestamp),
      timestampOrNow(card.updatedAt, timestamp),
      rowVersionOrDefault(card.rowVersion),
    );
    insertCredentialFields(db, {
      accountId: auth.accountId,
      cardId: info.lastInsertRowid,
      fields: credentials.credentialFields,
      timestamp,
    });
    if (card.id) {
      cardIdMap.set(card.id, info.lastInsertRowid);
    }
  }

  return cardIdMap;
}

function insertImportedTransactions(
  db: Database.Database,
  auth: AuthContext,
  transactions: ImportTransaction[],
  cardIdMap: Map<number, DatabaseId>,
  timestamp: string,
) {
  const statement = db.prepare(
    `INSERT INTO transactions (
      accountId, cardId, type, buyerName, buyerType, salePriceCents, feesCents,
      netProceedsCents, remainingBalanceAtSaleCents, statusAtSale, platform,
      reason, transactionDate, notes, idempotencyKey, createdByUserId, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const transaction of transactions) {
    const cardId = cardIdMap.get(transaction.cardId);
    if (!cardId) {
      throw badRequest('IMPORT_REFERENCE_ERROR', 'Imported transaction references a missing card.', [
        {
          field: 'transactions.cardId',
          code: 'missing_reference',
          message: 'Imported transaction references a card not present in the import payload.',
        },
      ]);
    }

    statement.run(
      auth.accountId,
      cardId,
      transaction.type,
      transaction.buyerName ?? null,
      transaction.buyerType ?? null,
      transaction.salePriceCents ?? null,
      transaction.feesCents,
      transaction.netProceedsCents ?? null,
      transaction.remainingBalanceAtSaleCents ?? null,
      transaction.statusAtSale ?? null,
      transaction.platform ?? null,
      transaction.reason ?? null,
      transaction.transactionDate ?? null,
      transaction.notes ?? null,
      transaction.idempotencyKey ?? null,
      auth.userId,
      timestampOrNow(transaction.createdAt, timestamp),
    );
  }
}

function insertImportedUsages(
  db: Database.Database,
  auth: AuthContext,
  usages: ImportUsage[],
  cardIdMap: Map<number, DatabaseId>,
  timestamp: string,
) {
  const statement = db.prepare(
    `INSERT INTO usages (
      accountId, cardId, amountCents, merchant, description, isReversed,
      isWriteOff, reversalReason, reversedAt, usageDate, idempotencyKey,
      createdByUserId, createdAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const usage of usages) {
    const cardId = cardIdMap.get(usage.cardId);
    if (!cardId) {
      throw badRequest('IMPORT_REFERENCE_ERROR', 'Imported usage references a missing card.', [
        {
          field: 'usages.cardId',
          code: 'missing_reference',
          message: 'Imported usage references a card not present in the import payload.',
        },
      ]);
    }

    statement.run(
      auth.accountId,
      cardId,
      usage.amountCents,
      usage.merchant ?? null,
      usage.description ?? null,
      toSqlBoolean(usage.isReversed),
      toSqlBoolean(usage.isWriteOff),
      usage.reversalReason ?? null,
      usage.reversedAt ?? null,
      usage.usageDate ?? null,
      usage.idempotencyKey ?? null,
      auth.userId,
      timestampOrNow(usage.createdAt, timestamp),
    );
  }
}

function deleteCurrentImportScope(db: Database.Database, auth: AuthContext) {
  db.prepare('DELETE FROM usages WHERE accountId = ?').run(auth.accountId);
  db.prepare('DELETE FROM transactions WHERE accountId = ?').run(auth.accountId);
  db.prepare('DELETE FROM cards WHERE accountId = ?').run(auth.accountId);
  db.prepare('DELETE FROM deals WHERE accountId = ?').run(auth.accountId);
  db.prepare('DELETE FROM reference_values WHERE accountId = ?').run(auth.accountId);
  db.prepare('DELETE FROM app_settings WHERE accountId = ?').run(auth.accountId);
}

function foreignKeyViolations(db: Database.Database) {
  return db.prepare('PRAGMA foreign_key_check').all();
}

function importSummary(mode: ImportMode, payload: PlaintextImportPayload, backupInfo: BackupInfo | null = null) {
  return {
    mode,
    backupCreated: Boolean(backupInfo),
    dealCount: payload.deals.length,
    cardCount: payload.cards.length,
    transactionCount: payload.transactions.length,
    usageCount: payload.usages.length,
    settingCount: payload.appSettings.length,
    referenceValueCount: payload.referenceValues.length,
  };
}

function importPayloadIntoDatabase(
  db: Database.Database,
  auth: AuthContext,
  payload: PlaintextImportPayload,
  mode: ImportMode,
  timestamp: string,
  requestId: string,
  backupInfo: BackupInfo | null = null,
) {
  return db.transaction(() => {
    if (mode === 'replace') {
      deleteCurrentImportScope(db, auth);
    }

    insertImportedSettings(db, auth, payload.appSettings, timestamp);
    insertImportedReferenceValues(db, auth, payload.referenceValues, timestamp);
    const dealIdMap = insertImportedDeals(db, auth, payload.deals, timestamp);
    const cardIdMap = insertImportedCards(db, auth, payload.cards, dealIdMap, timestamp);
    insertImportedTransactions(db, auth, payload.transactions, cardIdMap, timestamp);
    insertImportedUsages(db, auth, payload.usages, cardIdMap, timestamp);

    const violations = foreignKeyViolations(db);
    if (violations.length) {
      throw badRequest('IMPORT_FOREIGN_KEY_FAILED', 'Imported data failed foreign key validation.', [
        {
          field: 'payload',
          code: 'foreign_key_check_failed',
          message: 'Imported data contains broken references.',
        },
      ]);
    }

    const summary = importSummary(mode, payload, backupInfo);
    const rowCount =
      summary.settingCount
      + summary.referenceValueCount
      + summary.dealCount
      + summary.cardCount
      + summary.transactionCount
      + summary.usageCount;
    const jobInfo = db
      .prepare(
        `INSERT INTO import_jobs (
          accountId, userId, type, status, rowCount, validCount, invalidCount,
          summaryJson, createdAt, updatedAt
        ) VALUES (?, ?, ?, 'confirmed', ?, ?, 0, ?, ?, ?)`,
      )
      .run(
        auth.accountId,
        auth.userId,
        mode === 'replace' ? 'json_replace' : 'json_merge',
        rowCount,
        rowCount,
        JSON.stringify(summary),
        timestamp,
        timestamp,
      );
    const importJob = db.prepare('SELECT * FROM import_jobs WHERE id = ?').get(jobInfo.lastInsertRowid) as ImportJobRow;

    insertAuditEvent(db, {
      accountId: auth.accountId,
      userId: auth.userId,
      requestId,
      entityType: 'import',
      entityId: importJob.id,
      action: mode === 'replace' ? 'import.json_replace' : 'import.json_merge',
      metadata: {
        ...summary,
        backupFilename: backupInfo?.filename,
      },
      timestamp,
    });

    return {
      summary,
      importJob: {
        id: importJob.id,
        type: importJob.type,
        status: importJob.status,
        rowCount: importJob.rowCount,
        validCount: importJob.validCount,
        invalidCount: importJob.invalidCount,
        summary,
        createdAt: importJob.createdAt,
        updatedAt: importJob.updatedAt,
      },
    };
  })();
}

function translateImportError(error: unknown) {
  const sqliteError = error as SqliteErrorLike;
  if (sqliteError.code?.startsWith('SQLITE_CONSTRAINT')) {
    return badRequest('IMPORT_CONSTRAINT_FAILED', 'Imported data violates database constraints.');
  }
  return error;
}

async function createPreReplaceBackup(db: Database.Database, timestamp: string): Promise<BackupInfo> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-json-replace-backup-'));
  const filename = `gift-card-pre-import-${exportDate(timestamp)}.sqlite`;
  const backupPath = path.join(tempDir, filename);
  await db.backup(backupPath);
  return {
    tempDir,
    filename,
    path: backupPath,
  };
}

export function createBackupRouter({ db }: { db: Database.Database }) {
  const router = Router();

  router.use(requireUnlockedSession);
  router.use(requireAdminRole);

  router.post(
    '/export',
    asyncHandler(async (req, res) => {
      const body = validateBody(plaintextExportSchema, req.body || {});
      await verifyFreshUnlockSecret(db, req.auth, body.unlockSecret);
      const backupSettings = readBackupSettings(db, req.auth.accountId);
      if (!backupSettings.allowPlaintextExport) {
        throw forbidden(
          'PLAINTEXT_EXPORT_DISABLED',
          backupSettings.plaintextExportPolicyLocked
            ? 'Plaintext JSON export is disabled by deployment policy.'
            : 'Plaintext JSON export is disabled in settings.',
        );
      }

      const timestamp = new Date().toISOString();
      const payload = buildPlaintextExport(db, req.auth, timestamp);
      insertAuditEvent(db, {
        accountId: req.auth.accountId,
        userId: req.auth.userId,
        requestId: req.requestId,
        entityType: 'backup',
        action: 'backup.export_plaintext',
        metadata: {
          exportType: 'plaintext_json',
          dealCount: payload.deals.length,
          cardCount: payload.cards.length,
          transactionCount: payload.transactions.length,
          usageCount: payload.usages.length,
        },
        timestamp,
      });
      recordBackupExport(db, req.auth.accountId, 'plaintext_json', timestamp);

      res.set({
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        'Content-Disposition': `attachment; filename="gift-card-plaintext-export-${exportDate(timestamp)}.json"`,
      });
      res.json(objectResponse(payload));
    }),
  );

  router.post(
    '/export-encrypted',
    asyncHandler(async (req, res) => {
      const body = validateBody(encryptedExportSchema, req.body || {});
      await verifyFreshUnlockSecret(db, req.auth, body.unlockSecret);

      const timestamp = new Date().toISOString();
      const plaintextPayload = buildPlaintextExport(db, req.auth, timestamp, {
        includeNetworkSecurityCodes: true,
      });
      const payload = encryptPortableBackupPayload(plaintextPayload, body.backupPassphrase, timestamp);
      insertAuditEvent(db, {
        accountId: req.auth.accountId,
        userId: req.auth.userId,
        requestId: req.requestId,
        entityType: 'backup',
        action: 'backup.export_encrypted',
        metadata: {
          exportType: 'encrypted_portable_json',
          payloadSchemaVersion: payload.payloadSchemaVersion,
          dealCount: plaintextPayload.deals.length,
          cardCount: plaintextPayload.cards.length,
          transactionCount: plaintextPayload.transactions.length,
          usageCount: plaintextPayload.usages.length,
        },
        timestamp,
      });
      recordBackupExport(db, req.auth.accountId, 'encrypted_portable_json', timestamp);

      res.set({
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        'Content-Disposition': `attachment; filename="gift-card-encrypted-export-${exportDate(timestamp)}.json"`,
      });
      res.json(objectResponse(payload));
    }),
  );

  router.post(
    '/import',
    asyncHandler(async (req, res) => {
      const body = validateBody(backupImportSchema, req.body || {});
      await verifyFreshUnlockSecret(db, req.auth, body.unlockSecret);

      try {
        const response = await runIdempotentJsonAsync(db, req, async () => {
          const timestamp = new Date().toISOString();
          let importPayload: PlaintextImportPayload;
          if (body.payload.exportType === 'encrypted_portable_json') {
            const backupPassphrase = body.backupPassphrase;
            if (!backupPassphrase) {
              throw badRequest('BACKUP_PASSPHRASE_REQUIRED', 'Backup passphrase is required for encrypted imports.');
            }
            importPayload = decryptPortableBackupPayload(body.payload, backupPassphrase);
          } else {
            importPayload = body.payload;
          }
          const backupInfo = body.mode === 'replace' ? await createPreReplaceBackup(db, timestamp) : null;
          const result = importPayloadIntoDatabase(
            db,
            req.auth,
            importPayload,
            body.mode,
            timestamp,
            req.requestId,
            backupInfo,
          );

          return {
            status: 201,
            body: objectResponse(result),
          };
        });

        sendIdempotentJson(res, response);
      } catch (error) {
        throw translateImportError(error);
      }
    }),
  );

  router.post(
    '/db-file',
    requireFeatureFlag('rawDatabaseExport'),
    asyncHandler(async (req, res, next) => {
      const body = validateBody(rawDatabaseExportSchema, req.body || {});
      await verifyFreshUnlockSecret(db, req.auth, body.unlockSecret);

      const timestamp = new Date().toISOString();
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-raw-db-export-'));
      const filename = `gift-card-raw-db-export-${exportDate(timestamp)}.sqlite`;
      const exportPath = path.join(tempDir, filename);

      await db.backup(exportPath);
      insertAuditEvent(db, {
        accountId: req.auth.accountId,
        userId: req.auth.userId,
        requestId: req.requestId,
        entityType: 'backup',
        action: 'backup.export_db_file',
        metadata: {
          exportType: 'raw_sqlite',
        },
        timestamp,
      });
      recordBackupExport(db, req.auth.accountId, 'raw_sqlite', timestamp);

      res.set({
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        'Content-Type': 'application/vnd.sqlite3',
      });
      res.download(exportPath, filename, (error) => {
        fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        if (error) {
          next(error);
        }
      });
    }),
  );

  return router;
}
