const commonSecrets = new Set([
  'password',
  'password1',
  'password12',
  'password123',
  'password1234',
  'letmein1234',
  'qwerty1234',
  'correcthorsebatterystaple',
]);

function onlyDigits(value) {
  return /^\d+$/.test(value);
}

function isRepeated(value) {
  return /^(.)(\1)+$/.test(value);
}

function isAscendingSequence(value) {
  return '01234567890123456789'.includes(value);
}

function isDescendingSequence(value) {
  return '98765432109876543210'.includes(value);
}

export function validateUnlockSecret(unlockSecret) {
  const value = String(unlockSecret || '');
  const compact = value.toLowerCase().replace(/\s+/g, '');
  const fieldErrors = [];

  if (!value) {
    fieldErrors.push({
      field: 'unlockSecret',
      code: 'required',
      message: 'Unlock secret is required.',
    });
  } else if (onlyDigits(value)) {
    if (value.length < 8 || isRepeated(value) || isAscendingSequence(value) || isDescendingSequence(value)) {
      fieldErrors.push({
        field: 'unlockSecret',
        code: 'weak_numeric_secret',
        message: 'Use at least 8 non-obvious digits or a longer passphrase.',
      });
    }
  } else if (value.length < 12) {
    fieldErrors.push({
      field: 'unlockSecret',
      code: 'too_short',
      message: 'Use at least 12 characters for a passphrase.',
    });
  }

  if (commonSecrets.has(compact)) {
    fieldErrors.push({
      field: 'unlockSecret',
      code: 'common_secret',
      message: 'Use a less common unlock secret.',
    });
  }

  return {
    valid: fieldErrors.length === 0,
    fieldErrors,
  };
}
