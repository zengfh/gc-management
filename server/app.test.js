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
});
