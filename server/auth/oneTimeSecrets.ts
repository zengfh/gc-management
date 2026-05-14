import crypto from 'node:crypto';

export function normalizeOneTimeSecret(value: unknown): string {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

export function generateOneTimeSecret(prefix: string): string {
  const body = crypto
    .randomBytes(18)
    .toString('base64url')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 24);
  const chunks = body.match(/.{1,4}/g) || [body];
  return `${prefix}-${chunks.join('-')}`;
}
