import { describe, expect, it } from 'vitest';
import { cardSearchQuery, mergeCardSearchCriteria } from './cardSearch';

describe('cardSearchQuery', () => {
  it('builds the API query and maps cardNumber to credential', () => {
    expect(
      cardSearchQuery({
        cardNumber: '1234',
        status: 'available',
        brand: 'Amazon',
        offset: 25,
        sortBy: 'brand',
        sortDir: 'asc',
      }),
    ).toBe('?offset=25&status=available&brand=Amazon&sortBy=brand&sortDir=asc&credential=1234');
  });

  it('omits empty values and the default zero offset', () => {
    expect(cardSearchQuery({ status: '', offset: 0, text: 'coffee' })).toBe('?text=coffee');
  });
});

describe('mergeCardSearchCriteria', () => {
  it('resets offset when filters change without an explicit offset', () => {
    expect(mergeCardSearchCriteria({ status: 'available', offset: 50 }, { brand: 'Target' })).toEqual({
      status: 'available',
      brand: 'Target',
      offset: 0,
    });
  });

  it('keeps explicit offsets for pagination', () => {
    expect(mergeCardSearchCriteria({ status: 'available', offset: 0 }, { offset: 100 })).toEqual({
      status: 'available',
      offset: 100,
    });
  });
});
