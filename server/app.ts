import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextFunction, Request, Response } from 'express';
import express, { type Express } from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { nanoid } from 'nanoid';
import type Database from 'better-sqlite3';
import { createSqliteLoginAttemptStore } from './auth/loginAttempts.js';
import { createSqliteSessionStore } from './auth/sqliteSessionStore.js';
import { verifyDatabase } from './db/index.js';
import { HttpError } from './http/errors.js';
import { errorResponse } from './http/response.js';
import { createErrorReporter } from './observability/errorReporter.js';
import { createRequestLogger, logRequestError } from './observability/requestLogging.js';
import { createRequestMetrics, createRequestMetricsMiddleware } from './observability/requestMetrics.js';
import { createAuditRouter } from './routes/audit.js';
import { createAuthRouter } from './routes/auth.js';
import { createAiImportRouter } from './routes/aiImport.js';
import { createBackupRouter } from './routes/backup.js';
import { createCardsRouter } from './routes/cards.js';
import { createAdminRouter } from './routes/admin.js';
import { createDealsRouter } from './routes/deals.js';
import { createMcpRouter } from './routes/mcp.js';
import { createMcpTokensRouter } from './routes/mcpTokens.js';
import { createObservabilityRouter } from './routes/observability.js';
import { createReferenceValuesRouter } from './routes/referenceValues.js';
import { createSettingsRouter } from './routes/settings.js';
import { createUsersRouter } from './routes/users.js';
import { csrfProtection } from './security/csrf.js';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.basename(appDir) === 'server' && path.basename(path.dirname(appDir)) === 'build'
  ? path.resolve(appDir, '..', '..')
  : path.resolve(appDir, '..');
const defaultStaticDir = path.join(projectRoot, 'dist');

interface CreateAppOptions {
  db?: Database.Database;
  logger?: Console;
  serveStatic?: boolean;
  staticDir?: string;
}

function envBoolean(name: string): boolean | undefined {
  const value = process.env[name];
  if (value === undefined) {
    return undefined;
  }
  if (['1', 'true', 'yes', 'on'].includes(value.toLowerCase())) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(value.toLowerCase())) {
    return false;
  }
  return undefined;
}

function shouldServeStatic(serveStatic?: boolean): boolean {
  if (serveStatic !== undefined) {
    return serveStatic;
  }

  const configured = envBoolean('GC_SERVE_STATIC');
  if (configured !== undefined) {
    return configured;
  }

  return process.env.NODE_ENV === 'production';
}

function shouldTrustProxy() {
  const configured = envBoolean('GC_TRUST_PROXY');
  if (configured !== undefined) {
    return configured;
  }

  return process.env.NODE_ENV === 'production';
}

function shouldUseSecureSessionCookie() {
  const configured = envBoolean('GC_SESSION_COOKIE_SECURE');
  if (configured !== undefined) {
    return configured;
  }

  return process.env.NODE_ENV === 'production';
}

function assertStaticBuild(staticDir: string) {
  const indexPath = path.join(staticDir, 'index.html');
  if (!fs.existsSync(indexPath)) {
    throw new Error(
      `Static frontend build not found at ${indexPath}. Run npm run build before production startup or set GC_SERVE_STATIC=false.`,
    );
  }
}

function setStaticCacheHeaders(res: Response, filePath: string, staticDir: string) {
  const relativePath = path.relative(staticDir, filePath);
  if (relativePath.split(path.sep)[0] === 'assets') {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return;
  }

  res.setHeader('Cache-Control', 'no-cache');
}

function installStaticRoutes(app: Express, staticDir: string) {
  const indexPath = path.join(staticDir, 'index.html');

  app.use(
    express.static(staticDir, {
      index: false,
      setHeaders: (res, filePath) => setStaticCacheHeaders(res, filePath, staticDir),
    }),
  );

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!['GET', 'HEAD'].includes(req.method) || req.path.startsWith('/api/') || path.extname(req.path)) {
      next();
      return;
    }

    res.set('Cache-Control', 'no-cache');
    res.sendFile(indexPath);
  });
}

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

export function createApp({ db, logger = console, serveStatic, staticDir = defaultStaticDir }: CreateAppOptions = {}) {
  assertProductionConfig();

  const app = express();
  if (shouldTrustProxy()) {
    app.set('trust proxy', 1);
  }

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
        secure: shouldUseSecureSessionCookie(),
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
      exemptPaths: [
        '/api/auth/setup',
        '/api/auth/login',
        '/api/auth/passkeys/login/options',
        '/api/auth/passkeys/login/verify',
        '/api/auth/accept-invite',
        '/api/auth/recover',
        '/api/mcp',
      ],
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
    app.use('/api/ai-import', createAiImportRouter({ db }));
    app.use('/api/auth', createAuthRouter({ db, loginAttempts: createSqliteLoginAttemptStore({ db }) }));
    app.use('/api/audit', createAuditRouter({ db }));
    app.use('/api/backup', createBackupRouter({ db }));
    app.use('/api/cards', createCardsRouter({ db }));
    app.use('/api/deals', createDealsRouter({ db }));
    app.use('/api/mcp', createMcpRouter({ db }));
    app.use('/api/mcp/tokens', createMcpTokensRouter({ db }));
    app.use('/api/observability', createObservabilityRouter({ metrics }));
    app.use('/api/reference-values', createReferenceValuesRouter({ db }));
    app.use('/api/settings', createSettingsRouter({ db }));
    app.use('/api/users', createUsersRouter({ db }));
  }

  if (shouldServeStatic(serveStatic)) {
    assertStaticBuild(staticDir);
    installStaticRoutes(app, staticDir);
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

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
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
