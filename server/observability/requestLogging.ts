function defaultLogEnabled() {
  if (process.env.GC_REQUEST_LOGS != null) {
    return process.env.GC_REQUEST_LOGS === 'true';
  }
  return process.env.NODE_ENV === 'production';
}

function safeLogPath(req) {
  return req.path || req.originalUrl?.split('?')[0] || 'unknown';
}

function writeLog(logger, method, payload) {
  const writer = typeof logger?.[method] === 'function' ? logger[method] : console[method];
  writer.call(logger || console, JSON.stringify(payload));
}

export function createRequestLogger({ logger = console, enabled = defaultLogEnabled() } = {}) {
  return function requestLogger(req, res, next) {
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

export function logRequestError({ logger = console, req, err }) {
  if (!defaultLogEnabled()) {
    return;
  }

  writeLog(logger, 'error', {
    level: 'error',
    event: 'http.error',
    requestId: req.requestId,
    method: req.method,
    path: safeLogPath(req),
    status: err.status || 500,
    errorCode: err.code || 'INTERNAL_ERROR',
    errorName: err.name || 'Error',
  });
}
