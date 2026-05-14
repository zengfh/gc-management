import type { NextFunction, Request, Response } from 'express';

type LogMethod = 'info' | 'error';
type Logger = Pick<Console, LogMethod>;

function defaultLogEnabled(): boolean {
  if (process.env.GC_REQUEST_LOGS != null) {
    return process.env.GC_REQUEST_LOGS === 'true';
  }
  return process.env.NODE_ENV === 'production';
}

function safeLogPath(req: Request): string {
  return req.path || req.originalUrl?.split('?')[0] || 'unknown';
}

function writeLog(logger: Partial<Logger> | undefined, method: LogMethod, payload: unknown) {
  const writer = typeof logger?.[method] === 'function' ? logger[method] : console[method];
  writer.call(logger || console, JSON.stringify(payload));
}

export function createRequestLogger({
  logger = console,
  enabled = defaultLogEnabled(),
}: { logger?: Partial<Logger>; enabled?: boolean } = {}) {
  return function requestLogger(req: Request, res: Response, next: NextFunction) {
    if (!enabled) {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      writeLog(logger, 'info', {
        level: 'info',
        event: 'http.request',
        requestId: req.requestId,
        method: req.method,
        path: safeLogPath(req),
        status: res.statusCode,
        durationMs: Number(durationMs.toFixed(1)),
        accountId: req.auth?.accountId || req.session?.accountId || null,
        userId: req.auth?.userId || req.session?.userId || null,
      });
    });

    next();
  };
}

export function logRequestError({ logger = console, req, err }: { logger?: Partial<Logger>; req: Request; err: unknown }) {
  if (!defaultLogEnabled()) {
    return;
  }

  writeLog(logger, 'error', {
    level: 'error',
    event: 'http.error',
    requestId: req.requestId,
    method: req.method,
    path: safeLogPath(req),
    status: typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 500,
    errorCode: typeof (err as { code?: unknown })?.code === 'string' ? (err as { code: string }).code : 'INTERNAL_ERROR',
    errorName: err instanceof Error ? err.name : 'Error',
  });
}
