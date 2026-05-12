import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/index.js';

describe('settings routes', () => {
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

  function withCsrf(requestBuilder, csrfToken) {
    return requestBuilder.set('Origin', appOrigin).set('X-CSRF-Token', csrfToken);
  }

  it('returns default backup settings for an unlocked vault', async () => {
    await setupOwner();

    const response = await agent.get('/api/settings/backup');

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      allowPlaintextExport: true,
      backupReminderDays: 30,
      backupReminderDue: true,
      lastBackupAt: null,
      nextBackupDueAt: null,
      lastPlaintextExportAt: null,
      lastEncryptedExportAt: null,
      lastRawDatabaseExportAt: null,
    });
  });

  it('updates backup settings with the current unlock secret and redacted audit', async () => {
    const csrfToken = await setupOwner();

    const response = await withCsrf(agent.put('/api/settings/backup'), csrfToken).send({
      unlockSecret,
      allowPlaintextExport: false,
      backupReminderDays: 14,
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      allowPlaintextExport: false,
      backupReminderDays: 14,
    });

    const settings = db.prepare('SELECT key, value FROM app_settings ORDER BY key').all();
    expect(settings).toEqual([
      { key: 'backup.allowPlaintextExport', value: 'false' },
      { key: 'backup.reminderDays', value: '14' },
    ]);

    const auditRows = db
      .prepare("SELECT * FROM audit_log WHERE entityType = 'system' AND action = 'settings.backup_update'")
      .all();
    expect(auditRows).toHaveLength(1);
    expect(JSON.parse(auditRows[0].metadata)).toMatchObject({
      allowPlaintextExport: false,
      backupReminderDays: 14,
    });
    expect(JSON.stringify(auditRows)).not.toContain(unlockSecret);
  }, 45_000);

  it('rejects backup settings update with the wrong unlock secret', async () => {
    const csrfToken = await setupOwner();

    const response = await withCsrf(agent.put('/api/settings/backup'), csrfToken).send({
      unlockSecret: 'wrong unlock phrase',
      allowPlaintextExport: false,
      backupReminderDays: 14,
    });

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('INVALID_UNLOCK_SECRET');
    expect(db.prepare('SELECT COUNT(*) AS count FROM app_settings').get().count).toBe(0);
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'settings.backup_update'").get().count,
    ).toBe(0);
  }, 45_000);

  it('enforces disabled plaintext export and still records encrypted backup timestamps', async () => {
    const csrfToken = await setupOwner();
    await withCsrf(agent.put('/api/settings/backup'), csrfToken).send({
      unlockSecret,
      allowPlaintextExport: false,
      backupReminderDays: 30,
    });

    const plaintextExport = await withCsrf(agent.post('/api/backup/export'), csrfToken).send({
      unlockSecret,
      confirmation: 'EXPORT',
      acknowledgePlaintext: true,
    });
    expect(plaintextExport.status).toBe(403);
    expect(plaintextExport.body.error.code).toBe('PLAINTEXT_EXPORT_DISABLED');
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'backup.export_plaintext'").get().count,
    ).toBe(0);

    const encryptedExport = await withCsrf(agent.post('/api/backup/export-encrypted'), csrfToken).send({
      unlockSecret,
      backupPassphrase: 'portable backup passphrase',
      backupPassphraseConfirmation: 'portable backup passphrase',
      confirmation: 'ENCRYPT',
    });
    expect(encryptedExport.status).toBe(200);

    const settings = await agent.get('/api/settings/backup');
    expect(settings.body.data).toMatchObject({
      allowPlaintextExport: false,
      backupReminderDue: false,
      lastPlaintextExportAt: null,
      lastEncryptedExportAt: expect.any(String),
      lastBackupAt: expect.any(String),
      nextBackupDueAt: expect.any(String),
    });
  }, 45_000);
});
