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
});

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

      const analysis = await analyzeGiftCardsWithAi(parsed.data.text);
      insertAuditEvent(db, {
        accountId: req.auth.accountId,
        userId: req.auth.userId,
        requestId: req.requestId,
        entityType: 'import',
        entityId: null,
        action: 'ai_import.analyze',
        metadata: {
          provider: analysis.provider,
          model: analysis.model,
          rowCount: analysis.rows.length,
          textLength: parsed.data.text.length,
        },
        timestamp: new Date().toISOString(),
      });

      res.json(objectResponse(analysis));
    }),
  );

  return router;
}
