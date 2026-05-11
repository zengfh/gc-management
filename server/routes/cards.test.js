import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/index.js';

describe('card routes', () => {
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

  function sampleCard(overrides = {}) {
    return {
      brand: 'Target',
      cardType: 'merchant',
      faceValueCents: 5_000,
      purchaseCostCents: 4_500,
      cardNumber: '4111 1111 1111 1111',
      pin: '1234',
      billingZip: '94105',
      expirationDate: '2027-12-31',
      notes: 'Holiday balance',
      ...overrides,
    };
  }

  it('requires an unlocked session for card inventory', async () => {
    const response = await agent.get('/api/cards');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('LOCKED');
  });

  it('creates cards with encrypted credentials and returns only masked fields', async () => {
    const csrfToken = await setupOwner();

    const missingCsrf = await agent.post('/api/cards').send({
      cards: [sampleCard()],
    });
    expect(missingCsrf.status).toBe(403);

    const createResponse = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [sampleCard()],
    });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data).toHaveLength(1);
    expect(createResponse.body.data[0]).toMatchObject({
      brand: 'Target',
      cardType: 'merchant',
      faceValueCents: 5_000,
      remainingBalanceCents: 5_000,
      purchaseCostCents: 4_500,
      cardNumberLast4: '1111',
      status: 'available',
    });
    expect(createResponse.body.data[0]).not.toHaveProperty('cardNumber');
    expect(createResponse.body.data[0]).not.toHaveProperty('pin');
    expect(createResponse.body.data[0]).not.toHaveProperty('billingZip');

    const stored = db.prepare('SELECT * FROM cards WHERE id = ?').get(createResponse.body.data[0].id);
    expect(stored.cardNumber).not.toContain('4111111111111111');
    expect(stored.pin).not.toBe('1234');
    expect(stored.billingZip).not.toBe('94105');
    expect(stored.cardNumberHash).toMatch(/^[a-f0-9]{64}$/);

    const listResponse = await agent.get('/api/cards').query({
      cardNumber: '4111-1111-1111-1111',
    });
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.map((card) => card.id)).toEqual([createResponse.body.data[0].id]);
    expect(listResponse.body.page).toMatchObject({
      limit: 50,
      offset: 0,
      total: 1,
      hasMore: false,
    });
  }, 45_000);

  it('blocks active duplicate cards by normalized number and brand', async () => {
    const csrfToken = await setupOwner();

    const first = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [sampleCard()],
    });
    expect(first.status).toBe(201);

    const duplicate = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [sampleCard({ cardNumber: '4111111111111111' })],
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_ACTIVE_CARD');

    const count = db.prepare('SELECT COUNT(*) AS count FROM cards').get().count;
    expect(count).toBe(1);
  }, 45_000);

  it('returns card detail with redacted audit history', async () => {
    const csrfToken = await setupOwner();
    const createResponse = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [sampleCard()],
    });
    const cardId = createResponse.body.data[0].id;

    const detailResponse = await agent.get(`/api/cards/${cardId}`);

    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.data.card).toMatchObject({
      id: cardId,
      brand: 'Target',
      cardNumberLast4: '1111',
    });
    expect(detailResponse.body.data.card).not.toHaveProperty('cardNumber');
    expect(detailResponse.body.data.transactions).toEqual([]);
    expect(detailResponse.body.data.usages).toEqual([]);
    expect(detailResponse.body.data.audit).toHaveLength(1);
    expect(detailResponse.body.data.audit[0]).toMatchObject({
      entityType: 'card',
      entityId: cardId,
      action: 'card.create',
    });

    const auditText = JSON.stringify(
      db.prepare('SELECT oldValue, newValue, metadata FROM audit_log WHERE entityId = ?').all(cardId),
    );
    expect(auditText).not.toContain('4111111111111111');
    expect(auditText).not.toContain('1234');
    expect(auditText).not.toContain('94105');
  }, 45_000);
});
