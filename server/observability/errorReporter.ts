function requestPath(req) {
  return req.path || (req.originalUrl || req.url || '').split('?')[0] || 'unknown';
}

export function createErrorReporter({
  endpoint = process.env.GC_ERROR_REPORT_URL,
  token = process.env.GC_ERROR_REPORT_TOKEN,
  fetchImpl = globalThis.fetch,
  logger = console,
} = {}) {
  return {
    report({ req, err }) {
      if (!endpoint || !fetchImpl) {
        return;
      }

      const payload = {
        event: 'server.error',
        requestId: req.requestId,
        method: req.method,
        path: requestPath(req),
        accountId: req.auth?.accountId || req.session?.accountId || null,
        userId: req.auth?.userId || req.session?.userId || null,
        error: {
          name: err?.name || 'Error',
          code: 'INTERNAL_ERROR',
        },
        reportedAt: new Date().toISOString(),
      };

      fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      }).catch((error) => {
        logger.error?.(
          JSON.stringify({
            level: 'error',
            event: 'external_error_report_failed',
            requestId: req.requestId,
            message: error?.message || 'External error report failed.',
          }),
        );
      });
    },
  };
}
