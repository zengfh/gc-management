import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/index.js';

describe('reference value routes', () => {
  const appOrigin = 'http://localhost:5173';
  let db;
  let agent;

  beforeEach(() => {
    db = openDatabase({ filename: ':memory:' });
    agent = request.agent(createApp({ db }));

    return () => {
      db.close();
    };
  });

  async function setupOwner() {
    const response = await agent.post('/api/auth/setup').send({
      unlockSecret: 'a strong unlock phrase',
    });
    return response.body.data.csrfToken;
  }

  function postWithCsrf(path, csrfToken) {
    return agent.post(path).set('Origin', appOrigin).set('X-CSRF-Token', csrfToken);
  }

  it('requires an unlocked session', async () => {
    const response = await agent.get('/api/reference-values');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('LOCKED');
  });

  it('can be disabled by deployment feature flag', async () => {
    const originalFlag = process.env.GC_FEATURE_REFERENCE_VALUE_HINTS;
    process.env.GC_FEATURE_REFERENCE_VALUE_HINTS = 'false';
    try {
      await setupOwner();

      const response = await agent.get('/api/reference-values');

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FEATURE_DISABLED');
    } finally {
      if (originalFlag === undefined) {
        delete process.env.GC_FEATURE_REFERENCE_VALUE_HINTS;
      } else {
        process.env.GC_FEATURE_REFERENCE_VALUE_HINTS = originalFlag;
      }
    }
  });

  it('upserts and searches reference values by substring', async () => {
    const csrfToken = await setupOwner();

    const upsert = await postWithCsrf('/api/reference-values', csrfToken).send({
      values: [
        { type: 'deal_name', value: 'Amazon Prime Day' },
        { type: 'source', value: 'Best Buy' },
        { type: 'card_brand', value: 'Amazon' },
      ],
    });

    expect(upsert.status).toBe(200);
    expect(upsert.body.data).toEqual([
      expect.objectContaining({ type: 'deal_name', value: 'Amazon Prime Day', usageCount: 1 }),
      expect.objectContaining({ type: 'source', value: 'Best Buy', usageCount: 1 }),
      expect.objectContaining({ type: 'card_brand', value: 'Amazon', usageCount: 1 }),
    ]);

    const byMiddle = await agent.get('/api/reference-values').query({
      types: 'card_brand',
      q: 'maz',
    });
    expect(byMiddle.status).toBe(200);
    expect(byMiddle.body.data.card_brand.map((value) => value.value)).toEqual(['Amazon']);

    const byTail = await agent.get('/api/reference-values').query({
      types: 'card_brand',
      q: 'zon',
    });
    expect(byTail.status).toBe(200);
    expect(byTail.body.data.card_brand.map((value) => value.value)).toEqual(['Amazon']);
  });

  it('deduplicates normalized values and increments usage count', async () => {
    const csrfToken = await setupOwner();

    await postWithCsrf('/api/reference-values', csrfToken).send({
      values: [{ type: 'card_brand', value: 'Amazon' }],
    });
    await postWithCsrf('/api/reference-values', csrfToken).send({
      values: [{ type: 'card_brand', value: 'amazon' }],
    });

    const response = await agent.get('/api/reference-values').query({
      types: 'card_brand',
      q: 'am',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.card_brand).toHaveLength(1);
    expect(response.body.data.card_brand[0]).toMatchObject({
      value: 'Amazon',
      usageCount: 2,
    });
  });

  it('rejects unsupported reference types', async () => {
    const csrfToken = await setupOwner();

    const response = await postWithCsrf('/api/reference-values', csrfToken).send({
      values: [{ type: 'merchant', value: 'Amazon' }],
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_FAILED');
  });
});
