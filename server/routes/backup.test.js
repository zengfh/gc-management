import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
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

  function parseBuffer(res, callback) {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
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

  it('omits network-card security codes from plaintext JSON exports', async () => {
    const originalFlag = process.env.GC_FEATURE_NETWORK_SECURITY_CODE_STORAGE;
    process.env.GC_FEATURE_NETWORK_SECURITY_CODE_STORAGE = 'true';
    try {
      const csrfToken = await setupOwner();
      const createResponse = await postWithCsrf('/api/cards', csrfToken).send({
        cards: [
          {
            brand: 'Visa',
            cardType: 'prepaid',
            network: 'visa',
            credentialProfile: 'network_prepaid',
            faceValueCents: 10_000,
            credentials: {
              profile: 'network_prepaid',
              fields: [
                {
                  fieldKey: 'card_number',
                  label: 'Card number',
                  fieldKind: 'card_number',
                  value: '4111111111111111',
                },
                {
                  fieldKey: 'network_security_code',
                  label: 'Security code',
                  fieldKind: 'network_security_code',
                  value: '123',
                },
              ],
            },
          },
        ],
      });
      expect(createResponse.status).toBe(201);

      const response = await postWithCsrf('/api/backup/export', csrfToken).send({
        unlockSecret,
        confirmation: 'EXPORT',
        acknowledgePlaintext: true,
      });

      expect(response.status).toBe(200);
      expect(response.body.data.warning).toMatch(/security codes are omitted/i);
      const exportedFields = response.body.data.cards[0].credentials.fields;
      expect(exportedFields).toEqual([
        expect.objectContaining({
          fieldKey: 'card_number',
          value: '4111111111111111',
        }),
      ]);
      expect(JSON.stringify(response.body.data)).not.toContain('network_security_code');
      expect(JSON.stringify(response.body.data)).not.toContain('"123"');
    } finally {
      if (originalFlag === undefined) {
        delete process.env.GC_FEATURE_NETWORK_SECURITY_CODE_STORAGE;
      } else {
        process.env.GC_FEATURE_NETWORK_SECURITY_CODE_STORAGE = originalFlag;
      }
    }
  }, 45_000);

  it('exports encrypted portable JSON without exposing credentials or passphrases', async () => {
    const csrfToken = await setupOwner();
    await createSampleCard(csrfToken);
    const backupPassphrase = 'portable backup passphrase';

    const response = await postWithCsrf('/api/backup/export-encrypted', csrfToken).send({
      unlockSecret,
      backupPassphrase,
      backupPassphraseConfirmation: backupPassphrase,
      confirmation: 'ENCRYPT',
    });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['content-disposition']).toMatch(
      /attachment; filename="gift-card-encrypted-export-\d{4}-\d{2}-\d{2}\.json"/,
    );
    expect(response.body.data).toMatchObject({
      schemaVersion: 1,
      exportType: 'encrypted_portable_json',
      payloadSchemaVersion: 1,
      appVersion: expect.any(String),
      exportedAt: expect.any(String),
      encryptedAt: expect.any(String),
      kdf: {
        name: 'scrypt',
        salt: expect.any(String),
        N: 131072,
        r: 8,
        p: 1,
        keyLength: 32,
      },
      cipher: {
        name: 'aes-256-gcm',
        iv: expect.any(String),
        authTag: expect.any(String),
        ciphertext: expect.any(String),
      },
    });
    expect(response.body.data).not.toHaveProperty('cards');
    expect(response.body.data).not.toHaveProperty('deals');

    const exportText = JSON.stringify(response.body.data);
    expect(exportText).not.toContain('4111111111111111');
    expect(exportText).not.toContain('1234');
    expect(exportText).not.toContain('94105');
    expect(exportText).not.toContain(unlockSecret);
    expect(exportText).not.toContain(backupPassphrase);

    const auditRows = db
      .prepare("SELECT * FROM audit_log WHERE entityType = 'backup' AND action = 'backup.export_encrypted'")
      .all();
    expect(auditRows).toHaveLength(1);
    expect(JSON.parse(auditRows[0].metadata)).toMatchObject({
      exportType: 'encrypted_portable_json',
      payloadSchemaVersion: 1,
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
    expect(auditText).not.toContain(backupPassphrase);
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

  it('rejects encrypted export when the backup passphrase reuses the unlock secret', async () => {
    const csrfToken = await setupOwner();
    await createSampleCard(csrfToken);

    const response = await postWithCsrf('/api/backup/export-encrypted', csrfToken).send({
      unlockSecret,
      backupPassphrase: unlockSecret,
      backupPassphraseConfirmation: unlockSecret,
      confirmation: 'ENCRYPT',
    });

    expect(response.status).toBe(400);
    expect(response.body.error.fieldErrors).toEqual([
      expect.objectContaining({
        field: 'backupPassphrase',
        code: 'custom',
      }),
    ]);
    const backupAuditCount = db
      .prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'backup.export_encrypted'")
      .get().count;
    expect(backupAuditCount).toBe(0);
  }, 45_000);

  it('exports a raw sqlite database file with fresh secret controls and audit', async () => {
    const csrfToken = await setupOwner();
    await createSampleCard(csrfToken);

    const response = await postWithCsrf('/api/backup/db-file', csrfToken)
      .buffer(true)
      .parse(parseBuffer)
      .send({ unlockSecret });

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['content-disposition']).toMatch(
      /attachment; filename="gift-card-raw-db-export-\d{4}-\d{2}-\d{2}\.sqlite"/,
    );
    expect(Buffer.isBuffer(response.body)).toBe(true);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-raw-export-test-'));
    const exportedPath = path.join(tempDir, 'export.sqlite');
    fs.writeFileSync(exportedPath, response.body);
    const exportedDb = new Database(exportedPath, { readonly: true });
    try {
      const cardCount = exportedDb.prepare('SELECT COUNT(*) AS count FROM cards').get().count;
      const stored = exportedDb.prepare('SELECT cardNumber, pin, billingZip FROM cards LIMIT 1').get();
      expect(cardCount).toBe(1);
      expect(JSON.stringify(stored)).not.toContain('4111111111111111');
      expect(JSON.stringify(stored)).not.toContain('1234');
      expect(JSON.stringify(stored)).not.toContain('94105');
    } finally {
      exportedDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    const auditRows = db
      .prepare("SELECT * FROM audit_log WHERE entityType = 'backup' AND action = 'backup.export_db_file'")
      .all();
    expect(auditRows).toHaveLength(1);
    expect(JSON.parse(auditRows[0].metadata)).toMatchObject({
      exportType: 'raw_sqlite',
    });

    const auditText = JSON.stringify(auditRows);
    expect(auditText).not.toContain('4111111111111111');
    expect(auditText).not.toContain('1234');
    expect(auditText).not.toContain('94105');
    expect(auditText).not.toContain(unlockSecret);
  }, 45_000);

  it('rejects raw database export without the current unlock secret', async () => {
    const csrfToken = await setupOwner();
    await createSampleCard(csrfToken);

    const response = await postWithCsrf('/api/backup/db-file', csrfToken).send({
      unlockSecret: 'wrong unlock phrase',
    });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_UNLOCK_SECRET');
    const backupAuditCount = db
      .prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'backup.export_db_file'")
      .get().count;
    expect(backupAuditCount).toBe(0);
  }, 45_000);

  it('rejects raw database export when the feature is disabled by deployment policy', async () => {
    const originalFlag = process.env.GC_FEATURE_RAW_DATABASE_EXPORT;
    process.env.GC_FEATURE_RAW_DATABASE_EXPORT = 'false';
    try {
      const csrfToken = await setupOwner();

      const response = await postWithCsrf('/api/backup/db-file', csrfToken).send({
        unlockSecret,
      });

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('FEATURE_DISABLED');
    } finally {
      if (originalFlag === undefined) {
        delete process.env.GC_FEATURE_RAW_DATABASE_EXPORT;
      } else {
        process.env.GC_FEATURE_RAW_DATABASE_EXPORT = originalFlag;
      }
    }
  }, 45_000);

  it('merges a plaintext JSON export into an unlocked vault with encrypted imported credentials', async () => {
    const csrfToken = await setupOwner();
    await createSampleCard(csrfToken);
    const exportResponse = await postWithCsrf('/api/backup/export', csrfToken).send({
      unlockSecret,
      confirmation: 'EXPORT',
      acknowledgePlaintext: true,
    });
    expect(exportResponse.status).toBe(200);

    const targetDb = openDatabase({ filename: ':memory:' });
    const targetAgent = request.agent(createApp({ db: targetDb }));
    try {
      const setupResponse = await targetAgent.post('/api/auth/setup').send({ unlockSecret });
      const targetCsrfToken = setupResponse.body.data.csrfToken;

      const importResponse = await targetAgent
        .post('/api/backup/import')
        .set('Origin', appOrigin)
        .set('X-CSRF-Token', targetCsrfToken)
        .send({
          unlockSecret,
          mode: 'merge',
          payload: exportResponse.body.data,
        });

      expect(importResponse.status).toBe(201);
      expect(importResponse.body.data.summary).toMatchObject({
        mode: 'merge',
        dealCount: 1,
        cardCount: 1,
        transactionCount: 0,
        usageCount: 0,
      });
      expect(importResponse.body.data.importJob).toMatchObject({
        type: 'json_merge',
        status: 'confirmed',
        rowCount: 2,
        validCount: 2,
        invalidCount: 0,
      });

      const cardsResponse = await targetAgent.get('/api/cards');
      expect(cardsResponse.body.data).toHaveLength(1);
      expect(cardsResponse.body.data[0]).toMatchObject({
        brand: 'Target',
        cardNumberLast4: '1111',
        remainingBalanceCents: 5000,
      });

      const revealResponse = await targetAgent
        .post(`/api/cards/${cardsResponse.body.data[0].id}/reveal`)
        .set('Origin', appOrigin)
        .set('X-CSRF-Token', targetCsrfToken)
        .send({});
      expect(revealResponse.body.data).toMatchObject({
        cardNumber: '4111111111111111',
        pin: '1234',
        billingZip: '94105',
      });

      const stored = targetDb.prepare('SELECT cardNumber, pin, billingZip FROM cards LIMIT 1').get();
      expect(JSON.stringify(stored)).not.toContain('4111111111111111');
      expect(JSON.stringify(stored)).not.toContain('1234');
      expect(JSON.stringify(stored)).not.toContain('94105');

      const auditRows = targetDb
        .prepare("SELECT * FROM audit_log WHERE entityType = 'import' AND action = 'import.json_merge'")
        .all();
      expect(auditRows).toHaveLength(1);
      const auditText = JSON.stringify(auditRows);
      expect(auditText).not.toContain('4111111111111111');
      expect(auditText).not.toContain('1234');
      expect(auditText).not.toContain('94105');
      expect(auditText).not.toContain(unlockSecret);
    } finally {
      targetDb.close();
    }
  }, 45_000);

  it('imports an encrypted portable JSON backup into an unlocked vault', async () => {
    const backupPassphrase = 'portable backup passphrase';
    const csrfToken = await setupOwner();
    await createSampleCard(csrfToken);
    const exportResponse = await postWithCsrf('/api/backup/export-encrypted', csrfToken).send({
      unlockSecret,
      backupPassphrase,
      backupPassphraseConfirmation: backupPassphrase,
      confirmation: 'ENCRYPT',
    });
    expect(exportResponse.status).toBe(200);

    const targetDb = openDatabase({ filename: ':memory:' });
    const targetAgent = request.agent(createApp({ db: targetDb }));
    try {
      const setupResponse = await targetAgent.post('/api/auth/setup').send({ unlockSecret });
      const targetCsrfToken = setupResponse.body.data.csrfToken;

      const importResponse = await targetAgent
        .post('/api/backup/import')
        .set('Origin', appOrigin)
        .set('X-CSRF-Token', targetCsrfToken)
        .send({
          unlockSecret,
          backupPassphrase,
          mode: 'merge',
          payload: exportResponse.body.data,
        });

      expect(importResponse.status).toBe(201);
      expect(importResponse.body.data.summary).toMatchObject({
        mode: 'merge',
        dealCount: 1,
        cardCount: 1,
        transactionCount: 0,
        usageCount: 0,
      });
      expect(importResponse.body.data.importJob).toMatchObject({
        type: 'json_merge',
        status: 'confirmed',
        rowCount: 2,
        validCount: 2,
        invalidCount: 0,
      });

      const cardsResponse = await targetAgent.get('/api/cards');
      expect(cardsResponse.body.data).toHaveLength(1);
      expect(cardsResponse.body.data[0]).toMatchObject({
        brand: 'Target',
        cardNumberLast4: '1111',
        remainingBalanceCents: 5000,
      });

      const revealResponse = await targetAgent
        .post(`/api/cards/${cardsResponse.body.data[0].id}/reveal`)
        .set('Origin', appOrigin)
        .set('X-CSRF-Token', targetCsrfToken)
        .send({});
      expect(revealResponse.body.data).toMatchObject({
        cardNumber: '4111111111111111',
        pin: '1234',
        billingZip: '94105',
      });

      const stored = targetDb.prepare('SELECT cardNumber, pin, billingZip FROM cards LIMIT 1').get();
      expect(JSON.stringify(stored)).not.toContain('4111111111111111');
      expect(JSON.stringify(stored)).not.toContain('1234');
      expect(JSON.stringify(stored)).not.toContain('94105');

      const auditRows = targetDb
        .prepare("SELECT * FROM audit_log WHERE entityType = 'import' AND action = 'import.json_merge'")
        .all();
      expect(auditRows).toHaveLength(1);
      const auditText = JSON.stringify(auditRows);
      expect(auditText).not.toContain('4111111111111111');
      expect(auditText).not.toContain('1234');
      expect(auditText).not.toContain('94105');
      expect(auditText).not.toContain(unlockSecret);
      expect(auditText).not.toContain(backupPassphrase);
    } finally {
      targetDb.close();
    }
  }, 45_000);

  it('rejects encrypted portable JSON import with the wrong backup passphrase', async () => {
    const backupPassphrase = 'portable backup passphrase';
    const csrfToken = await setupOwner();
    await createSampleCard(csrfToken);
    const exportResponse = await postWithCsrf('/api/backup/export-encrypted', csrfToken).send({
      unlockSecret,
      backupPassphrase,
      backupPassphraseConfirmation: backupPassphrase,
      confirmation: 'ENCRYPT',
    });
    expect(exportResponse.status).toBe(200);

    const targetDb = openDatabase({ filename: ':memory:' });
    const targetAgent = request.agent(createApp({ db: targetDb }));
    try {
      const setupResponse = await targetAgent.post('/api/auth/setup').send({ unlockSecret });
      const targetCsrfToken = setupResponse.body.data.csrfToken;

      const importResponse = await targetAgent
        .post('/api/backup/import')
        .set('Origin', appOrigin)
        .set('X-CSRF-Token', targetCsrfToken)
        .send({
          unlockSecret,
          backupPassphrase: 'wrong portable backup passphrase',
          mode: 'merge',
          payload: exportResponse.body.data,
        });

      expect(importResponse.status).toBe(400);
      expect(importResponse.body.error.code).toBe('INVALID_BACKUP_PASSPHRASE');
      expect(targetDb.prepare('SELECT COUNT(*) AS count FROM cards').get().count).toBe(0);
      expect(targetDb.prepare('SELECT COUNT(*) AS count FROM import_jobs').get().count).toBe(0);
      expect(
        targetDb.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE entityType = 'import'").get().count,
      ).toBe(0);
    } finally {
      targetDb.close();
    }
  }, 45_000);

  it('replays duplicate JSON import requests with the same idempotency key without importing twice', async () => {
    const csrfToken = await setupOwner();
    await createSampleCard(csrfToken);
    const exportResponse = await postWithCsrf('/api/backup/export', csrfToken).send({
      unlockSecret,
      confirmation: 'EXPORT',
      acknowledgePlaintext: true,
    });
    expect(exportResponse.status).toBe(200);

    const targetDb = openDatabase({ filename: ':memory:' });
    const targetAgent = request.agent(createApp({ db: targetDb }));
    try {
      const setupResponse = await targetAgent.post('/api/auth/setup').send({ unlockSecret });
      const targetCsrfToken = setupResponse.body.data.csrfToken;
      const payload = {
        unlockSecret,
        mode: 'merge',
        payload: exportResponse.body.data,
      };

      const firstImport = await targetAgent
        .post('/api/backup/import')
        .set('Origin', appOrigin)
        .set('X-CSRF-Token', targetCsrfToken)
        .set('Idempotency-Key', 'json-import-1')
        .send(payload);
      expect(firstImport.status).toBe(201);

      const replayedImport = await targetAgent
        .post('/api/backup/import')
        .set('Origin', appOrigin)
        .set('X-CSRF-Token', targetCsrfToken)
        .set('Idempotency-Key', 'json-import-1')
        .send(payload);
      expect(replayedImport.status).toBe(201);
      expect(replayedImport.headers['idempotency-replayed']).toBe('true');
      expect(replayedImport.body).toEqual(firstImport.body);

      expect(targetDb.prepare('SELECT COUNT(*) AS count FROM cards').get().count).toBe(1);
      expect(targetDb.prepare('SELECT COUNT(*) AS count FROM import_jobs').get().count).toBe(1);
    } finally {
      targetDb.close();
    }
  }, 45_000);

  it('replaces current data from plaintext JSON only after creating an automatic database backup', async () => {
    const sourceCsrfToken = await setupOwner();
    await createSampleCard(sourceCsrfToken);
    const exportResponse = await postWithCsrf('/api/backup/export', sourceCsrfToken).send({
      unlockSecret,
      confirmation: 'EXPORT',
      acknowledgePlaintext: true,
    });
    expect(exportResponse.status).toBe(200);

    const targetDb = openDatabase({ filename: ':memory:' });
    const targetAgent = request.agent(createApp({ db: targetDb }));
    try {
      const setupResponse = await targetAgent.post('/api/auth/setup').send({ unlockSecret });
      const targetCsrfToken = setupResponse.body.data.csrfToken;
      const currentCard = await targetAgent
        .post('/api/cards')
        .set('Origin', appOrigin)
        .set('X-CSRF-Token', targetCsrfToken)
        .send({
          cards: [
            {
              brand: 'Amazon',
              cardType: 'merchant',
              faceValueCents: 2500,
              purchaseCostCents: 2000,
              cardNumber: '5555555555554444',
            },
          ],
        });
      expect(currentCard.status).toBe(201);

      const importResponse = await targetAgent
        .post('/api/backup/import')
        .set('Origin', appOrigin)
        .set('X-CSRF-Token', targetCsrfToken)
        .send({
          unlockSecret,
          mode: 'replace',
          confirmation: 'REPLACE',
          payload: exportResponse.body.data,
        });

      expect(importResponse.status).toBe(201);
      expect(importResponse.body.data.summary).toMatchObject({
        mode: 'replace',
        backupCreated: true,
        dealCount: 1,
        cardCount: 1,
      });

      const cardsResponse = await targetAgent.get('/api/cards');
      expect(cardsResponse.body.data).toHaveLength(1);
      expect(cardsResponse.body.data[0]).toMatchObject({
        brand: 'Target',
        cardNumberLast4: '1111',
      });
      expect(JSON.stringify(cardsResponse.body.data)).not.toContain('Amazon');

      const auditRows = targetDb
        .prepare("SELECT * FROM audit_log WHERE entityType = 'import' AND action = 'import.json_replace'")
        .all();
      expect(auditRows).toHaveLength(1);
      expect(JSON.parse(auditRows[0].metadata)).toMatchObject({
        mode: 'replace',
        backupCreated: true,
        cardCount: 1,
      });
    } finally {
      targetDb.close();
    }
  }, 45_000);
});
