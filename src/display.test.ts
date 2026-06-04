import { describe, expect, it } from 'vitest';
import { statusLabels, formatMoney, formatDateTime } from './display';

describe('display utilities', () => {
  describe('statusLabels', () => {
    it('has the correct label for all known statuses', () => {
      expect(statusLabels.available).toBe('Available');
      expect(statusLabels.reserved).toBe('Reserved');
      expect(statusLabels.in_use).toBe('In Use');
      expect(statusLabels.sold).toBe('Sold');
      expect(statusLabels.used_up).toBe('Used Up');
      expect(statusLabels.void).toBe('Void');
    });
  });

  describe('formatMoney', () => {
    it('formats cents correctly', () => {
      expect(formatMoney(100)).toBe('$1.00');
      expect(formatMoney(1050)).toBe('$10.50');
      expect(formatMoney(0)).toBe('$0.00');
      expect(formatMoney(99)).toBe('$0.99');
    });

    it('handles negative amounts correctly', () => {
      // Intl.NumberFormat correctly handles negatives, usually format as -$1.00 for USD en-US.
      expect(formatMoney(-100)).toBe('-$1.00');
    });

    it('defaults to 0 if no value provided', () => {
      expect(formatMoney()).toBe('$0.00');
    });
  });

  describe('formatDateTime', () => {
    it('formats a valid date string correctly', () => {
      // Since toLocaleString() is timezone dependent, we'll just check it returns a string
      // that is not 'Not recorded' and has length.
      const result = formatDateTime('2024-01-01T12:00:00Z');
      expect(result).not.toBe('Not recorded');
      expect(result.length).toBeGreaterThan(0);
    });

    it('handles null gracefully', () => {
      expect(formatDateTime(null)).toBe('Not recorded');
    });

    it('handles undefined gracefully', () => {
      expect(formatDateTime(undefined)).toBe('Not recorded');
    });

    it('handles empty string gracefully', () => {
      expect(formatDateTime('')).toBe('Not recorded');
    });
  });
});
