function statusClass(status) {
  return `${Math.floor(status / 100)}xx`;
}

export function createRequestMetrics({ now = () => Date.now() } = {}) {
  const startedAtMs = now();
  const byStatusClass = {};
  const byMethod = {};
  let total = 0;
  let errorCount = 0;
  let totalDurationMs = 0;
  let maxDurationMs = 0;

  return {
    record({ method, status, durationMs }) {
      total += 1;
      totalDurationMs += durationMs;
      maxDurationMs = Math.max(maxDurationMs, durationMs);
      byStatusClass[statusClass(status)] = (byStatusClass[statusClass(status)] || 0) + 1;
      byMethod[method] = (byMethod[method] || 0) + 1;
      if (status >= 500) {
        errorCount += 1;
      }
    },

    snapshot() {
      return {
        startedAt: new Date(startedAtMs).toISOString(),
        uptimeSeconds: Math.max(0, Math.round((now() - startedAtMs) / 1000)),
        requests: {
          total,
          errorCount,
          averageDurationMs: total > 0 ? Number((totalDurationMs / total).toFixed(1)) : 0,
          maxDurationMs: Number(maxDurationMs.toFixed(1)),
          byStatusClass,
          byMethod,
        },
      };
    },
  };
}

export function createRequestMetricsMiddleware({ metrics }) {
  return function requestMetrics(req, res, next) {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      metrics.record({
        method: req.method,
        status: res.statusCode,
        durationMs,
      });
    });
    next();
  };
}
