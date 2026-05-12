import { Router } from 'express';
import { requireUnlockedSession } from '../auth/requireAuth.js';
import { objectResponse } from '../http/response.js';

export function createObservabilityRouter({ metrics }) {
  const router = Router();

  router.use(requireUnlockedSession);

  router.get('/summary', (_req, res) => {
    res.json(objectResponse(metrics.snapshot()));
  });

  return router;
}
