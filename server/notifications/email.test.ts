import nodemailer from 'nodemailer';
import { afterEach, expect, it, vi } from 'vitest';
import { createEmailTransport } from './email.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it('preserves SMTP configuration and message delivery after the mail library upgrade', async () => {
  vi.stubEnv('GC_NOTIFICATION_OUTBOX_PATH', '');
  vi.stubEnv('GC_SMTP_HOST', 'smtp.example.com');
  vi.stubEnv('GC_SMTP_PORT', '465');
  vi.stubEnv('GC_SMTP_SECURE', 'true');
  vi.stubEnv('GC_SMTP_USER', 'synthetic-user');
  vi.stubEnv('GC_SMTP_PASS', 'synthetic-password');
  vi.stubEnv('GC_NOTIFICATION_FROM_EMAIL', 'cards@example.com');
  const sendMail = vi.fn().mockResolvedValue({ messageId: 'test-message' });
  const createTransport = vi.spyOn(nodemailer, 'createTransport')
    .mockReturnValue({ sendMail } as unknown as ReturnType<typeof nodemailer.createTransport>);
  const transport = createEmailTransport();
  const message = { to: ['owner@example.com'], subject: 'Expires soon', text: 'Synthetic reminder', html: '<p>Synthetic reminder</p>' };
  expect(await transport.send(message)).toEqual({ messageId: 'test-message' });
  expect(createTransport).toHaveBeenCalledWith({
    host: 'smtp.example.com', port: 465, secure: true,
    auth: { user: 'synthetic-user', pass: 'synthetic-password' },
  });
  expect(sendMail).toHaveBeenCalledWith({ from: 'cards@example.com', ...message });
});
