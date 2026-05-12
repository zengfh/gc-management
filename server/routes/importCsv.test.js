import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/index.js';

describe('CSV import preview route', () => {
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

  it('previews a valid CSV without creating cards or exposing full credentials', async () => {
    const csrfToken = await setupOwner();
    const csv = [
      'brand,cardType,faceValue,purchaseCost,cardNumber,pin,billingZip,expirationDate,format,source,notes',
      'Target,merchant,50.00,45.00,4111 1111 1111 1111,1234,94105,2027-12-31,digital,Costco,Holiday balance',
      'Amazon,merchant,25,20,,,,2028-01-31,digital,Staples,Bulk reward',
    ].join('\n');

    const response = await postWithCsrf('/api/cards/import-csv', csrfToken).send({ csv });

    expect(response.status).toBe(200);
    expect(response.body.data.summary).toEqual({
      rowCount: 2,
      validCount: 2,
      invalidCount: 0,
    });
    expect(response.body.data.rows).toEqual([
      expect.objectContaining({
        rowNumber: 2,
        valid: true,
        parsed: expect.objectContaining({
          brand: 'Target',
          cardType: 'merchant',
          faceValueCents: 5000,
          purchaseCostCents: 4500,
          cardNumberLast4: '1111',
          hasPin: true,
          hasBillingZip: true,
        }),
        errors: [],
      }),
      expect.objectContaining({
        rowNumber: 3,
        valid: true,
        parsed: expect.objectContaining({
          brand: 'Amazon',
          faceValueCents: 2500,
          purchaseCostCents: 2000,
          cardNumberLast4: null,
        }),
        errors: [],
      }),
    ]);

    expect(db.prepare('SELECT COUNT(*) AS count FROM cards').get().count).toBe(0);
    const responseText = JSON.stringify(response.body);
    expect(responseText).not.toContain('4111111111111111');
    expect(responseText).not.toContain('1234');
    expect(responseText).not.toContain('94105');
  }, 45_000);

  it('rejects CSV import when the feature is disabled by deployment policy', async () => {
    const originalFlag = process.env.GC_FEATURE_CSV_IMPORT;
    process.env.GC_FEATURE_CSV_IMPORT = 'false';
    try {
      const csrfToken = await setupOwner();
      const response = await postWithCsrf('/api/cards/import-csv', csrfToken).send({
        csv: 'brand,cardType,faceValue\nTarget,merchant,50.00',
      });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FEATURE_DISABLED');
    } finally {
      if (originalFlag === undefined) {
        delete process.env.GC_FEATURE_CSV_IMPORT;
      } else {
        process.env.GC_FEATURE_CSV_IMPORT = originalFlag;
      }
    }
  });

  it('previews marketplace template aliases and normalized delivery values', async () => {
    const csrfToken = await setupOwner();
    const csv = [
      'Merchant,Value,Cost,Number,Claim Code,Postal Code,Expires,Delivery,Seller,Memo',
      'Best Buy,100.00,86.25,5555444433332222,7788,94105,2028-08-31,eGift,Raise,Marketplace order',
    ].join('\n');

    const response = await postWithCsrf('/api/cards/import-csv', csrfToken).send({ csv });

    expect(response.status).toBe(200);
    expect(response.body.data.summary).toEqual({
      rowCount: 1,
      validCount: 1,
      invalidCount: 0,
    });
    expect(response.body.data.rows[0]).toMatchObject({
      rowNumber: 2,
      valid: true,
      parsed: {
        brand: 'Best Buy',
        cardType: 'merchant',
        network: null,
        faceValueCents: 10000,
        purchaseCostCents: 8625,
        cardNumberLast4: '2222',
        hasPin: true,
        hasBillingZip: true,
        expirationDate: '2028-08-31',
        format: 'digital',
        source: 'Raise',
        notes: 'Marketplace order',
      },
      errors: [],
    });

    const responseText = JSON.stringify(response.body);
    expect(responseText).not.toContain('5555444433332222');
    expect(responseText).not.toContain('7788');
    expect(responseText).not.toContain('94105');
  }, 45_000);

  it('returns row errors and duplicate conflicts without committing invalid CSV rows', async () => {
    const csrfToken = await setupOwner();
    const existing = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [
        {
          brand: 'Target',
          cardType: 'merchant',
          faceValueCents: 5000,
          cardNumber: '4111 1111 1111 1111',
          pin: '1234',
        },
      ],
    });
    expect(existing.status).toBe(201);

    const csv = [
      'brand,cardType,faceValue,purchaseCost,cardNumber,pin',
      'Target,merchant,50.00,45.00,4111 1111 1111 1111,9999',
      ',merchant,-5,4.00,,',
      'Best Buy,invalid,25.00,20.00,,',
    ].join('\n');

    const response = await postWithCsrf('/api/cards/import-csv', csrfToken).send({ csv });

    expect(response.status).toBe(200);
    expect(response.body.data.summary).toEqual({
      rowCount: 3,
      validCount: 0,
      invalidCount: 3,
    });
    expect(response.body.data.rows[0].errors).toEqual([
      expect.objectContaining({
        field: 'cardNumber',
        code: 'duplicate_active_card',
      }),
    ]);
    expect(response.body.data.rows[1].errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'brand', code: 'required' }),
        expect.objectContaining({ field: 'faceValue', code: 'invalid_money' }),
      ]),
    );
    expect(response.body.data.rows[2].errors).toEqual([
      expect.objectContaining({
        field: 'cardType',
        code: 'invalid_enum',
      }),
    ]);
    expect(db.prepare('SELECT COUNT(*) AS count FROM cards').get().count).toBe(1);

    const responseText = JSON.stringify(response.body);
    expect(responseText).not.toContain('4111111111111111');
    expect(responseText).not.toContain('9999');
  }, 45_000);

  it('confirms a valid CSV by revalidating, creating cards, and writing an import job', async () => {
    const csrfToken = await setupOwner();
    const csv = [
      'brand,cardType,faceValue,purchaseCost,cardNumber,pin,billingZip,expirationDate,format,source,notes',
      'Target,merchant,50.00,45.00,4111 1111 1111 1111,1234,94105,2027-12-31,digital,Costco,Holiday balance',
      'Amazon,merchant,25,20,,,,2028-01-31,digital,Staples,Bulk reward',
    ].join('\n');

    const response = await postWithCsrf('/api/cards/import-csv/confirm', csrfToken).send({ csv });

    expect(response.status).toBe(201);
    expect(response.body.data.summary).toEqual({
      rowCount: 2,
      validCount: 2,
      invalidCount: 0,
    });
    expect(response.body.data.importJob).toMatchObject({
      type: 'csv',
      status: 'confirmed',
      rowCount: 2,
      validCount: 2,
      invalidCount: 0,
    });
    expect(response.body.data.cards).toEqual([
      expect.objectContaining({
        brand: 'Target',
        faceValueCents: 5000,
        purchaseCostCents: 4500,
        cardNumberLast4: '1111',
      }),
      expect.objectContaining({
        brand: 'Amazon',
        faceValueCents: 2500,
        purchaseCostCents: 2000,
        cardNumberLast4: null,
      }),
    ]);
    expect(response.body.data.cards[0]).not.toHaveProperty('cardNumber');
    expect(response.body.data.cards[0]).not.toHaveProperty('pin');
    expect(response.body.data.cards[0]).not.toHaveProperty('billingZip');

    expect(db.prepare('SELECT COUNT(*) AS count FROM cards').get().count).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS count FROM import_jobs').get().count).toBe(1);
    const auditRows = db
      .prepare("SELECT * FROM audit_log WHERE entityType = 'import' AND action = 'import.csv_confirm'")
      .all();
    expect(auditRows).toHaveLength(1);
    expect(JSON.parse(auditRows[0].metadata)).toMatchObject({
      rowCount: 2,
      cardCount: 2,
    });

    const auditText = JSON.stringify(auditRows);
    expect(auditText).not.toContain('4111111111111111');
    expect(auditText).not.toContain('1234');
    expect(auditText).not.toContain('94105');
  }, 45_000);

  it('confirms prepaid template aliases with network metadata', async () => {
    const csrfToken = await setupOwner();
    const csv = [
      'Issuer,Card Category,Payment Network,Face Amount,Cost Basis,Account Number,PIN,Billing Postal Code,Exp Date,Medium,Purchase Source,Description',
      'Vanilla,prepaid,visa,200.00,190.00,4111111111111111,1234,94105,2029-04-30,plastic,Giftcards.com,Activation batch',
    ].join('\n');

    const response = await postWithCsrf('/api/cards/import-csv/confirm', csrfToken).send({ csv });

    expect(response.status).toBe(201);
    expect(response.body.data.cards[0]).toMatchObject({
      brand: 'Vanilla',
      cardType: 'prepaid',
      network: 'visa',
      faceValueCents: 20000,
      purchaseCostCents: 19000,
      cardNumberLast4: '1111',
      expirationDate: '2029-04-30',
      format: 'physical',
      source: 'Giftcards.com',
      notes: 'Activation batch',
    });

    const stored = db.prepare('SELECT brand, cardType, network, format, source, notes FROM cards').get();
    expect(stored).toMatchObject({
      brand: 'Vanilla',
      cardType: 'prepaid',
      network: 'visa',
      format: 'physical',
      source: 'Giftcards.com',
      notes: 'Activation batch',
    });
  }, 45_000);

  it('confirms custom credential columns into encrypted credential fields', async () => {
    const csrfToken = await setupOwner();
    const csv = [
      'brand,credentialProfile,faceValue,purchaseCost,custom:Member ID,custom:Security phrase,source,notes',
      'Local Spa,custom,120.00,96.00,MEMBER-2345,frontdesk-only,Direct,Issuer-specific fields',
    ].join('\n');

    const response = await postWithCsrf('/api/cards/import-csv/confirm', csrfToken).send({ csv });

    expect(response.status).toBe(201);
    expect(response.body.data.cards[0]).toMatchObject({
      brand: 'Local Spa',
      credentialProfile: 'custom',
      credentialSummary: expect.objectContaining({
        fieldCount: 2,
      }),
    });
    expect(JSON.stringify(response.body.data)).not.toContain('MEMBER-2345');
    expect(JSON.stringify(response.body.data)).not.toContain('frontdesk-only');

    const storedFields = db
      .prepare('SELECT fieldKey, label, fieldKind, encryptedValue FROM card_credential_fields ORDER BY sortOrder')
      .all();
    expect(storedFields).toEqual([
      expect.objectContaining({
        fieldKey: 'member_id',
        label: 'Member ID',
        fieldKind: 'primary_code',
      }),
      expect.objectContaining({
        fieldKey: 'security_phrase',
        label: 'Security phrase',
        fieldKind: 'primary_code',
      }),
    ]);
    expect(storedFields[0].encryptedValue).not.toContain('MEMBER-2345');
    expect(storedFields[1].encryptedValue).not.toContain('frontdesk-only');
  }, 45_000);

  it('rejects CSV confirm when revalidation finds row errors or duplicate conflicts', async () => {
    const csrfToken = await setupOwner();
    const existing = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [
        {
          brand: 'Target',
          cardType: 'merchant',
          faceValueCents: 5000,
          cardNumber: '4111 1111 1111 1111',
        },
      ],
    });
    expect(existing.status).toBe(201);
    const csv = [
      'brand,cardType,faceValue,purchaseCost,cardNumber',
      'Target,merchant,50.00,45.00,4111 1111 1111 1111',
      ',merchant,-5,4.00,',
    ].join('\n');

    const response = await postWithCsrf('/api/cards/import-csv/confirm', csrfToken).send({ csv });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('CSV_IMPORT_INVALID');
    expect(response.body.error.details.summary).toEqual({
      rowCount: 2,
      validCount: 0,
      invalidCount: 2,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM cards').get().count).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS count FROM import_jobs').get().count).toBe(0);
  }, 45_000);
});
