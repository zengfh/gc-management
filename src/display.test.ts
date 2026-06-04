import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  formatMoney,
  formatDateTime,
  isWithinNextDays,
  isBeforeToday,
  formatDisplayValue,
  statusText,
  viewTitle,
  isTerminalCard,
  dollarsToCents,
  criteriaValue,
  errorMessage,
  isRecord,
} from './display';
import type { ViewId } from './appTypes';

describe('display utilities', () => {
  describe('formatMoney', () => {
    it('formats cents into USD currency', () => {
      expect(formatMoney(1000)).toBe('$10.00');
      expect(formatMoney(0)).toBe('$0.00');
      expect(formatMoney(-500)).toBe('-$5.00');
    });

    it('handles undefined input by treating it as 0', () => {
      expect(formatMoney(undefined)).toBe('$0.00');
    });
  });

  describe('formatDateTime', () => {
    it('returns "Not recorded" for null, undefined, or empty string', () => {
      expect(formatDateTime(null)).toBe('Not recorded');
      expect(formatDateTime(undefined)).toBe('Not recorded');
      expect(formatDateTime('')).toBe('Not recorded');
    });

    it('formats a valid date string', () => {
      const dateStr = '2023-05-10T14:30:00Z';
      const expected = new Date(dateStr).toLocaleString();
      expect(formatDateTime(dateStr)).toBe(expected);
    });
  });

  describe('date functions with mocked time', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      // Assume today is Jan 15, 2023 12:00:00 Local time
      vi.setSystemTime(new Date(2023, 0, 15, 12, 0, 0));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    describe('isWithinNextDays', () => {
      it('returns true if the date is within the specified number of next days', () => {
        expect(isWithinNextDays('2023-01-15', 5)).toBe(true); // Today
        expect(isWithinNextDays('2023-01-20', 5)).toBe(true); // Exactly 5 days from today
      });

      it('returns false if the date is outside the specified number of next days', () => {
        expect(isWithinNextDays('2023-01-14', 5)).toBe(false); // Yesterday
        expect(isWithinNextDays('2023-01-21', 5)).toBe(false); // 6 days from today
      });

      it('returns false for invalid or missing dates', () => {
        expect(isWithinNextDays(null, 5)).toBe(false);
        expect(isWithinNextDays('', 5)).toBe(false);
        expect(isWithinNextDays('invalid-date', 5)).toBe(false);
      });
    });

    describe('isBeforeToday', () => {
      it('returns true if the date is before today', () => {
        expect(isBeforeToday('2023-01-14')).toBe(true);
        expect(isBeforeToday('2022-12-31')).toBe(true);
      });

      it('returns false if the date is today or in the future', () => {
        expect(isBeforeToday('2023-01-15')).toBe(false);
        expect(isBeforeToday('2023-01-16')).toBe(false);
      });

      it('returns false for invalid or missing dates', () => {
        expect(isBeforeToday(null)).toBe(false);
        expect(isBeforeToday('')).toBe(false);
        expect(isBeforeToday('invalid-date')).toBe(false);
      });
    });
  });

  describe('formatDisplayValue', () => {
    it('transforms string with underscores and capitalizes words', () => {
      expect(formatDisplayValue('hello_world')).toBe('Hello World');
      expect(formatDisplayValue('some_variable_name')).toBe('Some Variable Name');
    });

    it('returns "Not recorded" for falsy values', () => {
      expect(formatDisplayValue('')).toBe('Not recorded');
      expect(formatDisplayValue(null)).toBe('Not recorded');
      expect(formatDisplayValue(undefined)).toBe('Not recorded');
      expect(formatDisplayValue(0)).toBe('Not recorded');
    });

    it('formats non-string truthy values', () => {
      expect(formatDisplayValue(123)).toBe('123');
      expect(formatDisplayValue(true)).toBe('True');
    });
  });

  describe('statusText', () => {
    it('returns the human-readable label for a known status', () => {
      expect(statusText('available')).toBe('Available');
      expect(statusText('in_use')).toBe('In Use');
      expect(statusText('used_up')).toBe('Used Up');
    });

    it('returns the raw string if the status is unknown', () => {
      expect(statusText('unknown_status')).toBe('unknown_status');
    });
  });

  describe('viewTitle', () => {
    it('returns the correct title for each ViewId', () => {
      expect(viewTitle('dashboard')).toBe('Dashboard');
      expect(viewTitle('cards')).toBe('Cards');
      expect(viewTitle('audit')).toBe('Audit Log');
      expect(viewTitle('backup')).toBe('Backup');
      expect(viewTitle('settings')).toBe('Settings');
    });

    it('returns "Deals" for any unknown or default view', () => {
      expect(viewTitle('deals' as ViewId)).toBe('Deals');
      expect(viewTitle('something_else' as ViewId)).toBe('Deals');
    });
  });

  describe('isTerminalCard', () => {
    it('returns true for terminal statuses', () => {
      expect(isTerminalCard({ status: 'sold' })).toBe(true);
      expect(isTerminalCard({ status: 'used_up' })).toBe(true);
      expect(isTerminalCard({ status: 'void' })).toBe(true);
    });

    it('returns false for non-terminal statuses', () => {
      expect(isTerminalCard({ status: 'available' })).toBe(false);
      expect(isTerminalCard({ status: 'reserved' })).toBe(false);
      expect(isTerminalCard({ status: 'in_use' })).toBe(false);
    });
  });

  describe('dollarsToCents', () => {
    it('converts dollar string amounts to cents (number)', () => {
      expect(dollarsToCents('10.50')).toBe(1050);
      expect(dollarsToCents('0.99')).toBe(99);
      expect(dollarsToCents('5')).toBe(500);
    });

    it('ignores dollar signs and commas', () => {
      expect(dollarsToCents('$1,234.56')).toBe(123456);
      expect(dollarsToCents(' $ 10.00 ')).toBe(1000);
    });

    it('returns undefined for empty or invalid input strings', () => {
      expect(dollarsToCents('')).toBeUndefined();
      expect(dollarsToCents('   ')).toBeUndefined();
      expect(dollarsToCents('$')).toBeUndefined();
    });
  });

  describe('criteriaValue', () => {
    it('trims string values', () => {
      expect(criteriaValue('  hello  ')).toBe('hello');
    });

    it('converts non-null values to strings and trims', () => {
      expect(criteriaValue(123)).toBe('123');
    });

    it('returns empty string for null or undefined', () => {
      expect(criteriaValue(null)).toBe('');
      expect(criteriaValue(undefined)).toBe('');
    });
  });

  describe('errorMessage', () => {
    it('returns the message property of an Error object', () => {
      expect(errorMessage(new Error('Something went wrong'))).toBe('Something went wrong');
    });

    it('returns "Unexpected error." for non-Error objects', () => {
      expect(errorMessage('Just a string error')).toBe('Unexpected error.');
      expect(errorMessage(null)).toBe('Unexpected error.');
      expect(errorMessage({ message: 'Fake error' })).toBe('Unexpected error.');
    });
  });

  describe('isRecord', () => {
    it('returns true for plain objects', () => {
      expect(isRecord({ a: 1 })).toBe(true);
      expect(isRecord({})).toBe(true);
    });

    it('returns false for arrays, null, and primitives', () => {
      expect(isRecord([])).toBe(false);
      expect(isRecord(null)).toBe(false);
      expect(isRecord(undefined)).toBe(false);
      expect(isRecord('string')).toBe(false);
      expect(isRecord(123)).toBe(false);
      expect(isRecord(true)).toBe(false);
    });
  });
});
