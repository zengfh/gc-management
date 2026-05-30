import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

export interface EmailMessage {
  to: string[];
  subject: string;
  text: string;
  html?: string;
}

export interface EmailSendResult {
  messageId?: string;
}

export interface EmailTransport {
  send(message: EmailMessage): Promise<EmailSendResult>;
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super('Expiration email notifications are not configured. Set SMTP env vars or GC_NOTIFICATION_OUTBOX_PATH.');
    this.name = 'EmailNotConfiguredError';
  }
}

function boolEnv(value: string | undefined, fallback = false) {
  if (value == null || value === '') {
    return fallback;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function notificationFromAddress() {
  return process.env.GC_NOTIFICATION_FROM_EMAIL
    || process.env.GC_SMTP_FROM
    || process.env.SMTP_FROM
    || '';
}

function smtpHost() {
  return process.env.GC_SMTP_HOST || process.env.SMTP_HOST || '';
}

function smtpPort() {
  const raw = process.env.GC_SMTP_PORT || process.env.SMTP_PORT || '';
  return raw ? Number(raw) : 587;
}

function smtpUser() {
  return process.env.GC_SMTP_USER || process.env.SMTP_USER || '';
}

function smtpPass() {
  return process.env.GC_SMTP_PASS || process.env.SMTP_PASS || '';
}

function outboxPath() {
  return process.env.GC_NOTIFICATION_OUTBOX_PATH || '';
}

export function createEmailTransport(): EmailTransport {
  const outbox = outboxPath();
  if (outbox) {
    return {
      async send(message) {
        fs.mkdirSync(path.dirname(outbox), { recursive: true });
        const messageId = `outbox-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        fs.appendFileSync(outbox, `${JSON.stringify({ ...message, messageId, createdAt: new Date().toISOString() })}\n`);
        return { messageId };
      },
    };
  }

  const host = smtpHost();
  const from = notificationFromAddress();
  if (!host || !from) {
    throw new EmailNotConfiguredError();
  }

  const user = smtpUser();
  const pass = smtpPass();
  const transport = nodemailer.createTransport({
    host,
    port: smtpPort(),
    secure: boolEnv(process.env.GC_SMTP_SECURE || process.env.SMTP_SECURE, smtpPort() === 465),
    ...(user || pass ? { auth: { user, pass } } : {}),
  });

  return {
    async send(message) {
      const result = await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      return { messageId: result.messageId };
    },
  };
}
