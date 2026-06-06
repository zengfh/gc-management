import type { Card, CredentialField, CredentialProfile, RevealedCredentials } from '../shared/domain';
import { formatMoney } from './display';

export interface ReserveSummaryColumn {
  key: string;
  label: string;
}

export interface ReserveSummaryRow {
  card: Card;
  values: Record<string, string>;
}

export interface ReserveSummary {
  columns: ReserveSummaryColumn[];
  rows: ReserveSummaryRow[];
  unavailableCredentialCardIds: Set<string>;
}

export type RevealedCredentialsByCardId = Record<string, RevealedCredentials | null | undefined>;

export const baseReserveSummaryColumns: ReserveSummaryColumn[] = [
  { key: 'brand', label: 'Brand' },
  { key: 'remainingBalance', label: 'Remaining balance' },
];

const defaultRedemptionKindsByProfile: Record<CredentialProfile, Set<string>> = {
  claim_code: new Set(['primary_code', 'pin', 'access_code']),
  claim_link: new Set(['primary_code']),
  merchant_number_pin: new Set(['card_number', 'primary_code', 'pin', 'access_code']),
  barcode: new Set(['barcode_value', 'pin', 'access_code']),
  network_prepaid: new Set(['card_number', 'expiration_month', 'expiration_year', 'network_security_code', 'billing_postal_code']),
  custom: new Set(['primary_code', 'card_number', 'pin', 'access_code', 'barcode_value']),
};

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function profileFrom(card: Card, credentials?: RevealedCredentials | null): CredentialProfile | 'custom' {
  const profile = credentials?.credentials?.profile || card.credentialProfile || 'custom';
  return (
    profile === 'claim_code'
    || profile === 'claim_link'
    || profile === 'merchant_number_pin'
    || profile === 'barcode'
    || profile === 'network_prepaid'
    || profile === 'custom'
  ) ? profile : 'custom';
}

function credentialColumnKey(field: Pick<CredentialField, 'fieldKey' | 'fieldKind' | 'label'>): string {
  const raw = `${field.label || field.fieldKind || field.fieldKey}`.trim().toLowerCase();
  const normalized = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `credential:${normalized || field.fieldKind || field.fieldKey}`;
}

function credentialColumnLabel(field: Pick<CredentialField, 'fieldKind' | 'label'>): string {
  if (field.fieldKind === 'pin') return 'PIN';
  if (field.fieldKind === 'access_code') return field.label || 'Access code';
  if (field.fieldKind === 'billing_postal_code') return field.label || 'Billing ZIP';
  if (field.fieldKind === 'network_security_code') return field.label || 'Security code';
  return field.label || field.fieldKind;
}

function credentialFields(credentials?: RevealedCredentials | null): CredentialField[] {
  const fields: CredentialField[] = [...(credentials?.credentials?.fields || [])];
  if (credentials?.cardNumber && !fields.some((field) => field.fieldKind === 'card_number')) {
    fields.push({
      fieldKey: 'cardNumber',
      fieldKind: 'card_number',
      label: 'Card number',
      value: credentials.cardNumber,
      copyable: true,
    });
  }
  if (credentials?.pin && !fields.some((field) => field.fieldKind === 'pin')) {
    fields.push({
      fieldKey: 'pin',
      fieldKind: 'pin',
      label: 'PIN',
      value: credentials.pin,
      copyable: true,
    });
  }
  if (credentials?.billingZip && !fields.some((field) => field.fieldKind === 'billing_postal_code')) {
    fields.push({
      fieldKey: 'billingZip',
      fieldKind: 'billing_postal_code',
      label: 'Billing ZIP',
      value: credentials.billingZip,
      copyable: true,
    });
  }
  return fields.filter((field) => field.value !== null && field.value !== undefined && String(field.value).length > 0);
}

function isRedemptionField(profile: CredentialProfile | 'custom', field: CredentialField): boolean {
  if (field.copyable === false) {
    return false;
  }
  return defaultRedemptionKindsByProfile[profile].has(field.fieldKind);
}

export function buildReserveSummary(
  cards: Card[],
  revealedCredentialsByCardId: RevealedCredentialsByCardId = {},
  unavailableCredentialCardIds: Set<string> = new Set(),
): ReserveSummary {
  const credentialColumns = new Map<string, ReserveSummaryColumn>();
  const credentialValuesByCardId = new Map<string, Record<string, string>>();

  for (const card of cards) {
    const cardId = String(card.id);
    const credentials = revealedCredentialsByCardId[cardId];
    const profile = profileFrom(card, credentials);
    const values: Record<string, string> = {};
    for (const field of credentialFields(credentials).filter((candidate) => isRedemptionField(profile, candidate))) {
      const key = credentialColumnKey(field);
      if (!credentialColumns.has(key)) {
        credentialColumns.set(key, { key, label: credentialColumnLabel(field) });
      }
      values[key] = normalizeCell(field.value);
    }
    credentialValuesByCardId.set(cardId, values);
  }

  const columns = [...baseReserveSummaryColumns, ...credentialColumns.values()];
  const rows = cards.map((card) => {
    const values: Record<string, string> = {
      brand: normalizeCell(card.brand),
      remainingBalance: formatMoney(card.remainingBalanceCents),
      ...credentialValuesByCardId.get(String(card.id)),
    };
    if (unavailableCredentialCardIds.has(String(card.id))) {
      for (const column of columns) {
        if (column.key.startsWith('credential:') && !values[column.key]) {
          values[column.key] = 'Unavailable';
        }
      }
    }
    return { card, values };
  });

  return { columns, rows, unavailableCredentialCardIds };
}

export function reserveSummaryToTsv(summary: ReserveSummary): string {
  const header = summary.columns.map((column) => normalizeCell(column.label)).join('\t');
  const rows = summary.rows.map((row) => summary.columns.map((column) => normalizeCell(row.values[column.key])).join('\t'));
  return [header, ...rows].join('\n');
}
