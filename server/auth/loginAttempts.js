export function createLoginAttemptStore({
  maxAttempts = 5,
  windowMs = 15 * 60 * 1000,
  now = () => Date.now(),
} = {}) {
  const attempts = new Map();

  function currentRecord(key) {
    const record = attempts.get(key);
    if (!record || record.resetAt <= now()) {
      attempts.delete(key);
      return null;
    }
    return record;
  }

  return {
    isBlocked(key) {
      const record = currentRecord(key);
      return Boolean(record && record.failures >= maxAttempts);
    },

    recordFailure(key) {
      const record = currentRecord(key) || {
        failures: 0,
        resetAt: now() + windowMs,
      };
      record.failures += 1;
      attempts.set(key, record);
      return record;
    },

    recordSuccess(key) {
      attempts.delete(key);
    },
  };
}
