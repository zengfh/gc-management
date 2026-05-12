import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from './app.js';
import { openDatabase } from './db/index.js';

describe('app', () => {
  it('returns health with request id', async () => {
    const db = openDatabase({ filename: ':memory:' });
    const app = createApp({ db });

    const response = await request(app)
      .get('/api/health')
      .set('x-request-id', 'req_test');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe('req_test');
    expect(response.body).toEqual({
      data: {
        status: 'ok',
        database: 'ok',
      },
    });

    db.close();
  });

  it('sets security headers with a strict credential-safe CSP', async () => {
    const db = openDatabase({ filename: ':memory:' });
    const app = createApp({ db });

    const response = await request(app).get('/api/health');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['content-security-policy']).toContain("script-src 'self'");
    expect(response.headers['content-security-policy']).toContain("style-src 'self' 'unsafe-inline'");
    expect(response.headers['content-security-policy']).toContain("img-src 'self' data:");
    expect(response.headers['content-security-policy']).toContain("connect-src 'self'");
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['content-security-policy']).toContain("base-uri 'self'");
    expect(response.headers['content-security-policy']).toContain("form-action 'self'");
    expect(response.headers['content-security-policy']).not.toContain('unsafe-eval');

    db.close();
  });

  it('adds HSTS in production configuration', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSessionSecret = process.env.SESSION_SECRET;
    process.env.NODE_ENV = 'production';
    process.env.SESSION_SECRET = 'test-production-session-secret';
    const db = openDatabase({ filename: ':memory:' });
    try {
      const app = createApp({ db });

      const response = await request(app).get('/api/health');

      expect(response.headers['strict-transport-security']).toContain('max-age=');
    } finally {
      db.close();
      process.env.NODE_ENV = originalNodeEnv;
      process.env.SESSION_SECRET = originalSessionSecret;
    }
  });

  it('writes credential-safe structured request logs when enabled', async () => {
    const originalRequestLogs = process.env.GC_REQUEST_LOGS;
    process.env.GC_REQUEST_LOGS = 'true';
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const db = openDatabase({ filename: ':memory:' });
    try {
      const app = createApp({ db, logger });

      const response = await request(app)
        .get('/api/health?cardNumber=4111111111111111&unlockSecret=a%20strong%20unlock%20phrase')
        .set('x-request-id', 'req_logsafe');

      expect(response.status).toBe(200);
      expect(logger.info).toHaveBeenCalledTimes(1);
      const logPayload = JSON.parse(logger.info.mock.calls[0][0]);
      expect(logPayload).toMatchObject({
        level: 'info',
        event: 'http.request',
        requestId: 'req_logsafe',
        method: 'GET',
        path: '/api/health',
        status: 200,
      });
      expect(logPayload.durationMs).toEqual(expect.any(Number));
      const rawLog = logger.info.mock.calls[0][0];
      expect(rawLog).not.toContain('4111111111111111');
      expect(rawLog).not.toContain('unlockSecret');
      expect(rawLog).not.toContain('a strong unlock phrase');
      expect(logger.error).not.toHaveBeenCalled();
    } finally {
      db.close();
      if (originalRequestLogs === undefined) {
        delete process.env.GC_REQUEST_LOGS;
      } else {
        process.env.GC_REQUEST_LOGS = originalRequestLogs;
      }
    }
  });

  it('returns authenticated observability metrics without query details', async () => {
    const db = openDatabase({ filename: ':memory:' });
    const agent = request.agent(createApp({ db }));
    try {
      await agent.get('/api/health?cardNumber=4111111111111111');
      const setupResponse = await agent.post('/api/auth/setup').send({
        unlockSecret: 'a strong unlock phrase',
      });
      expect(setupResponse.status).toBe(201);

      const summaryResponse = await agent.get('/api/observability/summary');

      expect(summaryResponse.status).toBe(200);
      expect(summaryResponse.body.data).toMatchObject({
        startedAt: expect.any(String),
        uptimeSeconds: expect.any(Number),
        requests: {
          total: expect.any(Number),
          errorCount: 0,
          averageDurationMs: expect.any(Number),
          maxDurationMs: expect.any(Number),
          byStatusClass: expect.objectContaining({
            '2xx': expect.any(Number),
          }),
          byMethod: expect.objectContaining({
            GET: expect.any(Number),
            POST: expect.any(Number),
          }),
        },
      });
      expect(summaryResponse.body.data.requests.total).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(summaryResponse.body)).not.toContain('4111111111111111');
      expect(JSON.stringify(summaryResponse.body)).not.toContain('cardNumber');
    } finally {
      db.close();
    }
  }, 30_000);

  it('rejects production startup without an explicit session secret', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalSessionSecret = process.env.SESSION_SECRET;
    process.env.NODE_ENV = 'production';
    delete process.env.SESSION_SECRET;
    const db = openDatabase({ filename: ':memory:' });
    try {
      expect(() => createApp({ db })).toThrow('SESSION_SECRET is required in production.');
    } finally {
      db.close();
      process.env.NODE_ENV = originalNodeEnv;
      process.env.SESSION_SECRET = originalSessionSecret;
    }
  });
});
