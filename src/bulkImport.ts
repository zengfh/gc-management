import type { CredentialProfile, ReferenceValueState } from '../shared/domain';
import type { ApiPayload } from './appTypes';
import { inferCredentialProfileForBrand, inferNetworkFromBrand } from './credentialHelpers';
import { dollarsToCents } from './display';
import { normalizeReferenceText, referenceValueTypes } from './referenceValues';

export type BulkImportProfile = CredentialProfile;

export interface BulkImportDraft {
  id: string;
  lineNumber: number;
  rawLine: string;
  brand: string;
  faceValue: string;
  credentialProfile: BulkImportProfile;
  primaryCode: string;
  secondaryCode: string;
  expirationMonth: string;
  expirationYear: string;
  billingZip: string;
  networkSecurityCode: string;
  barcodeFormat: string;
  source: string;
  notes: string;
  warnings: string[];
}

export interface BulkImportAnalysis {
  rows: BulkImportDraft[];
  skippedLines: number[];
}

interface BulkImportContext {
  brand: string;
  faceValue: string;
  credentialProfile: BulkImportProfile;
}

const builtInBrandAliases: Array<{ aliases: string[]; brand: string }> = [
  { brand: 'DoorDash', aliases: ['doordash', 'door dash'] },
  { brand: 'Best Buy', aliases: ['bestbuy', 'best buy'] },
  { brand: 'Amazon', aliases: ['amazon'] },
  { brand: 'Uber Eats', aliases: ['ubereats', 'uber eats'] },
  { brand: 'Uber', aliases: ['uber'] },
  { brand: 'Target', aliases: ['target'] },
  { brand: 'Walmart', aliases: ['walmart'] },
  { brand: 'Starbucks', aliases: ['starbucks'] },
  { brand: 'Home Depot', aliases: ['homedepot', 'home depot'] },
  { brand: "Lowe's", aliases: ['lowes', "lowe's"] },
  { brand: 'Apple', aliases: ['apple'] },
  { brand: 'Steam', aliases: ['steam'] },
  { brand: 'Visa', aliases: ['visa'] },
  { brand: 'Vanilla Visa', aliases: ['vanilla visa', 'vanillavisa'] },
  { brand: 'Mastercard', aliases: ['mastercard', 'master card'] },
  { brand: 'American Express', aliases: ['amex', 'american express'] },
];

const headerAliases: Record<string, keyof BulkImportDraft | 'profile' | 'code' | 'pin' | 'ignore'> = {
  brand: 'brand',
  merchant: 'brand',
  cardbrand: 'brand',
  card_brand: 'brand',
  value: 'faceValue',
  amount: 'faceValue',
  balance: 'faceValue',
  facevalue: 'faceValue',
  face_value: 'faceValue',
  code: 'code',
  claimcode: 'code',
  claim_code: 'code',
  redemptioncode: 'code',
  redemption_code: 'code',
  barcode: 'code',
  barcodevalue: 'code',
  barcode_value: 'code',
  cardnumber: 'code',
  card_number: 'code',
  password: 'pin',
  passcode: 'pin',
  pin: 'pin',
  accesscode: 'pin',
  access_code: 'pin',
  expmonth: 'expirationMonth',
  exp_month: 'expirationMonth',
  expirationmonth: 'expirationMonth',
  expiration_month: 'expirationMonth',
  expyear: 'expirationYear',
  exp_year: 'expirationYear',
  expirationyear: 'expirationYear',
  expiration_year: 'expirationYear',
  billingzip: 'billingZip',
  billing_zip: 'billingZip',
  billingpostalcode: 'billingZip',
  billing_postal_code: 'billingZip',
  postalcode: 'billingZip',
  postal_code: 'billingZip',
  zip: 'billingZip',
  cvv: 'networkSecurityCode',
  cvc: 'networkSecurityCode',
  cid: 'networkSecurityCode',
  securitycode: 'networkSecurityCode',
  security_code: 'networkSecurityCode',
  networksecuritycode: 'networkSecurityCode',
  network_security_code: 'networkSecurityCode',
  barcodeformat: 'barcodeFormat',
  barcode_format: 'barcodeFormat',
  credentialtype: 'profile',
  credential_type: 'profile',
  credentialprofile: 'profile',
  credential_profile: 'profile',
  source: 'source',
  notes: 'notes',
  note: 'notes',
};

function compact(value: string): string {
  return normalizeReferenceText(value).replace(/[^a-z0-9]+/g, '');
}

function tokenizeLine(line: string): string[] {
  return line
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function parseDelimitedLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function splitLine(line: string): { fields: string[]; delimited: boolean } {
  if (line.includes('\t')) {
    return {
      fields: line.split('\t').map((field) => field.trim()).filter(Boolean),
      delimited: true,
    };
  }
  if (line.includes(',')) {
    const cells = parseDelimitedLine(line).filter(Boolean);
    if (cells.length > 1) {
      return { fields: cells, delimited: true };
    }
  }
  return { fields: tokenizeLine(line), delimited: false };
}

function moneyValue(value: string): string {
  return value.trim().replace(/^\$/, '').replace(/,/g, '');
}

function isMoneyToken(value: string, allowPlainNumber: boolean): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (/^\$\d+(?:\.\d{1,2})?$/.test(trimmed)) {
    return true;
  }
  return allowPlainNumber && /^\d+(?:\.\d{1,2})?$/.test(trimmed);
}

function canonicalProfile(value: string): BulkImportProfile | null {
  const normalized = compact(value);
  if (['claimcode', 'singlecode', 'codeonly', 'redemptioncode'].includes(normalized)) {
    return 'claim_code';
  }
  if (['numberpin', 'cardnumberpin', 'merchantnumberpin'].includes(normalized)) {
    return 'merchant_number_pin';
  }
  if (['access', 'accesscode', 'numberaccess', 'merchantnumberaccess'].includes(normalized)) {
    return 'merchant_number_pin';
  }
  if (['barcode', 'qr', 'qrcode'].includes(normalized)) {
    return 'barcode';
  }
  if (['prepaid', 'networkprepaid', 'visa', 'mastercard', 'amex'].includes(normalized)) {
    return 'network_prepaid';
  }
  if (normalized === 'custom') {
    return 'custom';
  }
  return null;
}

function indexedBrandCandidates(referenceValues?: ReferenceValueState): Array<{ alias: string; brand: string }> {
  const indexed = referenceValues?.[referenceValueTypes.cardBrand] || [];
  const candidates = indexed.flatMap((row) => [{ alias: row.value, brand: row.value }]);
  for (const row of builtInBrandAliases) {
    for (const alias of row.aliases) {
      candidates.push({ alias, brand: row.brand });
    }
  }
  return candidates
    .filter((row) => row.alias.trim())
    .sort((left, right) => compact(right.alias).length - compact(left.alias).length);
}

function matchBrandFromText(line: string, referenceValues?: ReferenceValueState): { brand: string; rest: string } {
  const normalizedLine = compact(line);
  for (const candidate of indexedBrandCandidates(referenceValues)) {
    const alias = compact(candidate.alias);
    if (!alias || !normalizedLine.startsWith(alias)) {
      continue;
    }
    const tokens = tokenizeLine(line);
    let consumed = 0;
    let combined = '';
    for (const token of tokens) {
      combined += compact(token);
      consumed += 1;
      if (combined === alias) {
        return {
          brand: candidate.brand,
          rest: tokens.slice(consumed).join(' '),
        };
      }
      if (!alias.startsWith(combined)) {
        break;
      }
    }
  }
  return { brand: '', rest: line };
}

function matchBrandFromField(value: string, referenceValues?: ReferenceValueState): string {
  const normalized = compact(value);
  const match = indexedBrandCandidates(referenceValues).find((candidate) => compact(candidate.alias) === normalized);
  return match?.brand || '';
}

function headerKey(value: string): keyof typeof headerAliases | null {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const compacted = normalized.replace(/_/g, '');
  if (headerAliases[normalized]) {
    return normalized;
  }
  if (headerAliases[compacted]) {
    return compacted;
  }
  return null;
}

function isHeaderRow(fields: string[]): boolean {
  const matches = fields.filter((field) => Boolean(headerKey(field)));
  return matches.length >= 2
    && fields.some((field) => {
      const key = headerKey(field);
      return key ? headerAliases[key] === 'brand' : false;
    });
}

function draftFromHeader(fields: string[], headers: string[], lineNumber: number, rawLine: string): BulkImportDraft {
  const draft = emptyDraft(lineNumber, rawLine);
  let profileProvided = false;
  headers.forEach((header, index) => {
    const key = headerKey(header);
    if (!key) {
      return;
    }
    const target = headerAliases[key];
    const value = fields[index]?.trim() || '';
    if (!value || target === 'ignore') {
      return;
    }
    if (target === 'code') {
      draft.primaryCode = value;
      return;
    }
    if (target === 'pin') {
      draft.secondaryCode = value;
      return;
    }
    if (target === 'profile') {
      profileProvided = true;
      draft.credentialProfile = canonicalProfile(value) || draft.credentialProfile;
      return;
    }
    if (
      target === 'brand'
      || target === 'faceValue'
      || target === 'expirationMonth'
      || target === 'expirationYear'
      || target === 'billingZip'
      || target === 'networkSecurityCode'
      || target === 'barcodeFormat'
      || target === 'source'
      || target === 'notes'
    ) {
      draft[target] = value;
    }
  });
  if (!profileProvided) {
    draft.credentialProfile = draft.brand
      ? inferCredentialProfileForBrand(draft.brand) as BulkImportProfile
      : (draft.secondaryCode ? 'merchant_number_pin' : 'claim_code');
  }
  return withWarnings(draft);
}

function emptyDraft(lineNumber: number, rawLine: string): BulkImportDraft {
  return {
    id: `bulk-${lineNumber}`,
    lineNumber,
    rawLine,
    brand: '',
    faceValue: '',
    credentialProfile: 'claim_code',
    primaryCode: '',
    secondaryCode: '',
    expirationMonth: '',
    expirationYear: '',
    billingZip: '',
    networkSecurityCode: '',
    barcodeFormat: 'code128',
    source: '',
    notes: '',
    warnings: [],
  };
}

function draftFromFields(fields: string[], delimited: boolean, lineNumber: number, rawLine: string, referenceValues?: ReferenceValueState): BulkImportDraft {
  const draft = emptyDraft(lineNumber, rawLine);
  let remaining = [...fields];
  let brandWasMatched = false;

  if (delimited && remaining.length >= 3) {
    const brand = matchBrandFromField(remaining[0] || '', referenceValues);
    if (brand || !isMoneyToken(remaining[0] || '', false)) {
      draft.brand = brand || (remaining[0] || '').trim();
      brandWasMatched = Boolean(brand);
      remaining = remaining.slice(1);
    }
  } else {
    const brandMatch = matchBrandFromText(rawLine, referenceValues);
    if (brandMatch.brand) {
      draft.brand = brandMatch.brand;
      brandWasMatched = true;
      remaining = splitLine(brandMatch.rest).fields;
    } else {
      const looseValueIndex = remaining.findIndex((field) => isMoneyToken(field, true));
      if (looseValueIndex > 0 && looseValueIndex < remaining.length - 1) {
        draft.brand = remaining.slice(0, looseValueIndex).join(' ');
        remaining = remaining.slice(looseValueIndex);
      }
    }
  }

  const profileIndex = remaining.findIndex((field) => Boolean(canonicalProfile(field)));
  if (profileIndex >= 0) {
    draft.credentialProfile = canonicalProfile(remaining[profileIndex] || '') || draft.credentialProfile;
    remaining.splice(profileIndex, 1);
  }

  const allowPlainNumberValue = Boolean(draft.brand) || remaining.length >= 3;
  const valueIndex = remaining.findIndex((field) => isMoneyToken(field, allowPlainNumberValue));
  if (valueIndex >= 0) {
    draft.faceValue = moneyValue(remaining[valueIndex] || '');
    remaining.splice(valueIndex, 1);
  }

  if (!draft.credentialProfile || draft.credentialProfile === 'claim_code') {
    draft.credentialProfile = draft.brand && brandWasMatched
      ? inferCredentialProfileForBrand(draft.brand) as BulkImportProfile
      : (remaining.length >= 2 ? 'merchant_number_pin' : 'claim_code');
  }

  draft.primaryCode = remaining[0] || '';
  draft.secondaryCode = remaining[1] || '';
  if (remaining.length > 2) {
    draft.notes = `Extra parsed tokens: ${remaining.slice(2).join(' ')}`;
  }

  return withWarnings(draft);
}

function applyContinuationContext(draft: BulkImportDraft, fields: string[], context: BulkImportContext | null): BulkImportDraft {
  if (!context || draft.brand || draft.faceValue || !draft.primaryCode || context.credentialProfile !== 'claim_code') {
    return draft;
  }

  return withWarnings({
    ...draft,
    warnings: [],
    brand: context.brand,
    faceValue: context.faceValue,
    credentialProfile: 'claim_code',
    primaryCode: fields.join(' ').trim() || draft.primaryCode,
    secondaryCode: '',
    notes: '',
  });
}

function nextContinuationContext(row: BulkImportDraft): BulkImportContext | null {
  if (!row.brand || !row.faceValue || !row.primaryCode || bulkImportMissingFields(row).length > 0) {
    return null;
  }
  return {
    brand: row.brand,
    faceValue: row.faceValue,
    credentialProfile: row.credentialProfile,
  };
}

export function bulkImportMissingFields(row: BulkImportDraft): string[] {
  const missing: string[] = [];
  if (!row.brand.trim()) {
    missing.push('brand');
  }
  if (!dollarsToCents(row.faceValue)) {
    missing.push('face value');
  }
  if (!row.primaryCode.trim()) {
    missing.push('code/card number');
  }
  if (row.credentialProfile === 'merchant_number_pin' && !row.secondaryCode.trim()) {
    missing.push('PIN');
  }
  return missing;
}

function withWarnings(draft: BulkImportDraft): BulkImportDraft {
  const warnings = [...draft.warnings];
  const missing = bulkImportMissingFields({ ...draft, warnings: [] });
  if (missing.length > 0) {
    warnings.push(`Needs ${missing.join(', ')} before import.`);
  }
  if (draft.secondaryCode && draft.credentialProfile === 'claim_code') {
    warnings.push('Second credential was parsed but this row is set to single-code. Change credential type if it is a PIN.');
  }
  return {
    ...draft,
    warnings,
  };
}

export function analyzeBulkImportText(text: string, referenceValues?: ReferenceValueState): BulkImportAnalysis {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const skippedLines: number[] = [];
  const rows: BulkImportDraft[] = [];
  let headers: string[] | null = null;
  let continuationContext: BulkImportContext | null = null;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed) {
      skippedLines.push(lineNumber);
      return;
    }

    const { fields, delimited } = splitLine(line);
    if (!fields.length) {
      skippedLines.push(lineNumber);
      return;
    }
    if (!headers && delimited && isHeaderRow(fields)) {
      headers = fields;
      skippedLines.push(lineNumber);
      return;
    }

    const row = headers
      ? draftFromHeader(fields, headers, lineNumber, trimmed)
      : applyContinuationContext(
          draftFromFields(fields, delimited, lineNumber, trimmed, referenceValues),
          fields,
          continuationContext,
        );
    rows.push(row);
    continuationContext = nextContinuationContext(row) || continuationContext;
  });

  return { rows, skippedLines };
}

export function refreshBulkImportWarnings(row: BulkImportDraft): BulkImportDraft {
  return withWarnings({ ...row, warnings: [] });
}

export function bulkImportRowToDealPayload(row: BulkImportDraft): ApiPayload {
  return {
    cards: [bulkImportRowToCardPayload(row)],
  };
}

export function bulkImportRowsToDealPayload(rows: BulkImportDraft[]): ApiPayload {
  return {
    name: rows.length === 1 ? rows[0]?.brand.trim() || 'Bulk import' : 'Bulk import',
    cards: rows.map(bulkImportRowToCardPayload),
  };
}

function bulkImportRowToCardPayload(row: BulkImportDraft): ApiPayload {
  const profile = row.credentialProfile;
  const faceValueCents = dollarsToCents(row.faceValue);
  if (!faceValueCents) {
    throw new Error(`Line ${row.lineNumber} needs a face value.`);
  }
  const credentialFields = [];
  if (row.credentialProfile === 'claim_code') {
    credentialFields.push({
      fieldKey: 'primary_code',
      label: 'Redemption code',
      fieldKind: 'primary_code',
      value: row.primaryCode.trim(),
    });
  } else if (row.credentialProfile === 'barcode') {
    credentialFields.push({
      fieldKey: 'barcode_value',
      label: 'Barcode',
      fieldKind: 'barcode_value',
      value: row.primaryCode.trim(),
      barcodeFormat: row.barcodeFormat || 'code128',
    });
  } else {
    credentialFields.push({
      fieldKey: 'card_number',
      label: 'Card number',
      fieldKind: 'card_number',
      value: row.primaryCode.trim(),
    });
    if (row.secondaryCode.trim()) {
      credentialFields.push({
        fieldKey: 'pin',
        label: 'PIN',
        fieldKind: 'pin',
        value: row.secondaryCode.trim(),
      });
    }
    if (profile === 'network_prepaid') {
      if (row.expirationMonth.trim()) {
        credentialFields.push({
          fieldKey: 'expiration_month',
          label: 'Exp. month',
          fieldKind: 'expiration_month',
          value: row.expirationMonth.trim(),
        });
      }
      if (row.expirationYear.trim()) {
        credentialFields.push({
          fieldKey: 'expiration_year',
          label: 'Exp. year',
          fieldKind: 'expiration_year',
          value: row.expirationYear.trim(),
        });
      }
      if (row.billingZip.trim()) {
        credentialFields.push({
          fieldKey: 'billing_postal_code',
          label: 'Billing ZIP',
          fieldKind: 'billing_postal_code',
          value: row.billingZip.trim(),
        });
      }
      const networkSecurityCode = row.networkSecurityCode || '';
      if (networkSecurityCode.trim()) {
        credentialFields.push({
          fieldKey: 'network_security_code',
          label: 'Security code',
          fieldKind: 'network_security_code',
          value: networkSecurityCode.trim(),
        });
      }
    }
  }

  const network = profile === 'network_prepaid' ? inferNetworkFromBrand(row.brand) : null;
  return {
    brand: row.brand.trim(),
    cardType: profile === 'network_prepaid' ? 'prepaid' : 'merchant',
    credentialProfile: profile,
    credentials: {
      profile,
      fields: credentialFields,
    },
    ...(network ? { network } : {}),
    ...(profile === 'claim_code' ? { redemptionCode: row.primaryCode.trim() } : {}),
    ...(profile === 'barcode' ? { barcodeValue: row.primaryCode.trim(), barcodeFormat: row.barcodeFormat || 'code128' } : {}),
    ...(profile !== 'claim_code' && profile !== 'barcode' ? { cardNumber: row.primaryCode.trim() } : {}),
    ...(row.secondaryCode.trim() && profile === 'merchant_number_pin' ? { pin: row.secondaryCode.trim() } : {}),
    ...(row.billingZip.trim() && profile === 'network_prepaid' ? { billingZip: row.billingZip.trim() } : {}),
    ...((row.networkSecurityCode || '').trim() && profile === 'network_prepaid' ? { networkSecurityCode: (row.networkSecurityCode || '').trim() } : {}),
    ...(row.source.trim() ? { source: row.source.trim() } : {}),
    ...(row.notes.trim() ? { notes: row.notes.trim() } : {}),
    faceValueCents,
  };
}
