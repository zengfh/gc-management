import { Router } from 'express';
import { requireUnlockedSession } from '../auth/requireAuth.js';
import { requireAdminRole } from '../auth/roles.js';
import { objectResponse } from '../http/response.js';

function hasValidMetricsToken(req) {
  const configuredToken = process.env.GC_METRICS_TOKEN;
  if (!configuredToken) {
    return false;
  }
  return req.get('authorization') === `Bearer ${configuredToken}`;
}

function metricLine(name, value, labels = null) {
  const renderedLabels = labels
    ? `{${Object.entries(labels)
        .map(([key, labelValue]) => `${key}="${String(labelValue).replaceAll('"', '\\"')}"`)
        .join(',')}}`
    : '';
  return `${name}${renderedLabels} ${value}`;
}

function renderPrometheusMetrics(snapshot) {
  const lines = [
    '# HELP gc_http_requests_total Total HTTP requests observed by this process.',
    '# TYPE gc_http_requests_total counter',
    metricLine('gc_http_requests_total', snapshot.requests.total),
    '# HELP gc_http_request_errors_total Total 5xx HTTP responses observed by this process.',
    '# TYPE gc_http_request_errors_total counter',
    metricLine('gc_http_request_errors_total', snapshot.requests.errorCount),
    '# HELP gc_http_request_duration_ms_average Average HTTP request duration in milliseconds.',
    '# TYPE gc_http_request_duration_ms_average gauge',
    metricLine('gc_http_request_duration_ms_average', snapshot.requests.averageDurationMs),
    '# HELP gc_http_request_duration_ms_max Maximum HTTP request duration in milliseconds.',
    '# TYPE gc_http_request_duration_ms_max gauge',
    metricLine('gc_http_request_duration_ms_max', snapshot.requests.maxDurationMs),
    '# HELP gc_process_uptime_seconds Process uptime represented by the metrics collector.',
    '# TYPE gc_process_uptime_seconds gauge',
    metricLine('gc_process_uptime_seconds', snapshot.uptimeSeconds),
    '# HELP gc_http_requests_by_status_class_total HTTP requests grouped by status class.',
    '# TYPE gc_http_requests_by_status_class_total counter',
  ];

  for (const [statusClass, count] of Object.entries(snapshot.requests.byStatusClass)) {
    lines.push(metricLine('gc_http_requests_by_status_class_total', count, { status_class: statusClass }));
  }

  lines.push(
    '# HELP gc_http_requests_by_method_total HTTP requests grouped by method.',
    '# TYPE gc_http_requests_by_method_total counter',
  );

  for (const [method, count] of Object.entries(snapshot.requests.byMethod)) {
    lines.push(metricLine('gc_http_requests_by_method_total', count, { method }));
  }

  return `${lines.join('\n')}\n`;
}

function sendMetrics(metrics, res) {
  res.type('text/plain; version=0.0.4; charset=utf-8').send(renderPrometheusMetrics(metrics.snapshot()));
}

export function createObservabilityRouter({ metrics }) {
  const router = Router();

  router.get(
    '/metrics',
    (req, res, next) => {
      if (hasValidMetricsToken(req)) {
        sendMetrics(metrics, res);
        return;
      }
      next();
    },
    requireUnlockedSession,
    requireAdminRole,
    (_req, res) => {
      sendMetrics(metrics, res);
    },
  );

  router.use(requireUnlockedSession);
  router.use(requireAdminRole);

  router.get('/summary', (_req, res) => {
    res.json(objectResponse(metrics.snapshot()));
  });

  return router;
}
