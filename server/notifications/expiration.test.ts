import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import {
  expirationDateForCard,
  sendExpirationNotificationTest,
  sendExpirationNotifications,
  type ExpirationNotificationSummary,
} from './expiration.js';
import type { EmailMessage, EmailTransport } from './email.js';

class MemoryEmailTransport implements EmailTransport {
  messages: EmailMessage[] = [];

  async send(message: EmailMessage) {
    this.messages.push(message);
    return { messageId: `test-${this.messages.length}` };
  }
}

describe('expiration notifications', () => {
  let db;

  beforeEach(() => {
    db = openDatabase({ filename: ':memory:' });
    db.prepare(
      "INSERT INTO accounts (id, name, mode, createdAt, updatedAt) VALUES (1, 'Personal', 'local', ?, ?)",
    ).run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    db.prepare(
      `INSERT INTO users (
        id, accountId, email, displayName, role, unlockSecretHash,
        encryptionSalt, encryptedDEK, createdAt, updatedAt
      ) VALUES (1, 1, 'admin@example.com', 'Owner', 'owner', 'hash', 'salt', 'dek', ?, ?)`,
    ).run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');

    return () => {
      db.close();
    };
  });

  function insertCard({
    id,
    brand,
    expirationDate = null,
    expirationMonth = '',
    expirationYear = '',
    status = 'available',
    remainingBalanceCents = 5000,
  }: {
    id: number;
    brand: string;
    expirationDate?: string | null;
    expirationMonth?: string;
    expirationYear?: string;
    status?: string;
    remainingBalanceCents?: number;
  }) {
    db.prepare(
      `INSERT INTO cards (
        id, accountId, brand, cardType, faceValueCents, remainingBalanceCents,
        purchaseCostCents, expirationDate, status, credentialProfile,
        primaryCredentialLast4, createdAt, updatedAt
      ) VALUES (?, 1, ?, 'prepaid', 5000, ?, 0, ?, ?, 'network_prepaid', '1234', ?, ?)`,
    ).run(
      id,
      brand,
      remainingBalanceCents,
      expirationDate,
      status,
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );
    if (expirationMonth) {
      db.prepare(
        `INSERT INTO card_credential_fields (
          accountId, cardId, fieldKey, label, fieldKind, sensitivityClass,
          displayHint, sortOrder, createdAt, updatedAt
        ) VALUES (1, ?, 'expiration_month', 'Exp. month', 'expiration_month', 'payment_chd', ?, 50, ?, ?)`,
      ).run(id, expirationMonth, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    }
    if (expirationYear) {
      db.prepare(
        `INSERT INTO card_credential_fields (
          accountId, cardId, fieldKey, label, fieldKind, sensitivityClass,
          displayHint, sortOrder, createdAt, updatedAt
        ) VALUES (1, ?, 'expiration_year', 'Exp. year', 'expiration_year', 'payment_chd', ?, 60, ?, ?)`,
      ).run(id, expirationYear, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    }
  }

  it('treats month/year card expiration as the first day of the month', () => {
    expect(expirationDateForCard({
      expirationDate: null,
      expirationMonthHint: '11',
      expirationYearHint: '2026',
    })?.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(expirationDateForCard({
      expirationDate: null,
      expirationMonthHint: '',
      expirationYearHint: '',
    })).toBeNull();
  });

  it('emails owner/admin recipients for due cards and records one delivery per threshold', async () => {
    insertCard({ id: 1, brand: 'Mastercard', expirationMonth: '11', expirationYear: '2026' });
    insertCard({ id: 2, brand: 'DoorDash', expirationDate: '2026-11-08' });
    insertCard({ id: 3, brand: 'Used Up', expirationMonth: '11', expirationYear: '2026', status: 'used_up' });
    const transport = new MemoryEmailTransport();

    const summary = await sendExpirationNotifications({
      db,
      now: new Date('2026-10-04T12:00:00.000Z'),
      transport,
    });

    expect(summary).toMatchObject<ExpirationNotificationSummary>({
      checkedAt: '2026-10-04T12:00:00.000Z',
      dueCards: 1,
      recipients: 1,
      sentEmails: 1,
      sentDeliveries: 1,
      skipped: [],
    });
    expect(transport.messages).toHaveLength(1);
    expect(transport.messages[0]).toMatchObject({
      to: ['admin@example.com'],
      subject: 'Gift cards expiring in 28 days',
    });
    expect(transport.messages[0].text).toContain('Mastercard');
    expect(transport.messages[0].text).toContain('Expires: 2026-11-01');
    expect(transport.messages[0].text).not.toContain('Used Up');
    expect(db.prepare('SELECT COUNT(*) AS count FROM expiration_notification_deliveries').get().count).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'notification.expiration_email_sent'").get().count).toBe(1);

    const secondSummary = await sendExpirationNotifications({
      db,
      now: new Date('2026-10-04T14:00:00.000Z'),
      transport,
    });
    expect(secondSummary.sentEmails).toBe(0);
    expect(secondSummary.sentDeliveries).toBe(0);
    expect(transport.messages).toHaveLength(1);
  });

  it('reports skipped notifications when there is no configured admin email', async () => {
    db.prepare('UPDATE users SET email = NULL WHERE id = 1').run();
    insertCard({ id: 1, brand: 'Mastercard', expirationMonth: '11', expirationYear: '2026' });

    const summary = await sendExpirationNotifications({
      db,
      now: new Date('2026-10-04T12:00:00.000Z'),
      transport: new MemoryEmailTransport(),
    });

    expect(summary).toMatchObject({
      dueCards: 1,
      recipients: 0,
      sentEmails: 0,
      sentDeliveries: 0,
      skipped: ['account:1:no_admin_email'],
    });
  });

  it('sends a test expiration email without requiring a due card', async () => {
    const transport = new MemoryEmailTransport();

    const summary = await sendExpirationNotificationTest({
      db,
      accountId: 1,
      now: new Date('2026-05-30T07:00:00.000Z'),
      transport,
    });

    expect(summary).toEqual({
      checkedAt: '2026-05-30T07:00:00.000Z',
      recipients: 1,
      sentEmails: 1,
      skipped: [],
    });
    expect(transport.messages).toHaveLength(1);
    expect(transport.messages[0]).toMatchObject({
      to: ['admin@example.com'],
      subject: 'Gift Card Manager expiration notification test',
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'notification.expiration_test_email_sent'").get().count).toBe(1);
  });
});
