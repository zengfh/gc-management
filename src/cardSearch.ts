import type { CardSearchCriteria } from '../shared/domain';
import { criteriaValue } from './display';

export function mergeCardSearchCriteria(
  currentCriteria: CardSearchCriteria,
  criteria: CardSearchCriteria = {},
): CardSearchCriteria {
  const nextCriteria = {
    ...currentCriteria,
    ...criteria,
  };

  if (!Object.prototype.hasOwnProperty.call(criteria, 'offset')) {
    nextCriteria.offset = 0;
  }

  return nextCriteria;
}

export function cardSearchQuery(criteria: CardSearchCriteria): string {
  const params = new URLSearchParams();
  const entries = [
    ['limit', criteriaValue(criteria.limit)],
    ['offset', criteriaValue(criteria.offset)],
    ['status', criteriaValue(criteria.status)],
    ['cardType', criteriaValue(criteria.cardType)],
    ['activeOnly', criteriaValue(criteria.activeOnly)],
    ['brand', criteriaValue(criteria.brand)],
    ['source', criteriaValue(criteria.source)],
    ['dealId', criteriaValue(criteria.dealId)],
    ['expiresBefore', criteriaValue(criteria.expiresBefore)],
    ['text', criteriaValue(criteria.text)],
    ['sortBy', criteriaValue(criteria.sortBy)],
    ['sortDir', criteriaValue(criteria.sortDir)],
    ['credential', criteriaValue(criteria.cardNumber)],
  ] as const;

  entries.forEach(([key, value]) => {
    if (value && (key !== 'offset' || value !== '0')) {
      params.set(key, value);
    }
  });

  const query = params.toString();
  return query ? `?${query}` : '';
}
