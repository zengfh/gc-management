import { Router } from 'express';
import { z } from 'zod';
import { insertAuditEvent } from '../audit/index.js';
import { requireUnlockedSession } from '../auth/requireAuth.js';
import { requireAdminRole } from '../auth/roles.js';
import { verifyFreshUnlockSecret } from '../auth/verifyUnlockSecret.js';
import { asyncHandler, badRequest } from '../http/errors.js';
import { objectResponse } from '../http/response.js';
import {
  plaintextExportPolicyLocked,
  readBackupSettings,
  updateBackupSettings,
} from '../settings/backupSettings.js';

const backupSettingsUpdateSchema = z
  .object({
    unlockSecret: z.string().min(1),
    allowPlaintextExport: z.boolean(),
    backupReminderDays: z.number().int().min(0).max(365),
  })
  .strict();

function zodFieldErrors(error) {
  return error.issues.map((issue) => ({
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

export function createSettingsRouter({ db }) {
  const router = Router();

  router.use(requireUnlockedSession);
  router.use(requireAdminRole);

  router.get(
    '/backup',
    asyncHandler(async (req, res) => {
      res.json(objectResponse(readBackupSettings(db, req.auth.accountId)));
    }),
  );

  router.put(
    '/backup',
    asyncHandler(async (req, res) => {
      const body = validateBody(backupSettingsUpdateSchema, req.body || {});
      if (plaintextExportPolicyLocked() && body.allowPlaintextExport) {
        throw badRequest(
          'PLAINTEXT_EXPORT_POLICY_LOCKED',
          'Plaintext JSON export is disabled by deployment policy.',
        );
      }

      await verifyFreshUnlockSecret(db, req.auth, body.unlockSecret);

      const timestamp = new Date().toISOString();
      updateBackupSettings(
        db,
        req.auth.accountId,
        {
          allowPlaintextExport: body.allowPlaintextExport,
          backupReminderDays: body.backupReminderDays,
        },
        timestamp,
      );

      insertAuditEvent(db, {
        accountId: req.auth.accountId,
        userId: req.auth.userId,
        requestId: req.requestId,
        entityType: 'system',
        action: 'settings.backup_update',
        metadata: {
          allowPlaintextExport: body.allowPlaintextExport,
          backupReminderDays: body.backupReminderDays,
        },
        timestamp,
      });

      res.json(objectResponse(readBackupSettings(db, req.auth.accountId, timestamp)));
    }),
  );

  return router;
}
