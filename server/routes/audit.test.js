import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/index.js';

describe('audit routes', () => {
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

  it('lists audit events with entity and action filters without sensitive values', async () => {
    const csrfToken = await setupOwner();
    const createResponse = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [
        {
          brand: 'Target',
          cardType: 'merchant',
          faceValueCents: 5_000,
          cardNumber: '4111 1111 1111 1111',
          pin: '1234',
        },
      ],
    });
    const cardId = createResponse.body.data[0].id;

    const reserveResponse = await postWithCsrf(`/api/cards/${cardId}/reserve`, csrfToken).send({
      reservedFor: 'Dealer A',
    });
    expect(reserveResponse.status).toBe(200);

    const response = await agent.get('/api/audit').query({
      entityType: 'card',
      action: 'card.reserve',
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      expect.objectContaining({
        entityType: 'card',
        entityId: cardId,
        action: 'card.reserve',
        timestamp: expect.any(String),
      }),
    ]);
    expect(response.body.page).toMatchObject({
      total: 1,
      hasMore: false,
    });

    const responseText = JSON.stringify(response.body);
    expect(responseText).not.toContain('4111111111111111');
    expect(responseText).not.toContain('1234');

    const invalidEntity = await agent.get('/api/audit').query({
      entityType: 'credential',
    });
    expect(invalidEntity.status).toBe(400);
    expect(invalidEntity.body.error.fieldErrors).toEqual([
      expect.objectContaining({
        field: 'entityType',
        code: 'invalid_enum',
      }),
    ]);
  }, 45_000);
});
