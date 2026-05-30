import type { Card, CardStatus } from '../shared/domain';
import type { ViewId } from './appTypes';

export const statusLabels: Record<CardStatus, string> = {
  available: 'Available',
  reserved: 'Reserved',
  in_use: 'In Use',
  sold: 'Sold',
  used_up: 'Used Up',
  void: 'Void',
};

const terminalCardStatuses = new Set(['sold', 'used_up', 'void']);

export function formatMoney(cents = 0): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return 'Not recorded';
  }
  return new Date(value).toLocaleString();
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isWithinNextDays(value: string | null | undefined, days: number): boolean {
  const parsed = parseDateOnly(value);
  if (!parsed) {
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + days);
  return parsed >= today && parsed <= end;
}

export function isBeforeToday(value: string | null | undefined): boolean {
  const parsed = parseDateOnly(value);
  if (!parsed) {
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed < today;
}

export function formatDisplayValue(value: unknown): string {
  if (!value) {
    return 'Not recorded';
  }
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function statusText(status: CardStatus | string): string {
  return status in statusLabels ? statusLabels[status as CardStatus] : status;
}

export function viewTitle(view: ViewId): string {
  if (view === 'dashboard') {
    return 'Dashboard';
  }
  if (view === 'cards') {
    return 'Cards';
  }
  if (view === 'aiImport') {
    return 'AI Import';
  }
  if (view === 'audit') {
    return 'Audit Log';
  }
  if (view === 'backup') {
    return 'Backup';
  }
  if (view === 'settings') {
    return 'Settings';
  }
  return 'Deals';
}

export function isTerminalCard(card: Pick<Card, 'status'>): boolean {
  return terminalCardStatuses.has(card.status);
}

export function dollarsToCents(value: string): number | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = String(value).replace(/[$,]/g, '').trim();
  if (!normalized) {
    return undefined;
  }

  return Math.round(Number(normalized) * 100);
}

export function criteriaValue(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

export function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : 'Unexpected error.';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
