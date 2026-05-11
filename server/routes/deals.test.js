import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/index.js';

describe('deal routes', () => {
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

  function card(number, overrides = {}) {
    return {
      brand: 'Staples',
      cardType: 'merchant',
      faceValueCents: 5_000,
      cardNumber: number,
      pin: '1234',
      ...overrides,
    };
  }

  it('requires an unlocked session for deals', async () => {
    const response = await agent.get('/api/deals');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('LOCKED');
  });

  it('creates a deal with batch cards and deterministic total-cost allocation', async () => {
    const csrfToken = await setupOwner();

    const response = await postWithCsrf('/api/deals', csrfToken).send({
      name: 'Staples promo',
      source: 'Staples',
      purchaseDate: '2026-05-11',
      totalCostCents: 10_000,
      notes: 'May promo',
      cards: [
        card('4111 1111 1111 1111'),
        card('4222 2222 2222 2222'),
        card('4333 3333 3333 3333'),
      ],
    });

    expect(response.status).toBe(201);
    expect(response.body.data.deal).toMatchObject({
      name: 'Staples promo',
      source: 'Staples',
      purchaseDate: '2026-05-11',
      inputTotalCostCents: 10_000,
    });
    expect(response.body.data.cards.map((createdCard) => createdCard.purchaseCostCents)).toEqual([
      3_333,
      3_333,
      3_334,
    ]);
    expect(new Set(response.body.data.cards.map((createdCard) => createdCard.dealId))).toEqual(
      new Set([response.body.data.deal.id]),
    );

    const storedNumbers = db.prepare('SELECT cardNumber FROM cards ORDER BY id').all();
    expect(JSON.stringify(storedNumbers)).not.toContain('4111111111111111');

    const actions = db.prepare('SELECT entityType, action FROM audit_log ORDER BY id').all();
    expect(actions).toEqual([
      { entityType: 'auth', action: 'auth.setup' },
      { entityType: 'deal', action: 'deal.create' },
      { entityType: 'card', action: 'card.create' },
      { entityType: 'card', action: 'card.create' },
      { entityType: 'card', action: 'card.create' },
    ]);
  }, 45_000);

  it('allocates mixed explicit and proportional costs exactly', async () => {
    const csrfToken = await setupOwner();

    const response = await postWithCsrf('/api/deals', csrfToken).send({
      name: 'Mixed cost promo',
      totalCostCents: 10_000,
      cards: [
        card('4111 1111 1111 1111', { purchaseCostCents: 6_000 }),
        card('4222 2222 2222 2222'),
        card('4333 3333 3333 3333'),
      ],
    });

    expect(response.status).toBe(201);
    expect(response.body.data.cards.map((createdCard) => createdCard.purchaseCostCents)).toEqual([
      6_000,
      2_000,
      2_000,
    ]);
  }, 45_000);

  it('rejects invalid batch cards atomically', async () => {
    const csrfToken = await setupOwner();

    const duplicateResponse = await postWithCsrf('/api/deals', csrfToken).send({
      name: 'Bad batch',
      totalCostCents: 10_000,
      cards: [
        card('4111 1111 1111 1111'),
        card('4111111111111111'),
      ],
    });
    expect(duplicateResponse.status).toBe(409);
    expect(duplicateResponse.body.error.code).toBe('DUPLICATE_ACTIVE_CARD');

    expect(db.prepare('SELECT COUNT(*) AS count FROM deals').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM cards').get().count).toBe(0);

    const excessiveExplicitCost = await postWithCsrf('/api/deals', csrfToken).send({
      name: 'Bad costs',
      totalCostCents: 5_000,
      cards: [card('4222 2222 2222 2222', { purchaseCostCents: 6_000 })],
    });
    expect(excessiveExplicitCost.status).toBe(400);
    expect(excessiveExplicitCost.body.error.code).toBe('COST_ALLOCATION_INVALID');
  }, 45_000);

  it('lists deal detail and archives or unarchives without removing cards', async () => {
    const csrfToken = await setupOwner();
    const createResponse = await postWithCsrf('/api/deals', csrfToken).send({
      name: 'Archive me',
      totalCostCents: 5_000,
      cards: [card('4111 1111 1111 1111')],
    });
    const dealId = createResponse.body.data.deal.id;
    const cardId = createResponse.body.data.cards[0].id;

    const listResponse = await agent.get('/api/deals');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.map((deal) => deal.id)).toEqual([dealId]);

    const detailResponse = await agent.get(`/api/deals/${dealId}`);
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.data.deal.id).toBe(dealId);
    expect(detailResponse.body.data.cards.map((dealCard) => dealCard.id)).toEqual([cardId]);

    const archiveResponse = await postWithCsrf(`/api/deals/${dealId}/archive`, csrfToken).send({});
    expect(archiveResponse.status).toBe(200);
    expect(archiveResponse.body.data.deal.id).toBe(dealId);
    expect(archiveResponse.body.data.deal.archivedAt).toEqual(expect.any(String));

    const hiddenList = await agent.get('/api/deals');
    expect(hiddenList.status).toBe(200);
    expect(hiddenList.body.data).toEqual([]);

    const cardDetail = await agent.get(`/api/cards/${cardId}`);
    expect(cardDetail.status).toBe(200);
    expect(cardDetail.body.data.card.dealId).toBe(dealId);

    const unarchiveResponse = await postWithCsrf(`/api/deals/${dealId}/unarchive`, csrfToken).send({});
    expect(unarchiveResponse.status).toBe(200);
    expect(unarchiveResponse.body.data.deal.archivedAt).toBeNull();

    const visibleList = await agent.get('/api/deals');
    expect(visibleList.body.data.map((deal) => deal.id)).toEqual([dealId]);

    const actions = db
      .prepare("SELECT action FROM audit_log WHERE entityType = 'deal' AND entityId = ? ORDER BY id")
      .all(dealId)
      .map((row) => row.action);
    expect(actions).toEqual(['deal.create', 'deal.archive', 'deal.unarchive']);
  }, 45_000);
});
