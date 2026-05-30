import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/index.js';

describe('admin operations routes', () => {
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
    const response = await agent.post('/api/auth/setup').send({
      email: 'owner@example.com',
      displayName: 'Owner',
      unlockSecret,
    });
    expect(response.status).toBe(201);
    return response.body.data.csrfToken;
  }

  function withCsrf(requestBuilder, csrfToken) {
    return requestBuilder.set('Origin', appOrigin).set('X-CSRF-Token', csrfToken);
  }

  it('updates support and retention policy with redacted audit records', async () => {
    const csrfToken = await setupOwner();

    const support = await withCsrf(agent.put('/api/admin/support-policy'), csrfToken).send({
      unlockSecret,
      supportAccessEnabled: true,
      supportContact: 'ops@example.com',
      supportPolicyUrl: 'https://example.com/support-policy',
      supportNotes: 'Require explicit owner approval before any support access.',
    });
    expect(support.status).toBe(200);
    expect(support.body.data).toMatchObject({
      supportAccessEnabled: true,
      supportContact: 'ops@example.com',
      supportPolicyUrl: 'https://example.com/support-policy',
      supportUpdatedByUserId: 1,
    });

    const dataPolicy = await withCsrf(agent.put('/api/admin/data-policy'), csrfToken).send({
      unlockSecret,
      auditRetentionDays: 180,
      idempotencyRetentionDays: 14,
      sessionRetentionDays: 3,
      loginAttemptRetentionDays: 30,
    });
    expect(dataPolicy.status).toBe(200);
    expect(dataPolicy.body.data).toMatchObject({
      auditRetentionDays: 180,
      idempotencyRetentionDays: 14,
      sessionRetentionDays: 3,
      loginAttemptRetentionDays: 30,
    });

    const auditRows = db
      .prepare(
        `SELECT action, metadata
         FROM audit_log
         WHERE action IN ('support.policy_update', 'data.policy_update')
         ORDER BY id`,
      )
      .all();
    expect(auditRows).toHaveLength(2);
    expect(JSON.stringify(auditRows)).not.toContain(unlockSecret);
    expect(JSON.parse(auditRows[0].metadata)).toMatchObject({
      supportAccessEnabled: true,
      supportContactSet: true,
    });
  }, 45_000);

  it('exports sanitized account data without credential or key material', async () => {
    const csrfToken = await setupOwner();
    const createCard = await withCsrf(agent.post('/api/cards'), csrfToken).send({
      cards: [
        {
          brand: 'Target',
          cardType: 'merchant',
          faceValueCents: 5000,
          purchaseCostCents: 4500,
          cardNumber: '4111111111111111',
          pin: '1234',
          billingZip: '94105',
        },
      ],
    });
    expect(createCard.status).toBe(201);

    const response = await withCsrf(agent.post('/api/admin/data-export'), csrfToken).send({
      unlockSecret,
      confirmation: 'EXPORT',
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      exportType: 'sanitized_account_json',
      counts: {
        users: 1,
        cards: 1,
      },
    });
    expect(response.body.data.users[0]).not.toHaveProperty('unlockSecretHash');
    expect(response.body.data.users[0]).not.toHaveProperty('encryptedDEK');
    expect(response.body.data.cards[0]).toMatchObject({
      brand: 'Target',
      cardNumberLast4: '1111',
    });
    expect(response.body.data.cards[0]).not.toHaveProperty('cardNumber');
    expect(response.body.data.cards[0]).not.toHaveProperty('pin');
    expect(response.body.data.cards[0]).not.toHaveProperty('billingZip');
    expect(JSON.stringify(response.body)).not.toContain('4111111111111111');
    expect(JSON.stringify(response.body)).not.toContain('1234');
    expect(JSON.stringify(response.body)).not.toContain('94105');
    expect(JSON.stringify(response.body)).not.toContain(unlockSecret);
  }, 45_000);

  it('previews and runs retention deletion against old operational records', async () => {
    const csrfToken = await setupOwner();
    await withCsrf(agent.put('/api/admin/data-policy'), csrfToken).send({
      unlockSecret,
      auditRetentionDays: 1,
      idempotencyRetentionDays: 1,
      sessionRetentionDays: 1,
      loginAttemptRetentionDays: 1,
    });

    const now = Date.now();
    const oldIso = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO audit_log (accountId, userId, entityType, action, timestamp)
       VALUES (1, 1, 'system', 'old.audit', ?)`,
    ).run(oldIso);
    db.prepare(
      `INSERT INTO idempotency_keys (
        accountId, userId, key, method, path, requestHash, createdAt, expiresAt
      ) VALUES (1, 1, 'old-key', 'POST', '/old', 'hash', ?, ?)`,
    ).run(oldIso, oldIso);
    db.prepare(
      `INSERT INTO web_sessions (sid, sessionJson, expiresAt, updatedAt)
       VALUES ('old-session', '{}', ?, ?)`,
    ).run(now - 3 * 24 * 60 * 60 * 1000, oldIso);
    db.prepare(
      `INSERT INTO auth_login_attempts (key, failures, resetAt, updatedAt)
       VALUES ('old-login', 2, ?, ?)`,
    ).run(now - 3 * 24 * 60 * 60 * 1000, oldIso);

    const preview = await withCsrf(agent.post('/api/admin/retention/run'), csrfToken).send({
      unlockSecret,
      dryRun: true,
    });
    expect(preview.status).toBe(200);
    expect(preview.body.data).toEqual({
      dryRun: true,
      counts: {
        auditLog: 1,
        idempotencyKeys: 1,
        webSessions: 1,
        loginAttempts: 1,
      },
    });

    const purge = await withCsrf(agent.post('/api/admin/retention/run'), csrfToken).send({
      unlockSecret,
      confirmation: 'PURGE',
    });
    expect(purge.status).toBe(200);
    expect(purge.body.data.dryRun).toBe(false);
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'old.audit'").get().count).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM idempotency_keys WHERE key = 'old-key'").get().count).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM web_sessions WHERE sid = 'old-session'").get().count).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS count FROM auth_login_attempts WHERE key = 'old-login'").get().count).toBe(0);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'data.retention_run'").get().count,
    ).toBe(1);
  }, 45_000);

  it('runs expiration notification emails to the owner/admin email address', async () => {
    const outbox = path.join(os.tmpdir(), `gc-expiration-outbox-${Date.now()}-${Math.random()}.jsonl`);
    process.env.GC_NOTIFICATION_OUTBOX_PATH = outbox;
    try {
      const csrfToken = await setupOwner();
      const createCard = await withCsrf(agent.post('/api/cards'), csrfToken).send({
        cards: [
          {
            brand: 'Mastercard',
            cardType: 'prepaid',
            credentialProfile: 'network_prepaid',
            faceValueCents: 80000,
            cardNumber: '5274800000001425',
            expirationMonth: '11',
            expirationYear: '2026',
          },
        ],
      });
      expect(createCard.status).toBe(201);

      const response = await withCsrf(agent.post('/api/admin/notifications/expiration/run'), csrfToken).send({
        now: '2026-10-04',
      });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        dueCards: 1,
        recipients: 1,
        sentEmails: 1,
        sentDeliveries: 1,
        skipped: [],
      });
      const outboxRows = fs.readFileSync(outbox, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]).toMatchObject({
        to: ['owner@example.com'],
        subject: 'Gift cards expiring in 28 days',
      });
      expect(outboxRows[0].text).toContain('Mastercard');
      expect(outboxRows[0].text).toContain('Expires: 2026-11-01');
      expect(outboxRows[0].text).not.toContain('5274800000001425');
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'notification.expiration_email_sent'").get().count,
      ).toBe(1);
    } finally {
      if (fs.existsSync(outbox)) {
        fs.unlinkSync(outbox);
      }
      delete process.env.GC_NOTIFICATION_OUTBOX_PATH;
    }
  }, 45_000);

  it('sends expiration notification test emails to the owner/admin email address', async () => {
    const outbox = path.join(os.tmpdir(), `gc-expiration-test-outbox-${Date.now()}-${Math.random()}.jsonl`);
    process.env.GC_NOTIFICATION_OUTBOX_PATH = outbox;
    try {
      const csrfToken = await setupOwner();

      const response = await withCsrf(agent.post('/api/admin/notifications/expiration/test'), csrfToken).send({});

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        recipients: 1,
        sentEmails: 1,
        skipped: [],
      });
      const outboxRows = fs.readFileSync(outbox, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]).toMatchObject({
        to: ['owner@example.com'],
        subject: 'Gift Card Manager expiration notification test',
      });
      expect(
        db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'notification.expiration_test_email_sent'").get().count,
      ).toBe(1);
    } finally {
      if (fs.existsSync(outbox)) {
        fs.unlinkSync(outbox);
      }
      delete process.env.GC_NOTIFICATION_OUTBOX_PATH;
    }
  }, 45_000);

  it('deletes inventory data while preserving users and a deletion audit event', async () => {
    const csrfToken = await setupOwner();
    const createCard = await withCsrf(agent.post('/api/cards'), csrfToken).send({
      cards: [
        {
          brand: 'Target',
          cardType: 'merchant',
          faceValueCents: 5000,
        },
      ],
    });
    expect(createCard.status).toBe(201);

    const rejected = await withCsrf(agent.post('/api/admin/data-delete'), csrfToken).send({
      unlockSecret,
      confirmation: 'DELETE',
    });
    expect(rejected.status).toBe(400);

    const response = await withCsrf(agent.post('/api/admin/data-delete'), csrfToken).send({
      unlockSecret,
      confirmation: 'DELETE_ACCOUNT_DATA',
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      deleted: true,
      counts: {
        cards: 1,
      },
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM cards').get().count).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS count FROM users').get().count).toBe(1);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'data.inventory_delete'").get().count,
    ).toBe(1);
  }, 45_000);
});
