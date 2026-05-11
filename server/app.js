import express from 'express';
import { nanoid } from 'nanoid';
import { verifyDatabase } from './db/index.js';

export function createApp({ db } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    const requestId = req.get('x-request-id') || `req_${nanoid(12)}`;
    req.requestId = requestId;
    res.set('x-request-id', requestId);
    next();
  });

  app.get('/api/health', (_req, res) => {
    const database = db ? verifyDatabase(db) : { ok: false };
    res.json({
      data: {
        status: 'ok',
        database: database.ok ? 'ok' : 'unavailable',
      },
    });
  });

  app.use((req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found.',
        requestId: req.requestId,
      },
    });
  });

  app.use((err, req, res, _next) => {
    console.error({ requestId: req.requestId, err });
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected server error.',
        requestId: req.requestId,
      },
    });
  });

  return app;
}
