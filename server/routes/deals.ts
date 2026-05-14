import { Router, type Request } from 'express';
import type Database from 'better-sqlite3';
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
  type CredentialInput,
  type CredentialProfile,
  credentialFieldKinds,
  credentialProfiles,
  insertCredentialFields,
  parseCredentialSummary,
  type PreparedCredentialField,
} from '../cards/credentials.js';
import { featureEnabled } from '../config/featureFlags.js';
import { asyncHandler, badRequest, conflict, notFound } from '../http/errors.js';
import type { AuthContext } from '../types/express.js';

type DealCardInput = z.infer<typeof dealCardInputSchema>;
type DealCardWithCost = DealCardInput & { purchaseCostCents: number };
type CreateDealBody = z.infer<typeof createDealSchema>;

interface CountRow {
  count: number;
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
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

interface PreparedDealCard extends DealCardWithCost {
  dealId: number;
  source: string | null;
  status: 'available';
  credentialProfile: CredentialProfile;
  primaryCredentialLast4: string | null;
  credentialSummaryJson: string;
  credentialFields: PreparedCredentialField[];
  cardNumber: string | null;
  cardNumberHash: string | null;
  cardNumberLast4: string | null;
  pin: string | null;
  billingZip: string | null;
}

interface SqliteErrorLike {
  code?: string;
  message?: string;
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

const dealCardInputSchema = z
  .object({
    brand: z.string().trim().min(1).max(120),
    cardType: z.enum(['merchant', 'prepaid']),
    network: z.enum(['visa', 'mastercard', 'amex', 'discover', 'other']).nullable().optional(),
    credentialProfile: z.enum(credentialProfiles).optional(),
    credentials: credentialsInputSchema.optional(),
    faceValueCents: z.number().int().positive(),
    purchaseCostCents: z.number().int().nonnegative().optional(),
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

const createDealSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    source: z.string().trim().nullable().optional(),
    purchaseDate: z.string().trim().nullable().optional(),
    totalCostCents: z.number().int().nonnegative().optional(),
    notes: z.string().trim().nullable().optional(),
    cards: z.array(dealCardInputSchema).max(100).optional(),
  })
  .strict();

const updateDealSchema = z
  .object({
    rowVersion: z.number().int().positive().optional(),
    name: z.string().trim().min(1).max(160).optional(),
    source: z.string().trim().nullable().optional(),
    purchaseDate: z.string().trim().nullable().optional(),
    notes: z.string().trim().nullable().optional(),
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
    rowVersion: row.rowVersion,
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

function objectResponse<T>(data: T) {
  return { data };
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

function allocateCardCosts(
  cards: DealCardInput[],
  rawCards: unknown[],
  totalCostCents: CreateDealBody['totalCostCents'],
): DealCardWithCost[] {
  const cardsWithCosts = cards.map((card) => ({
    ...card,
    purchaseCostCents: card.purchaseCostCents ?? 0,
  }));

  if (totalCostCents == null) {
    return cardsWithCosts;
  }

  if (cardsWithCosts.length === 0) {
    return cardsWithCosts;
  }

  const explicitIndexes: number[] = [];
  const proportionalIndexes: number[] = [];
  cardsWithCosts.forEach((_card, index) => {
    const rawCard = rawCards[index];
    if (rawCard && typeof rawCard === 'object' && Object.hasOwn(rawCard, 'purchaseCostCents')) {
      explicitIndexes.push(index);
    } else {
      proportionalIndexes.push(index);
    }
  });

  const explicitSum = explicitIndexes.reduce((sum, index) => sum + cardsWithCosts[index].purchaseCostCents, 0);
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
  const totalFaceValue = proportionalIndexes.reduce(
    (sum, index) => sum + cardsWithCosts[index].faceValueCents,
    0,
  );
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

    return {
      ...card,
      purchaseCostCents,
    };
  });
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

function prepareCard(
  card: DealCardWithCost,
  auth: AuthContext,
  dealId: number,
  fallbackSource: string | null | undefined,
): PreparedDealCard {
  let model;
  try {
    model = buildCredentialModel(card as CredentialInput, auth, {
      allowNetworkSecurityCodeStorage: featureEnabled('networkSecurityCodeStorage'),
    });
  } catch (error) {
    throw credentialValidationFailure(error);
  }
  return {
    ...card,
    dealId,
    source: card.source ?? fallbackSource ?? null,
    status: 'available',
    credentialProfile: model.credentialProfile,
    primaryCredentialLast4: model.primaryCredentialLast4,
    credentialSummaryJson: model.credentialSummaryJson,
    credentialFields: model.fields,
    cardNumber: model.encryptedCardNumber,
    cardNumberHash: model.cardNumberHash,
    cardNumberLast4: model.cardNumberLast4,
    pin: model.pin,
    billingZip: model.billingZip,
  };
}

function assertNoDuplicateInputs(cards: PreparedDealCard[]) {
  assertNoDuplicatePreparedCredentials(cards, duplicateCredentialConflict);
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

function hasOwnValue(object: object, key: PropertyKey) {
  return Object.hasOwn(object, key);
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

export function createDealsRouter({ db }: { db: Database.Database }) {
  const router = Router();

  router.use(requireUnlockedSession);

  function loadDeal(auth: AuthContext, dealId: number): DealRow {
    const deal = db
      .prepare('SELECT * FROM deals WHERE accountId = ? AND id = ?')
      .get(auth.accountId, dealId) as DealRow | undefined;

    if (!deal) {
      throw notFound('DEAL_NOT_FOUND', 'Deal not found.');
    }

    return deal;
  }

  function dealDetail(auth: AuthContext, dealId: number) {
    const deal = loadDeal(auth, dealId);
    const cards = db
      .prepare('SELECT * FROM cards WHERE accountId = ? AND dealId = ? ORDER BY id')
      .all(auth.accountId, dealId) as CardRow[];

    return {
      deal: toDealResponse(deal),
      cards: cards.map(toCardResponse),
    };
  }

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const limit = parsePositiveInt(req.query.limit, 50, { min: 1, max: 100 });
      const offset = parsePositiveInt(req.query.offset, 0, { min: 0 });
      const includeArchived = req.query.includeArchived === 'true';
      const whereClause = includeArchived ? 'accountId = ?' : 'accountId = ? AND archivedAt IS NULL';
      const total = (db.prepare(`SELECT COUNT(*) AS count FROM deals WHERE ${whereClause}`).get(req.auth.accountId) as CountRow).count;
      const rows = db
        .prepare(
          `SELECT *
           FROM deals
           WHERE ${whereClause}
           ORDER BY updatedAt DESC, id DESC
           LIMIT ? OFFSET ?`,
        )
        .all(req.auth.accountId, limit, offset) as DealRow[];

      res.json(pageResponse(rows.map(toDealResponse), { limit, offset, total }));
    }),
  );

  router.post(
    '/',
    requireOperatorRole,
    asyncHandler(async (req, res) => {
      const rawCards: unknown[] = Array.isArray(req.body?.cards) ? req.body.cards : [];
      const body = validateBody(createDealSchema, req.body || {});
      const timestamp = nowIso();
      const cardsWithCosts = allocateCardCosts(body.cards || [], rawCards, body.totalCostCents);

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
              req.auth.accountId,
              normalizeDealName(body.name, body.source),
              body.source ?? null,
              body.purchaseDate ?? null,
              body.totalCostCents ?? null,
              body.notes ?? null,
              req.auth.userId,
              req.auth.userId,
              timestamp,
              timestamp,
            );
          const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealInfo.lastInsertRowid) as DealRow;

          insertAuditEvent(db, {
            accountId: req.auth.accountId,
            userId: req.auth.userId,
            requestId: req.requestId,
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

          const preparedCards = cardsWithCosts.map((card) =>
            prepareCard(card, req.auth, deal.id, body.source),
          );
          assertNoDuplicateInputs(preparedCards);
          assertNoExistingCredentialDuplicates(db, req.auth, preparedCards, duplicateCredentialConflict);

          const cards = preparedCards.map((card) => {
            const cardInfo = db
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
                card.dealId,
                card.brand,
                card.cardType,
                card.network ?? null,
                card.faceValueCents,
                card.faceValueCents,
                card.purchaseCostCents,
                card.cardNumber,
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
                card.source,
                card.notes ?? null,
                req.auth.userId,
                req.auth.userId,
                timestamp,
                timestamp,
              );

            const row = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardInfo.lastInsertRowid) as CardRow;
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

          return { deal, cards };
        })();

        res.status(201).json(
          objectResponse({
            deal: toDealResponse(created.deal),
            cards: created.cards.map(toCardResponse),
          }),
        );
      } catch (error) {
        throw translateSqliteError(error);
      }
    }),
  );

  router.put(
    '/:dealId',
    requireOperatorRole,
    asyncHandler(async (req, res) => {
      const dealId = parsePositiveInt(req.params.dealId, null, { min: 1 });
      const body = validateBody(updateDealSchema, req.body || {});
      const timestamp = nowIso();

      const updated = db.transaction(() => {
        const before = loadDeal(req.auth, dealId);
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
          hasOwnValue(body, 'name') ? body.name : before.name,
          hasOwnValue(body, 'source') ? body.source ?? null : before.source,
          hasOwnValue(body, 'purchaseDate') ? body.purchaseDate ?? null : before.purchaseDate,
          hasOwnValue(body, 'notes') ? body.notes ?? null : before.notes,
          req.auth.userId,
          timestamp,
          dealId,
          req.auth.accountId,
        );

        const after = loadDeal(req.auth, dealId);
        insertAuditEvent(db, {
          accountId: req.auth.accountId,
          userId: req.auth.userId,
          requestId: req.requestId,
          entityType: 'deal',
          entityId: dealId,
          action: 'deal.update',
          oldValue: dealAuditValue(before),
          newValue: dealAuditValue(after),
          timestamp,
        });

        return after;
      })();

      res.json(
        objectResponse({
          deal: toDealResponse(updated),
          cards: dealDetail(req.auth, dealId).cards,
        }),
      );
    }),
  );

  function archiveDeal({ req, dealId, archivedAt }: { req: Request; dealId: number; archivedAt: string | null }) {
    const timestamp = nowIso();

    return db.transaction(() => {
      const before = loadDeal(req.auth, dealId);

      db.prepare(
        `UPDATE deals
         SET archivedAt = ?,
             updatedByUserId = ?,
             updatedAt = ?,
             rowVersion = rowVersion + 1
         WHERE id = ? AND accountId = ?`,
      ).run(archivedAt, req.auth.userId, timestamp, dealId, req.auth.accountId);

      const after = loadDeal(req.auth, dealId);
      insertAuditEvent(db, {
        accountId: req.auth.accountId,
        userId: req.auth.userId,
        requestId: req.requestId,
        entityType: 'deal',
        entityId: dealId,
        action: archivedAt ? 'deal.archive' : 'deal.unarchive',
        oldValue: dealAuditValue(before),
        newValue: dealAuditValue(after),
        timestamp,
      });

      return after;
    })();
  }

  router.post(
    '/:dealId/archive',
    requireOperatorRole,
    asyncHandler(async (req, res) => {
      const dealId = parsePositiveInt(req.params.dealId, null, { min: 1 });
      archiveDeal({ req, dealId, archivedAt: nowIso() });
      res.json(objectResponse(dealDetail(req.auth, dealId)));
    }),
  );

  router.post(
    '/:dealId/unarchive',
    requireOperatorRole,
    asyncHandler(async (req, res) => {
      const dealId = parsePositiveInt(req.params.dealId, null, { min: 1 });
      archiveDeal({ req, dealId, archivedAt: null });
      res.json(objectResponse(dealDetail(req.auth, dealId)));
    }),
  );

  router.get(
    '/:dealId',
    asyncHandler(async (req, res) => {
      const dealId = parsePositiveInt(req.params.dealId, null, { min: 1 });
      res.json(objectResponse(dealDetail(req.auth, dealId)));
    }),
  );

  return router;
}
