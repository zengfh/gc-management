import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { nanoid } from 'nanoid';
import { createSqliteLoginAttemptStore } from './auth/loginAttempts.js';
import { createSqliteSessionStore } from './auth/sqliteSessionStore.js';
import { verifyDatabase } from './db/index.js';
import { errorResponse } from './http/response.js';
import { createErrorReporter } from './observability/errorReporter.js';
import { createRequestLogger, logRequestError } from './observability/requestLogging.js';
import { createRequestMetrics, createRequestMetricsMiddleware } from './observability/requestMetrics.js';
import { createAuditRouter } from './routes/audit.js';
import { createAuthRouter } from './routes/auth.js';
import { createBackupRouter } from './routes/backup.js';
import { createCardsRouter } from './routes/cards.js';
import { createAdminRouter } from './routes/admin.js';
import { createDealsRouter } from './routes/deals.js';
import { createObservabilityRouter } from './routes/observability.js';
import { createSettingsRouter } from './routes/settings.js';
import { createUsersRouter } from './routes/users.js';
import { csrfProtection } from './security/csrf.js';

function assertProductionConfig() {
  if (process.env.NODE_ENV === 'production' && !process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET is required in production.');
  }
  if (process.env.GC_DEPLOYMENT_MODE === 'multi-instance') {
    throw new Error(
      'GC_DEPLOYMENT_MODE=multi-instance is blocked until external shared session/rate-limit stores and a server database are configured.',
    );
  }
}

export function createApp({ db, logger = console } = {}) {
  assertProductionConfig();

  const app = express();
  const sessionStore = db ? createSqliteSessionStore({ db }) : undefined;
  const metrics = createRequestMetrics();
  const errorReporter = createErrorReporter({ logger });

  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      frameguard: {
        action: 'deny',
      },
      hsts:
        process.env.NODE_ENV === 'production'
          ? {
              maxAge: 15552000,
              includeSubDomains: true,
            }
          : false,
      referrerPolicy: {
        policy: 'no-referrer',
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(
    session({
      name: 'gc.sid',
      ...(sessionStore ? { store: sessionStore } : {}),
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
  app.use(createRequestMetricsMiddleware({ metrics }));
  app.use(createRequestLogger({ logger }));
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
    app.use('/api/admin', createAdminRouter({ db }));
    app.use('/api/auth', createAuthRouter({ db, loginAttempts: createSqliteLoginAttemptStore({ db }) }));
    app.use('/api/audit', createAuditRouter({ db }));
    app.use('/api/backup', createBackupRouter({ db }));
    app.use('/api/cards', createCardsRouter({ db }));
    app.use('/api/deals', createDealsRouter({ db }));
    app.use('/api/observability', createObservabilityRouter({ metrics }));
    app.use('/api/settings', createSettingsRouter({ db }));
    app.use('/api/users', createUsersRouter({ db }));
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

    logRequestError({ logger, req, err });
    errorReporter.report({ req, err });
    res
      .status(500)
      .json(errorResponse({ code: 'INTERNAL_ERROR', message: 'Unexpected server error.' }, req.requestId));
  });

  return app;
}
