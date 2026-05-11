import request from 'supertest';
import { describe, expect, it } from 'vitest';
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
