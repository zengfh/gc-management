import type { Request } from 'express';

type FetchLike = typeof fetch;
type ReporterLogger = Pick<Console, 'error'>;

function requestPath(req: Request): string {
  return req.path || (req.originalUrl || req.url || '').split('?')[0] || 'unknown';
}

export function createErrorReporter({
  endpoint = process.env.GC_ERROR_REPORT_URL,
  token = process.env.GC_ERROR_REPORT_TOKEN,
  fetchImpl = globalThis.fetch,
  logger = console,
}: {
  endpoint?: string;
  token?: string;
  fetchImpl?: FetchLike;
  logger?: Partial<ReporterLogger>;
} = {}) {
  return {
    report({ req, err }: { req: Request; err: unknown }) {
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
          name: err instanceof Error ? err.name : 'Error',
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
            message: error instanceof Error ? error.message : 'External error report failed.',
          }),
        );
      });
    },
  };
}
