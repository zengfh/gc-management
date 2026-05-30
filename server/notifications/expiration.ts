import type Database from 'better-sqlite3';
import { insertAuditEvent } from '../audit/index.js';
import { EmailNotConfiguredError, createEmailTransport, type EmailTransport } from './email.js';

export const expirationNotificationThresholds = [1, 2, 3, 4, 5, 7, 14, 21, 28] as const;

interface CardExpirationRow {
  id: number;
  accountId: number;
  brand: string;
  faceValueCents: number;
  remainingBalanceCents: number;
  status: string;
  expirationDate: string | null;
  primaryCredentialLast4: string | null;
  credentialSummaryJson: string | null;
  expirationMonthHint: string | null;
  expirationYearHint: string | null;
}

interface RecipientRow {
  email: string;
}

export interface ExpiringCardNotification {
  accountId: number;
  cardId: number;
  brand: string;
  faceValueCents: number;
  remainingBalanceCents: number;
  status: string;
  primaryCredentialLast4: string | null;
  expirationDate: string;
  thresholdDays: number;
}

export interface ExpirationNotificationSummary {
  checkedAt: string;
  dueCards: number;
  recipients: number;
  sentEmails: number;
  sentDeliveries: number;
  skipped: string[];
}

function utcDateOnly(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const [yearRaw, monthRaw, dayRaw] = value.split('-');
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function parseExpirationMonthYear(monthHint: string | null, yearHint: string | null): Date | null {
  const month = Number(String(monthHint || '').replace(/\D/g, ''));
  const yearDigits = String(yearHint || '').replace(/\D/g, '');
  const year = yearDigits.length === 2 ? Number(`20${yearDigits}`) : Number(yearDigits);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000 || year > 2200) {
    return null;
  }
  return new Date(Date.UTC(year, month - 1, 1));
}

export function expirationDateForCard(row: Pick<CardExpirationRow, 'expirationDate' | 'expirationMonthHint' | 'expirationYearHint'>): Date | null {
  return parseIsoDate(row.expirationDate) || parseExpirationMonthYear(row.expirationMonthHint, row.expirationYearHint);
}

function daysBetweenUtcDates(from: Date, to: Date): number {
  return Math.round((utcDateOnly(to).getTime() - utcDateOnly(from).getTime()) / 86_400_000);
}

function expirationDateText(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function moneyText(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function credentialLast4(row: Pick<CardExpirationRow, 'primaryCredentialLast4' | 'credentialSummaryJson'>): string | null {
  if (row.primaryCredentialLast4) {
    return row.primaryCredentialLast4;
  }
  if (!row.credentialSummaryJson) {
    return null;
  }
  try {
    const summary = JSON.parse(row.credentialSummaryJson) as { primaryLast4?: unknown };
    return typeof summary.primaryLast4 === 'string' ? summary.primaryLast4 : null;
  } catch {
    return null;
  }
}

function cardRows(db: Database.Database, accountId?: number): CardExpirationRow[] {
  const where = [
    "cards.status IN ('available', 'reserved', 'in_use')",
    'cards.remainingBalanceCents > 0',
    accountId ? 'cards.accountId = ?' : '',
  ].filter(Boolean).join(' AND ');
  return db.prepare(
    `SELECT
       cards.id,
       cards.accountId,
       cards.brand,
       cards.faceValueCents,
       cards.remainingBalanceCents,
       cards.status,
       cards.expirationDate,
       cards.primaryCredentialLast4,
       cards.credentialSummaryJson,
       MAX(CASE WHEN fields.fieldKind = 'expiration_month' THEN fields.displayHint END) AS expirationMonthHint,
       MAX(CASE WHEN fields.fieldKind = 'expiration_year' THEN fields.displayHint END) AS expirationYearHint
     FROM cards
     LEFT JOIN card_credential_fields AS fields
       ON fields.accountId = cards.accountId
      AND fields.cardId = cards.id
      AND fields.fieldKind IN ('expiration_month', 'expiration_year')
     WHERE ${where}
     GROUP BY cards.id
     ORDER BY cards.accountId, cards.id`,
  ).all(...(accountId ? [accountId] : [])) as CardExpirationRow[];
}

function recipientRows(db: Database.Database, accountId: number): RecipientRow[] {
  const configured = process.env.GC_NOTIFICATION_RECIPIENT_EMAIL?.trim();
  if (configured) {
    return configured
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
      .map((email) => ({ email }));
  }
  return db.prepare(
    `SELECT DISTINCT LOWER(email) AS email
     FROM users
     WHERE accountId = ?
       AND disabledAt IS NULL
       AND role IN ('owner', 'admin')
       AND email IS NOT NULL
       AND TRIM(email) <> ''
     ORDER BY role = 'owner' DESC, id`,
  ).all(accountId) as RecipientRow[];
}

function deliveryExists(
  db: Database.Database,
  notification: ExpiringCardNotification,
  recipientEmail: string,
): boolean {
  const row = db.prepare(
    `SELECT id
     FROM expiration_notification_deliveries
     WHERE accountId = ?
       AND cardId = ?
       AND thresholdDays = ?
       AND expirationDate = ?
       AND recipientEmail = ?
     LIMIT 1`,
  ).get(
    notification.accountId,
    notification.cardId,
    notification.thresholdDays,
    notification.expirationDate,
    recipientEmail,
  ) as { id: number } | undefined;
  return Boolean(row);
}

function selectDueNotifications(
  db: Database.Database,
  now: Date,
  accountId?: number,
): ExpiringCardNotification[] {
  const today = utcDateOnly(now);
  return cardRows(db, accountId).flatMap((row) => {
    const expirationDate = expirationDateForCard(row);
    if (!expirationDate) {
      return [];
    }
    const thresholdDays = daysBetweenUtcDates(today, expirationDate);
    if (!expirationNotificationThresholds.includes(thresholdDays as typeof expirationNotificationThresholds[number])) {
      return [];
    }
    return [{
      accountId: row.accountId,
      cardId: row.id,
      brand: row.brand,
      faceValueCents: row.faceValueCents,
      remainingBalanceCents: row.remainingBalanceCents,
      status: row.status,
      primaryCredentialLast4: credentialLast4(row),
      expirationDate: expirationDateText(expirationDate),
      thresholdDays,
    }];
  });
}

function emailSubject(notifications: ExpiringCardNotification[]): string {
  const shortest = Math.min(...notifications.map((card) => card.thresholdDays));
  return `Gift cards expiring in ${shortest} day${shortest === 1 ? '' : 's'}`;
}

function emailText(notifications: ExpiringCardNotification[]): string {
  const lines = [
    'The following gift cards are approaching expiration:',
    '',
    ...notifications.map((card) => [
      `- ${card.brand} ${moneyText(card.remainingBalanceCents)} remaining`,
      `  Expires: ${card.expirationDate} (${card.thresholdDays} day${card.thresholdDays === 1 ? '' : 's'} left)`,
      `  Status: ${card.status}`,
      card.primaryCredentialLast4 ? `  Credential ending: ${card.primaryCredentialLast4}` : '',
      `  Card ID: ${card.cardId}`,
    ].filter(Boolean).join('\n')),
    '',
    'Open Gift Card Manager to reveal credentials or mark cards used, sold, or void.',
  ];
  return lines.join('\n');
}

function emailHtml(notifications: ExpiringCardNotification[]): string {
  const escape = (value: string) => value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
  const rows = notifications.map((card) => `
    <tr>
      <td>${escape(card.brand)}</td>
      <td>${escape(moneyText(card.remainingBalanceCents))}</td>
      <td>${escape(card.expirationDate)}</td>
      <td>${card.thresholdDays}</td>
      <td>${escape(card.status)}</td>
      <td>${escape(card.primaryCredentialLast4 || '')}</td>
    </tr>`).join('');
  return `
    <p>The following gift cards are approaching expiration:</p>
    <table border="1" cellpadding="6" cellspacing="0">
      <thead><tr><th>Brand</th><th>Remaining</th><th>Expires</th><th>Days left</th><th>Status</th><th>Ending</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p>Open Gift Card Manager to reveal credentials or mark cards used, sold, or void.</p>`;
}

function recordDelivery(
  db: Database.Database,
  notification: ExpiringCardNotification,
  recipientEmail: string,
  messageId: string | undefined,
  timestamp: string,
) {
  db.prepare(
    `INSERT OR IGNORE INTO expiration_notification_deliveries (
      accountId, cardId, thresholdDays, expirationDate, recipientEmail,
      status, providerMessageId, sentAt, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?)`,
  ).run(
    notification.accountId,
    notification.cardId,
    notification.thresholdDays,
    notification.expirationDate,
    recipientEmail,
    messageId || null,
    timestamp,
    timestamp,
    timestamp,
  );
}

export async function sendExpirationNotifications({
  db,
  now = new Date(),
  accountId,
  transport,
  logger = console,
}: {
  db: Database.Database;
  now?: Date;
  accountId?: number;
  transport?: EmailTransport;
  logger?: Pick<Console, 'warn'>;
}): Promise<ExpirationNotificationSummary> {
  const timestamp = now.toISOString();
  const skipped: string[] = [];
  const due = selectDueNotifications(db, now, accountId);
  let sentEmails = 0;
  let sentDeliveries = 0;
  const byAccount = new Map<number, ExpiringCardNotification[]>();

  for (const notification of due) {
    byAccount.set(notification.accountId, [...(byAccount.get(notification.accountId) || []), notification]);
  }

  for (const [notificationAccountId, notifications] of byAccount.entries()) {
    const recipients = recipientRows(db, notificationAccountId);
    if (recipients.length === 0) {
      skipped.push(`account:${notificationAccountId}:no_admin_email`);
      continue;
    }

    for (const recipient of recipients) {
      const unsent = notifications.filter((notification) =>
        !deliveryExists(db, notification, recipient.email));
      if (unsent.length === 0) {
        continue;
      }

      try {
        const activeTransport = transport || createEmailTransport();
        const result = await activeTransport.send({
          to: [recipient.email],
          subject: emailSubject(unsent),
          text: emailText(unsent),
          html: emailHtml(unsent),
        });
        sentEmails += 1;
        for (const notification of unsent) {
          recordDelivery(db, notification, recipient.email, result.messageId, timestamp);
          sentDeliveries += 1;
        }
        insertAuditEvent(db, {
          accountId: notificationAccountId,
          entityType: 'system',
          action: 'notification.expiration_email_sent',
          metadata: {
            recipientEmail: recipient.email,
            cardCount: unsent.length,
            thresholds: [...new Set(unsent.map((notification) => notification.thresholdDays))].sort((a, b) => a - b),
          },
          timestamp,
        });
      } catch (caught) {
        const reason = caught instanceof EmailNotConfiguredError ? 'email_not_configured' : 'email_send_failed';
        skipped.push(`account:${notificationAccountId}:${recipient.email}:${reason}`);
        logger.warn(`Expiration notification skipped for account ${notificationAccountId}: ${reason}`);
      }
    }
  }

  return {
    checkedAt: timestamp,
    dueCards: due.length,
    recipients: Array.from(byAccount.keys()).reduce((count, id) => count + recipientRows(db, id).length, 0),
    sentEmails,
    sentDeliveries,
    skipped,
  };
}

export function startExpirationNotificationScheduler({
  db,
  logger = console,
  intervalMs = 6 * 60 * 60 * 1000,
}: {
  db: Database.Database;
  logger?: Pick<Console, 'info' | 'warn'>;
  intervalMs?: number;
}) {
  const enabled = (process.env.GC_EXPIRATION_NOTIFICATIONS_ENABLED || 'true').toLowerCase();
  if (['0', 'false', 'no', 'off'].includes(enabled)) {
    logger.info('Expiration notification scheduler disabled.');
    return null;
  }

  const run = () => {
    sendExpirationNotifications({ db, logger }).catch((caught) => {
      logger.warn(`Expiration notification scheduler failed: ${caught instanceof Error ? caught.message : String(caught)}`);
    });
  };
  const startupDelay = Number(process.env.GC_EXPIRATION_NOTIFICATIONS_STARTUP_DELAY_MS || 30_000);
  const startupTimer = setTimeout(run, Math.max(0, startupDelay));
  const interval = setInterval(run, intervalMs);
  return {
    stop() {
      clearTimeout(startupTimer);
      clearInterval(interval);
    },
  };
}
