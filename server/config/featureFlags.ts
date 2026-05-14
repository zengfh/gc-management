import type { NextFunction, Request, Response } from 'express';
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
  networkSecurityCodeStorage: {
    env: 'GC_FEATURE_NETWORK_SECURITY_CODE_STORAGE',
    defaultEnabled: false,
    disabledValue: 'false',
    public: true,
    description: 'Storage of network prepaid security codes such as CVV/CVC. Disabled by default.',
  },
} as const;

type FeatureFlagName = keyof typeof featureFlagDefinitions;
type FeatureFlagDefinition = (typeof featureFlagDefinitions)[FeatureFlagName];
type EnvLike = NodeJS.ProcessEnv;

function readFlag(definition: FeatureFlagDefinition, env: EnvLike): boolean {
  const value = env[definition.env];
  if (value == null || value === '') {
    return definition.defaultEnabled;
  }
  return value !== definition.disabledValue;
}

export function featureEnabled(flagName: FeatureFlagName, env: EnvLike = process.env): boolean {
  const definition = featureFlagDefinitions[flagName];
  if (!definition) {
    throw new Error(`Unknown feature flag: ${flagName}`);
  }
  return readFlag(definition, env);
}

export function getFeatureFlags(env: EnvLike = process.env): Record<FeatureFlagName, boolean> {
  return Object.fromEntries(
    Object.entries(featureFlagDefinitions).map(([name, definition]) => [
      name,
      readFlag(definition, env),
    ]),
  ) as Record<FeatureFlagName, boolean>;
}

export function getPublicFeatureFlags(env: EnvLike = process.env): Partial<Record<FeatureFlagName, boolean>> {
  return Object.fromEntries(
    Object.entries(featureFlagDefinitions)
      .filter(([, definition]) => definition.public)
      .map(([name, definition]) => [name, readFlag(definition, env)]),
  );
}

export function requireFeatureFlag(flagName: FeatureFlagName) {
  return function featureFlagMiddleware(_req: Request, _res: Response, next: NextFunction) {
    if (!featureEnabled(flagName)) {
      next(forbidden('FEATURE_DISABLED', 'This feature is disabled by deployment policy.'));
      return;
    }
    next();
  };
}
