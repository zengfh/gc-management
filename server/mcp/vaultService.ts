import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  assertNoDuplicatePreparedCredentials,
  assertNoExistingCredentialDuplicates,
  buildCredentialModel,
  CredentialValidationError,
  credentialSearchBlindIndexes,
  insertCredentialFields,
  parseCredentialSummary,
  revealCredentialPayload,
  type CredentialInput,
  type CredentialProfile,
  type PreparedCredentialField,
} from '../cards/credentials.js';
import { transitionFor } from '../cards/stateMachine.js';
import { featureEnabled } from '../config/featureFlags.js';
import { insertAuditEvent } from '../audit/index.js';
import { badRequest, conflict, notFound } from '../http/errors.js';
import type { AuthContext } from '../types/express.js';

const activeStatuses = new Set(['available', 'reserved', 'in_use']);
const terminalStatuses = new Set(['sold', 'used_up', 'void']);

interface CountRow {
  count: number;
}

interface AmountRow {
  amountCents: number | null;
}

interface ActivityCountRow {
  transactionCount: number;
  usageCount: number;
}

interface CardInventorySummaryBaseRow {
  activeRemainingCents: number | null;
  activeCostBasisCents: number | null;
  availableFaceCents: number | null;
  reservedRemainingCents: number | null;
  inUseRemainingCents: number | null;
  expiringSoonRemainingCents: number | null;
  prepaidRemainingCents: number | null;
  staleReservationCount: number | null;
  trackedCards: number | null;
  activeCards: number | null;
  availableCards: number | null;
  reservedCards: number | null;
  inUseCards: number | null;
  soldCards: number | null;
  usedUpCards: number | null;
  voidCards: number | null;
}

interface CardInventorySoldSummaryRow {
  soldProceedsCents: number | null;
  soldCostBasisCents: number | null;
}

interface IdempotencyRow {
  method: string;
  path: string;
  requestHash: string;
  responseStatus: number | null;
  responseBody: string | null;
}

export interface CardRow {
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

interface DealRow {
  id: number;
  accountId: number;
  name: string;
  source: string | null;
  purchaseDate: string | null;
  inputTotalCostCents: number | null;
  notes: string | null;
  archivedAt: string | null;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

interface ReferenceValueRow {
  id: number;
  type: 'deal_name' | 'source' | 'card_brand';
  value: string;
  usageCount: number;
  lastUsedAt: string;
  createdAt: string;
  updatedAt: string;
}

interface PreparedCard extends CardInput {
  dealId: number | null;
  source: string | null | undefined;
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
  expirationDate: string | null;
}

export interface CardInput extends CredentialInput {
  dealId?: number | null | undefined;
  brand: string;
  cardType: 'merchant' | 'prepaid';
  network?: 'visa' | 'mastercard' | 'amex' | 'discover' | 'other' | null | undefined;
  faceValueCents: number;
  purchaseCostCents?: number | undefined;
  expirationDate?: string | null | undefined;
  format?: 'digital' | 'physical' | null | undefined;
  source?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface CardSearchCriteria {
  status?: string | null | undefined;
  activeOnly?: boolean | string | null | undefined;
  cardType?: string | null | undefined;
  brand?: string | null | undefined;
  source?: string | null | undefined;
  dealId?: number | null | undefined;
  dealName?: string | null | undefined;
  expiresBefore?: string | null | undefined;
  expiresAfter?: string | null | undefined;
  text?: string | null | undefined;
  credential?: string | null | undefined;
  sortBy?: string | null | undefined;
  sortDir?: string | null | undefined;
  limit?: number | null | undefined;
  offset?: number | null | undefined;
}

export interface UpdateCardInput {
  rowVersion?: number | undefined;
  brand?: string | undefined;
  cardType?: 'merchant' | 'prepaid' | undefined;
  network?: 'visa' | 'mastercard' | 'amex' | 'discover' | 'other' | null | undefined;
  faceValueCents?: number | undefined;
  remainingBalanceCents?: number | undefined;
  purchaseCostCents?: number | undefined;
  expirationDate?: string | null | undefined;
  format?: 'digital' | 'physical' | null | undefined;
  source?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface DealInput {
  name?: string | undefined;
  source?: string | null | undefined;
  purchaseDate?: string | null | undefined;
  totalCostCents?: number | null | undefined;
  notes?: string | null | undefined;
  cards?: CardInput[] | undefined;
}

export interface UpdateDealInput {
  rowVersion?: number | undefined;
  name?: string | undefined;
  source?: string | null | undefined;
  purchaseDate?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface VaultServiceContext {
  db: Database.Database;
  auth: AuthContext;
  requestId?: string | null | undefined;
}

const cardSortColumns: Record<string, string> = {
  brand: 'brand',
  expirationDate: 'expirationDate',
  faceValueCents: 'faceValueCents',
  purchaseCostCents: 'purchaseCostCents',
  remainingBalanceCents: 'remainingBalanceCents',
  source: 'source',
  status: 'status',
  updatedAt: 'updatedAt',
};

function nowIso() {
  return new Date().toISOString();
}

function dateOnlyInDays(days: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizeCredentialBrandForDuplicate(brand: string) {
  return brand.trim().toLowerCase();
}

function duplicateCredentialConflict() {
  return conflict('DUPLICATE_ACTIVE_CARD', 'Active duplicate credential for this brand already exists.');
}

function credentialValidationFailure(error: unknown) {
  if (error instanceof CredentialValidationError) {
    return badRequest('VALIDATION_FAILED', 'Request validation failed.', error.fieldErrors);
  }
  return error;
}

function translateSqliteError(error: unknown) {
  const sqliteError = error as { code?: string; message?: string };
  if (sqliteError.code === 'SQLITE_CONSTRAINT_UNIQUE' || sqliteError.message?.includes('idx_cards_active_dedupe')) {
    return conflict('DUPLICATE_ACTIVE_CARD', 'Active duplicate card number for this brand already exists.');
  }
  if (sqliteError.code?.startsWith('SQLITE_CONSTRAINT')) {
    return badRequest('VALIDATION_FAILED', 'Request validation failed.');
  }
  return error;
}

function parsePositiveInt(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (value == null || value === '') {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw badRequest('VALIDATION_FAILED', 'Expected integer input.');
  }
  return parsed;
}

function parseDateFilter(value: unknown, field: string) {
  if (value == null || value === '') {
    return null;
  }
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw badRequest('VALIDATION_FAILED', `${field} must be YYYY-MM-DD.`);
  }
  return normalized;
}

function parseSort(sortBy: unknown, sortDir: unknown) {
  const requested = String(sortBy || 'updatedAt');
  if (!Object.hasOwn(cardSortColumns, requested)) {
    throw badRequest('VALIDATION_FAILED', 'Unsupported card sort field.');
  }
  const direction = String(sortDir || (sortBy ? 'asc' : 'desc')).toLowerCase();
  if (!['asc', 'desc'].includes(direction)) {
    throw badRequest('VALIDATION_FAILED', 'Sort direction must be asc or desc.');
  }
  return {
    column: cardSortColumns[requested],
    direction: direction.toUpperCase(),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(objectValue[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function runMcpIdempotent<T>(
  { db, auth }: VaultServiceContext,
  toolName: string,
  idempotencyKey: string,
  input: unknown,
  execute: () => T,
): T {
  const key = String(idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(key)) {
    throw badRequest('INVALID_IDEMPOTENCY_KEY', 'idempotencyKey must be 1-128 URL-safe characters.');
  }
  const method = 'MCP';
  const path = `mcp:${toolName}`;
  const requestHash = crypto
    .createHash('sha256')
    .update(stableStringify({ toolName, input }))
    .digest('hex');

  const existing = db
    .prepare(
      `SELECT method, path, requestHash, responseStatus, responseBody
       FROM idempotency_keys
       WHERE accountId = ? AND key = ?`,
    )
    .get(auth.accountId, key) as IdempotencyRow | undefined;

  if (existing) {
    if (existing.method !== method || existing.path !== path || existing.requestHash !== requestHash) {
      throw conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency key was already used for a different MCP operation.');
    }
    if (!existing.responseStatus || !existing.responseBody) {
      throw conflict('IDEMPOTENCY_REQUEST_IN_PROGRESS', 'Matching idempotent MCP request is still in progress.');
    }
    return JSON.parse(existing.responseBody) as T;
  }

  const timestamp = nowIso();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO idempotency_keys (
      accountId, userId, key, method, path, requestHash, createdAt, expiresAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(auth.accountId, auth.userId, key, method, path, requestHash, timestamp, expiresAt);

  try {
    const response = execute();
    db.prepare(
      `UPDATE idempotency_keys
       SET responseStatus = 200, responseBody = ?
       WHERE accountId = ? AND key = ?`,
    ).run(JSON.stringify(response), auth.accountId, key);
    return response;
  } catch (error) {
    db.prepare('DELETE FROM idempotency_keys WHERE accountId = ? AND key = ?').run(auth.accountId, key);
    throw error;
  }
}

function toCardResponse(row: CardRow) {
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
    credentialSummary: parseCredentialSummary(row),
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

function toDealResponse(row: DealRow) {
  return {
    id: row.id,
    accountId: row.accountId,
    name: row.name,
    source: row.source,
    purchaseDate: row.purchaseDate,
    inputTotalCostCents: row.inputTotalCostCents,
    notes: row.notes,
    archivedAt: row.archivedAt,
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

function toReferenceValueResponse(row: ReferenceValueRow) {
  return {
    id: row.id,
    type: row.type,
    value: row.value,
    usageCount: row.usageCount,
    lastUsedAt: row.lastUsedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
    cardType: card.cardType,
    network: card.network,
    status: card.status,
    faceValueCents: card.faceValueCents,
    remainingBalanceCents: card.remainingBalanceCents,
    purchaseCostCents: card.purchaseCostCents,
    expirationDate: card.expirationDate,
    format: card.format,
    source: card.source,
    notes: card.notes,
    rowVersion: card.rowVersion,
  };
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

function expirationDateFromParts(month: unknown, year: unknown): string | null {
  const monthDigits = String(month || '').replace(/\D/g, '');
  const yearDigits = String(year || '').replace(/\D/g, '');
  if (!monthDigits || !yearDigits) {
    return null;
  }
  const monthNumber = Number(monthDigits);
  const yearNumber = Number(yearDigits.length === 2 ? `20${yearDigits}` : yearDigits);
  if (
    !Number.isInteger(monthNumber)
    || monthNumber < 1
    || monthNumber > 12
    || !Number.isInteger(yearNumber)
    || yearNumber < 2000
    || yearNumber > 2200
  ) {
    return null;
  }
  return `${yearNumber}-${String(monthNumber).padStart(2, '0')}-01`;
}

function expirationDateFromCredentialFields(fields: PreparedCredentialField[]): string | null {
  const month = fields.find((field) => field.fieldKind === 'expiration_month')?.displayHint;
  const year = fields.find((field) => field.fieldKind === 'expiration_year')?.displayHint;
  return expirationDateFromParts(month, year);
}

function cardExpirationDate(input: CardInput, fields: PreparedCredentialField[]): string | null {
  const explicit = String(input.expirationDate || '').trim();
  return explicit || expirationDateFromParts(input.expirationMonth, input.expirationYear) || expirationDateFromCredentialFields(fields);
}

function prepareCard(input: CardInput, auth: AuthContext, dealId: number | null, fallbackSource?: string | null | undefined): PreparedCard {
  const credentials = buildCardCredentialFields(input, auth);
  return {
    ...input,
    dealId,
    source: input.source ?? fallbackSource ?? null,
    purchaseCostCents: input.purchaseCostCents ?? 0,
    ...credentials,
    expirationDate: cardExpirationDate(input, credentials.credentialFields),
    status: 'available',
  };
}

function assertDealBelongsToAccount(db: Database.Database, auth: AuthContext, dealId: number | null | undefined) {
  if (!dealId) {
    return;
  }
  const row = db.prepare('SELECT id FROM deals WHERE accountId = ? AND id = ?').get(auth.accountId, dealId);
  if (!row) {
    throw notFound('DEAL_NOT_FOUND', 'Deal not found.');
  }
}

function insertPreparedCard(
  db: Database.Database,
  auth: AuthContext,
  requestId: string | null | undefined,
  timestamp: string,
  card: PreparedCard,
) {
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
      auth.accountId,
      card.dealId ?? null,
      card.brand,
      card.cardType,
      card.network ?? null,
      card.faceValueCents,
      card.faceValueCents,
      card.purchaseCostCents ?? 0,
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
      card.format ?? null,
      card.source ?? null,
      card.notes ?? null,
      auth.userId,
      auth.userId,
      timestamp,
      timestamp,
    );

  const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(info.lastInsertRowid) as CardRow;
  insertCredentialFields(db, {
    accountId: auth.accountId,
    cardId: row.id,
    fields: card.credentialFields,
    timestamp,
  });
  insertAuditEvent(db, {
    accountId: auth.accountId,
    userId: auth.userId,
    requestId,
    entityType: 'card',
    entityId: row.id,
    action: 'card.create',
    newValue: createCardAuditValue(row),
    timestamp,
  });
  return row;
}

function loadCard(db: Database.Database, auth: AuthContext, cardId: number): CardRow {
  const card = db
    .prepare('SELECT * FROM cards WHERE accountId = ? AND id = ?')
    .get(auth.accountId, cardId) as CardRow | undefined;
  if (!card) {
    throw notFound('CARD_NOT_FOUND', 'Card not found.');
  }
  return card;
}

export function cardInventorySummary({ db, auth }: VaultServiceContext) {
  const today = dateOnlyInDays(0);
  const expiresBy = dateOnlyInDays(30);
  const base = db
    .prepare(
      `SELECT
          COALESCE(SUM(CASE WHEN status IN ('available', 'reserved', 'in_use') THEN remainingBalanceCents ELSE 0 END), 0) AS activeRemainingCents,
          COALESCE(SUM(CASE WHEN status IN ('available', 'reserved', 'in_use') THEN purchaseCostCents ELSE 0 END), 0) AS activeCostBasisCents,
          COALESCE(SUM(CASE WHEN status = 'available' THEN faceValueCents ELSE 0 END), 0) AS availableFaceCents,
          COALESCE(SUM(CASE WHEN status = 'reserved' THEN remainingBalanceCents ELSE 0 END), 0) AS reservedRemainingCents,
          COALESCE(SUM(CASE WHEN status = 'in_use' THEN remainingBalanceCents ELSE 0 END), 0) AS inUseRemainingCents,
          COALESCE(SUM(CASE
            WHEN status IN ('available', 'reserved', 'in_use')
             AND remainingBalanceCents > 0
             AND expirationDate IS NOT NULL
             AND expirationDate >= ?
             AND expirationDate <= ?
            THEN remainingBalanceCents ELSE 0 END), 0) AS expiringSoonRemainingCents,
          COALESCE(SUM(CASE
            WHEN status IN ('available', 'reserved', 'in_use')
             AND remainingBalanceCents > 0
             AND cardType = 'prepaid'
            THEN remainingBalanceCents ELSE 0 END), 0) AS prepaidRemainingCents,
          COALESCE(SUM(CASE
            WHEN status = 'reserved'
             AND reservedUntil IS NOT NULL
             AND reservedUntil < ?
            THEN 1 ELSE 0 END), 0) AS staleReservationCount,
          COUNT(*) AS trackedCards,
          COALESCE(SUM(CASE WHEN status IN ('available', 'reserved', 'in_use') AND remainingBalanceCents > 0 THEN 1 ELSE 0 END), 0) AS activeCards,
          COALESCE(SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END), 0) AS availableCards,
          COALESCE(SUM(CASE WHEN status = 'reserved' THEN 1 ELSE 0 END), 0) AS reservedCards,
          COALESCE(SUM(CASE WHEN status = 'in_use' THEN 1 ELSE 0 END), 0) AS inUseCards,
          COALESCE(SUM(CASE WHEN status = 'sold' THEN 1 ELSE 0 END), 0) AS soldCards,
          COALESCE(SUM(CASE WHEN status = 'used_up' THEN 1 ELSE 0 END), 0) AS usedUpCards,
          COALESCE(SUM(CASE WHEN status = 'void' THEN 1 ELSE 0 END), 0) AS voidCards
       FROM cards
       WHERE accountId = ?`,
    )
    .get(today, expiresBy, today, auth.accountId) as CardInventorySummaryBaseRow;
  const sold = db
    .prepare(
      `WITH sold_cards AS (
         SELECT cards.id,
                cards.purchaseCostCents,
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
         WHERE accountId = ?
           AND status = 'sold'
       )
       SELECT
          COALESCE(SUM(COALESCE(latestSalePriceCents, 0)), 0) AS soldProceedsCents,
          COALESCE(SUM(purchaseCostCents), 0) AS soldCostBasisCents
       FROM sold_cards`,
    )
    .get(auth.accountId) as CardInventorySoldSummaryRow;

  const activeRemainingCents = Number(base.activeRemainingCents || 0);
  const activeCostBasisCents = Number(base.activeCostBasisCents || 0);
  const soldProceedsCents = Number(sold.soldProceedsCents || 0);
  const soldCostBasisCents = Number(sold.soldCostBasisCents || 0);

  return {
    activeRemainingCents,
    activeCostBasisCents,
    activeGrossMarginCents: activeRemainingCents - activeCostBasisCents,
    availableFaceCents: Number(base.availableFaceCents || 0),
    reservedRemainingCents: Number(base.reservedRemainingCents || 0),
    inUseRemainingCents: Number(base.inUseRemainingCents || 0),
    soldProceedsCents,
    soldCostBasisCents,
    realizedProfitCents: soldProceedsCents - soldCostBasisCents,
    expiringSoonRemainingCents: Number(base.expiringSoonRemainingCents || 0),
    prepaidRemainingCents: Number(base.prepaidRemainingCents || 0),
    staleReservationCount: Number(base.staleReservationCount || 0),
    trackedCards: Number(base.trackedCards || 0),
    activeCards: Number(base.activeCards || 0),
    availableCards: Number(base.availableCards || 0),
    reservedCards: Number(base.reservedCards || 0),
    inUseCards: Number(base.inUseCards || 0),
    soldCards: Number(base.soldCards || 0),
    usedUpCards: Number(base.usedUpCards || 0),
    voidCards: Number(base.voidCards || 0),
    updatedAt: nowIso(),
  };
}

export function searchCards(ctx: VaultServiceContext, criteria: CardSearchCriteria = {}) {
  const { db, auth } = ctx;
  const limit = parsePositiveInt(criteria.limit, 50, 1, 100);
  const offset = parsePositiveInt(criteria.offset, 0, 0);
  const sort = parseSort(criteria.sortBy, criteria.sortDir);
  const where = ['accountId = ?'];
  const params: unknown[] = [auth.accountId];

  if (criteria.status) {
    const status = String(criteria.status);
    if (!activeStatuses.has(status) && !['sold', 'used_up', 'void'].includes(status)) {
      throw badRequest('VALIDATION_FAILED', 'Unsupported card status.');
    }
    where.push('status = ?');
    params.push(status);
  }

  if (String(criteria.activeOnly || '').toLowerCase() === 'true' || criteria.activeOnly === true) {
    where.push("status IN ('available', 'reserved', 'in_use') AND remainingBalanceCents > 0");
  }

  if (criteria.cardType) {
    const cardType = String(criteria.cardType);
    if (!['merchant', 'prepaid'].includes(cardType)) {
      throw badRequest('VALIDATION_FAILED', 'Unsupported card type.');
    }
    where.push('cardType = ?');
    params.push(cardType);
  }

  if (criteria.brand) {
    where.push('LOWER(TRIM(brand)) = LOWER(TRIM(?))');
    params.push(String(criteria.brand).trim());
  }

  if (criteria.source) {
    where.push('LOWER(TRIM(source)) = LOWER(TRIM(?))');
    params.push(String(criteria.source).trim());
  }

  if (criteria.dealId) {
    where.push('dealId = ?');
    params.push(criteria.dealId);
  }

  const dealName = String(criteria.dealName || '').trim();
  if (dealName) {
    where.push(
      `EXISTS (
        SELECT 1
        FROM deals
        WHERE deals.accountId = cards.accountId
          AND deals.id = cards.dealId
          AND LOWER(TRIM(deals.name)) = LOWER(TRIM(?))
      )`,
    );
    params.push(dealName);
  }

  const expiresBefore = parseDateFilter(criteria.expiresBefore, 'expiresBefore');
  if (expiresBefore) {
    where.push('expirationDate IS NOT NULL AND expirationDate <= ?');
    params.push(expiresBefore);
  }

  const expiresAfter = parseDateFilter(criteria.expiresAfter, 'expiresAfter');
  if (expiresAfter) {
    where.push('expirationDate IS NOT NULL AND expirationDate >= ?');
    params.push(expiresAfter);
  }

  if (criteria.text) {
    const text = String(criteria.text).trim().toLowerCase();
    if (text) {
      const pattern = `%${text}%`;
      where.push('(LOWER(brand) LIKE ? OR LOWER(COALESCE(source, \'\')) LIKE ? OR LOWER(COALESCE(notes, \'\')) LIKE ?)');
      params.push(pattern, pattern, pattern);
    }
  }

  if (criteria.credential) {
    const hashes = credentialSearchBlindIndexes(criteria.credential, auth.blindIndexKey);
    if (hashes.length === 0) {
      throw badRequest('VALIDATION_FAILED', 'Credential search requires a non-empty value.');
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

  return {
    ...pageResponse(rows.map(toCardResponse), { limit, offset, total }),
    summary: cardInventorySummary(ctx),
  };
}

export function cardDetail({ db, auth }: VaultServiceContext, cardId: number) {
  const card = loadCard(db, auth, cardId);
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

export function revealCardCredentials(ctx: VaultServiceContext, cardId: number) {
  const { db, auth, requestId } = ctx;
  const timestamp = nowIso();
  const card = loadCard(db, auth, cardId);
  insertAuditEvent(db, {
    accountId: auth.accountId,
    userId: auth.userId,
    requestId,
    entityType: 'card',
    entityId: cardId,
    action: 'card.credentials_reveal',
    metadata: {
      credentialProfile: card.credentialProfile,
      credentialSummary: parseCredentialSummary(card),
      channel: 'mcp',
    },
    timestamp,
  });
  const credentials = revealCredentialPayload(db, card, auth);
  const byKind = Object.fromEntries(credentials.fields.map((field) => [field.fieldKind, field.value]));
  return {
    cardNumber: byKind.card_number ?? null,
    cardNumberLast4: card.cardNumberLast4 ?? card.primaryCredentialLast4,
    pin: byKind.pin ?? null,
    billingZip: byKind.billing_postal_code ?? null,
    credentials,
  };
}

export function createCards(ctx: VaultServiceContext, cards: CardInput[]) {
  const { db, auth, requestId } = ctx;
  if (cards.length < 1 || cards.length > 100) {
    throw badRequest('VALIDATION_FAILED', 'Create cards accepts 1-100 cards.');
  }
  cards.forEach((card) => assertDealBelongsToAccount(db, auth, card.dealId));
  const prepared = cards.map((card) => prepareCard(card, auth, card.dealId ?? null));
  assertNoDuplicatePreparedCredentials(prepared, duplicateCredentialConflict);
  const timestamp = nowIso();
  try {
    const created = db.transaction(() => {
      assertNoExistingCredentialDuplicates(db, auth, prepared, duplicateCredentialConflict);
      return prepared.map((card) => insertPreparedCard(db, auth, requestId, timestamp, card));
    })();
    return pageResponse(created.map(toCardResponse), { limit: created.length, offset: 0, total: created.length });
  } catch (error) {
    throw translateSqliteError(error);
  }
}

export function updateCard(ctx: VaultServiceContext, cardId: number, body: UpdateCardInput) {
  const { db, auth, requestId } = ctx;
  const timestamp = nowIso();
  const updateFields = Object.keys(body).filter((field) => field !== 'rowVersion');
  if (updateFields.length === 0) {
    throw badRequest('NO_CHANGES', 'At least one card field must be changed.');
  }

  try {
    const updated = db.transaction(() => {
      const before = loadCard(db, auth, cardId);
      if (body.rowVersion && body.rowVersion !== before.rowVersion) {
        throw conflict('STALE_CARD_VERSION', 'Card has changed since it was loaded.');
      }
      if (terminalStatuses.has(before.status) && updateFields.some((field) => field !== 'notes')) {
        throw conflict('TERMINAL_CARD_EDIT_RESTRICTED', 'Terminal cards only allow notes edits.');
      }
      const next = {
        brand: body.brand ?? before.brand,
        cardType: body.cardType ?? before.cardType,
        network: body.network === undefined ? before.network : body.network,
        faceValueCents: body.faceValueCents ?? before.faceValueCents,
        remainingBalanceCents: body.remainingBalanceCents ?? before.remainingBalanceCents,
        purchaseCostCents: body.purchaseCostCents ?? before.purchaseCostCents,
        expirationDate: body.expirationDate === undefined ? before.expirationDate : body.expirationDate,
        format: body.format === undefined ? before.format : body.format,
        source: body.source === undefined ? before.source : body.source,
        notes: body.notes === undefined ? before.notes : body.notes,
      };
      if (next.remainingBalanceCents > next.faceValueCents) {
        throw badRequest('REMAINING_BALANCE_EXCEEDS_FACE_VALUE', 'Remaining balance cannot exceed face value.');
      }
      db.prepare(
        `UPDATE cards
         SET brand = ?,
             cardType = ?,
             network = ?,
             faceValueCents = ?,
             remainingBalanceCents = ?,
             purchaseCostCents = ?,
             expirationDate = ?,
             format = ?,
             source = ?,
             notes = ?,
             updatedByUserId = ?,
             updatedAt = ?,
             rowVersion = rowVersion + 1
         WHERE id = ? AND accountId = ?`,
      ).run(
        next.brand,
        next.cardType,
        next.network,
        next.faceValueCents,
        next.remainingBalanceCents,
        next.purchaseCostCents,
        next.expirationDate,
        next.format,
        next.source,
        next.notes,
        auth.userId,
        timestamp,
        cardId,
        auth.accountId,
      );
      const after = loadCard(db, auth, cardId);
      insertAuditEvent(db, {
        accountId: auth.accountId,
        userId: auth.userId,
        requestId,
        entityType: 'card',
        entityId: cardId,
        action: 'card.update',
        oldValue: mutationAuditValue(before),
        newValue: mutationAuditValue(after),
        timestamp,
      });
      return after;
    })();
    return toCardResponse(updated);
  } catch (error) {
    throw translateSqliteError(error);
  }
}

export function deleteCard(ctx: VaultServiceContext, cardId: number) {
  const { db, auth, requestId } = ctx;
  const timestamp = nowIso();
  db.transaction(() => {
    const card = loadCard(db, auth, cardId);
    const activity = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM transactions WHERE accountId = ? AND cardId = ?) AS transactionCount,
          (SELECT COUNT(*) FROM usages WHERE accountId = ? AND cardId = ?) AS usageCount`,
      )
      .get(auth.accountId, cardId, auth.accountId, cardId) as ActivityCountRow;
    if (card.status !== 'available' || activity.transactionCount > 0 || activity.usageCount > 0) {
      throw conflict('CARD_DELETE_RESTRICTED', 'Only never-touched available cards can be deleted.');
    }
    insertAuditEvent(db, {
      accountId: auth.accountId,
      userId: auth.userId,
      requestId,
      entityType: 'card',
      entityId: cardId,
      action: 'card.delete',
      oldValue: createCardAuditValue(card),
      timestamp,
    });
    db.prepare('DELETE FROM cards WHERE id = ? AND accountId = ?').run(cardId, auth.accountId);
  })();
  return { deleted: true, cardId };
}

export function mutateCardStatus(
  ctx: VaultServiceContext,
  cardId: number,
  transitionAction: string,
  body: { reservedFor?: string | null | undefined; reservedUntil?: string | null | undefined; reservedNotes?: string | null | undefined } = {},
) {
  const { db, auth, requestId } = ctx;
  const timestamp = nowIso();
  const card = db.transaction(() => {
    const before = loadCard(db, auth, cardId);
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
      auth.userId,
      timestamp,
      cardId,
      auth.accountId,
    );
    const after = loadCard(db, auth, cardId);
    insertAuditEvent(db, {
      accountId: auth.accountId,
      userId: auth.userId,
      requestId,
      entityType: 'card',
      entityId: cardId,
      action: transition.action,
      oldValue: mutationAuditValue(before),
      newValue: mutationAuditValue(after),
      timestamp,
    });
    return after;
  })();
  return toCardResponse(card);
}

export function sellCard(
  ctx: VaultServiceContext,
  cardId: number,
  body: {
    salePriceCents: number;
    buyerName?: string | null | undefined;
    buyerType?: 'dealer' | 'group_chat' | 'friend' | 'self' | 'other' | null | undefined;
    platform?: string | null | undefined;
    transactionDate?: string | null | undefined;
    notes?: string | null | undefined;
    idempotencyKey?: string | undefined;
  },
) {
  const { db, auth, requestId } = ctx;
  const timestamp = nowIso();
  db.transaction(() => {
    const before = loadCard(db, auth, cardId);
    const transition = transitionFor('sell', before.status);
    db.prepare(
      `INSERT INTO transactions (
        accountId, cardId, type, buyerName, buyerType, salePriceCents,
        remainingBalanceAtSaleCents, statusAtSale, platform, transactionDate,
        notes, idempotencyKey, createdByUserId, createdAt
      ) VALUES (?, ?, 'sale', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      auth.accountId,
      cardId,
      body.buyerName ?? null,
      body.buyerType ?? null,
      body.salePriceCents,
      before.remainingBalanceCents,
      before.status,
      body.platform ?? null,
      body.transactionDate ?? timestamp.slice(0, 10),
      body.notes ?? null,
      body.idempotencyKey ?? null,
      auth.userId,
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
    ).run(transition.status, auth.userId, timestamp, cardId, auth.accountId);
    const after = loadCard(db, auth, cardId);
    insertAuditEvent(db, {
      accountId: auth.accountId,
      userId: auth.userId,
      requestId,
      entityType: 'card',
      entityId: cardId,
      action: transition.action,
      oldValue: mutationAuditValue(before),
      newValue: mutationAuditValue(after),
      metadata: { salePriceCents: body.salePriceCents },
      timestamp,
    });
  })();
  return cardDetail(ctx, cardId);
}

export function undoSale(ctx: VaultServiceContext, cardId: number, body: { reason: string; idempotencyKey?: string | undefined }) {
  const { db, auth, requestId } = ctx;
  const timestamp = nowIso();
  db.transaction(() => {
    const before = loadCard(db, auth, cardId);
    const transition = transitionFor('undo-sale', before.status);
    const sale = db
      .prepare(
        `SELECT *
         FROM transactions
         WHERE accountId = ? AND cardId = ? AND type = 'sale'
         ORDER BY id DESC
         LIMIT 1`,
      )
      .get(auth.accountId, cardId) as TransactionRow | undefined;
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
      .get(auth.accountId, cardId, sale.id);
    if (laterReversal) {
      throw conflict('SALE_ALREADY_REVERSED', 'Sale has already been reversed.');
    }
    db.prepare(
      `INSERT INTO transactions (
        accountId, cardId, type, remainingBalanceAtSaleCents, statusAtSale,
        reason, idempotencyKey, createdByUserId, createdAt
      ) VALUES (?, ?, 'sale_reversal', ?, ?, ?, ?, ?, ?)`,
    ).run(
      auth.accountId,
      cardId,
      sale.remainingBalanceAtSaleCents,
      sale.statusAtSale,
      body.reason,
      body.idempotencyKey ?? null,
      auth.userId,
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
    ).run(sale.statusAtSale, sale.remainingBalanceAtSaleCents, auth.userId, timestamp, cardId, auth.accountId);
    const after = loadCard(db, auth, cardId);
    insertAuditEvent(db, {
      accountId: auth.accountId,
      userId: auth.userId,
      requestId,
      entityType: 'card',
      entityId: cardId,
      action: transition.action,
      oldValue: mutationAuditValue(before),
      newValue: mutationAuditValue(after),
      metadata: { reason: body.reason },
      timestamp,
    });
  })();
  return cardDetail(ctx, cardId);
}

export function useCard(
  ctx: VaultServiceContext,
  cardId: number,
  body: {
    amountCents: number;
    merchant?: string | null | undefined;
    description?: string | null | undefined;
    usageDate?: string | null | undefined;
    idempotencyKey?: string | undefined;
  },
) {
  const { db, auth, requestId } = ctx;
  const timestamp = nowIso();
  db.transaction(() => {
    const before = loadCard(db, auth, cardId);
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
      auth.accountId,
      cardId,
      body.amountCents,
      body.merchant ?? null,
      body.description ?? null,
      body.usageDate ?? timestamp.slice(0, 10),
      body.idempotencyKey ?? null,
      auth.userId,
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
    ).run(nextStatus, remainingBalanceCents, auth.userId, timestamp, cardId, auth.accountId);
    const after = loadCard(db, auth, cardId);
    insertAuditEvent(db, {
      accountId: auth.accountId,
      userId: auth.userId,
      requestId,
      entityType: 'card',
      entityId: cardId,
      action: transition.action,
      oldValue: mutationAuditValue(before),
      newValue: mutationAuditValue(after),
      metadata: { amountCents: body.amountCents },
      timestamp,
    });
  })();
  return cardDetail(ctx, cardId);
}

export function undoUsage(
  ctx: VaultServiceContext,
  cardId: number,
  body: { usageId: number; reason: string; idempotencyKey?: string | undefined },
) {
  const { db, auth, requestId } = ctx;
  const timestamp = nowIso();
  db.transaction(() => {
    const before = loadCard(db, auth, cardId);
    const usage = db
      .prepare('SELECT * FROM usages WHERE accountId = ? AND cardId = ? AND id = ?')
      .get(auth.accountId, cardId, body.usageId) as UsageRow | undefined;
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
    ).run(body.reason, timestamp, usage.id, auth.accountId, cardId);
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
        .get(auth.accountId, cardId) as AmountRow).amountCents || 0;
    const remainingBalanceCents = before.faceValueCents - activeUsageTotal;
    const nextStatus = activeUsageTotal === 0 ? 'available' : remainingBalanceCents === 0 ? 'used_up' : 'in_use';
    db.prepare(
      `UPDATE cards
       SET status = ?,
           remainingBalanceCents = ?,
           updatedByUserId = ?,
           updatedAt = ?,
           rowVersion = rowVersion + 1
       WHERE id = ? AND accountId = ?`,
    ).run(nextStatus, remainingBalanceCents, auth.userId, timestamp, cardId, auth.accountId);
    const after = loadCard(db, auth, cardId);
    insertAuditEvent(db, {
      accountId: auth.accountId,
      userId: auth.userId,
      requestId,
      entityType: 'card',
      entityId: cardId,
      action: transition.action,
      oldValue: mutationAuditValue(before),
      newValue: mutationAuditValue(after),
      metadata: { usageId: usage.id, reason: body.reason },
      timestamp,
    });
  })();
  return cardDetail(ctx, cardId);
}

export function voidCard(ctx: VaultServiceContext, cardId: number, body: { reason?: string | null | undefined; idempotencyKey?: string | undefined }) {
  const { db, auth, requestId } = ctx;
  const timestamp = nowIso();
  db.transaction(() => {
    const before = loadCard(db, auth, cardId);
    const transition = transitionFor('void', before.status);
    db.prepare(
      `INSERT INTO usages (
        accountId, cardId, amountCents, merchant, description, isWriteOff,
        usageDate, idempotencyKey, createdByUserId, createdAt
      ) VALUES (?, ?, ?, 'Write-off (Voided)', ?, 1, ?, ?, ?, ?)`,
    ).run(
      auth.accountId,
      cardId,
      before.remainingBalanceCents,
      body.reason ?? null,
      timestamp.slice(0, 10),
      body.idempotencyKey ?? null,
      auth.userId,
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
    ).run(transition.status, auth.userId, timestamp, cardId, auth.accountId);
    const after = loadCard(db, auth, cardId);
    insertAuditEvent(db, {
      accountId: auth.accountId,
      userId: auth.userId,
      requestId,
      entityType: 'card',
      entityId: cardId,
      action: transition.action,
      oldValue: mutationAuditValue(before),
      newValue: mutationAuditValue(after),
      metadata: { writeOffAmountCents: before.remainingBalanceCents },
      timestamp,
    });
  })();
  return cardDetail(ctx, cardId);
}

function normalizeDealName(name: string | null | undefined, source: string | null | undefined) {
  const trimmedName = name?.trim();
  if (trimmedName) {
    return trimmedName;
  }
  const trimmedSource = source?.trim();
  if (trimmedSource) {
    return trimmedSource;
  }
  return 'Untitled deal';
}

function allocateCardCosts(cards: CardInput[], totalCostCents?: number | null | undefined): CardInput[] {
  const cardsWithCosts = cards.map((card) => ({ ...card, purchaseCostCents: card.purchaseCostCents ?? 0 }));
  if (totalCostCents == null || cardsWithCosts.length === 0) {
    return cardsWithCosts;
  }
  const explicitIndexes: number[] = [];
  const proportionalIndexes: number[] = [];
  cardsWithCosts.forEach((card, index) => {
    if (card.purchaseCostCents && card.purchaseCostCents > 0) {
      explicitIndexes.push(index);
    } else {
      proportionalIndexes.push(index);
    }
  });
  const explicitSum = explicitIndexes.reduce((sum, index) => sum + (cardsWithCosts[index]?.purchaseCostCents ?? 0), 0);
  if (explicitSum > totalCostCents) {
    throw badRequest('COST_ALLOCATION_INVALID', 'Explicit card costs exceed total deal cost.');
  }
  if (proportionalIndexes.length === 0) {
    if (explicitSum !== totalCostCents) {
      throw badRequest('COST_ALLOCATION_INVALID', 'Explicit card costs must equal total deal cost.');
    }
    return cardsWithCosts;
  }
  const remainingCost = totalCostCents - explicitSum;
  const totalFaceValue = proportionalIndexes.reduce((sum, index) => sum + (cardsWithCosts[index]?.faceValueCents ?? 0), 0);
  let allocated = 0;
  return cardsWithCosts.map((card, index) => {
    if (!proportionalIndexes.includes(index)) {
      return card;
    }
    const isLast = index === proportionalIndexes[proportionalIndexes.length - 1];
    const purchaseCostCents = isLast
      ? remainingCost - allocated
      : Math.floor((remainingCost * card.faceValueCents) / totalFaceValue);
    allocated += purchaseCostCents;
    return { ...card, purchaseCostCents };
  });
}

function loadDeal(db: Database.Database, auth: AuthContext, dealId: number): DealRow {
  const deal = db.prepare('SELECT * FROM deals WHERE accountId = ? AND id = ?').get(auth.accountId, dealId) as DealRow | undefined;
  if (!deal) {
    throw notFound('DEAL_NOT_FOUND', 'Deal not found.');
  }
  return deal;
}

function dealAuditValue(deal: DealRow) {
  return {
    name: deal.name,
    source: deal.source,
    purchaseDate: deal.purchaseDate,
    inputTotalCostCents: deal.inputTotalCostCents,
    archivedAt: deal.archivedAt,
    rowVersion: deal.rowVersion,
  };
}

export function listDeals({ db, auth }: VaultServiceContext, input: { includeArchived?: boolean | undefined; limit?: number | undefined; offset?: number | undefined } = {}) {
  const limit = parsePositiveInt(input.limit, 50, 1, 100);
  const offset = parsePositiveInt(input.offset, 0, 0);
  const whereClause = input.includeArchived ? 'accountId = ?' : 'accountId = ? AND archivedAt IS NULL';
  const total = (db.prepare(`SELECT COUNT(*) AS count FROM deals WHERE ${whereClause}`).get(auth.accountId) as CountRow).count;
  const rows = db
    .prepare(
      `SELECT *
       FROM deals
       WHERE ${whereClause}
       ORDER BY updatedAt DESC, id DESC
       LIMIT ? OFFSET ?`,
    )
    .all(auth.accountId, limit, offset) as DealRow[];
  return pageResponse(rows.map(toDealResponse), { limit, offset, total });
}

export function dealDetail({ db, auth }: VaultServiceContext, dealId: number) {
  const deal = loadDeal(db, auth, dealId);
  const cards = db.prepare('SELECT * FROM cards WHERE accountId = ? AND dealId = ? ORDER BY id').all(auth.accountId, dealId) as CardRow[];
  return {
    deal: toDealResponse(deal),
    cards: cards.map(toCardResponse),
  };
}

export function createDeal(ctx: VaultServiceContext, body: DealInput) {
  const { db, auth, requestId } = ctx;
  const timestamp = nowIso();
  const cardsWithCosts = allocateCardCosts(body.cards || [], body.totalCostCents);
  try {
    const created = db.transaction(() => {
      const dealInfo = db
        .prepare(
          `INSERT INTO deals (
            accountId, name, source, purchaseDate, inputTotalCostCents, notes,
            createdByUserId, updatedByUserId, createdAt, updatedAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          auth.accountId,
          normalizeDealName(body.name, body.source),
          body.source ?? null,
          body.purchaseDate ?? null,
          body.totalCostCents ?? null,
          body.notes ?? null,
          auth.userId,
          auth.userId,
          timestamp,
          timestamp,
        );
      const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealInfo.lastInsertRowid) as DealRow;
      insertAuditEvent(db, {
        accountId: auth.accountId,
        userId: auth.userId,
        requestId,
        entityType: 'deal',
        entityId: deal.id,
        action: 'deal.create',
        newValue: {
          name: deal.name,
          source: deal.source,
          purchaseDate: deal.purchaseDate,
          inputTotalCostCents: deal.inputTotalCostCents,
        },
        timestamp,
      });

      const preparedCards = cardsWithCosts.map((card) => prepareCard(card, auth, deal.id, body.source));
      assertNoDuplicatePreparedCredentials(preparedCards, duplicateCredentialConflict);
      assertNoExistingCredentialDuplicates(db, auth, preparedCards, duplicateCredentialConflict);
      const cards = preparedCards.map((card) => insertPreparedCard(db, auth, requestId, timestamp, card));
      return { deal, cards };
    })();
    return {
      deal: toDealResponse(created.deal),
      cards: created.cards.map(toCardResponse),
    };
  } catch (error) {
    throw translateSqliteError(error);
  }
}

export function updateDeal(ctx: VaultServiceContext, dealId: number, body: UpdateDealInput) {
  const { db, auth, requestId } = ctx;
  const timestamp = nowIso();
  const updated = db.transaction(() => {
    const before = loadDeal(db, auth, dealId);
    if (body.rowVersion && body.rowVersion !== before.rowVersion) {
      throw conflict('STALE_DEAL_VERSION', 'Deal has changed since it was loaded.');
    }
    db.prepare(
      `UPDATE deals
       SET name = ?,
           source = ?,
           purchaseDate = ?,
           notes = ?,
           updatedByUserId = ?,
           updatedAt = ?,
           rowVersion = rowVersion + 1
       WHERE id = ? AND accountId = ?`,
    ).run(
      Object.hasOwn(body, 'name') ? body.name : before.name,
      Object.hasOwn(body, 'source') ? body.source ?? null : before.source,
      Object.hasOwn(body, 'purchaseDate') ? body.purchaseDate ?? null : before.purchaseDate,
      Object.hasOwn(body, 'notes') ? body.notes ?? null : before.notes,
      auth.userId,
      timestamp,
      dealId,
      auth.accountId,
    );
    const after = loadDeal(db, auth, dealId);
    insertAuditEvent(db, {
      accountId: auth.accountId,
      userId: auth.userId,
      requestId,
      entityType: 'deal',
      entityId: dealId,
      action: 'deal.update',
      oldValue: dealAuditValue(before),
      newValue: dealAuditValue(after),
      timestamp,
    });
    return after;
  })();
  return dealDetail(ctx, updated.id);
}

export function archiveDeal(ctx: VaultServiceContext, dealId: number, archivedAt: string | null = nowIso()) {
  const { db, auth, requestId } = ctx;
  const timestamp = nowIso();
  db.transaction(() => {
    const before = loadDeal(db, auth, dealId);
    db.prepare(
      `UPDATE deals
       SET archivedAt = ?,
           updatedByUserId = ?,
           updatedAt = ?,
           rowVersion = rowVersion + 1
       WHERE id = ? AND accountId = ?`,
    ).run(archivedAt, auth.userId, timestamp, dealId, auth.accountId);
    const after = loadDeal(db, auth, dealId);
    insertAuditEvent(db, {
      accountId: auth.accountId,
      userId: auth.userId,
      requestId,
      entityType: 'deal',
      entityId: dealId,
      action: archivedAt ? 'deal.archive' : 'deal.unarchive',
      oldValue: dealAuditValue(before),
      newValue: dealAuditValue(after),
      timestamp,
    });
  })();
  return dealDetail(ctx, dealId);
}

export function listReferenceValues(
  { db, auth }: VaultServiceContext,
  input: { types?: Array<'deal_name' | 'source' | 'card_brand'> | undefined; q?: string | undefined; limit?: number | undefined } = {},
) {
  const types = input.types?.length ? [...new Set(input.types)] : ['deal_name', 'source', 'card_brand'] as const;
  const q = String(input.q || '').trim().toLowerCase();
  const limit = parsePositiveInt(input.limit, 50, 1, 200);
  const data: Record<string, ReturnType<typeof toReferenceValueResponse>[]> = {};
  for (const type of types) {
    if (q) {
      data[type] = (db
        .prepare(
          `SELECT *
           FROM reference_values
           WHERE accountId = ? AND type = ? AND normalizedValue LIKE ?
           ORDER BY
             CASE
               WHEN normalizedValue = ? THEN 0
               WHEN normalizedValue LIKE ? THEN 1
               ELSE 2
             END,
             usageCount DESC,
             lastUsedAt DESC,
             value COLLATE NOCASE ASC
           LIMIT ?`,
        )
        .all(auth.accountId, type, `%${q}%`, q, `${q}%`, limit) as ReferenceValueRow[]).map(toReferenceValueResponse);
    } else {
      data[type] = (db
        .prepare(
          `SELECT *
           FROM reference_values
           WHERE accountId = ? AND type = ?
           ORDER BY usageCount DESC, lastUsedAt DESC, value COLLATE NOCASE ASC
           LIMIT ?`,
        )
        .all(auth.accountId, type, limit) as ReferenceValueRow[]).map(toReferenceValueResponse);
    }
  }
  return data;
}

export function upsertReferenceValues(
  ctx: VaultServiceContext,
  values: Array<{ type: 'deal_name' | 'source' | 'card_brand'; value: string }>,
) {
  const { db, auth, requestId } = ctx;
  const timestamp = nowIso();
  const statement = db.prepare(
    `INSERT INTO reference_values (
      accountId, type, value, normalizedValue, usageCount, lastUsedAt, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(accountId, type, normalizedValue) DO UPDATE SET
      usageCount = reference_values.usageCount + 1,
      lastUsedAt = excluded.lastUsedAt,
      updatedAt = excluded.updatedAt`,
  );
  const select = db.prepare('SELECT * FROM reference_values WHERE accountId = ? AND type = ? AND normalizedValue = ?');
  const rows = db.transaction(() => {
    const seen = new Set<string>();
    const created: ReferenceValueRow[] = [];
    for (const item of values) {
      const value = String(item.value || '').trim();
      if (!value) {
        continue;
      }
      const normalizedValue = value.toLowerCase();
      const key = `${item.type}\0${normalizedValue}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      statement.run(auth.accountId, item.type, value, normalizedValue, timestamp, timestamp, timestamp);
      created.push(select.get(auth.accountId, item.type, normalizedValue) as ReferenceValueRow);
    }
    return created.map(toReferenceValueResponse);
  })();
  insertAuditEvent(db, {
    accountId: auth.accountId,
    userId: auth.userId,
    requestId,
    entityType: 'system',
    action: 'reference_values.upsert',
    metadata: {
      count: rows.length,
      types: [...new Set(rows.map((value) => value.type))],
      channel: 'mcp',
    },
    timestamp,
  });
  return rows;
}

export function duplicateSearchByCredential(ctx: VaultServiceContext, brand: string, credential: string) {
  const hashes = credentialSearchBlindIndexes(credential, ctx.auth.blindIndexKey);
  if (hashes.length === 0) {
    return [];
  }
  const placeholders = hashes.map(() => '?').join(', ');
  const rows = ctx.db
    .prepare(
      `SELECT DISTINCT cards.*
       FROM cards
       LEFT JOIN card_credential_fields AS fields
         ON fields.accountId = cards.accountId AND fields.cardId = cards.id
       WHERE cards.accountId = ?
         AND LOWER(TRIM(cards.brand)) = ?
         AND cards.status IN ('available', 'reserved', 'in_use')
         AND (
           cards.cardNumberHash IN (${placeholders})
           OR fields.blindIndex IN (${placeholders})
         )
       ORDER BY cards.updatedAt DESC, cards.id DESC
       LIMIT 20`,
    )
    .all(ctx.auth.accountId, normalizeCredentialBrandForDuplicate(brand), ...hashes, ...hashes) as CardRow[];
  return rows.map(toCardResponse);
}
