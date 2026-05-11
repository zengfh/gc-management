import { describe, expect, it } from 'vitest';
import { validateUnlockSecret } from './unlockSecret.js';

describe('unlock secret validation', () => {
  it('rejects missing, short, common, repeated, and sequential unlock secrets', () => {
    expect(validateUnlockSecret('').fieldErrors.map((error) => error.code)).toContain('required');
    expect(validateUnlockSecret('short').fieldErrors.map((error) => error.code)).toContain('too_short');
    expect(validateUnlockSecret('password1234').fieldErrors.map((error) => error.code)).toContain('common_secret');
    expect(validateUnlockSecret('11111111').fieldErrors.map((error) => error.code)).toContain(
      'weak_numeric_secret',
    );
    expect(validateUnlockSecret('12345678').fieldErrors.map((error) => error.code)).toContain(
      'weak_numeric_secret',
    );
  });

  it('accepts strong numeric secrets and longer passphrases', () => {
    expect(validateUnlockSecret('83529174')).toEqual({ valid: true, fieldErrors: [] });
    expect(validateUnlockSecret('a strong unlock phrase')).toEqual({ valid: true, fieldErrors: [] });
  });
});
