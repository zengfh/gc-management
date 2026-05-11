import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/index.js';

describe('backup routes', () => {
  const appOrigin = 'http://localhost:5173';
  const unlockSecret = 'a strong unlock phrase';
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
    const response = await agent.post('/api/auth/setup').send({ unlockSecret });
    return response.body.data.csrfToken;
  }

  function postWithCsrf(path, csrfToken) {
    return agent.post(path).set('Origin', appOrigin).set('X-CSRF-Token', csrfToken);
  }

  async function createSampleCard(csrfToken) {
    const response = await postWithCsrf('/api/deals', csrfToken).send({
      name: 'May bonus deal',
      source: 'Costco',
      purchaseDate: '2026-05-01',
      totalCostCents: 4_500,
      notes: 'Export fixture',
      cards: [
        {
          brand: 'Target',
          cardType: 'merchant',
          faceValueCents: 5_000,
          cardNumber: '4111 1111 1111 1111',
          pin: '1234',
          billingZip: '94105',
          expirationDate: '2027-12-31',
          source: 'Costco',
          notes: 'Holiday balance',
        },
      ],
    });

    expect(response.status).toBe(201);
    return response.body.data;
  }

  it('exports plaintext JSON with fresh secret controls and a redacted audit event', async () => {
    const csrfToken = await setupOwner();
    const created = await createSampleCard(csrfToken);

    const response = await postWithCsrf('/api/backup/export', csrfToken).send({
      unlockSecret,
      confirmation: 'EXPORT',
      acknowledgePlaintext: true,
    });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['content-disposition']).toMatch(
      /attachment; filename="gift-card-plaintext-export-\d{4}-\d{2}-\d{2}\.json"/,
    );
    expect(response.body.data).toMatchObject({
      schemaVersion: 1,
      exportType: 'plaintext_json',
      warning: expect.stringContaining('spendable credentials'),
      deals: [
        expect.objectContaining({
          id: created.deal.id,
          name: 'May bonus deal',
          source: 'Costco',
        }),
      ],
      cards: [
        expect.objectContaining({
          id: created.cards[0].id,
          dealId: created.deal.id,
          brand: 'Target',
          cardNumber: '4111111111111111',
          pin: '1234',
          billingZip: '94105',
          cardNumberLast4: '1111',
        }),
      ],
      transactions: [],
      usages: [],
    });
    expect(response.body.data.exportedAt).toEqual(expect.any(String));
    expect(response.body.data.cards[0]).not.toHaveProperty('cvv');
    expect(response.body.data.cards[0]).not.toHaveProperty('cardNumberHash');

    const auditRows = db
      .prepare("SELECT * FROM audit_log WHERE entityType = 'backup' AND action = 'backup.export_plaintext'")
      .all();
    expect(auditRows).toHaveLength(1);
    expect(JSON.parse(auditRows[0].metadata)).toMatchObject({
      exportType: 'plaintext_json',
      dealCount: 1,
      cardCount: 1,
      transactionCount: 0,
      usageCount: 0,
    });

    const auditText = JSON.stringify(auditRows);
    expect(auditText).not.toContain('4111111111111111');
    expect(auditText).not.toContain('1234');
    expect(auditText).not.toContain('94105');
    expect(auditText).not.toContain(unlockSecret);
  }, 45_000);

  it('rejects plaintext export without the current unlock secret and confirmation controls', async () => {
    const csrfToken = await setupOwner();
    await createSampleCard(csrfToken);

    const missingCsrf = await agent.post('/api/backup/export').send({
      unlockSecret,
      confirmation: 'EXPORT',
      acknowledgePlaintext: true,
    });
    expect(missingCsrf.status).toBe(403);

    const wrongSecret = await postWithCsrf('/api/backup/export', csrfToken).send({
      unlockSecret: 'wrong unlock phrase',
      confirmation: 'EXPORT',
      acknowledgePlaintext: true,
    });
    expect(wrongSecret.status).toBe(401);
    expect(wrongSecret.body.error.code).toBe('INVALID_UNLOCK_SECRET');

    const missingConfirmation = await postWithCsrf('/api/backup/export', csrfToken).send({
      unlockSecret,
      confirmation: 'export',
      acknowledgePlaintext: true,
    });
    expect(missingConfirmation.status).toBe(400);
    expect(missingConfirmation.body.error.fieldErrors).toEqual([
      expect.objectContaining({
        field: 'confirmation',
        code: 'invalid_value',
      }),
    ]);

    const backupAuditCount = db
      .prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entityType = 'backup'")
      .get().count;
    expect(backupAuditCount).toBe(0);
  }, 45_000);
});
