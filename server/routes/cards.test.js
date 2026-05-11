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

  it('filters card inventory by source deal expiration text and whitelisted sort fields', async () => {
    const csrfToken = await setupOwner();

    const staplesDeal = await postWithCsrf('/api/deals', csrfToken).send({
      name: 'Staples May promo',
      source: 'Staples',
      totalCostCents: 4_500,
      cards: [
        sampleCard({
          brand: 'Target',
          cardNumber: '4111 1111 1111 1111',
          expirationDate: '2026-05-30',
          notes: 'Holiday balance',
        }),
      ],
    });
    expect(staplesDeal.status).toBe(201);

    const costcoDeal = await postWithCsrf('/api/deals', csrfToken).send({
      name: 'Costco promo',
      source: 'Costco',
      totalCostCents: 4_500,
      cards: [
        sampleCard({
          brand: 'Amazon',
          cardNumber: '4222 2222 2222 2222',
          expirationDate: '2028-01-31',
          notes: 'Bulk reward',
        }),
      ],
    });
    expect(costcoDeal.status).toBe(201);

    const filtered = await agent.get('/api/cards').query({
      source: 'Staples',
      dealId: staplesDeal.body.data.deal.id,
      expiresBefore: '2026-06-01',
      text: 'holiday',
      sortBy: 'expirationDate',
      sortDir: 'asc',
    });

    expect(filtered.status).toBe(200);
    expect(filtered.body.data.map((card) => card.id)).toEqual([staplesDeal.body.data.cards[0].id]);
    expect(filtered.body.page).toMatchObject({
      total: 1,
      hasMore: false,
    });

    const unsupportedSort = await agent.get('/api/cards').query({
      sortBy: 'cardNumber',
    });
    expect(unsupportedSort.status).toBe(400);
    expect(unsupportedSort.body.error.fieldErrors).toEqual([
      expect.objectContaining({
        field: 'sortBy',
        code: 'invalid_enum',
      }),
    ]);
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

  it('reveals card credentials through an explicit CSRF-protected action with redacted audit', async () => {
    const csrfToken = await setupOwner();
    const createResponse = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [sampleCard()],
    });
    const cardId = createResponse.body.data[0].id;

    const missingCsrf = await agent.post(`/api/cards/${cardId}/reveal`).send({});
    expect(missingCsrf.status).toBe(403);

    const revealResponse = await postWithCsrf(`/api/cards/${cardId}/reveal`, csrfToken).send({});

    expect(revealResponse.status).toBe(200);
    expect(revealResponse.headers['cache-control']).toContain('no-store');
    expect(revealResponse.body.data).toEqual({
      cardNumber: '4111111111111111',
      cardNumberLast4: '1111',
      pin: '1234',
      billingZip: '94105',
    });

    const auditRows = db
      .prepare("SELECT * FROM audit_log WHERE entityType = 'card' AND action = 'card.credentials_reveal'")
      .all();
    expect(auditRows).toHaveLength(1);
    const auditText = JSON.stringify(auditRows);
    expect(auditText).not.toContain('4111111111111111');
    expect(auditText).not.toContain('1234');
    expect(auditText).not.toContain('94105');
  }, 45_000);

  it('reserves and unreserves an available card with audit records', async () => {
    const csrfToken = await setupOwner();
    const createResponse = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [sampleCard()],
    });
    const cardId = createResponse.body.data[0].id;

    const reserveResponse = await postWithCsrf(`/api/cards/${cardId}/reserve`, csrfToken).send({
      reservedFor: 'Dealer A',
      reservedUntil: '2026-06-01',
      reservedNotes: 'Awaiting payment',
    });
    expect(reserveResponse.status).toBe(200);
    expect(reserveResponse.body.data).toMatchObject({
      id: cardId,
      status: 'reserved',
      rowVersion: 2,
    });

    const duplicateReserve = await postWithCsrf(`/api/cards/${cardId}/reserve`, csrfToken).send({});
    expect(duplicateReserve.status).toBe(409);
    expect(duplicateReserve.body.error.code).toBe('INVALID_CARD_TRANSITION');

    const unreserveResponse = await postWithCsrf(`/api/cards/${cardId}/unreserve`, csrfToken).send({});
    expect(unreserveResponse.status).toBe(200);
    expect(unreserveResponse.body.data).toMatchObject({
      id: cardId,
      status: 'available',
      rowVersion: 3,
    });

    const duplicateUnreserve = await postWithCsrf(`/api/cards/${cardId}/unreserve`, csrfToken).send({});
    expect(duplicateUnreserve.status).toBe(409);
    expect(duplicateUnreserve.body.error.code).toBe('INVALID_CARD_TRANSITION');

    const actions = db
      .prepare("SELECT action FROM audit_log WHERE entityType = 'card' AND entityId = ? ORDER BY id")
      .all(cardId)
      .map((row) => row.action);
    expect(actions).toEqual(['card.create', 'card.reserve', 'card.unreserve']);
  }, 45_000);

  it('sells a card and undo restores the sale snapshot with a reversal transaction', async () => {
    const csrfToken = await setupOwner();
    const createResponse = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [sampleCard()],
    });
    const cardId = createResponse.body.data[0].id;

    const sellResponse = await postWithCsrf(`/api/cards/${cardId}/sell`, csrfToken).send({
      salePriceCents: 4_800,
      buyerName: 'Dealer A',
      buyerType: 'dealer',
      platform: 'chat',
      transactionDate: '2026-05-11',
      notes: 'Sold at discount',
    });
    expect(sellResponse.status).toBe(200);
    expect(sellResponse.body.data.card).toMatchObject({
      id: cardId,
      status: 'sold',
      remainingBalanceCents: 0,
      rowVersion: 2,
    });
    expect(sellResponse.body.data.transactions).toHaveLength(1);
    expect(sellResponse.body.data.transactions[0]).toMatchObject({
      type: 'sale',
      salePriceCents: 4_800,
      remainingBalanceAtSaleCents: 5_000,
      statusAtSale: 'available',
    });

    const duplicateSell = await postWithCsrf(`/api/cards/${cardId}/sell`, csrfToken).send({
      salePriceCents: 4_800,
    });
    expect(duplicateSell.status).toBe(409);
    expect(duplicateSell.body.error.code).toBe('INVALID_CARD_TRANSITION');

    const missingReason = await postWithCsrf(`/api/cards/${cardId}/undo-sale`, csrfToken).send({});
    expect(missingReason.status).toBe(400);

    const undoResponse = await postWithCsrf(`/api/cards/${cardId}/undo-sale`, csrfToken).send({
      reason: 'Buyer canceled',
    });
    expect(undoResponse.status).toBe(200);
    expect(undoResponse.body.data.card).toMatchObject({
      id: cardId,
      status: 'available',
      remainingBalanceCents: 5_000,
      rowVersion: 3,
    });
    expect(undoResponse.body.data.transactions.map((transaction) => transaction.type)).toEqual([
      'sale_reversal',
      'sale',
    ]);

    const actions = db
      .prepare("SELECT action FROM audit_log WHERE entityType = 'card' AND entityId = ? ORDER BY id")
      .all(cardId)
      .map((row) => row.action);
    expect(actions).toEqual(['card.create', 'card.sell', 'card.undo_sale']);
  }, 45_000);

  it('records partial and final usage while blocking overuse', async () => {
    const csrfToken = await setupOwner();
    const createResponse = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [sampleCard()],
    });
    const cardId = createResponse.body.data[0].id;

    const partialUse = await postWithCsrf(`/api/cards/${cardId}/use`, csrfToken).send({
      amountCents: 2_000,
      merchant: 'Target',
      description: 'Groceries',
      usageDate: '2026-05-11',
    });
    expect(partialUse.status).toBe(200);
    expect(partialUse.body.data.card).toMatchObject({
      id: cardId,
      status: 'in_use',
      remainingBalanceCents: 3_000,
      rowVersion: 2,
    });
    expect(partialUse.body.data.usages).toHaveLength(1);
    expect(partialUse.body.data.usages[0]).toMatchObject({
      amountCents: 2_000,
      merchant: 'Target',
      isReversed: 0,
      isWriteOff: 0,
    });

    const overuse = await postWithCsrf(`/api/cards/${cardId}/use`, csrfToken).send({
      amountCents: 4_000,
    });
    expect(overuse.status).toBe(409);
    expect(overuse.body.error.code).toBe('INSUFFICIENT_BALANCE');

    const finalUse = await postWithCsrf(`/api/cards/${cardId}/use`, csrfToken).send({
      amountCents: 3_000,
      merchant: 'Target',
    });
    expect(finalUse.status).toBe(200);
    expect(finalUse.body.data.card).toMatchObject({
      id: cardId,
      status: 'used_up',
      remainingBalanceCents: 0,
      rowVersion: 3,
    });
    expect(finalUse.body.data.usages.map((usage) => usage.amountCents)).toEqual([3_000, 2_000]);

    const actions = db
      .prepare("SELECT action FROM audit_log WHERE entityType = 'card' AND entityId = ? ORDER BY id")
      .all(cardId)
      .map((row) => row.action);
    expect(actions).toEqual(['card.create', 'card.use', 'card.use']);
  }, 45_000);

  it('voids an active card by writing off the remaining balance', async () => {
    const csrfToken = await setupOwner();
    const createResponse = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [sampleCard()],
    });
    const cardId = createResponse.body.data[0].id;

    await postWithCsrf(`/api/cards/${cardId}/use`, csrfToken).send({
      amountCents: 1_500,
      merchant: 'Target',
    });

    const voidResponse = await postWithCsrf(`/api/cards/${cardId}/void`, csrfToken).send({
      reason: 'Card lost',
    });
    expect(voidResponse.status).toBe(200);
    expect(voidResponse.body.data.card).toMatchObject({
      id: cardId,
      status: 'void',
      remainingBalanceCents: 0,
      rowVersion: 3,
    });
    expect(voidResponse.body.data.usages[0]).toMatchObject({
      amountCents: 3_500,
      merchant: 'Write-off (Voided)',
      description: 'Card lost',
      isWriteOff: 1,
    });

    const useVoided = await postWithCsrf(`/api/cards/${cardId}/use`, csrfToken).send({
      amountCents: 100,
    });
    expect(useVoided.status).toBe(409);
    expect(useVoided.body.error.code).toBe('INVALID_CARD_TRANSITION');

    const actions = db
      .prepare("SELECT action FROM audit_log WHERE entityType = 'card' AND entityId = ? ORDER BY id")
      .all(cardId)
      .map((row) => row.action);
    expect(actions).toEqual(['card.create', 'card.use', 'card.void']);
  }, 45_000);

  it('undoes a non-write-off usage and recalculates card balance and status', async () => {
    const csrfToken = await setupOwner();
    const createResponse = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [sampleCard()],
    });
    const cardId = createResponse.body.data[0].id;

    await postWithCsrf(`/api/cards/${cardId}/use`, csrfToken).send({
      amountCents: 2_000,
      merchant: 'Target',
    });
    const finalUse = await postWithCsrf(`/api/cards/${cardId}/use`, csrfToken).send({
      amountCents: 3_000,
      merchant: 'Target',
    });
    const usageId = finalUse.body.data.usages[0].id;
    expect(finalUse.body.data.card.status).toBe('used_up');

    const missingReason = await postWithCsrf(`/api/cards/${cardId}/undo-usage`, csrfToken).send({
      usageId,
    });
    expect(missingReason.status).toBe(400);

    const undoResponse = await postWithCsrf(`/api/cards/${cardId}/undo-usage`, csrfToken).send({
      usageId,
      reason: 'Mistyped amount',
    });
    expect(undoResponse.status).toBe(200);
    expect(undoResponse.body.data.card).toMatchObject({
      id: cardId,
      status: 'in_use',
      remainingBalanceCents: 3_000,
      rowVersion: 4,
    });
    expect(undoResponse.body.data.usages[0]).toMatchObject({
      id: usageId,
      amountCents: 3_000,
      isReversed: 1,
      reversalReason: 'Mistyped amount',
    });

    const duplicateUndo = await postWithCsrf(`/api/cards/${cardId}/undo-usage`, csrfToken).send({
      usageId,
      reason: 'Try again',
    });
    expect(duplicateUndo.status).toBe(409);
    expect(duplicateUndo.body.error.code).toBe('USAGE_ALREADY_REVERSED');

    const actions = db
      .prepare("SELECT action FROM audit_log WHERE entityType = 'card' AND entityId = ? ORDER BY id")
      .all(cardId)
      .map((row) => row.action);
    expect(actions).toEqual(['card.create', 'card.use', 'card.use', 'card.undo_usage']);
  }, 45_000);

  it('rejects undoing a void write-off usage', async () => {
    const csrfToken = await setupOwner();
    const createResponse = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [sampleCard()],
    });
    const cardId = createResponse.body.data[0].id;

    const voidResponse = await postWithCsrf(`/api/cards/${cardId}/void`, csrfToken).send({
      reason: 'Card lost',
    });
    const writeOffUsageId = voidResponse.body.data.usages[0].id;

    const undoWriteOff = await postWithCsrf(`/api/cards/${cardId}/undo-usage`, csrfToken).send({
      usageId: writeOffUsageId,
      reason: 'Try to restore',
    });
    expect(undoWriteOff.status).toBe(409);
    expect(undoWriteOff.body.error.code).toBe('WRITE_OFF_USAGE_NOT_REVERSIBLE');
  }, 45_000);

  it('updates allowed fields with row-version protection and audit', async () => {
    const csrfToken = await setupOwner();
    const createResponse = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [sampleCard()],
    });
    const card = createResponse.body.data[0];

    const updateResponse = await agent
      .put(`/api/cards/${card.id}`)
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', csrfToken)
      .send({
        rowVersion: card.rowVersion,
        brand: 'Amazon',
        expirationDate: '2028-01-31',
        notes: 'Updated notes',
      });
    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.data).toMatchObject({
      id: card.id,
      brand: 'Amazon',
      expirationDate: '2028-01-31',
      notes: 'Updated notes',
      rowVersion: 2,
    });

    const staleUpdate = await agent
      .put(`/api/cards/${card.id}`)
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', csrfToken)
      .send({
        rowVersion: card.rowVersion,
        notes: 'Stale update',
      });
    expect(staleUpdate.status).toBe(409);
    expect(staleUpdate.body.error.code).toBe('STALE_CARD_VERSION');

    const actions = db
      .prepare("SELECT action FROM audit_log WHERE entityType = 'card' AND entityId = ? ORDER BY id")
      .all(card.id)
      .map((row) => row.action);
    expect(actions).toEqual(['card.create', 'card.update']);
  }, 45_000);

  it('limits terminal card edits to notes', async () => {
    const csrfToken = await setupOwner();
    const createResponse = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [sampleCard()],
    });
    const cardId = createResponse.body.data[0].id;
    const sold = await postWithCsrf(`/api/cards/${cardId}/sell`, csrfToken).send({
      salePriceCents: 4_800,
    });

    const brandUpdate = await agent
      .put(`/api/cards/${cardId}`)
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', csrfToken)
      .send({
        rowVersion: sold.body.data.card.rowVersion,
        brand: 'Amazon',
      });
    expect(brandUpdate.status).toBe(409);
    expect(brandUpdate.body.error.code).toBe('TERMINAL_CARD_EDIT_RESTRICTED');

    const notesUpdate = await agent
      .put(`/api/cards/${cardId}`)
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', csrfToken)
      .send({
        rowVersion: sold.body.data.card.rowVersion,
        notes: 'Closeout notes',
      });
    expect(notesUpdate.status).toBe(200);
    expect(notesUpdate.body.data).toMatchObject({
      id: cardId,
      status: 'sold',
      notes: 'Closeout notes',
      rowVersion: 3,
    });
  }, 45_000);

  it('deletes only never-touched available cards', async () => {
    const csrfToken = await setupOwner();
    const untouched = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [sampleCard()],
    });
    const touched = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [sampleCard({ brand: 'Best Buy', cardNumber: '5555 5555 5555 5555' })],
    });
    const untouchedId = untouched.body.data[0].id;
    const touchedId = touched.body.data[0].id;

    await postWithCsrf(`/api/cards/${touchedId}/use`, csrfToken).send({
      amountCents: 100,
      merchant: 'Best Buy',
    });

    const deleteTouched = await agent
      .delete(`/api/cards/${touchedId}`)
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', csrfToken);
    expect(deleteTouched.status).toBe(409);
    expect(deleteTouched.body.error.code).toBe('CARD_DELETE_RESTRICTED');

    const deleteUntouched = await agent
      .delete(`/api/cards/${untouchedId}`)
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', csrfToken);
    expect(deleteUntouched.status).toBe(204);

    const detail = await agent.get(`/api/cards/${untouchedId}`);
    expect(detail.status).toBe(404);
  }, 45_000);
});
