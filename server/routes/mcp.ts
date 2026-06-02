import type { Request, Response } from 'express';
import { Router } from 'express';
import type Database from 'better-sqlite3';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';
import { HttpError, asyncHandler } from '../http/errors.js';
import {
  authenticateMcpBearerToken,
  requireMcpScope,
  type McpAuthContext,
} from '../mcp/tokens.js';
import {
  archiveDeal,
  cardDetail,
  cardInventorySummary,
  createCards,
  createDeal,
  deleteCard,
  dealDetail,
  listDeals,
  listReferenceValues,
  mutateCardStatus,
  revealCardCredentials,
  runMcpIdempotent,
  searchCards,
  sellCard,
  undoSale,
  undoUsage,
  updateCard,
  updateDeal,
  upsertReferenceValues,
  useCard,
  voidCard,
  type CardInput,
  type VaultServiceContext,
} from '../mcp/vaultService.js';

const credentialProfileSchema = z.enum([
  'claim_code',
  'claim_link',
  'merchant_number_pin',
  'barcode',
  'network_prepaid',
  'custom',
]);
const barcodeFormatSchema = z.enum(['code128', 'qr', 'ean13', 'upca', 'pdf417', 'aztec', 'data_matrix', 'other']);
const cardStatusSchema = z.enum(['available', 'reserved', 'in_use', 'sold', 'used_up', 'void']);
const cardTypeSchema = z.enum(['merchant', 'prepaid']);
const networkSchema = z.enum(['visa', 'mastercard', 'amex', 'discover', 'other']);
const buyerTypeSchema = z.enum(['dealer', 'group_chat', 'friend', 'self', 'other']);
const referenceTypeSchema = z.enum(['deal_name', 'source', 'card_brand']);
const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalDateOnly = dateOnlySchema.nullable().optional();
const idempotencyKey = z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/);

const credentialFieldSchema = z
  .object({
    fieldKey: z.string().trim().min(1).max(80).optional(),
    key: z.string().trim().min(1).max(80).optional(),
    label: z.string().trim().min(1).max(80).optional(),
    fieldKind: z
      .enum([
        'primary_code',
        'card_number',
        'pin',
        'access_code',
        'barcode_value',
        'expiration_month',
        'expiration_year',
        'network_security_code',
        'billing_postal_code',
        'cardholder_name',
        'billing_address',
        'metadata',
      ])
      .optional(),
    value: z.string().max(4096).nullable().optional(),
    barcodeFormat: barcodeFormatSchema.nullable().optional(),
    sortOrder: z.number().int().optional(),
    copyable: z.boolean().optional(),
  })
  .strict();

const credentialsSchema = z
  .object({
    profile: credentialProfileSchema.optional(),
    fields: z.array(credentialFieldSchema).max(20).optional(),
  })
  .strict();

const cardInputSchema = z
  .object({
    dealId: z.number().int().positive().nullable().optional(),
    brand: z.string().trim().min(1).max(120),
    cardType: cardTypeSchema,
    network: networkSchema.nullable().optional(),
    credentialProfile: credentialProfileSchema.optional(),
    credentials: credentialsSchema.optional(),
    faceValueCents: z.number().int().positive(),
    purchaseCostCents: z.number().int().nonnegative().optional(),
    cardNumber: z.string().trim().nullable().optional(),
    pin: z.string().trim().nullable().optional(),
    billingZip: z.string().trim().nullable().optional(),
    primaryCode: z.string().trim().nullable().optional(),
    claimCode: z.string().trim().nullable().optional(),
    claimLink: z.string().trim().nullable().optional(),
    claimUrl: z.string().trim().nullable().optional(),
    redemptionCode: z.string().trim().nullable().optional(),
    giftCode: z.string().trim().nullable().optional(),
    accessCode: z.string().trim().nullable().optional(),
    barcodeValue: z.string().trim().nullable().optional(),
    barcodeFormat: barcodeFormatSchema.nullable().optional(),
    expirationMonth: z.string().trim().nullable().optional(),
    expirationYear: z.string().trim().nullable().optional(),
    networkSecurityCode: z.string().trim().nullable().optional(),
    cvv: z.string().trim().nullable().optional(),
    billingPostalCode: z.string().trim().nullable().optional(),
    cardholderName: z.string().trim().nullable().optional(),
    billingAddress: z.string().trim().nullable().optional(),
    expirationDate: optionalDateOnly,
    format: z.enum(['digital', 'physical']).nullable().optional(),
    source: z.string().trim().nullable().optional(),
    notes: z.string().trim().nullable().optional(),
  })
  .strict();

const updateCardSchema = z
  .object({
    rowVersion: z.number().int().positive().optional(),
    brand: z.string().trim().min(1).max(120).optional(),
    cardType: cardTypeSchema.optional(),
    network: networkSchema.nullable().optional(),
    faceValueCents: z.number().int().positive().optional(),
    remainingBalanceCents: z.number().int().nonnegative().optional(),
    purchaseCostCents: z.number().int().nonnegative().optional(),
    expirationDate: optionalDateOnly,
    format: z.enum(['digital', 'physical']).nullable().optional(),
    source: z.string().trim().nullable().optional(),
    notes: z.string().trim().nullable().optional(),
  })
  .strict();

function toolText(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

function toolSuccess(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: toolText(data),
      },
    ],
    structuredContent: data as Record<string, unknown>,
  };
}

function toolError(error: unknown) {
  if (error instanceof HttpError) {
    return {
      isError: true,
      content: [
        {
          type: 'text' as const,
          text: `${error.code}: ${error.message}`,
        },
      ],
      structuredContent: {
        code: error.code,
        message: error.message,
        fieldErrors: error.fieldErrors,
        details: error.details,
      },
    };
  }
  const message = error instanceof Error ? error.message : 'MCP tool failed.';
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: message,
      },
    ],
  };
}

function requireWriteIdempotency<T>(ctx: VaultServiceContext, toolName: string, key: string, input: unknown, execute: () => T) {
  return runMcpIdempotent(ctx, toolName, key, input, execute);
}

function createServer({ db, auth, requestId }: { db: Database.Database; auth: McpAuthContext; requestId?: string | null | undefined }) {
  const server = new McpServer(
    {
      name: 'gift-card-vault',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    },
  );
  const ctx: VaultServiceContext = { db, auth, requestId };

  function runTool(requiredScopes: Parameters<typeof requireMcpScope>[1][], execute: () => unknown) {
    try {
      requiredScopes.forEach((scope) => requireMcpScope(auth, scope));
      return toolSuccess(execute());
    } catch (error) {
      return toolError(error);
    }
  }

  server.registerTool(
    'giftcards.search_cards',
    {
      title: 'Search gift cards',
      description: 'Search vault cards by status, brand, type, deal, expiration, text, or exact credential value. Does not reveal full credentials.',
      inputSchema: {
        status: cardStatusSchema.optional(),
        activeOnly: z.boolean().optional(),
        cardType: cardTypeSchema.optional(),
        brand: z.string().trim().optional(),
        source: z.string().trim().optional(),
        dealId: z.number().int().positive().optional(),
        dealName: z.string().trim().optional(),
        expiresBefore: optionalDateOnly,
        expiresAfter: optionalDateOnly,
        text: z.string().trim().optional(),
        credential: z.string().trim().optional(),
        sortBy: z.enum([
          'brand',
          'expirationDate',
          'faceValueCents',
          'purchaseCostCents',
          'remainingBalanceCents',
          'source',
          'status',
          'updatedAt',
        ]).optional(),
        sortDir: z.enum(['asc', 'desc']).optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async (args) => runTool(['cards:read'], () => searchCards(ctx, args)),
  );

  server.registerTool(
    'giftcards.get_card',
    {
      title: 'Get card detail',
      description: 'Load a card detail record, transactions, usages, and audit entries. Does not reveal full credentials.',
      inputSchema: {
        cardId: z.number().int().positive(),
      },
    },
    async ({ cardId }) => runTool(['cards:read'], () => cardDetail(ctx, cardId)),
  );

  server.registerTool(
    'giftcards.reveal_card_credentials',
    {
      title: 'Reveal card credentials',
      description: 'Reveal full stored credentials for one card and audit the reveal event.',
      inputSchema: {
        cardId: z.number().int().positive(),
      },
    },
    async ({ cardId }) => runTool(['cards:read', 'cards:reveal'], () => revealCardCredentials(ctx, cardId)),
  );

  server.registerTool(
    'giftcards.create_cards',
    {
      title: 'Create cards',
      description: 'Create 1-100 cards using the same credential profiles as the web app. Requires idempotencyKey.',
      inputSchema: {
        idempotencyKey,
        cards: z.array(cardInputSchema).min(1).max(100),
      },
    },
    async (args) => runTool(['cards:create'], () =>
      requireWriteIdempotency(ctx, 'giftcards.create_cards', args.idempotencyKey, args, () =>
        createCards(ctx, args.cards as CardInput[]))),
  );

  server.registerTool(
    'giftcards.update_card',
    {
      title: 'Update card',
      description: 'Update editable card metadata and balances. Stored secret credential values are not edited by this tool. Requires idempotencyKey.',
      inputSchema: {
        idempotencyKey,
        cardId: z.number().int().positive(),
        updates: updateCardSchema,
      },
    },
    async (args) => runTool(['cards:update'], () =>
      requireWriteIdempotency(ctx, 'giftcards.update_card', args.idempotencyKey, args, () =>
        updateCard(ctx, args.cardId, args.updates))),
  );

  server.registerTool(
    'giftcards.delete_card',
    {
      title: 'Delete card',
      description: 'Delete only never-touched available cards. Requires idempotencyKey.',
      inputSchema: {
        idempotencyKey,
        cardId: z.number().int().positive(),
      },
    },
    async (args) => runTool(['cards:delete'], () =>
      requireWriteIdempotency(ctx, 'giftcards.delete_card', args.idempotencyKey, args, () =>
        deleteCard(ctx, args.cardId))),
  );

  server.registerTool(
    'giftcards.reserve_card',
    {
      title: 'Reserve card',
      description: 'Reserve an available card. Requires idempotencyKey.',
      inputSchema: {
        idempotencyKey,
        cardId: z.number().int().positive(),
        reservedFor: z.string().trim().nullable().optional(),
        reservedUntil: optionalDateOnly,
        reservedNotes: z.string().trim().nullable().optional(),
      },
    },
    async (args) => runTool(['cards:lifecycle'], () =>
      requireWriteIdempotency(ctx, 'giftcards.reserve_card', args.idempotencyKey, args, () =>
        mutateCardStatus(ctx, args.cardId, 'reserve', args))),
  );

  server.registerTool(
    'giftcards.unreserve_card',
    {
      title: 'Unreserve card',
      description: 'Return a reserved card to available. Requires idempotencyKey.',
      inputSchema: {
        idempotencyKey,
        cardId: z.number().int().positive(),
      },
    },
    async (args) => runTool(['cards:lifecycle'], () =>
      requireWriteIdempotency(ctx, 'giftcards.unreserve_card', args.idempotencyKey, args, () =>
        mutateCardStatus(ctx, args.cardId, 'unreserve'))),
  );

  server.registerTool(
    'giftcards.use_card',
    {
      title: 'Use card',
      description: 'Record card usage and reduce remaining balance. Requires idempotencyKey.',
      inputSchema: {
        idempotencyKey,
        cardId: z.number().int().positive(),
        amountCents: z.number().int().positive(),
        merchant: z.string().trim().nullable().optional(),
        description: z.string().trim().nullable().optional(),
        usageDate: optionalDateOnly,
      },
    },
    async (args) => runTool(['cards:lifecycle'], () =>
      requireWriteIdempotency(ctx, 'giftcards.use_card', args.idempotencyKey, args, () =>
        useCard(ctx, args.cardId, args))),
  );

  server.registerTool(
    'giftcards.undo_usage',
    {
      title: 'Undo usage',
      description: 'Reverse a non-write-off usage event and restore card balance. Requires idempotencyKey.',
      inputSchema: {
        idempotencyKey,
        cardId: z.number().int().positive(),
        usageId: z.number().int().positive(),
        reason: z.string().trim().min(1),
      },
    },
    async (args) => runTool(['cards:lifecycle'], () =>
      requireWriteIdempotency(ctx, 'giftcards.undo_usage', args.idempotencyKey, args, () =>
        undoUsage(ctx, args.cardId, args))),
  );

  server.registerTool(
    'giftcards.sell_card',
    {
      title: 'Sell card',
      description: 'Mark a card sold, zero remaining balance, and record sale metadata. Requires idempotencyKey.',
      inputSchema: {
        idempotencyKey,
        cardId: z.number().int().positive(),
        salePriceCents: z.number().int().nonnegative(),
        buyerName: z.string().trim().nullable().optional(),
        buyerType: buyerTypeSchema.nullable().optional(),
        platform: z.string().trim().nullable().optional(),
        transactionDate: optionalDateOnly,
        notes: z.string().trim().nullable().optional(),
      },
    },
    async (args) => runTool(['cards:lifecycle'], () =>
      requireWriteIdempotency(ctx, 'giftcards.sell_card', args.idempotencyKey, args, () =>
        sellCard(ctx, args.cardId, args))),
  );

  server.registerTool(
    'giftcards.undo_sale',
    {
      title: 'Undo sale',
      description: 'Reverse latest sale transaction and restore prior status/balance. Requires idempotencyKey.',
      inputSchema: {
        idempotencyKey,
        cardId: z.number().int().positive(),
        reason: z.string().trim().min(1),
      },
    },
    async (args) => runTool(['cards:lifecycle'], () =>
      requireWriteIdempotency(ctx, 'giftcards.undo_sale', args.idempotencyKey, args, () =>
        undoSale(ctx, args.cardId, args))),
  );

  server.registerTool(
    'giftcards.void_card',
    {
      title: 'Void card',
      description: 'Void a card and write off remaining balance. Requires idempotencyKey.',
      inputSchema: {
        idempotencyKey,
        cardId: z.number().int().positive(),
        reason: z.string().trim().nullable().optional(),
      },
    },
    async (args) => runTool(['cards:lifecycle'], () =>
      requireWriteIdempotency(ctx, 'giftcards.void_card', args.idempotencyKey, args, () =>
        voidCard(ctx, args.cardId, args))),
  );

  server.registerTool(
    'giftcards.list_deals',
    {
      title: 'List deals',
      description: 'List deal groups.',
      inputSchema: {
        includeArchived: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async (args) => runTool(['deals:read'], () => listDeals(ctx, args)),
  );

  server.registerTool(
    'giftcards.get_deal',
    {
      title: 'Get deal',
      description: 'Load a deal and its cards.',
      inputSchema: {
        dealId: z.number().int().positive(),
      },
    },
    async ({ dealId }) => runTool(['deals:read'], () => dealDetail(ctx, dealId)),
  );

  server.registerTool(
    'giftcards.create_deal',
    {
      title: 'Create deal',
      description: 'Create a deal, optionally with cards. Creating cards also requires cards:create. Requires idempotencyKey.',
      inputSchema: {
        idempotencyKey,
        name: z.string().trim().min(1).max(160).optional(),
        source: z.string().trim().nullable().optional(),
        purchaseDate: optionalDateOnly,
        totalCostCents: z.number().int().nonnegative().nullable().optional(),
        notes: z.string().trim().nullable().optional(),
        cards: z.array(cardInputSchema).max(100).optional(),
      },
    },
    async (args) => runTool(['deals:write'], () => {
      if (args.cards?.length) {
        requireMcpScope(auth, 'cards:create');
      }
      return requireWriteIdempotency(ctx, 'giftcards.create_deal', args.idempotencyKey, args, () =>
        createDeal(ctx, args));
    }),
  );

  server.registerTool(
    'giftcards.update_deal',
    {
      title: 'Update deal',
      description: 'Update a deal group. Requires idempotencyKey.',
      inputSchema: {
        idempotencyKey,
        dealId: z.number().int().positive(),
        updates: z
          .object({
            rowVersion: z.number().int().positive().optional(),
            name: z.string().trim().min(1).max(160).optional(),
            source: z.string().trim().nullable().optional(),
            purchaseDate: optionalDateOnly,
            notes: z.string().trim().nullable().optional(),
          })
          .strict(),
      },
    },
    async (args) => runTool(['deals:write'], () =>
      requireWriteIdempotency(ctx, 'giftcards.update_deal', args.idempotencyKey, args, () =>
        updateDeal(ctx, args.dealId, args.updates))),
  );

  server.registerTool(
    'giftcards.archive_deal',
    {
      title: 'Archive deal',
      description: 'Archive a deal group. Requires idempotencyKey.',
      inputSchema: {
        idempotencyKey,
        dealId: z.number().int().positive(),
      },
    },
    async (args) => runTool(['deals:write'], () =>
      requireWriteIdempotency(ctx, 'giftcards.archive_deal', args.idempotencyKey, args, () =>
        archiveDeal(ctx, args.dealId))),
  );

  server.registerTool(
    'giftcards.unarchive_deal',
    {
      title: 'Unarchive deal',
      description: 'Unarchive a deal group. Requires idempotencyKey.',
      inputSchema: {
        idempotencyKey,
        dealId: z.number().int().positive(),
      },
    },
    async (args) => runTool(['deals:write'], () =>
      requireWriteIdempotency(ctx, 'giftcards.unarchive_deal', args.idempotencyKey, args, () =>
        archiveDeal(ctx, args.dealId, null))),
  );

  server.registerTool(
    'giftcards.list_reference_values',
    {
      title: 'List hint values',
      description: 'List brand/source/deal-name hint values.',
      inputSchema: {
        types: z.array(referenceTypeSchema).optional(),
        q: z.string().trim().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async (args) => runTool(['reference:read'], () => listReferenceValues(ctx, args)),
  );

  server.registerTool(
    'giftcards.upsert_reference_values',
    {
      title: 'Upsert hint values',
      description: 'Add or increment brand/source/deal-name hint values. Requires idempotencyKey.',
      inputSchema: {
        idempotencyKey,
        values: z.array(z.object({
          type: referenceTypeSchema,
          value: z.string().trim().min(1).max(160),
        }).strict()).min(1).max(50),
      },
    },
    async (args) => runTool(['reference:write'], () =>
      requireWriteIdempotency(ctx, 'giftcards.upsert_reference_values', args.idempotencyKey, args, () =>
        upsertReferenceValues(ctx, args.values))),
  );

  server.registerResource(
    'inventory-summary',
    'giftcards://inventory/summary',
    {
      title: 'Inventory Summary',
      description: 'Aggregated inventory, proceeds, and expiration metrics.',
      mimeType: 'application/json',
    },
    async (uri) => {
      requireMcpScope(auth, 'cards:read');
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: toolText(cardInventorySummary(ctx)),
          },
        ],
      };
    },
  );

  server.registerResource(
    'cards-schema',
    'giftcards://cards/schema',
    {
      title: 'Card Schema',
      description: 'Supported card credential profiles and common input fields.',
      mimeType: 'application/json',
    },
    async (uri) => {
      requireMcpScope(auth, 'cards:read');
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: toolText({
              credentialProfiles: ['claim_code', 'claim_link', 'merchant_number_pin', 'barcode', 'network_prepaid', 'custom'],
              cardTypes: ['merchant', 'prepaid'],
              note: 'Secret credential values can be created and revealed by scoped tools, but update_card does not mutate stored secret values.',
            }),
          },
        ],
      };
    },
  );

  server.registerResource(
    'deals-schema',
    'giftcards://deals/schema',
    {
      title: 'Deal Schema',
      description: 'Deal group fields.',
      mimeType: 'application/json',
    },
    async (uri) => {
      requireMcpScope(auth, 'deals:read');
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: toolText({
              fields: ['name', 'source', 'purchaseDate', 'totalCostCents', 'notes', 'cards'],
              costAllocation: 'When totalCostCents is supplied, card purchase costs may be allocated across cards without explicit costs.',
            }),
          },
        ],
      };
    },
  );

  server.registerResource(
    'security-scopes',
    'giftcards://security/scopes',
    {
      title: 'MCP Security Scopes',
      description: 'Available MCP token scopes and their effect.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: toolText({
            grantedScopes: [...auth.scopes],
            tokenName: auth.tokenName,
            warning: 'cards:reveal exposes full gift-card credentials. Write scopes can modify the vault.',
          }),
        },
      ],
    }),
  );

  return server;
}

function methodNotAllowed(_req: Request, res: Response) {
  res.status(405).json({
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message: 'Method not allowed.',
    },
    id: null,
  });
}

export function createMcpRouter({ db }: { db: Database.Database }) {
  const router = Router();

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const auth = authenticateMcpBearerToken(db, req.get('Authorization'));
      const server = createServer({ db, auth, requestId: req.requestId });
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      } as unknown as ConstructorParameters<typeof StreamableHTTPServerTransport>[0]);

      try {
        await server.connect(transport as Parameters<typeof server.connect>[0]);
        await transport.handleRequest(req as unknown as Parameters<typeof transport.handleRequest>[0], res, req.body);
      } finally {
        res.on('close', () => {
          void transport.close();
          void server.close();
        });
      }
    }),
  );

  router.get('/', methodNotAllowed);
  router.delete('/', methodNotAllowed);

  return router;
}
