import { readFile } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/index.js';

describe('Release 5 synthetic credential acceptance data', () => {
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

  async function acceptanceCsv() {
    return readFile(path.join(process.cwd(), 'test-data/release5_acceptance_cards.csv'), 'utf8');
  }

  it('imports, searches, and reveals all mainstream credential profiles from the acceptance CSV', async () => {
    const csrfToken = await setupOwner();
    const csv = await acceptanceCsv();

    const previewResponse = await postWithCsrf('/api/cards/import-csv', csrfToken).send({ csv });
    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body.data.summary).toEqual({
      rowCount: 6,
      validCount: 6,
      invalidCount: 0,
    });
    const previewRowsByBrand = Object.fromEntries(
      previewResponse.body.data.rows.map((row) => [row.parsed.brand, row.parsed]),
    );
    expect(previewRowsByBrand.Uber).toMatchObject({
      credentialLabel: 'Redemption code',
      credentialHint: '****605A',
      hasPin: false,
    });
    expect(previewRowsByBrand.Target).toMatchObject({
      credentialLabel: 'Card number',
      credentialHint: '****0502',
      hasPin: true,
    });
    expect(previewRowsByBrand.Starbucks).toMatchObject({
      credentialLabel: 'Barcode',
      credentialHint: '****5678',
    });

    const confirmResponse = await postWithCsrf('/api/cards/import-csv/confirm', csrfToken).send({ csv });
    expect(confirmResponse.status).toBe(201);
    expect(confirmResponse.body.data.cards).toHaveLength(6);

    const profilesByBrand = Object.fromEntries(
      confirmResponse.body.data.cards.map((card) => [card.brand, card.credentialProfile]),
    );
    expect(profilesByBrand).toEqual({
      Uber: 'claim_code',
      'Best Buy': 'merchant_number_pin',
      Target: 'merchant_number_pin',
      Starbucks: 'barcode',
      'Vanilla Visa': 'network_prepaid',
      'Local Boutique': 'custom',
    });

    const searchCases = [
      ['UBERTEST202605A', 'Uber'],
      ['9900000000001001', 'Best Buy'],
      ['7788899900012345678', 'Starbucks'],
      ['GCMEMBER-12345', 'Local Boutique'],
    ];

    for (const [credential, expectedBrand] of searchCases) {
      const response = await agent.get('/api/cards').query({ credential });
      expect(response.status).toBe(200);
      expect(response.body.data.map((card) => card.brand)).toContain(expectedBrand);
    }

    const cardIdsByBrand = Object.fromEntries(confirmResponse.body.data.cards.map((card) => [card.brand, card.id]));
    const starbucksReveal = await postWithCsrf(`/api/cards/${cardIdsByBrand.Starbucks}/reveal`, csrfToken).send({});
    expect(starbucksReveal.status).toBe(200);
    expect(starbucksReveal.body.data.credentials.fields).toEqual([
      expect.objectContaining({
        fieldKind: 'barcode_value',
        barcodeFormat: 'code128',
        value: '7788899900012345678',
      }),
    ]);

    const prepaidReveal = await postWithCsrf(`/api/cards/${cardIdsByBrand['Vanilla Visa']}/reveal`, csrfToken).send({});
    expect(prepaidReveal.status).toBe(200);
    expect(prepaidReveal.body.data.credentials.fields.map((field) => field.fieldKind)).toEqual([
      'card_number',
      'expiration_month',
      'expiration_year',
      'billing_postal_code',
      'cardholder_name',
      'billing_address',
    ]);
    expect(JSON.stringify(prepaidReveal.body.data)).not.toContain('network_security_code');
  }, 45_000);
});
