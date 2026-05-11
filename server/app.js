import express from 'express';
import session from 'express-session';
import { nanoid } from 'nanoid';
import { verifyDatabase } from './db/index.js';
import { errorResponse } from './http/response.js';
import { createAuthRouter } from './routes/auth.js';
import { csrfProtection } from './security/csrf.js';

export function createApp({ db } = {}) {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(
    session({
      name: 'gc.sid',
      secret: process.env.SESSION_SECRET || 'dev-session-secret-change-me',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000,
      },
    }),
  );
  app.use((req, res, next) => {
    const requestId = req.get('x-request-id') || `req_${nanoid(12)}`;
    req.requestId = requestId;
    res.set('x-request-id', requestId);
    next();
  });
  app.use(
    csrfProtection({
      exemptPaths: ['/api/auth/setup', '/api/auth/login'],
    }),
  );

  app.get('/api/health', (_req, res) => {
    const database = db ? verifyDatabase(db) : { ok: false };
    res.json({
      data: {
        status: 'ok',
        database: database.ok ? 'ok' : 'unavailable',
      },
    });
  });

  if (db) {
    app.use('/api/auth', createAuthRouter({ db }));
  }

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
    if (err.status && err.code) {
      res.status(err.status).json(errorResponse(err, req.requestId));
      return;
    }

    console.error({ requestId: req.requestId, err });
    res
      .status(500)
      .json(errorResponse({ code: 'INTERNAL_ERROR', message: 'Unexpected server error.' }, req.requestId));
  });

  return app;
}
