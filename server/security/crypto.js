import crypto from 'node:crypto';

const dekBytes = 32;
const ivBytes = 12;
const authTagBytes = 16;
const scryptOptions = {
  N: 2 ** 17,
  r: 8,
  p: 1,
  maxmem: 256 * 1024 * 1024,
};

export function generateDEK() {
  return crypto.randomBytes(dekBytes);
}

export function generateSalt() {
  return crypto.randomBytes(16).toString('base64');
}

export function deriveKEK(unlockSecret, salt) {
  return crypto.scryptSync(unlockSecret, Buffer.from(salt, 'base64'), dekBytes, scryptOptions);
}

export function encryptString(plaintext, key) {
  if (plaintext == null) {
    return null;
  }

  const iv = crypto.randomBytes(ivBytes);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv, {
    authTagLength: authTagBytes,
  });
  const ciphertext = Buffer.concat([
    cipher.update(String(plaintext), 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [iv, authTag, ciphertext]
    .map((part) => part.toString('base64'))
    .join(':');
}

export function decryptString(payload, key) {
  if (payload == null) {
    return null;
  }

  const [ivRaw, authTagRaw, ciphertextRaw] = payload.split(':');
  if (!ivRaw || !authTagRaw || !ciphertextRaw) {
    throw new Error('Invalid encrypted payload format.');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivRaw, 'base64'),
    { authTagLength: authTagBytes },
  );
  decipher.setAuthTag(Buffer.from(authTagRaw, 'base64'));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function wrapDEK(dek, kek) {
  return encryptString(dek.toString('base64'), kek);
}

export function unwrapDEK(encryptedDEK, kek) {
  return Buffer.from(decryptString(encryptedDEK, kek), 'base64');
}

export function deriveBlindIndexKey(dek) {
  return Buffer.from(
    crypto.hkdfSync('sha256', dek, Buffer.alloc(0), 'blind-index-hmac', dekBytes),
  );
}

export function normalizeCardNumber(input) {
  return input ? String(input).replace(/\D/g, '') : null;
}

export function cardNumberLast4(input) {
  const normalized = normalizeCardNumber(input);
  return normalized ? normalized.slice(-4) : null;
}

export function cardNumberHash(input, hmacKey) {
  const normalized = normalizeCardNumber(input);
  if (!normalized) {
    return null;
  }

  return crypto.createHmac('sha256', hmacKey).update(normalized).digest('hex');
}
