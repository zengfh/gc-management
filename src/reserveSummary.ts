import type { Card, CredentialField, RevealedCredentials } from '../shared/domain';
import { formatMoney, statusLabels } from './display';

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
  { key: 'status', label: 'Status' },
  { key: 'faceValue', label: 'Face value' },
  { key: 'remainingBalance', label: 'Remaining balance' },
  { key: 'expiration', label: 'Expiration' },
  { key: 'source', label: 'Source' },
  { key: 'cardType', label: 'Card type' },
  { key: 'network', label: 'Network' },
  { key: 'credentialProfile', label: 'Credential profile' },
  { key: 'cardNumberLast4', label: 'Card number last 4' },
  { key: 'reservedFor', label: 'Reserved for' },
  { key: 'reservedUntil', label: 'Reserved until' },
  { key: 'reservedNotes', label: 'Reservation notes' },
  { key: 'notes', label: 'Card notes' },
  { key: 'cardId', label: 'Card ID' },
  { key: 'dealId', label: 'Deal ID' },
];

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
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

export function buildReserveSummary(
  cards: Card[],
  revealedCredentialsByCardId: RevealedCredentialsByCardId = {},
  unavailableCredentialCardIds: Set<string> = new Set(),
): ReserveSummary {
  const credentialColumns = new Map<string, ReserveSummaryColumn>();
  const credentialValuesByCardId = new Map<string, Record<string, string>>();

  for (const card of cards) {
    const cardId = String(card.id);
    const values: Record<string, string> = {};
    for (const field of credentialFields(revealedCredentialsByCardId[cardId])) {
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
      status: normalizeCell(statusLabels[card.status] || card.status),
      faceValue: formatMoney(card.faceValueCents),
      remainingBalance: formatMoney(card.remainingBalanceCents),
      expiration: normalizeCell(card.expirationDate),
      source: normalizeCell(card.source),
      cardType: normalizeCell(card.cardType),
      network: normalizeCell(card.network),
      credentialProfile: normalizeCell(card.credentialProfile),
      cardNumberLast4: normalizeCell(card.cardNumberLast4),
      reservedFor: normalizeCell(card.reservedFor),
      reservedUntil: normalizeCell(card.reservedUntil),
      reservedNotes: normalizeCell(card.reservedNotes),
      notes: normalizeCell(card.notes),
      cardId: normalizeCell(card.id),
      dealId: normalizeCell((card as Card & { dealId?: string | number | null }).dealId),
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
