import { Router, type Request } from 'express';
import type Database from 'better-sqlite3';
import { parse as parseCsv } from 'csv-parse/sync';
import { z } from 'zod';
import { insertAuditEvent } from '../audit/index.js';
import { requireUnlockedSession } from '../auth/requireAuth.js';
import { requireOperatorRole } from '../auth/roles.js';
import {
  assertNoDuplicatePreparedCredentials,
  assertNoExistingCredentialDuplicates,
  barcodeFormats,
  buildCredentialModel,
  CredentialValidationError,
  type CredentialFieldKind,
  type CredentialInput,
  credentialFieldKinds,
  credentialProfiles,
  credentialSearchBlindIndexes,
  insertCredentialFields,
  normalizeCredentialValue,
  parseCredentialSummary,
  type PreparedCredentialField,
  revealCredentialPayload,
  type CredentialProfile,
} from '../cards/credentials.js';
import { transitionFor } from '../cards/stateMachine.js';
import { featureEnabled, requireFeatureFlag } from '../config/featureFlags.js';
import { asyncHandler, badRequest, conflict, notFound } from '../http/errors.js';
import { runIdempotentJson, sendIdempotentJson } from '../http/idempotency.js';
import { objectResponse } from '../http/response.js';
import {
  cardNumberHash as hashCardNumber,
  cardNumberLast4,
  normalizeCardNumber,
} from '../security/crypto.js';
import type { AuthContext } from '../types/express.js';

const activeStatuses = new Set(['available', 'reserved', 'in_use']);

interface CardStatusMutationBody {
  reservedFor?: string | null;
  reservedUntil?: string | null;
  reservedNotes?: string | null;
}

interface CountRow {
  count: number;
}

interface ActivityCountRow {
  transactionCount: number;
  usageCount: number;
}

interface AmountRow {
  amountCents: number | null;
}

interface ImportJobRow {
  id: number;
  accountId: number;
  userId: number;
  type: string;
  status: string;
  rowCount: number;
  validCount: number;
  invalidCount: number;
  summaryJson: string | null;
  createdAt: string;
  updatedAt: string;
}

interface CardRow {
  id: number;
  accountId: number;
  dealId: number | null;
  brand: string;
  cardType: string;
  network: string | null;
  faceValueCents: number;
  remainingBalanceCents: number;
  purchaseCostCents: number;
  cardNumberLast4?: string | null;
  primaryCredentialLast4?: string | null;
  credentialProfile?: string | null;
  credentialSummaryJson?: string | null;
  cardNumber?: string | null;
  pin?: string | null;
  billingZip?: string | null;
  expirationDate: string | null;
  status: string;
  format: string | null;
  source: string | null;
  notes: string | null;
  reservedFor: string | null;
  reservedUntil: string | null;
  reservedNotes: string | null;
  latestSalePriceCents?: number | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

interface TransactionRow {
  id: number;
  accountId: number;
  cardId: number;
  type: string;
  remainingBalanceAtSaleCents: number | null;
  statusAtSale: string | null;
}

interface UsageRow {
  id: number;
  accountId: number;
  cardId: number;
  amountCents: number;
  isReversed: number;
  isWriteOff: number;
}

interface AuditRow {
  id: number;
  accountId: number;
  entityType: string;
  entityId: number | null;
  action: string;
  timestamp: string;
}

interface RowValidationError {
  field: string;
  code: string;
  message: string;
}

interface CsvParsedCard {
  brand: string | null;
  cardType: string | null;
  network: string | null;
  credentialProfile: string | null;
  faceValueCents: number | null;
  purchaseCostCents: number | null;
  cardNumberLast4: string | null;
  credentialLabel: string | null;
  credentialHint: string | null;
  hasPin: boolean;
  hasBillingZip: boolean;
  expirationDate: string | null;
  format: string | null;
  source: string | null;
  notes: string | null;
}

interface CsvPreviewRow {
  rowNumber: number;
  valid: boolean;
  parsed: CsvParsedCard;
  cardNumberHash?: string | null;
  errors: RowValidationError[];
}

interface CsvPreview {
  importType: 'csv';
  summary: {
    rowCount: number;
    validCount: number;
    invalidCount: number;
  };
  rows: Omit<CsvPreviewRow, 'cardNumberHash'>[];
}

interface CsvCustomCredentialField {
  fieldKey: string;
  label: string;
  fieldKind: CredentialFieldKind;
  value: string;
  sortOrder: number;
}

interface PreparedCard extends z.infer<typeof cardInputSchema> {
  status: 'available';
  credentialProfile: CredentialProfile;
  primaryCredentialLast4: string | null;
  credentialSummaryJson: string;
  credentialFields: PreparedCredentialField[];
  encryptedCardNumber: string | null;
  cardNumberHash: string | null;
  cardNumberLast4: string | null;
  pin: string | null;
  billingZip: string | null;
}

interface SqliteErrorLike {
  code?: string;
  message?: string;
}

function isCredentialProfile(value: string): value is CredentialProfile {
  return credentialProfiles.includes(value as CredentialProfile);
}

const credentialFieldInputSchema = z
  .object({
    fieldKey: z.string().trim().min(1).max(80).optional(),
    key: z.string().trim().min(1).max(80).optional(),
    label: z.string().trim().min(1).max(80).optional(),
    fieldKind: z.enum(credentialFieldKinds).optional(),
    value: z.string().trim().max(4096).nullable().optional(),
    barcodeFormat: z.enum(barcodeFormats).nullable().optional(),
    sortOrder: z.number().int().optional(),
    copyable: z.boolean().optional(),
  })
  .strict();

const credentialsInputSchema = z
  .object({
    profile: z.enum(credentialProfiles).optional(),
    fields: z.array(credentialFieldInputSchema).max(20).optional(),
  })
  .strict();

const cardInputSchema = z
  .object({
    dealId: z.number().int().positive().nullable().optional(),
    brand: z.string().trim().min(1).max(120),
    cardType: z.enum(['merchant', 'prepaid']),
    network: z.enum(['visa', 'mastercard', 'amex', 'discover', 'other']).nullable().optional(),
    credentialProfile: z.enum(credentialProfiles).optional(),
    credentials: credentialsInputSchema.optional(),
    faceValueCents: z.number().int().positive(),
    purchaseCostCents: z.number().int().nonnegative().default(0),
    cardNumber: z.string().trim().nullable().optional(),
    pin: z.string().trim().nullable().optional(),
    billingZip: z.string().trim().nullable().optional(),
    primaryCode: z.string().trim().nullable().optional(),
    claimCode: z.string().trim().nullable().optional(),
    redemptionCode: z.string().trim().nullable().optional(),
    giftCode: z.string().trim().nullable().optional(),
    accessCode: z.string().trim().nullable().optional(),
    barcodeValue: z.string().trim().nullable().optional(),
    barcodeFormat: z.enum(barcodeFormats).nullable().optional(),
    expirationMonth: z.string().trim().nullable().optional(),
    expirationYear: z.string().trim().nullable().optional(),
    networkSecurityCode: z.string().trim().nullable().optional(),
    cvv: z.string().trim().nullable().optional(),
    billingPostalCode: z.string().trim().nullable().optional(),
    cardholderName: z.string().trim().nullable().optional(),
    billingAddress: z.string().trim().nullable().optional(),
    expirationDate: z.string().trim().nullable().optional(),
    format: z.enum(['digital', 'physical']).nullable().optional(),
    source: z.string().trim().nullable().optional(),
    notes: z.string().trim().nullable().optional(),
  })
  .strict();

const createCardsSchema = z
  .object({
    cards: z.array(cardInputSchema).min(1).max(100),
  })
  .strict();

const importCsvPreviewSchema = z
  .object({
    csv: z.string().min(1).max(1_000_000),
  })
  .strict();

const reserveCardSchema = z
  .object({
    reservedFor: z.string().trim().nullable().optional(),
    reservedUntil: z.string().trim().nullable().optional(),
    reservedNotes: z.string().trim().nullable().optional(),
  })
  .strict();

const updateCardSchema = z
  .object({
    rowVersion: z.number().int().positive().optional(),
    brand: z.string().trim().min(1).max(120).optional(),
    expirationDate: z.string().trim().nullable().optional(),
    notes: z.string().trim().nullable().optional(),
  })
  .strict();

const sellCardSchema = z
  .object({
    salePriceCents: z.number().int().nonnegative(),
    buyerName: z.string().trim().nullable().optional(),
    buyerType: z.enum(['dealer', 'group_chat', 'friend', 'self', 'other']).nullable().optional(),
    platform: z.string().trim().nullable().optional(),
    transactionDate: z.string().trim().nullable().optional(),
    notes: z.string().trim().nullable().optional(),
  })
  .strict();

const terminalStatuses = new Set(['sold', 'used_up', 'void']);
const cardSortColumns = {
  brand: 'brand',
  expirationDate: 'expirationDate',
  faceValueCents: 'faceValueCents',
  purchaseCostCents: 'purchaseCostCents',
  remainingBalanceCents: 'remainingBalanceCents',
  status: 'status',
  updatedAt: 'updatedAt',
};
const csvColumnAliases = {
  brand: ['brand', 'merchant', 'store', 'retailer', 'issuer'],
  cardType: ['cardType', 'card type', 'type', 'card category'],
  network: ['network', 'card network', 'payment network'],
  credentialProfile: ['credentialProfile', 'credential profile', 'credential type', 'redemption format'],
  faceValue: [
    'faceValue',
    'face value',
    'faceValueCents',
    'face value cents',
    'face amount',
    'value',
    'amount',
    'balance',
    'denomination',
  ],
  purchaseCost: [
    'purchaseCost',
    'purchase cost',
    'purchaseCostCents',
    'purchase cost cents',
    'cost',
    'cost basis',
    'paid',
    'paid amount',
    'purchase price',
  ],
  cardNumber: [
    'cardNumber',
    'card number',
    'gift card number',
    'number',
    'account number',
    'code number',
  ],
  primaryCode: ['primaryCode', 'primary code', 'claim code', 'redemption code', 'gift code'],
  pin: ['pin'],
  accessCode: ['accessCode', 'access code'],
  barcodeValue: ['barcodeValue', 'barcode value', 'barcode'],
  barcodeFormat: ['barcodeFormat', 'barcode format'],
  expirationMonth: ['expirationMonth', 'expiration month', 'exp month'],
  expirationYear: ['expirationYear', 'expiration year', 'exp year'],
  networkSecurityCode: ['networkSecurityCode', 'network security code', 'security code', 'cvv', 'cvc', 'cid'],
  billingZip: ['billingZip', 'billing zip', 'zip', 'postal code', 'billing postal code'],
  cardholderName: ['cardholderName', 'cardholder name', 'name on card'],
  billingAddress: ['billingAddress', 'billing address'],
  expirationDate: ['expirationDate', 'expiration date', 'expires', 'expiry', 'exp date'],
  format: ['format', 'delivery', 'delivery method', 'medium'],
  source: ['source', 'purchase source', 'seller', 'platform', 'marketplace'],
  notes: ['notes', 'memo', 'description', 'comments'],
};
const csvNetworkValues = new Set(['visa', 'mastercard', 'amex', 'discover', 'other']);
const csvDigitalFormats = new Set(['digital', 'email', 'e-gift', 'egift', 'online']);
const csvPhysicalFormats = new Set(['physical', 'plastic', 'mail', 'shipped', 'in-store', 'instore']);

const undoSaleSchema = z
  .object({
    reason: z.string().trim().min(1),
  })
  .strict();

const useCardSchema = z
  .object({
    amountCents: z.number().int().positive(),
    merchant: z.string().trim().nullable().optional(),
    description: z.string().trim().nullable().optional(),
    usageDate: z.string().trim().nullable().optional(),
  })
  .strict();

const undoUsageSchema = z
  .object({
    usageId: z.number().int().positive(),
    reason: z.string().trim().min(1),
  })
  .strict();

const voidCardSchema = z
  .object({
    reason: z.string().trim().nullable().optional(),
  })
  .strict();

function nowIso() {
  return new Date().toISOString();
}

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

function parsePositiveInt<T extends number | null>(
  value: unknown,
  fallback: T,
  { min = 0, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {},
): number | T {
  if (value == null || value === '') {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw badRequest('VALIDATION_FAILED', 'Request validation failed.', [
      {
        field: 'query',
        code: 'invalid_integer',
        message: `Expected an integer between ${min} and ${max}.`,
      },
    ]);
  }
  return parsed;
}

function queryValidationError(field: string, code: string, message: string) {
  return badRequest('VALIDATION_FAILED', 'Request validation failed.', [
    {
      field,
      code,
      message,
    },
  ]);
}

function parseDateFilter(value: unknown, field: string) {
  if (value == null || value === '') {
    return null;
  }

  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw queryValidationError(field, 'invalid_date', 'Expected date in YYYY-MM-DD format.');
  }
  return normalized;
}

function isCardSortColumn(value: string): value is keyof typeof cardSortColumns {
  return Object.hasOwn(cardSortColumns, value);
}

function parseCardSort(query: Request['query']) {
  const rawSortBy = query.sortBy == null || query.sortBy === '' ? null : String(query.sortBy);
  const sortBy = rawSortBy || 'updatedAt';
  if (!isCardSortColumn(sortBy)) {
    throw queryValidationError('sortBy', 'invalid_enum', 'Unsupported card sort field.');
  }
  const sortColumn = cardSortColumns[sortBy];

  const rawSortDir = query.sortDir == null || query.sortDir === '' ? null : String(query.sortDir).toLowerCase();
  const sortDir = rawSortDir || (rawSortBy ? 'asc' : 'desc');
  if (!['asc', 'desc'].includes(sortDir)) {
    throw queryValidationError('sortDir', 'invalid_enum', 'Sort direction must be asc or desc.');
  }

  return {
    column: sortColumn,
    direction: sortDir.toUpperCase(),
  };
}

function normalizeHeader(value: unknown) {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function csvValue(record: Record<string, unknown>, aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeHeader);
  const entry = Object.entries(record).find(([key]) => normalizedAliases.includes(normalizeHeader(key)));
  if (!entry) {
    return '';
  }
  return String(entry[1] ?? '').trim();
}

function csvCustomCredentialFields(record: Record<string, unknown>): CsvCustomCredentialField[] {
  return Object.entries(record)
    .map(([key, rawValue], index) => {
      const match = String(key).match(/^custom\s*[:_-]\s*(.+)$/i);
      const value = String(rawValue ?? '').trim();
      if (!match || !value) {
        return null;
      }
      const label = match[1].trim();
      if (!label) {
        return null;
      }
      return {
        fieldKey: label,
        label,
        fieldKind: 'primary_code',
        value,
        sortOrder: (index + 1) * 10,
      };
    })
    .filter((field): field is CsvCustomCredentialField => Boolean(field));
}

function normalizeCsvCardType(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return 'merchant';
  }
  if (['merchant', 'store', 'giftcard', 'gift card'].includes(normalized)) {
    return 'merchant';
  }
  if (['prepaid', 'visa', 'mastercard', 'amex', 'discover'].includes(normalized)) {
    return 'prepaid';
  }
  return normalized;
}

function normalizeCsvNetwork(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  return csvNetworkValues.has(normalized) ? normalized : normalized || null;
}

function normalizeCsvFormat(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (csvDigitalFormats.has(normalized)) {
    return 'digital';
  }
  if (csvPhysicalFormats.has(normalized)) {
    return 'physical';
  }
  return normalized;
}

function normalizeCsvCredentialProfile(value: unknown) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');
  if (!normalized) {
    return null;
  }
  if (['claim_code', 'redemption_code', 'gift_code', 'code'].includes(normalized)) {
    return 'claim_code';
  }
  if (['number_pin', 'card_number_pin', 'merchant_number_pin', 'number'].includes(normalized)) {
    return 'merchant_number_pin';
  }
  if (['barcode', 'bar_code'].includes(normalized)) {
    return 'barcode';
  }
  if (['network_prepaid', 'prepaid', 'visa_mastercard', 'payment_card'].includes(normalized)) {
    return 'network_prepaid';
  }
  return normalized;
}

function maskedCredentialHint(fieldKind: CredentialFieldKind, value: string) {
  const normalized =
    fieldKind === 'card_number'
      ? normalizeCardNumber(value)
      : normalizeCredentialValue(fieldKind, value);
  return normalized ? `****${normalized.slice(-4)}` : null;
}

function csvPrimaryCredentialPreview({
  normalizedCardNumber,
  primaryCode,
  barcodeValue,
  customFields,
}: {
  normalizedCardNumber: string;
  primaryCode: string;
  barcodeValue: string;
  customFields: CsvCustomCredentialField[];
}) {
  if (normalizedCardNumber) {
    return {
      credentialLabel: 'Card number',
      credentialHint: maskedCredentialHint('card_number', normalizedCardNumber),
    };
  }
  if (primaryCode) {
    return {
      credentialLabel: 'Redemption code',
      credentialHint: maskedCredentialHint('primary_code', primaryCode),
    };
  }
  if (barcodeValue) {
    return {
      credentialLabel: 'Barcode',
      credentialHint: maskedCredentialHint('barcode_value', barcodeValue),
    };
  }
  const customPrimary = customFields.find((field) => field.value);
  if (customPrimary) {
    return {
      credentialLabel: customPrimary.label,
      credentialHint: maskedCredentialHint(customPrimary.fieldKind, customPrimary.value),
    };
  }
  return {
    credentialLabel: null,
    credentialHint: null,
  };
}

function rowError(field: string, code: string, message: string): RowValidationError {
  return { field, code, message };
}

function parseMoneyInput(
  raw: unknown,
  field: string,
  { required = false, positive = false }: { required?: boolean; positive?: boolean } = {},
) {
  const value = String(raw || '').trim();
  if (!value) {
    return {
      cents: required ? null : 0,
      error: required ? rowError(field, 'required', `${field} is required.`) : null,
    };
  }

  const normalized = value.replace(/[$,]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    return {
      cents: null,
      error: rowError(field, 'invalid_money', `${field} must be a non-negative money amount.`),
    };
  }

  const cents = Math.round(Number(normalized) * 100);
  if ((positive && cents <= 0) || cents < 0) {
    return {
      cents: null,
      error: rowError(field, 'invalid_money', `${field} must be greater than zero.`),
    };
  }
  return { cents, error: null };
}

function parseCsvRecords(csv: string): Record<string, unknown>[] {
  try {
    return parseCsv(csv, {
      bom: true,
      columns: true,
      relaxColumnCount: true,
      skipEmptyLines: true,
      trim: true,
    }) as Record<string, unknown>[];
  } catch (error) {
    const message = error instanceof Error ? error.message : 'CSV could not be parsed.';
    throw badRequest('CSV_PARSE_FAILED', 'CSV could not be parsed.', [
      rowError('csv', 'invalid_csv', message),
    ]);
  }
}

function previewCsvRow(
  record: Record<string, unknown>,
  rowNumber: number,
  auth: AuthContext,
  importHashes: Set<string>,
): CsvPreviewRow {
  const errors: RowValidationError[] = [];
  const brand = csvValue(record, csvColumnAliases.brand);
  const cardType = normalizeCsvCardType(csvValue(record, csvColumnAliases.cardType));
  const network = normalizeCsvNetwork(csvValue(record, csvColumnAliases.network));
  const credentialProfile = normalizeCsvCredentialProfile(csvValue(record, csvColumnAliases.credentialProfile));
  const faceValue = parseMoneyInput(
    csvValue(record, csvColumnAliases.faceValue),
    'faceValue',
    { required: true, positive: true },
  );
  const purchaseCost = parseMoneyInput(
    csvValue(record, csvColumnAliases.purchaseCost),
    'purchaseCost',
  );
  const normalizedCardNumber = normalizeCardNumber(csvValue(record, csvColumnAliases.cardNumber));
  const primaryCode = csvValue(record, csvColumnAliases.primaryCode);
  const pin = csvValue(record, csvColumnAliases.pin);
  const accessCode = csvValue(record, csvColumnAliases.accessCode);
  const barcodeValue = csvValue(record, csvColumnAliases.barcodeValue);
  const customFields = csvCustomCredentialFields(record);
  const billingZip = csvValue(record, csvColumnAliases.billingZip);
  const expirationDate = csvValue(record, csvColumnAliases.expirationDate);
  const format = normalizeCsvFormat(csvValue(record, csvColumnAliases.format));
  const credentialPreview = csvPrimaryCredentialPreview({
    normalizedCardNumber,
    primaryCode,
    barcodeValue,
    customFields,
  });

  if (!brand) {
    errors.push(rowError('brand', 'required', 'Brand is required.'));
  }
  if (!['merchant', 'prepaid'].includes(cardType)) {
    errors.push(rowError('cardType', 'invalid_enum', 'Card type must be merchant or prepaid.'));
  }
  if (network && !csvNetworkValues.has(network)) {
    errors.push(rowError('network', 'invalid_enum', 'Network must be visa, mastercard, amex, discover, or other.'));
  }
  if (credentialProfile && !isCredentialProfile(credentialProfile)) {
    errors.push(rowError('credentialProfile', 'invalid_enum', 'Credential profile is not supported.'));
  }
  if (faceValue.error) {
    errors.push(faceValue.error);
  }
  if (purchaseCost.error) {
    errors.push(purchaseCost.error);
  }
  if (format && !['digital', 'physical'].includes(format)) {
    errors.push(rowError('format', 'invalid_enum', 'Format must be digital or physical.'));
  }

  let cardNumberHash = null;
  if (normalizedCardNumber) {
    cardNumberHash = hashCardNumber(normalizedCardNumber, auth.blindIndexKey);
    if (brand) {
      const duplicateKey = `${brand}\0${cardNumberHash}`;
      if (importHashes.has(duplicateKey)) {
        errors.push(rowError('cardNumber', 'duplicate_import_row', 'Duplicate card number in this import.'));
      } else {
        importHashes.add(duplicateKey);
      }
    }
  }

  return {
    rowNumber,
    valid: errors.length === 0,
    parsed: {
      brand: brand || null,
      cardType: ['merchant', 'prepaid'].includes(cardType) ? cardType : null,
      network: csvNetworkValues.has(network) ? network : null,
      credentialProfile: isCredentialProfile(credentialProfile) ? credentialProfile : null,
      faceValueCents: faceValue.cents,
      purchaseCostCents: purchaseCost.cents,
      cardNumberLast4: normalizedCardNumber ? cardNumberLast4(normalizedCardNumber) : null,
      credentialLabel: credentialPreview.credentialLabel,
      credentialHint: credentialPreview.credentialHint,
      hasPin: Boolean(pin || accessCode || (normalizedCardNumber && primaryCode)),
      hasBillingZip: Boolean(billingZip),
      expirationDate: expirationDate || null,
      format: ['digital', 'physical'].includes(format) ? format : null,
      source: csvValue(record, csvColumnAliases.source) || null,
      notes: csvValue(record, csvColumnAliases.notes) || null,
    },
    cardNumberHash,
    errors,
  };
}

function applyCsvConflicts(
  db: Database.Database,
  auth: AuthContext,
  rows: CsvPreviewRow[],
): Omit<CsvPreviewRow, 'cardNumberHash'>[] {
  const lookup = db.prepare(
    `SELECT id
     FROM cards
     WHERE accountId = ?
       AND brand = ?
       AND cardNumberHash = ?
       AND status IN ('available', 'reserved', 'in_use')
     LIMIT 1`,
  );

  return rows.map((row) => {
    if (!row.cardNumberHash || !row.parsed.brand) {
      const responseRow = { ...row };
      delete responseRow.cardNumberHash;
      return responseRow;
    }

    const conflictRow = lookup.get(auth.accountId, row.parsed.brand, row.cardNumberHash) as { id: number } | undefined;
    const errors = conflictRow
      ? [
          ...row.errors,
          rowError('cardNumber', 'duplicate_active_card', 'Active duplicate card number already exists.'),
        ]
      : row.errors;
    const responseRow = {
      ...row,
      valid: errors.length === 0,
      errors,
    };
    delete responseRow.cardNumberHash;
    return responseRow;
  });
}

function buildCsvPreview(db: Database.Database, auth: AuthContext, csv: string): CsvPreview {
  const records = parseCsvRecords(csv);
  const importHashes = new Set<string>();
  const previewRows = records.map((record, index) =>
    previewCsvRow(record, index + 2, auth, importHashes),
  );
  const rows = applyCsvConflicts(db, auth, previewRows);
  const validCount = rows.filter((row) => row.valid).length;

  return {
    importType: 'csv',
    summary: {
      rowCount: rows.length,
      validCount,
      invalidCount: rows.length - validCount,
    },
    rows,
  };
}

function csvRecordToCardInput(record: Record<string, unknown>): z.infer<typeof cardInputSchema> {
  const credentialProfile = normalizeCsvCredentialProfile(csvValue(record, csvColumnAliases.credentialProfile));
  const customFields = csvCustomCredentialFields(record);
  return {
    brand: csvValue(record, csvColumnAliases.brand),
    cardType: normalizeCsvCardType(csvValue(record, csvColumnAliases.cardType)) as z.infer<typeof cardInputSchema>['cardType'],
    network: normalizeCsvNetwork(csvValue(record, csvColumnAliases.network)) as z.infer<typeof cardInputSchema>['network'],
    ...(isCredentialProfile(credentialProfile) ? { credentialProfile } : {}),
    faceValueCents: parseMoneyInput(
      csvValue(record, csvColumnAliases.faceValue),
      'faceValue',
      { required: true, positive: true },
    ).cents,
    purchaseCostCents: parseMoneyInput(
      csvValue(record, csvColumnAliases.purchaseCost),
      'purchaseCost',
    ).cents,
    cardNumber: normalizeCardNumber(csvValue(record, csvColumnAliases.cardNumber)),
    primaryCode: csvValue(record, csvColumnAliases.primaryCode) || null,
    pin: csvValue(record, csvColumnAliases.pin) || null,
    accessCode: csvValue(record, csvColumnAliases.accessCode) || null,
    barcodeValue: csvValue(record, csvColumnAliases.barcodeValue) || null,
    barcodeFormat: (csvValue(record, csvColumnAliases.barcodeFormat) || null) as z.infer<typeof cardInputSchema>['barcodeFormat'],
    expirationMonth: csvValue(record, csvColumnAliases.expirationMonth) || null,
    expirationYear: csvValue(record, csvColumnAliases.expirationYear) || null,
    networkSecurityCode: csvValue(record, csvColumnAliases.networkSecurityCode) || null,
    billingZip: csvValue(record, csvColumnAliases.billingZip) || null,
    cardholderName: csvValue(record, csvColumnAliases.cardholderName) || null,
    billingAddress: csvValue(record, csvColumnAliases.billingAddress) || null,
    expirationDate: csvValue(record, csvColumnAliases.expirationDate) || null,
    format: normalizeCsvFormat(csvValue(record, csvColumnAliases.format)) as z.infer<typeof cardInputSchema>['format'],
    source: csvValue(record, csvColumnAliases.source) || null,
    notes: csvValue(record, csvColumnAliases.notes) || null,
    ...(customFields.length > 0
      ? {
          credentialProfile: isCredentialProfile(credentialProfile) ? credentialProfile : 'custom',
          credentials: {
            profile: isCredentialProfile(credentialProfile) ? credentialProfile : 'custom',
            fields: customFields,
          },
        }
      : {}),
  };
}

function toImportJobResponse(row: ImportJobRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    userId: row.userId,
    type: row.type,
    status: row.status,
    rowCount: row.rowCount,
    validCount: row.validCount,
    invalidCount: row.invalidCount,
    summary: row.summaryJson ? JSON.parse(row.summaryJson) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function credentialValidationFailure(error: unknown) {
  if (error instanceof CredentialValidationError) {
    return badRequest('VALIDATION_FAILED', 'Request validation failed.', error.fieldErrors);
  }
  return error;
}

function duplicateCredentialConflict() {
  return conflict('DUPLICATE_ACTIVE_CARD', 'Active duplicate credential for this brand already exists.');
}

function buildCardCredentialFields(input: CredentialInput, auth: AuthContext) {
  try {
    const model = buildCredentialModel(input, auth, {
      allowNetworkSecurityCodeStorage: featureEnabled('networkSecurityCodeStorage'),
    });
    return {
      credentialProfile: model.credentialProfile,
      primaryCredentialLast4: model.primaryCredentialLast4,
      credentialSummaryJson: model.credentialSummaryJson,
      credentialFields: model.fields,
      encryptedCardNumber: model.encryptedCardNumber,
      cardNumberHash: model.cardNumberHash,
      cardNumberLast4: model.cardNumberLast4,
      pin: model.pin,
      billingZip: model.billingZip,
    };
  } catch (error) {
    throw credentialValidationFailure(error);
  }
}

function toCardResponse(row: CardRow) {
  const credentialSummary = parseCredentialSummary(row);
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
    cardNumberLast4: row.cardNumberLast4 ?? row.primaryCredentialLast4,
    credentialProfile: row.credentialProfile,
    credentialSummary,
    expirationDate: row.expirationDate,
    status: row.status,
    format: row.format,
    source: row.source,
    notes: row.notes,
    reservedFor: row.reservedFor,
    reservedUntil: row.reservedUntil,
    reservedNotes: row.reservedNotes,
    latestSalePriceCents: row.latestSalePriceCents ?? null,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toAuditResponse(row: AuditRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    timestamp: row.timestamp,
  };
}

function pageResponse<T>(data: T[], { limit, offset, total }: { limit: number; offset: number; total: number }) {
  return {
    data,
    page: {
      limit,
      offset,
      total,
      hasMore: offset + data.length < total,
    },
  };
}

function createCardAuditValue(card: CardRow) {
  return {
    brand: card.brand,
    cardType: card.cardType,
    faceValueCents: card.faceValueCents,
    purchaseCostCents: card.purchaseCostCents,
    cardNumberLast4: card.cardNumberLast4 ?? card.primaryCredentialLast4,
    credentialProfile: card.credentialProfile,
    credentialSummary: parseCredentialSummary(card),
    status: card.status,
  };
}

function mutationAuditValue(card: CardRow) {
  return {
    brand: card.brand,
    status: card.status,
    remainingBalanceCents: card.remainingBalanceCents,
    rowVersion: card.rowVersion,
  };
}

function assertNoDuplicateInputs(cards: PreparedCard[]) {
  assertNoDuplicatePreparedCredentials(cards, duplicateCredentialConflict);
}

function translateSqliteError(error: unknown) {
  const sqliteError = error as SqliteErrorLike;
  if (sqliteError.code === 'SQLITE_CONSTRAINT_UNIQUE' || sqliteError.message?.includes('idx_cards_active_dedupe')) {
    return conflict('DUPLICATE_ACTIVE_CARD', 'Active duplicate card number for this brand already exists.');
  }

  if (sqliteError.code?.startsWith('SQLITE_CONSTRAINT')) {
    return badRequest('VALIDATION_FAILED', 'Request validation failed.');
  }

  return error;
}

export function createCardsRouter({ db }: { db: Database.Database }) {
  const router = Router();

  router.use(requireUnlockedSession);

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const limit = parsePositiveInt(req.query.limit, 50, { min: 1, max: 100 });
      const offset = parsePositiveInt(req.query.offset, 0, { min: 0 });
      const sort = parseCardSort(req.query);
      const where = ['accountId = ?'];
      const params: unknown[] = [req.auth.accountId];

      if (req.query.status) {
        const status = String(req.query.status);
        if (!activeStatuses.has(status) && !['sold', 'used_up', 'void'].includes(status)) {
          throw badRequest('VALIDATION_FAILED', 'Request validation failed.', [
            {
              field: 'status',
              code: 'invalid_enum',
              message: 'Unsupported card status.',
            },
          ]);
        }
        where.push('status = ?');
        params.push(status);
      }

      if (req.query.brand) {
        where.push('brand = ?');
        params.push(String(req.query.brand).trim());
      }

      if (req.query.source) {
        where.push('source = ?');
        params.push(String(req.query.source).trim());
      }

      const dealId = parsePositiveInt(req.query.dealId, null, { min: 1 });
      if (dealId) {
        where.push('dealId = ?');
        params.push(dealId);
      }

      const expiresBefore = parseDateFilter(req.query.expiresBefore, 'expiresBefore');
      if (expiresBefore) {
        where.push('expirationDate IS NOT NULL AND expirationDate <= ?');
        params.push(expiresBefore);
      }

      const expiresAfter = parseDateFilter(req.query.expiresAfter, 'expiresAfter');
      if (expiresAfter) {
        where.push('expirationDate IS NOT NULL AND expirationDate >= ?');
        params.push(expiresAfter);
      }

      if (req.query.text) {
        const text = String(req.query.text).trim().toLowerCase();
        if (text) {
          const pattern = `%${text}%`;
          where.push(
            `(LOWER(brand) LIKE ? OR LOWER(COALESCE(source, '')) LIKE ? OR LOWER(COALESCE(notes, '')) LIKE ?)`,
          );
          params.push(pattern, pattern, pattern);
        }
      }

      const credentialSearch = req.query.credential ?? req.query.cardNumber;
      if (credentialSearch) {
        const field = req.query.credential ? 'credential' : 'cardNumber';
        if (field === 'cardNumber' && !normalizeCardNumber(credentialSearch)) {
          throw badRequest('VALIDATION_FAILED', 'Request validation failed.', [
            {
              field: 'cardNumber',
              code: 'invalid_card_number',
              message: 'Card number search requires digits.',
            },
          ]);
        }
        const hashes = credentialSearchBlindIndexes(credentialSearch, req.auth.blindIndexKey);
        if (hashes.length === 0) {
          throw badRequest('VALIDATION_FAILED', 'Request validation failed.', [
            {
              field,
              code: 'invalid_credential',
              message: 'Credential search requires a non-empty value.',
            },
          ]);
        }
        const placeholders = hashes.map(() => '?').join(', ');
        where.push(
          `(cardNumberHash IN (${placeholders})
            OR EXISTS (
              SELECT 1
              FROM card_credential_fields AS fields
              WHERE fields.accountId = cards.accountId
                AND fields.cardId = cards.id
                AND fields.blindIndex IN (${placeholders})
            ))`,
        );
        params.push(...hashes, ...hashes);
      }

      const whereClause = where.join(' AND ');
      const total = (db.prepare(`SELECT COUNT(*) AS count FROM cards WHERE ${whereClause}`).get(...params) as CountRow).count;
      const rows = db
        .prepare(
          `SELECT cards.*,
                  (
                    SELECT sale.salePriceCents
                    FROM transactions AS sale
                    WHERE sale.accountId = cards.accountId
                      AND sale.cardId = cards.id
                      AND sale.type = 'sale'
                      AND NOT EXISTS (
                        SELECT 1
                        FROM transactions AS reversal
                        WHERE reversal.accountId = sale.accountId
                          AND reversal.cardId = sale.cardId
                          AND reversal.type = 'sale_reversal'
                          AND reversal.id > sale.id
                      )
                    ORDER BY sale.id DESC
                    LIMIT 1
                  ) AS latestSalePriceCents
           FROM cards
           WHERE ${whereClause}
           ORDER BY ${sort.column} ${sort.direction}, id ${sort.direction}
           LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset) as CardRow[];

      res.json(pageResponse(rows.map(toCardResponse), { limit, offset, total }));
    }),
  );

  router.post(
    '/',
    requireOperatorRole,
    asyncHandler(async (req, res) => {
      const { cards } = validateBody(createCardsSchema, req.body);
      const timestamp = nowIso();
      const preparedCards = cards.map((card) => ({
        ...card,
        ...buildCardCredentialFields(card, req.auth),
        status: 'available' as const,
      }));
      assertNoDuplicateInputs(preparedCards);

      try {
        const createCards = db.transaction(() => {
          assertNoExistingCredentialDuplicates(db, req.auth, preparedCards, duplicateCredentialConflict);
          return preparedCards.map((card) => {
            const info = db
              .prepare(
                `INSERT INTO cards (
                  accountId, dealId, brand, cardType, network, faceValueCents,
                  remainingBalanceCents, purchaseCostCents, cardNumber,
                  cardNumberHash, cardNumberLast4, pin, billingZip,
                  credentialProfile, primaryCredentialLast4, credentialSummaryJson,
                  expirationDate, status, format, source, notes, createdByUserId,
                  updatedByUserId, createdAt, updatedAt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                req.auth.accountId,
                card.dealId ?? null,
                card.brand,
                card.cardType,
                card.network ?? null,
                card.faceValueCents,
                card.faceValueCents,
                card.purchaseCostCents,
                card.encryptedCardNumber,
                card.cardNumberHash,
                card.cardNumberLast4,
                card.pin,
                card.billingZip,
                card.credentialProfile,
                card.primaryCredentialLast4,
                card.credentialSummaryJson,
                card.expirationDate ?? null,
                card.status,
                card.format ?? null,
                card.source ?? null,
                card.notes ?? null,
                req.auth.userId,
                req.auth.userId,
                timestamp,
                timestamp,
              );

            const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(info.lastInsertRowid) as CardRow;
            insertCredentialFields(db, {
              accountId: req.auth.accountId,
              cardId: row.id,
              fields: card.credentialFields,
              timestamp,
            });
            insertAuditEvent(db, {
              accountId: req.auth.accountId,
              userId: req.auth.userId,
              requestId: req.requestId,
              entityType: 'card',
              entityId: row.id,
              action: 'card.create',
              newValue: createCardAuditValue(row),
              timestamp,
            });
            return row;
          });
        });

        const created = createCards();
        res
          .status(201)
          .json(pageResponse(created.map(toCardResponse), { limit: created.length, offset: 0, total: created.length }));
      } catch (error) {
        throw translateSqliteError(error);
      }
    }),
  );

  router.post(
    '/import-csv',
    requireOperatorRole,
    requireFeatureFlag('csvImport'),
    asyncHandler(async (req, res) => {
      const body = validateBody(importCsvPreviewSchema, req.body || {});
      res.json(objectResponse(buildCsvPreview(db, req.auth, body.csv)));
    }),
  );

  router.post(
    '/import-csv/confirm',
    requireOperatorRole,
    requireFeatureFlag('csvImport'),
    asyncHandler(async (req, res) => {
      const body = validateBody(importCsvPreviewSchema, req.body || {});
      const preview = buildCsvPreview(db, req.auth, body.csv);
      if (preview.summary.invalidCount > 0) {
        throw conflict('CSV_IMPORT_INVALID', 'CSV import has invalid rows.', {
          summary: preview.summary,
          rows: preview.rows,
        });
      }

      const timestamp = nowIso();
      const cards = parseCsvRecords(body.csv).map(csvRecordToCardInput);
      const preparedCards = cards.map((card) => ({
        ...card,
        ...buildCardCredentialFields(card, req.auth),
        status: 'available' as const,
      }));
      assertNoDuplicateInputs(preparedCards);

      try {
        const response = runIdempotentJson(db, req, () => {
          const result = db.transaction(() => {
            assertNoExistingCredentialDuplicates(db, req.auth, preparedCards, duplicateCredentialConflict);
            const jobInfo = db
              .prepare(
                `INSERT INTO import_jobs (
                  accountId, userId, type, status, rowCount, validCount, invalidCount,
                  summaryJson, createdAt, updatedAt
                ) VALUES (?, ?, 'csv', 'confirmed', ?, ?, ?, ?, ?, ?)`,
              )
              .run(
                req.auth.accountId,
                req.auth.userId,
                preview.summary.rowCount,
                preview.summary.validCount,
                preview.summary.invalidCount,
                JSON.stringify(preview.summary),
                timestamp,
                timestamp,
              );

            const createdCards = preparedCards.map((card) => {
              const info = db
                .prepare(
                  `INSERT INTO cards (
                  accountId, dealId, brand, cardType, network, faceValueCents,
                  remainingBalanceCents, purchaseCostCents, cardNumber,
                  cardNumberHash, cardNumberLast4, pin, billingZip,
                  credentialProfile, primaryCredentialLast4, credentialSummaryJson,
                  expirationDate, status, format, source, notes, createdByUserId,
                  updatedByUserId, createdAt, updatedAt
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                  req.auth.accountId,
                  null,
                  card.brand,
                  card.cardType,
                  card.network ?? null,
                  card.faceValueCents,
                  card.faceValueCents,
                  card.purchaseCostCents,
                  card.encryptedCardNumber,
                  card.cardNumberHash,
                  card.cardNumberLast4,
                  card.pin,
                  card.billingZip,
                  card.credentialProfile,
                  card.primaryCredentialLast4,
                  card.credentialSummaryJson,
                  card.expirationDate,
                  card.status,
                  card.format,
                  card.source,
                  card.notes,
                  req.auth.userId,
                  req.auth.userId,
                  timestamp,
                  timestamp,
                );

              const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(info.lastInsertRowid) as CardRow;
              insertCredentialFields(db, {
                accountId: req.auth.accountId,
                cardId: row.id,
                fields: card.credentialFields,
                timestamp,
              });
              insertAuditEvent(db, {
                accountId: req.auth.accountId,
                userId: req.auth.userId,
                requestId: req.requestId,
                entityType: 'card',
                entityId: row.id,
                action: 'card.create',
                newValue: createCardAuditValue(row),
                timestamp,
              });
              return row;
            });

            const importJob = db.prepare('SELECT * FROM import_jobs WHERE id = ?').get(jobInfo.lastInsertRowid) as ImportJobRow;
            insertAuditEvent(db, {
              accountId: req.auth.accountId,
              userId: req.auth.userId,
              requestId: req.requestId,
              entityType: 'import',
              entityId: importJob.id,
              action: 'import.csv_confirm',
              metadata: {
                rowCount: preview.summary.rowCount,
                validCount: preview.summary.validCount,
                invalidCount: preview.summary.invalidCount,
                cardCount: createdCards.length,
              },
              timestamp,
            });

            return {
              importJob,
              cards: createdCards,
            };
          })();

          return {
            status: 201,
            body: objectResponse({
              summary: preview.summary,
              importJob: toImportJobResponse(result.importJob),
              cards: result.cards.map(toCardResponse),
            }),
          };
        });

        sendIdempotentJson(res, response);
      } catch (error) {
        throw translateSqliteError(error);
      }
    }),
  );

  function loadCard(auth: AuthContext, cardId: number): CardRow {
    const card = db
      .prepare('SELECT * FROM cards WHERE accountId = ? AND id = ?')
      .get(auth.accountId, cardId) as CardRow | undefined;

    if (!card) {
      throw notFound('CARD_NOT_FOUND', 'Card not found.');
    }

    return card;
  }

  function cardDetail(auth: AuthContext, cardId: number) {
    const card = loadCard(auth, cardId);
    const transactions = db
      .prepare('SELECT * FROM transactions WHERE accountId = ? AND cardId = ? ORDER BY createdAt DESC, id DESC')
      .all(auth.accountId, cardId) as TransactionRow[];
    const usages = db
      .prepare('SELECT * FROM usages WHERE accountId = ? AND cardId = ? ORDER BY createdAt DESC, id DESC')
      .all(auth.accountId, cardId) as UsageRow[];
    const audit = db
      .prepare(
        `SELECT id, accountId, entityType, entityId, action, timestamp
         FROM audit_log
         WHERE accountId = ? AND entityType = 'card' AND entityId = ?
         ORDER BY timestamp DESC, id DESC`,
      )
      .all(auth.accountId, cardId) as AuditRow[];

    return {
      card: toCardResponse(card),
      transactions,
      usages,
      audit: audit.map(toAuditResponse),
    };
  }

  router.post(
    '/:cardId/reveal',
    requireOperatorRole,
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const timestamp = nowIso();
      const card = loadCard(req.auth, cardId);

      insertAuditEvent(db, {
        accountId: req.auth.accountId,
        userId: req.auth.userId,
        requestId: req.requestId,
        entityType: 'card',
        entityId: cardId,
        action: 'card.credentials_reveal',
        metadata: {
          credentialProfile: card.credentialProfile,
          credentialSummary: parseCredentialSummary(card),
        },
        timestamp,
      });

      res.set({
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      });
      const credentials = revealCredentialPayload(db, card, req.auth);
      const byKind = Object.fromEntries(
        credentials.fields.map((field) => [field.fieldKind, field.value]),
      );
      res.json(
        objectResponse({
          cardNumber: byKind.card_number ?? null,
          cardNumberLast4: card.cardNumberLast4 ?? card.primaryCredentialLast4,
          pin: byKind.pin ?? null,
          billingZip: byKind.billing_postal_code ?? null,
          credentials,
        }),
      );
    }),
  );

  function mutateCardStatus({
    req,
    cardId,
    transitionAction,
    body = {},
  }: {
    req: Request;
    cardId: number;
    transitionAction: string;
    body?: CardStatusMutationBody;
  }) {
    const timestamp = nowIso();

    return db.transaction(() => {
      const before = loadCard(req.auth, cardId);
      const transition = transitionFor(transitionAction, before.status);

      db.prepare(
        `UPDATE cards
         SET status = ?,
             reservedFor = ?,
             reservedUntil = ?,
             reservedNotes = ?,
             updatedByUserId = ?,
             updatedAt = ?,
             rowVersion = rowVersion + 1
         WHERE id = ? AND accountId = ?`,
      ).run(
        transition.status,
        transitionAction === 'reserve' ? body.reservedFor ?? null : null,
        transitionAction === 'reserve' ? body.reservedUntil ?? null : null,
        transitionAction === 'reserve' ? body.reservedNotes ?? null : null,
        req.auth.userId,
        timestamp,
        cardId,
        req.auth.accountId,
      );

      const after = loadCard(req.auth, cardId);
      insertAuditEvent(db, {
        accountId: req.auth.accountId,
        userId: req.auth.userId,
        requestId: req.requestId,
        entityType: 'card',
        entityId: cardId,
        action: transition.action,
        oldValue: mutationAuditValue(before),
        newValue: mutationAuditValue(after),
        timestamp,
      });

      return after;
    })();
  }

  router.put(
    '/:cardId',
    requireOperatorRole,
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const body = validateBody(updateCardSchema, req.body || {});
      const timestamp = nowIso();
      const updateFields = Object.keys(body).filter((field) => field !== 'rowVersion');

      if (updateFields.length === 0) {
        throw badRequest('NO_CHANGES', 'At least one card field must be changed.');
      }

      try {
        const updated = db.transaction(() => {
          const before = loadCard(req.auth, cardId);

          if (body.rowVersion && body.rowVersion !== before.rowVersion) {
            throw conflict('STALE_CARD_VERSION', 'Card has changed since it was loaded.');
          }

          if (terminalStatuses.has(before.status) && updateFields.some((field) => field !== 'notes')) {
            throw conflict('TERMINAL_CARD_EDIT_RESTRICTED', 'Terminal cards only allow notes edits.');
          }

          const next = {
            brand: body.brand ?? before.brand,
            expirationDate: body.expirationDate === undefined ? before.expirationDate : body.expirationDate,
            notes: body.notes === undefined ? before.notes : body.notes,
          };

          db.prepare(
            `UPDATE cards
             SET brand = ?,
                 expirationDate = ?,
                 notes = ?,
                 updatedByUserId = ?,
                 updatedAt = ?,
                 rowVersion = rowVersion + 1
             WHERE id = ? AND accountId = ?`,
          ).run(
            next.brand,
            next.expirationDate,
            next.notes,
            req.auth.userId,
            timestamp,
            cardId,
            req.auth.accountId,
          );

          const after = loadCard(req.auth, cardId);
          insertAuditEvent(db, {
            accountId: req.auth.accountId,
            userId: req.auth.userId,
            requestId: req.requestId,
            entityType: 'card',
            entityId: cardId,
            action: 'card.update',
            oldValue: mutationAuditValue(before),
            newValue: mutationAuditValue(after),
            timestamp,
          });

          return after;
        })();

        res.json(objectResponse(toCardResponse(updated)));
      } catch (error) {
        throw translateSqliteError(error);
      }
    }),
  );

  router.delete(
    '/:cardId',
    requireOperatorRole,
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const timestamp = nowIso();

      db.transaction(() => {
        const card = loadCard(req.auth, cardId);
        const activity = db
          .prepare(
            `SELECT
              (SELECT COUNT(*) FROM transactions WHERE accountId = ? AND cardId = ?) AS transactionCount,
              (SELECT COUNT(*) FROM usages WHERE accountId = ? AND cardId = ?) AS usageCount`,
          )
          .get(req.auth.accountId, cardId, req.auth.accountId, cardId) as ActivityCountRow;

        if (card.status !== 'available' || activity.transactionCount > 0 || activity.usageCount > 0) {
          throw conflict('CARD_DELETE_RESTRICTED', 'Only never-touched available cards can be deleted.');
        }

        insertAuditEvent(db, {
          accountId: req.auth.accountId,
          userId: req.auth.userId,
          requestId: req.requestId,
          entityType: 'card',
          entityId: cardId,
          action: 'card.delete',
          oldValue: createCardAuditValue(card),
          timestamp,
        });

        db.prepare('DELETE FROM cards WHERE id = ? AND accountId = ?').run(cardId, req.auth.accountId);
      })();

      res.status(204).send();
    }),
  );

  router.post(
    '/:cardId/reserve',
    requireOperatorRole,
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const body = validateBody(reserveCardSchema, req.body || {});
      const response = runIdempotentJson(db, req, () => {
        const card = mutateCardStatus({
          req,
          cardId,
          transitionAction: 'reserve',
          body,
        });

        return {
          status: 200,
          body: objectResponse(toCardResponse(card)),
        };
      });
      sendIdempotentJson(res, response);
    }),
  );

  router.post(
    '/:cardId/unreserve',
    requireOperatorRole,
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const response = runIdempotentJson(db, req, () => {
        const card = mutateCardStatus({
          req,
          cardId,
          transitionAction: 'unreserve',
        });

        return {
          status: 200,
          body: objectResponse(toCardResponse(card)),
        };
      });
      sendIdempotentJson(res, response);
    }),
  );

  router.post(
    '/:cardId/sell',
    requireOperatorRole,
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const body = validateBody(sellCardSchema, req.body);
      const timestamp = nowIso();

      const response = runIdempotentJson(db, req, () => {
        db.transaction(() => {
          const before = loadCard(req.auth, cardId);
          const transition = transitionFor('sell', before.status);

          db.prepare(
            `INSERT INTO transactions (
              accountId, cardId, type, buyerName, buyerType, salePriceCents,
              remainingBalanceAtSaleCents, statusAtSale, platform, transactionDate,
              notes, idempotencyKey, createdByUserId, createdAt
            ) VALUES (?, ?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            req.auth.accountId,
            cardId,
            body.buyerName ?? null,
            body.buyerType ?? null,
            body.salePriceCents,
            before.remainingBalanceCents,
            before.status,
            body.platform ?? null,
            body.transactionDate ?? timestamp.slice(0, 10),
            body.notes ?? null,
            req.get('Idempotency-Key') ?? null,
            req.auth.userId,
            timestamp,
          );

          db.prepare(
            `UPDATE cards
             SET status = ?,
                 remainingBalanceCents = 0,
                 updatedByUserId = ?,
                 updatedAt = ?,
                 rowVersion = rowVersion + 1
             WHERE id = ? AND accountId = ?`,
          ).run(transition.status, req.auth.userId, timestamp, cardId, req.auth.accountId);

          const after = loadCard(req.auth, cardId);
          insertAuditEvent(db, {
            accountId: req.auth.accountId,
            userId: req.auth.userId,
            requestId: req.requestId,
            entityType: 'card',
            entityId: cardId,
            action: transition.action,
            oldValue: mutationAuditValue(before),
            newValue: mutationAuditValue(after),
            metadata: {
              salePriceCents: body.salePriceCents,
            },
            timestamp,
          });
        })();

        return {
          status: 200,
          body: objectResponse(cardDetail(req.auth, cardId)),
        };
      });
      sendIdempotentJson(res, response);
    }),
  );

  router.post(
    '/:cardId/undo-sale',
    requireOperatorRole,
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const body = validateBody(undoSaleSchema, req.body);
      const timestamp = nowIso();

      const response = runIdempotentJson(db, req, () => {
        db.transaction(() => {
          const before = loadCard(req.auth, cardId);
          const transition = transitionFor('undo-sale', before.status);
          const sale = db
            .prepare(
              `SELECT *
               FROM transactions
               WHERE accountId = ? AND cardId = ? AND type = 'sale'
               ORDER BY id DESC
               LIMIT 1`,
            )
            .get(req.auth.accountId, cardId) as TransactionRow | undefined;

          if (!sale) {
            throw conflict('SALE_NOT_FOUND', 'No sale transaction is available to undo.');
          }

          const laterReversal = db
            .prepare(
              `SELECT id
               FROM transactions
               WHERE accountId = ? AND cardId = ? AND type = 'sale_reversal' AND id > ?
               LIMIT 1`,
            )
            .get(req.auth.accountId, cardId, sale.id) as { id: number } | undefined;
          if (laterReversal) {
            throw conflict('SALE_ALREADY_REVERSED', 'Sale has already been reversed.');
          }

          db.prepare(
            `INSERT INTO transactions (
              accountId, cardId, type, remainingBalanceAtSaleCents, statusAtSale,
              reason, idempotencyKey, createdByUserId, createdAt
            ) VALUES (?, ?, 'sale_reversal', ?, ?, ?, ?, ?, ?)`,
          ).run(
            req.auth.accountId,
            cardId,
            sale.remainingBalanceAtSaleCents,
            sale.statusAtSale,
            body.reason,
            req.get('Idempotency-Key') ?? null,
            req.auth.userId,
            timestamp,
          );

          db.prepare(
            `UPDATE cards
             SET status = ?,
                 remainingBalanceCents = ?,
                 updatedByUserId = ?,
                 updatedAt = ?,
                 rowVersion = rowVersion + 1
             WHERE id = ? AND accountId = ?`,
          ).run(
            sale.statusAtSale,
            sale.remainingBalanceAtSaleCents,
            req.auth.userId,
            timestamp,
            cardId,
            req.auth.accountId,
          );

          const after = loadCard(req.auth, cardId);
          insertAuditEvent(db, {
            accountId: req.auth.accountId,
            userId: req.auth.userId,
            requestId: req.requestId,
            entityType: 'card',
            entityId: cardId,
            action: transition.action,
            oldValue: mutationAuditValue(before),
            newValue: mutationAuditValue(after),
            metadata: {
              reason: body.reason,
            },
            timestamp,
          });
        })();

        return {
          status: 200,
          body: objectResponse(cardDetail(req.auth, cardId)),
        };
      });
      sendIdempotentJson(res, response);
    }),
  );

  router.post(
    '/:cardId/use',
    requireOperatorRole,
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const body = validateBody(useCardSchema, req.body);
      const timestamp = nowIso();

      const response = runIdempotentJson(db, req, () => {
        db.transaction(() => {
          const before = loadCard(req.auth, cardId);
          const transition = transitionFor('use', before.status);

          if (body.amountCents > before.remainingBalanceCents) {
            throw conflict('INSUFFICIENT_BALANCE', 'Usage amount exceeds remaining card balance.');
          }

          const remainingBalanceCents = before.remainingBalanceCents - body.amountCents;
          const nextStatus = remainingBalanceCents === 0 ? 'used_up' : 'in_use';

          db.prepare(
            `INSERT INTO usages (
              accountId, cardId, amountCents, merchant, description, usageDate,
              idempotencyKey, createdByUserId, createdAt
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(
            req.auth.accountId,
            cardId,
            body.amountCents,
            body.merchant ?? null,
            body.description ?? null,
            body.usageDate ?? timestamp.slice(0, 10),
            req.get('Idempotency-Key') ?? null,
            req.auth.userId,
            timestamp,
          );

          db.prepare(
            `UPDATE cards
             SET status = ?,
                 remainingBalanceCents = ?,
                 updatedByUserId = ?,
                 updatedAt = ?,
                 rowVersion = rowVersion + 1
             WHERE id = ? AND accountId = ?`,
          ).run(nextStatus, remainingBalanceCents, req.auth.userId, timestamp, cardId, req.auth.accountId);

          const after = loadCard(req.auth, cardId);
          insertAuditEvent(db, {
            accountId: req.auth.accountId,
            userId: req.auth.userId,
            requestId: req.requestId,
            entityType: 'card',
            entityId: cardId,
            action: transition.action,
            oldValue: mutationAuditValue(before),
            newValue: mutationAuditValue(after),
            metadata: {
              amountCents: body.amountCents,
            },
            timestamp,
          });
        })();

        return {
          status: 200,
          body: objectResponse(cardDetail(req.auth, cardId)),
        };
      });
      sendIdempotentJson(res, response);
    }),
  );

  router.post(
    '/:cardId/undo-usage',
    requireOperatorRole,
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const body = validateBody(undoUsageSchema, req.body);
      const timestamp = nowIso();

      const response = runIdempotentJson(db, req, () => {
        db.transaction(() => {
          const before = loadCard(req.auth, cardId);
          const usage = db
            .prepare('SELECT * FROM usages WHERE accountId = ? AND cardId = ? AND id = ?')
            .get(req.auth.accountId, cardId, body.usageId) as UsageRow | undefined;

          if (!usage) {
            throw notFound('USAGE_NOT_FOUND', 'Usage not found.');
          }

          if (usage.isWriteOff) {
            throw conflict('WRITE_OFF_USAGE_NOT_REVERSIBLE', 'Write-off usages cannot be undone.');
          }

          if (usage.isReversed) {
            throw conflict('USAGE_ALREADY_REVERSED', 'Usage has already been reversed.');
          }

          const transition = transitionFor('undo-usage', before.status);

          db.prepare(
            `UPDATE usages
             SET isReversed = 1,
                 reversalReason = ?,
                 reversedAt = ?
             WHERE id = ? AND accountId = ? AND cardId = ?`,
          ).run(body.reason, timestamp, usage.id, req.auth.accountId, cardId);

          const activeUsageTotal =
            (db
              .prepare(
                `SELECT COALESCE(SUM(amountCents), 0) AS amountCents
                 FROM usages
                 WHERE accountId = ?
                   AND cardId = ?
                   AND isReversed = 0
                   AND isWriteOff = 0`,
              )
              .get(req.auth.accountId, cardId) as AmountRow).amountCents || 0;
          const remainingBalanceCents = before.faceValueCents - activeUsageTotal;
          const nextStatus =
            activeUsageTotal === 0 ? 'available' : remainingBalanceCents === 0 ? 'used_up' : 'in_use';

          db.prepare(
            `UPDATE cards
             SET status = ?,
                 remainingBalanceCents = ?,
                 updatedByUserId = ?,
                 updatedAt = ?,
                 rowVersion = rowVersion + 1
             WHERE id = ? AND accountId = ?`,
          ).run(nextStatus, remainingBalanceCents, req.auth.userId, timestamp, cardId, req.auth.accountId);

          const after = loadCard(req.auth, cardId);
          insertAuditEvent(db, {
            accountId: req.auth.accountId,
            userId: req.auth.userId,
            requestId: req.requestId,
            entityType: 'card',
            entityId: cardId,
            action: transition.action,
            oldValue: mutationAuditValue(before),
            newValue: mutationAuditValue(after),
            metadata: {
              usageId: usage.id,
              reason: body.reason,
            },
            timestamp,
          });
        })();

        return {
          status: 200,
          body: objectResponse(cardDetail(req.auth, cardId)),
        };
      });
      sendIdempotentJson(res, response);
    }),
  );

  router.post(
    '/:cardId/void',
    requireOperatorRole,
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      const body = validateBody(voidCardSchema, req.body || {});
      const timestamp = nowIso();

      const response = runIdempotentJson(db, req, () => {
        db.transaction(() => {
          const before = loadCard(req.auth, cardId);
          const transition = transitionFor('void', before.status);

          db.prepare(
            `INSERT INTO usages (
              accountId, cardId, amountCents, merchant, description, isWriteOff,
              usageDate, idempotencyKey, createdByUserId, createdAt
            ) VALUES (?, ?, ?, 'Write-off (Voided)', ?, 1, ?, ?, ?, ?)`,
          ).run(
            req.auth.accountId,
            cardId,
            before.remainingBalanceCents,
            body.reason ?? null,
            timestamp.slice(0, 10),
            req.get('Idempotency-Key') ?? null,
            req.auth.userId,
            timestamp,
          );

          db.prepare(
            `UPDATE cards
             SET status = ?,
                 remainingBalanceCents = 0,
                 updatedByUserId = ?,
                 updatedAt = ?,
                 rowVersion = rowVersion + 1
             WHERE id = ? AND accountId = ?`,
          ).run(transition.status, req.auth.userId, timestamp, cardId, req.auth.accountId);

          const after = loadCard(req.auth, cardId);
          insertAuditEvent(db, {
            accountId: req.auth.accountId,
            userId: req.auth.userId,
            requestId: req.requestId,
            entityType: 'card',
            entityId: cardId,
            action: transition.action,
            oldValue: mutationAuditValue(before),
            newValue: mutationAuditValue(after),
            metadata: {
              writeOffAmountCents: before.remainingBalanceCents,
            },
            timestamp,
          });
        })();

        return {
          status: 200,
          body: objectResponse(cardDetail(req.auth, cardId)),
        };
      });
      sendIdempotentJson(res, response);
    }),
  );

  router.get(
    '/:cardId',
    asyncHandler(async (req, res) => {
      const cardId = parsePositiveInt(req.params.cardId, null, { min: 1 });
      res.json(objectResponse(cardDetail(req.auth, cardId)));
    }),
  );

  return router;
}
