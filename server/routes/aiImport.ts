import { Router } from 'express';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { insertAuditEvent } from '../audit/index.js';
import { analyzeGiftCardsWithAi } from '../aiImport.js';
import { requireUnlockedSession } from '../auth/requireAuth.js';
import { requireOperatorRole } from '../auth/roles.js';
import { asyncHandler, badRequest } from '../http/errors.js';
import { objectResponse } from '../http/response.js';

const aiImportAnalyzeSchema = z.object({
  text: z.string().trim().min(1).max(25_000),
  instruction: z.string().trim().max(4_000).optional().default(''),
  previousRows: z.array(z.unknown()).max(200).optional().default([]),
});

function elapsedSince(startedAt: number): number {
  return Math.max(1, Date.now() - startedAt);
}

function errorDetails(error: unknown): { code: string; status: number | null; providersTried?: unknown; providerFailures?: unknown } {
  const typed = error as { code?: string; status?: number; details?: { providersTried?: unknown; providerFailures?: unknown } };
  return {
    code: typed.code || 'UNKNOWN_ERROR',
    status: typed.status || null,
    ...(typed.details?.providersTried ? { providersTried: typed.details.providersTried } : {}),
    ...(typed.details?.providerFailures ? { providerFailures: typed.details.providerFailures } : {}),
  };
}

export function createAiImportRouter({ db }: { db: Database.Database }) {
  const router = Router();
  router.use(requireUnlockedSession);

  router.post(
    '/analyze',
    requireOperatorRole,
    asyncHandler(async (req, res) => {
      const parsed = aiImportAnalyzeSchema.safeParse(req.body || {});
      if (!parsed.success) {
        throw badRequest('VALIDATION_FAILED', 'Paste gift-card text before running AI analysis.', parsed.error.issues);
      }

      const startedAt = Date.now();
      try {
        const analysis = await analyzeGiftCardsWithAi(parsed.data.text, {
          instruction: parsed.data.instruction,
          previousRows: parsed.data.previousRows,
        });
        insertAuditEvent(db, {
          accountId: req.auth.accountId,
          userId: req.auth.userId,
          requestId: req.requestId,
          entityType: 'import',
          entityId: null,
          action: 'ai_import.analyze',
          metadata: {
            outcome: 'success',
            provider: analysis.provider,
            model: analysis.model,
            rowCount: analysis.rows.length,
            candidatesReturned: analysis.diagnostics.candidatesReturned,
            rowsDiscarded: analysis.diagnostics.rowsDiscarded,
            textLength: parsed.data.text.length,
            instructionLength: parsed.data.instruction.length,
            previousRowCount: parsed.data.previousRows.length,
            elapsedMs: elapsedSince(startedAt),
          },
          timestamp: new Date().toISOString(),
        });

        res.json(objectResponse(analysis));
      } catch (caught) {
        const details = errorDetails(caught);
        insertAuditEvent(db, {
          accountId: req.auth.accountId,
          userId: req.auth.userId,
          requestId: req.requestId,
          entityType: 'import',
          entityId: null,
          action: 'ai_import.analyze',
          metadata: {
            outcome: 'failure',
            errorCode: details.code,
            errorStatus: details.status,
            textLength: parsed.data.text.length,
            instructionLength: parsed.data.instruction.length,
            previousRowCount: parsed.data.previousRows.length,
            elapsedMs: elapsedSince(startedAt),
            ...(details.providersTried ? { providersTried: details.providersTried } : {}),
          },
          timestamp: new Date().toISOString(),
        });
        throw caught;
      }
    }),
  );

  return router;
}
