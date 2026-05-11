import { describe, expect, it } from 'vitest';
import {
  cardNumberHash,
  cardNumberLast4,
  decryptString,
  deriveBlindIndexKey,
  deriveKEK,
  encryptString,
  generateDEK,
  generateSalt,
  normalizeCardNumber,
  unwrapDEK,
  wrapDEK,
} from './crypto.js';

describe('crypto helpers', () => {
  it('encrypts strings with randomized payloads and decrypts them with the same key', () => {
    const key = generateDEK();

    const first = encryptString('4111 1111 1111 1111', key);
    const second = encryptString('4111 1111 1111 1111', key);

    expect(first).not.toBe(second);
    expect(decryptString(first, key)).toBe('4111 1111 1111 1111');
    expect(decryptString(second, key)).toBe('4111 1111 1111 1111');
  });

  it('wraps and unwraps a data encryption key from an unlock secret', () => {
    const dek = generateDEK();
    const salt = generateSalt();
    const kek = deriveKEK('a strong unlock phrase', salt);

    const encryptedDEK = wrapDEK(dek, kek);

    expect(unwrapDEK(encryptedDEK, kek)).toEqual(dek);
  }, 20_000);

  it('normalizes card numbers and hashes equivalent formatting identically', () => {
    const hmacKey = deriveBlindIndexKey(generateDEK());

    expect(normalizeCardNumber('4111 1111-1111 1111')).toBe('4111111111111111');
    expect(cardNumberLast4('4111 1111-1111 1111')).toBe('1111');
    expect(cardNumberHash('4111 1111-1111 1111', hmacKey)).toBe(
      cardNumberHash('4111111111111111', hmacKey),
    );
  });
});
