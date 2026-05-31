import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AuthContext } from '../types/express.js';
import {
  cardNumberHash,
  cardNumberLast4,
  decryptString,
  encryptString,
} from '../security/crypto.js';

export const credentialProfiles = [
  'claim_code',
  'claim_link',
  'merchant_number_pin',
  'barcode',
  'network_prepaid',
  'custom',
] as const;
export type CredentialProfile = (typeof credentialProfiles)[number];

export const credentialFieldKinds = [
  'primary_code',
  'card_number',
  'pin',
  'access_code',
  'barcode_value',
  'expiration_month',
  'expiration_year',
  'network_security_code',
  'billing_postal_code',
  'cardholder_name',
  'billing_address',
  'metadata',
] as const;
export type CredentialFieldKind = (typeof credentialFieldKinds)[number];

export const barcodeFormats = [
  'code128',
  'qr',
  'ean13',
  'upca',
  'pdf417',
  'aztec',
  'data_matrix',
  'other',
] as const;
type BarcodeFormat = (typeof barcodeFormats)[number];

const defaultProfile: CredentialProfile = 'merchant_number_pin';
const indexedKinds = new Set<CredentialFieldKind>(['primary_code', 'card_number', 'barcode_value']);

const kindSensitivity: Record<CredentialFieldKind, string> = {
  primary_code: 'spendable_secret',
  card_number: 'spendable_secret',
  pin: 'spendable_secret',
  access_code: 'spendable_secret',
  barcode_value: 'spendable_secret',
  expiration_month: 'payment_chd',
  expiration_year: 'payment_chd',
  network_security_code: 'payment_sad',
  billing_postal_code: 'billing_pii',
  cardholder_name: 'billing_pii',
  billing_address: 'billing_pii',
  metadata: 'display_metadata',
};

const labelByFieldKey: Record<string, string> = {
  primary_code: 'Redemption code',
  claim_link: 'Claim link',
  claim_url: 'Claim link',
  claim_code: 'Claim code',
  redemption_code: 'Redemption code',
  gift_code: 'Gift code',
  card_number: 'Card number',
  pin: 'PIN',
  access_code: 'PIN',
  barcode_value: 'Barcode',
  expiration_month: 'Exp. month',
  expiration_year: 'Exp. year',
  network_security_code: 'Security code',
  billing_postal_code: 'Billing ZIP',
  billing_zip: 'Billing ZIP',
  cardholder_name: 'Cardholder name',
  billing_address: 'Billing address',
  metadata: 'Note',
};

const kindByFieldKey: Record<string, CredentialFieldKind> = {
  primary_code: 'primary_code',
  claim_link: 'primary_code',
  claim_url: 'primary_code',
  url: 'primary_code',
  link: 'primary_code',
  claim_code: 'primary_code',
  redemption_code: 'primary_code',
  gift_code: 'primary_code',
  card_number: 'card_number',
  account_number: 'card_number',
  pin: 'pin',
  access_code: 'pin',
  barcode: 'barcode_value',
  barcode_value: 'barcode_value',
  expiration_month: 'expiration_month',
  exp_month: 'expiration_month',
  expiration_year: 'expiration_year',
  exp_year: 'expiration_year',
  cvv: 'network_security_code',
  cvc: 'network_security_code',
  cid: 'network_security_code',
  security_code: 'network_security_code',
  network_security_code: 'network_security_code',
  billing_postal_code: 'billing_postal_code',
  billing_zip: 'billing_postal_code',
  zip: 'billing_postal_code',
  postal_code: 'billing_postal_code',
  cardholder_name: 'cardholder_name',
  billing_address: 'billing_address',
  metadata: 'metadata',
  note: 'metadata',
};

const profileSortOrder: Record<CredentialProfile, Partial<Record<CredentialFieldKind, number>>> = {
  claim_code: {
    primary_code: 10,
    pin: 20,
    access_code: 30,
    barcode_value: 40,
  },
  claim_link: {
    primary_code: 10,
    pin: 20,
    metadata: 30,
  },
  merchant_number_pin: {
    card_number: 10,
    primary_code: 10,
    pin: 20,
    access_code: 30,
    barcode_value: 40,
    billing_postal_code: 80,
  },
  barcode: {
    barcode_value: 10,
    card_number: 20,
    primary_code: 30,
    pin: 40,
  },
  network_prepaid: {
    card_number: 10,
    expiration_month: 20,
    expiration_year: 30,
    network_security_code: 40,
    billing_postal_code: 50,
    cardholder_name: 60,
    billing_address: 70,
  },
  custom: {},
};

interface CredentialFieldInput {
  fieldKey?: string | null | undefined;
  key?: string | null | undefined;
  label?: string | null | undefined;
  fieldKind?: CredentialFieldKind | string | null | undefined;
  value?: unknown;
  barcodeFormat?: BarcodeFormat | string | null | undefined;
  sortOrder?: number | null | undefined;
  copyable?: boolean | null | undefined;
}

export interface CredentialInput {
  credentialProfile?: CredentialProfile | string | null | undefined;
  credentials?: {
    profile?: CredentialProfile | string | null | undefined;
    fields?: CredentialFieldInput[] | undefined;
  } | null | undefined;
  barcode?: string | null | undefined;
  barcodeValue?: string | null | undefined;
  cardNumber?: string | null | undefined;
  primaryCode?: string | null | undefined;
  claimCode?: string | null | undefined;
  redemptionCode?: string | null | undefined;
  giftCode?: string | null | undefined;
  claimLink?: string | null | undefined;
  claimUrl?: string | null | undefined;
  cardType?: string | null | undefined;
  network?: string | null | undefined;
  pin?: string | null | undefined;
  accessCode?: string | null | undefined;
  barcodeFormat?: BarcodeFormat | string | null | undefined;
  expirationMonth?: string | null | undefined;
  expirationYear?: string | null | undefined;
  networkSecurityCode?: string | null | undefined;
  cvv?: string | null | undefined;
  billingZip?: string | null | undefined;
  billingPostalCode?: string | null | undefined;
  cardholderName?: string | null | undefined;
  billingAddress?: string | null | undefined;
}

export interface PreparedCredentialField {
  fieldKey: string;
  label: string;
  fieldKind: CredentialFieldKind;
  sensitivityClass: string;
  encryptedValue: string | null;
  blindIndex: string | null;
  displayHint: string;
  displayLast4: string | null;
  valueLength: number;
  barcodeFormat: BarcodeFormat | null;
  sortOrder: number;
  copyable: 0 | 1;
}

interface PreparedCardCredentialCarrier {
  brand: string;
  credentialFields: PreparedCredentialField[];
}

interface CredentialFieldRow {
  fieldKey: string;
  label: string;
  fieldKind: CredentialFieldKind;
  sensitivityClass: string;
  encryptedValue: string | null;
  displayHint: string;
  barcodeFormat: BarcodeFormat | null;
  copyable: number;
}

interface CredentialSummaryRow {
  id?: number;
  credentialProfile?: CredentialProfile | string | null;
  credentialSummaryJson?: string | null;
  cardNumberLast4?: string | null;
  cardNumber?: string | null;
  pin?: string | null;
  billingZip?: string | null;
}

export class CredentialValidationError extends Error {
  fieldErrors: unknown[];

  constructor(message: string, fieldErrors: unknown[] = []) {
    super(message);
    this.name = 'CredentialValidationError';
    this.fieldErrors = fieldErrors;
  }
}

function validationError(field: string, code: string, message: string) {
  return { field, code, message };
}

function looksLikeClaimLink(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function canonicalFieldKey(value: unknown, fallback: string): string {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || fallback;
}

function humanizeFieldKey(fieldKey: string): string {
  return fieldKey
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export function normalizeCredentialProfile(profile: unknown, fallback: CredentialProfile = defaultProfile): CredentialProfile {
  return credentialProfiles.includes(profile as CredentialProfile) ? profile as CredentialProfile : fallback;
}

function normalizeExpirationMonth(value: unknown): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) {
    return '';
  }
  const month = Number(digits);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new CredentialValidationError('Invalid credential field.', [
      validationError('credentials.fields', 'invalid_expiration_month', 'Expiration month must be 1-12.'),
    ]);
  }
  return String(month).padStart(2, '0');
}

function normalizeExpirationYear(value: unknown): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) {
    return '';
  }
  if (digits.length === 2) {
    return `20${digits}`;
  }
  if (digits.length !== 4) {
    throw new CredentialValidationError('Invalid credential field.', [
      validationError('credentials.fields', 'invalid_expiration_year', 'Expiration year must be YY or YYYY.'),
    ]);
  }
  return digits;
}

export function normalizeCredentialValue(kind: CredentialFieldKind, value: unknown): string {
  if (value == null) {
    return '';
  }

  if (kind === 'card_number' || kind === 'network_security_code') {
    return String(value).replace(/\D/g, '');
  }
  if (kind === 'expiration_month') {
    return normalizeExpirationMonth(value);
  }
  if (kind === 'expiration_year') {
    return normalizeExpirationYear(value);
  }
  if (kind === 'primary_code' || kind === 'barcode_value') {
    return String(value).trim();
  }
  return String(value).trim();
}

function normalizeCredentialIndexValue(kind: CredentialFieldKind, value: unknown, profile?: CredentialProfile): string {
  if (kind === 'primary_code' && profile === 'claim_link') {
    return String(value || '').trim();
  }
  if (kind === 'primary_code' || kind === 'barcode_value') {
    return String(value || '').trim().replace(/[\s-]+/g, '').toUpperCase();
  }
  return normalizeCredentialValue(kind, value);
}

function genericCredentialHash(kind: CredentialFieldKind, value: unknown, hmacKey: Buffer, profile?: CredentialProfile): string | null {
  const normalized = normalizeCredentialIndexValue(kind, value, profile);
  if (!normalized) {
    return null;
  }
  return crypto
    .createHmac('sha256', hmacKey)
    .update(`${kind}\0${normalized}`)
    .digest('hex');
}

export function credentialBlindIndex(kind: CredentialFieldKind, value: unknown, hmacKey: Buffer, profile?: CredentialProfile): string | null {
  if (!indexedKinds.has(kind)) {
    return null;
  }
  if (kind === 'card_number') {
    return cardNumberHash(value, hmacKey);
  }
  return genericCredentialHash(kind, value, hmacKey, profile);
}

export function credentialSearchBlindIndexes(rawValue: unknown, hmacKey: Buffer): string[] {
  const hashes = new Set<string>();
  const cardHash = cardNumberHash(rawValue, hmacKey);
  if (cardHash) {
    hashes.add(cardHash);
  }

  for (const kind of ['primary_code', 'barcode_value'] as const) {
    const hash = genericCredentialHash(kind, rawValue, hmacKey);
    if (hash) {
      hashes.add(hash);
    }
    const exactHash = genericCredentialHash(kind, rawValue, hmacKey, 'claim_link');
    if (exactHash) {
      hashes.add(exactHash);
    }
  }

  return Array.from(hashes);
}

function displayLast4(kind: CredentialFieldKind, value: unknown): string | null {
  if (kind === 'card_number') {
    return cardNumberLast4(value);
  }
  const normalized = normalizeCredentialValue(kind, value);
  return normalized ? normalized.slice(-4) : null;
}

function displayHintFor(kind: CredentialFieldKind, value: unknown): string {
  if (kind === 'expiration_month' || kind === 'expiration_year') {
    return normalizeCredentialValue(kind, value);
  }
  if (kind === 'metadata') {
    return String(value || '').trim().slice(0, 80) || 'Saved';
  }
  const last4 = displayLast4(kind, value);
  return last4 ? `**** ${last4}` : 'Saved';
}

function inferKind(fieldKey: string, explicitKind: unknown): CredentialFieldKind {
  if (explicitKind === 'access_code') {
    return 'pin';
  }
  if (typeof explicitKind === 'string' && credentialFieldKinds.includes(explicitKind as CredentialFieldKind)) {
    return explicitKind as CredentialFieldKind;
  }
  return kindByFieldKey[fieldKey] || 'metadata';
}

function inferProfile(input: CredentialInput): CredentialProfile {
  if (credentialProfiles.includes(input.credentialProfile as CredentialProfile)) {
    return input.credentialProfile as CredentialProfile;
  }
  if (credentialProfiles.includes(input.credentials?.profile as CredentialProfile)) {
    return input.credentials?.profile as CredentialProfile;
  }
  if ((input.barcodeValue || input.barcode) && !input.cardNumber) {
    return 'barcode';
  }
  if ((input.claimLink || input.claimUrl) && !input.cardNumber) {
    return 'claim_link';
  }
  if (
    (input.primaryCode || input.claimCode || input.redemptionCode || input.giftCode)
    && !input.cardNumber
  ) {
    return 'claim_code';
  }
  if (input.cardType === 'prepaid' || input.network) {
    return 'network_prepaid';
  }
  return defaultProfile;
}

function legacyFieldsFromInput(input: CredentialInput, profile: CredentialProfile): CredentialFieldInput[] {
  const fields: CredentialFieldInput[] = [];
  const push = (
    fieldKey: string,
    fieldKind: CredentialFieldKind,
    value: unknown,
    label: string,
    sortOrder: number,
    extra: Partial<CredentialFieldInput> = {},
  ) => {
    if (value == null || String(value).trim() === '') {
      return;
    }
    fields.push({ fieldKey, fieldKind, value, label, sortOrder, ...extra });
  };

  const primaryCode =
    input.claimLink ??
    input.claimUrl ??
    input.primaryCode ??
    input.claimCode ??
    input.redemptionCode ??
    input.giftCode ??
    null;

  if (profile === 'claim_code') {
    push('primary_code', 'primary_code', primaryCode ?? input.cardNumber, 'Redemption code', 10);
    push('pin', 'pin', input.pin, 'PIN', 20);
    return fields;
  }

  if (profile === 'claim_link') {
    push('claim_link', 'primary_code', primaryCode ?? input.cardNumber, 'Claim link', 10);
    push('pin', 'pin', input.pin, 'PIN', 20);
    return fields;
  }

  if (profile === 'barcode') {
    push('barcode_value', 'barcode_value', input.barcodeValue ?? input.cardNumber, 'Barcode', 10, {
      barcodeFormat: input.barcodeFormat,
    });
    push('pin', 'pin', input.pin, 'PIN', 20);
    return fields;
  }

  push('card_number', 'card_number', input.cardNumber, 'Card number', 10);
  push('primary_code', 'primary_code', primaryCode, 'Redemption code', 15);
  push('pin', 'pin', input.pin ?? input.accessCode, 'PIN', 20);
  push('barcode_value', 'barcode_value', input.barcodeValue, 'Barcode', 40, {
    barcodeFormat: input.barcodeFormat,
  });
  push('expiration_month', 'expiration_month', input.expirationMonth, 'Exp. month', 50);
  push('expiration_year', 'expiration_year', input.expirationYear, 'Exp. year', 60);
  push('network_security_code', 'network_security_code', input.networkSecurityCode ?? input.cvv, 'Security code', 70);
  push('billing_postal_code', 'billing_postal_code', input.billingZip ?? input.billingPostalCode, 'Billing ZIP', 80);
  push('cardholder_name', 'cardholder_name', input.cardholderName, 'Cardholder name', 90);
  push('billing_address', 'billing_address', input.billingAddress, 'Billing address', 100);
  return fields;
}

function inputFields(input: CredentialInput, profile: CredentialProfile): CredentialFieldInput[] {
  if (Array.isArray(input.credentials?.fields)) {
    return input.credentials.fields;
  }
  return legacyFieldsFromInput(input, profile);
}

function prepareCredentialField(
  rawField: CredentialFieldInput,
  index: number,
  profile: CredentialProfile,
  auth: AuthContext,
): PreparedCredentialField | null {
  const fieldKey = canonicalFieldKey(
    rawField.fieldKey || rawField.key || rawField.fieldKind,
    `field_${index + 1}`,
  );
  const fieldKind = inferKind(fieldKey, rawField.fieldKind);
  const value = normalizeCredentialValue(fieldKind, rawField.value);
  if (!value) {
    return null;
  }
  if (profile === 'claim_link' && fieldKind === 'primary_code' && !looksLikeClaimLink(value)) {
    throw new CredentialValidationError('Credential validation failed.', [
      validationError('credentials.fields', 'invalid_claim_link', 'Claim link must be an HTTP or HTTPS URL.'),
    ]);
  }

  const profileOrder = profileSortOrder[profile] || {};
  const label = fieldKind === 'pin' && fieldKey === 'access_code'
    ? 'PIN'
    : String(rawField.label || labelByFieldKey[fieldKey] || humanizeFieldKey(fieldKey)).trim();
  const displayLastFour = displayLast4(fieldKind, value);
  return {
    fieldKey,
    label,
    fieldKind,
    sensitivityClass: kindSensitivity[fieldKind] || 'display_metadata',
    encryptedValue: encryptString(value, auth.dek),
    blindIndex: credentialBlindIndex(fieldKind, value, auth.blindIndexKey, profile),
    displayHint: displayHintFor(fieldKind, value),
    displayLast4: displayLastFour,
    valueLength: value.length,
    barcodeFormat: barcodeFormats.includes(rawField.barcodeFormat as BarcodeFormat)
      ? rawField.barcodeFormat as BarcodeFormat
      : null,
    sortOrder:
      typeof rawField.sortOrder === 'number' && Number.isInteger(rawField.sortOrder)
        ? rawField.sortOrder
        : profileOrder[fieldKind] ?? (index + 1) * 10,
    copyable: rawField.copyable === false ? 0 : 1,
  };
}

function buildSummary(profile: CredentialProfile, fields: PreparedCredentialField[]) {
  const primary =
    fields.find((field) => ['card_number', 'primary_code', 'barcode_value'].includes(field.fieldKind)) ||
    fields.find((field) => field.sensitivityClass === 'spendable_secret') ||
    fields[0] ||
    null;
  return {
    profile,
    primaryLabel: primary?.label ?? null,
    primaryLast4: primary?.displayLast4 ?? null,
    primaryHint: primary?.displayHint ?? null,
    fieldCount: fields.length,
    hasPin: fields.some((field) => field.fieldKind === 'pin' || field.fieldKind === 'access_code'),
    hasBillingZip: fields.some((field) => field.fieldKind === 'billing_postal_code'),
    hasBarcode: fields.some((field) => field.fieldKind === 'barcode_value'),
  };
}

function legacyShadowFromFields(fields: PreparedCredentialField[]) {
  const cardNumberField = fields.find((field) => field.fieldKind === 'card_number');
  const pinField = fields.find((field) => field.fieldKind === 'pin');
  const billingZipField = fields.find((field) => field.fieldKind === 'billing_postal_code');

  return {
    encryptedCardNumber: cardNumberField?.encryptedValue ?? null,
    cardNumberHash: cardNumberField?.blindIndex ?? null,
    cardNumberLast4: cardNumberField?.displayLast4 ?? null,
    pin: pinField?.encryptedValue ?? null,
    billingZip: billingZipField?.encryptedValue ?? null,
  };
}

export function buildCredentialModel(
  input: CredentialInput,
  auth: AuthContext,
  options: { allowNetworkSecurityCodeStorage?: boolean } = {},
) {
  const profile = inferProfile(input);
  const rawFields = inputFields(input, profile);
  const errors: unknown[] = [];
  const seenKeys = new Set<string>();
  const fields: PreparedCredentialField[] = [];

  rawFields.forEach((rawField, index) => {
    const field = prepareCredentialField(rawField, index, profile, auth);
    if (!field) {
      return;
    }
    if (field.fieldKind === 'network_security_code' && !options.allowNetworkSecurityCodeStorage) {
      errors.push(
        validationError(
          'credentials.fields',
          'security_code_storage_disabled',
          'Security code storage is disabled by deployment policy.',
        ),
      );
      return;
    }
    if (seenKeys.has(field.fieldKey)) {
      errors.push(
        validationError('credentials.fields', 'duplicate_field_key', `Duplicate credential field: ${field.fieldKey}.`),
      );
      return;
    }
    seenKeys.add(field.fieldKey);
    fields.push(field);
  });

  if (profile === 'claim_link' && !fields.some((field) => field.fieldKind === 'primary_code')) {
    errors.push(validationError('credentials.fields', 'required', 'Claim link is required.'));
  }

  if (errors.length > 0) {
    throw new CredentialValidationError('Credential validation failed.', errors);
  }

  const summary = buildSummary(profile, fields);
  return {
    profile,
    fields,
    summary,
    credentialProfile: profile,
    primaryCredentialLast4: summary.primaryLast4,
    credentialSummaryJson: JSON.stringify(summary),
    ...legacyShadowFromFields(fields),
  };
}

export function insertCredentialFields(
  db: Database.Database,
  {
    accountId,
    cardId,
    fields,
    timestamp,
  }: { accountId: number; cardId: number | bigint; fields: PreparedCredentialField[]; timestamp: string },
) {
  const statement = db.prepare(
    `INSERT INTO card_credential_fields (
      accountId, cardId, fieldKey, label, fieldKind, sensitivityClass,
      encryptedValue, blindIndex, displayHint, valueLength, barcodeFormat,
      sortOrder, copyable, createdAt, updatedAt
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (const field of fields) {
    statement.run(
      accountId,
      cardId,
      field.fieldKey,
      field.label,
      field.fieldKind,
      field.sensitivityClass,
      field.encryptedValue,
      field.blindIndex,
      field.displayHint,
      field.valueLength,
      field.barcodeFormat,
      field.sortOrder,
      field.copyable,
      timestamp,
      timestamp,
    );
  }
}

export function loadCredentialFields(db: Database.Database, accountId: number, cardId: number): CredentialFieldRow[] {
  return db
    .prepare(
      `SELECT *
       FROM card_credential_fields
       WHERE accountId = ? AND cardId = ?
       ORDER BY sortOrder, id`,
    )
    .all(accountId, cardId) as CredentialFieldRow[];
}

export function revealCredentialPayload(
  db: Database.Database,
  card: {
    id: number;
    credentialProfile?: string | null;
    cardNumber?: string | null;
    pin?: string | null;
    billingZip?: string | null;
  },
  auth: AuthContext,
) {
  const rows = loadCredentialFields(db, auth.accountId, card.id);
  const fields = rows.map((row) => ({
    fieldKey: row.fieldKey,
    label: row.fieldKind === 'access_code' ? 'PIN' : row.label,
    fieldKind: row.fieldKind === 'access_code' ? 'pin' : row.fieldKind,
    sensitivityClass: row.sensitivityClass,
    value: row.encryptedValue ? decryptString(row.encryptedValue, auth.dek) : null,
    displayHint: row.displayHint,
    barcodeFormat: row.barcodeFormat,
    copyable: row.copyable === 1,
  }));
  const hasKind = (kind: CredentialFieldKind) => fields.some((field) => field.fieldKind === kind && field.value);
  if (card.cardNumber && !hasKind('card_number')) {
    fields.push({
      fieldKey: 'card_number',
      label: 'Card number',
      fieldKind: 'card_number',
      sensitivityClass: 'spendable_secret',
      value: decryptString(card.cardNumber, auth.dek),
      displayHint: 'Saved',
      barcodeFormat: null,
      copyable: true,
    });
  }
  if (card.pin && !hasKind('pin')) {
    fields.push({
      fieldKey: 'pin',
      label: 'PIN',
      fieldKind: 'pin',
      sensitivityClass: 'spendable_secret',
      value: decryptString(card.pin, auth.dek),
      displayHint: 'Saved',
      barcodeFormat: null,
      copyable: true,
    });
  }
  if (card.billingZip && !hasKind('billing_postal_code')) {
    fields.push({
      fieldKey: 'billingZip',
      label: 'Billing ZIP',
      fieldKind: 'billing_postal_code',
      sensitivityClass: 'billing_pii',
      value: decryptString(card.billingZip, auth.dek),
      displayHint: 'Saved',
      barcodeFormat: null,
      copyable: true,
    });
  }

  return {
    profile: card.credentialProfile || defaultProfile,
    fields,
  };
}

export function parseCredentialSummary(row: CredentialSummaryRow) {
  if (row.credentialSummaryJson) {
    try {
      return JSON.parse(row.credentialSummaryJson);
    } catch {
      return null;
    }
  }

  return {
    profile: row.credentialProfile || defaultProfile,
    primaryLabel: row.cardNumberLast4 ? 'Card number' : null,
    primaryLast4: row.cardNumberLast4 ?? null,
    primaryHint: row.cardNumberLast4 ? `**** ${row.cardNumberLast4}` : null,
    fieldCount:
      (row.cardNumber ? 1 : 0) +
      (row.pin ? 1 : 0) +
      (row.billingZip ? 1 : 0),
    hasPin: Boolean(row.pin),
    hasBillingZip: Boolean(row.billingZip),
    hasBarcode: false,
  };
}

export function duplicateKeysForCredentialFields(card: PreparedCardCredentialCarrier): string[] {
  return card.credentialFields
    .filter((field) => field.blindIndex)
    .map((field) => `${card.brand}\0${field.blindIndex}`);
}

export function assertNoDuplicatePreparedCredentials(cards: PreparedCardCredentialCarrier[], conflictFactory: () => Error) {
  const seen = new Set<string>();
  for (const card of cards) {
    for (const key of duplicateKeysForCredentialFields(card)) {
      if (seen.has(key)) {
        throw conflictFactory();
      }
      seen.add(key);
    }
  }
}

export function assertNoExistingCredentialDuplicates(
  db: Database.Database,
  auth: AuthContext,
  cards: PreparedCardCredentialCarrier[],
  conflictFactory: () => Error,
) {
  const lookup = db.prepare(
    `SELECT cards.id
     FROM card_credential_fields AS fields
     JOIN cards ON cards.id = fields.cardId
      AND cards.accountId = fields.accountId
     WHERE fields.accountId = ?
       AND cards.brand = ?
       AND fields.blindIndex = ?
       AND cards.status IN ('available', 'reserved', 'in_use')
     LIMIT 1`,
  );

  for (const card of cards) {
    for (const field of card.credentialFields) {
      if (!field.blindIndex) {
        continue;
      }
      if (lookup.get(auth.accountId, card.brand, field.blindIndex)) {
        throw conflictFactory();
      }
    }
  }
}
