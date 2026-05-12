import { forbidden } from '../http/errors.js';

export const featureFlagDefinitions = {
  plaintextJsonExport: {
    env: 'GC_PLAINTEXT_EXPORT_ENABLED',
    defaultEnabled: true,
    disabledValue: 'false',
    public: true,
    description: 'Plaintext JSON export. Hosted deployments should disable this unless explicitly approved.',
  },
  rawDatabaseExport: {
    env: 'GC_FEATURE_RAW_DATABASE_EXPORT',
    defaultEnabled: true,
    disabledValue: 'false',
    public: true,
    description: 'Raw SQLite database export.',
  },
  csvImport: {
    env: 'GC_FEATURE_CSV_IMPORT',
    defaultEnabled: true,
    disabledValue: 'false',
    public: true,
    description: 'CSV import preview and confirm.',
  },
  referenceValueHints: {
    env: 'GC_FEATURE_REFERENCE_VALUE_HINTS',
    defaultEnabled: true,
    disabledValue: 'false',
    public: true,
    description: 'Add Deal indexed typeahead and reference review.',
  },
};

function readFlag(definition, env) {
  const value = env[definition.env];
  if (value == null || value === '') {
    return definition.defaultEnabled;
  }
  return value !== definition.disabledValue;
}

export function featureEnabled(flagName, env = process.env) {
  const definition = featureFlagDefinitions[flagName];
  if (!definition) {
    throw new Error(`Unknown feature flag: ${flagName}`);
  }
  return readFlag(definition, env);
}

export function getFeatureFlags(env = process.env) {
  return Object.fromEntries(
    Object.entries(featureFlagDefinitions).map(([name, definition]) => [
      name,
      readFlag(definition, env),
    ]),
  );
}

export function getPublicFeatureFlags(env = process.env) {
  return Object.fromEntries(
    Object.entries(featureFlagDefinitions)
      .filter(([, definition]) => definition.public)
      .map(([name, definition]) => [name, readFlag(definition, env)]),
  );
}

export function requireFeatureFlag(flagName) {
  return function featureFlagMiddleware(_req, _res, next) {
    if (!featureEnabled(flagName)) {
      next(forbidden('FEATURE_DISABLED', 'This feature is disabled by deployment policy.'));
      return;
    }
    next();
  };
}
