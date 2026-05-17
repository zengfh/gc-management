import { describe, expect, it } from 'vitest';
import {
  applyArchivedDealTransition,
  applySoldCard,
  applyUndoSale,
  incrementPageTotal,
  mergeCards,
  removeCard,
  replaceCard,
  replaceDeal,
  upsertDeal,
} from './appStateReducers';
import type { Card, Deal } from '../shared/domain';

const baseCard: Card = {
  id: 'card_1',
  brand: 'Amazon',
  status: 'available',
  cardType: 'merchant',
  rowVersion: 1,
  faceValueCents: 1000,
  remainingBalanceCents: 1000,
  purchaseCostCents: 900,
};

const baseDeal: Deal = {
  id: 'deal_1',
  name: 'Holiday cards',
  rowVersion: 1,
};

describe('appStateReducers', () => {
  it('merges incoming cards ahead of existing cards and removes duplicates', () => {
    const incoming = { ...baseCard, brand: 'Target' };
    expect(mergeCards([baseCard, { ...baseCard, id: 'card_2' }], [incoming])).toEqual([
      incoming,
      { ...baseCard, id: 'card_2' },
    ]);
  });

  it('updates page totals', () => {
    expect(incrementPageTotal({ limit: 50, offset: 0, total: 2, hasMore: false }, 3)).toEqual({
      limit: 50,
      offset: 0,
      total: 5,
      hasMore: false,
    });
  });

  it('upserts and replaces deals', () => {
    const updated = { ...baseDeal, name: 'Updated' };
    expect(upsertDeal([], baseDeal)).toEqual([baseDeal]);
    expect(upsertDeal([baseDeal], updated)).toEqual([updated]);
    expect(replaceDeal([baseDeal], updated)).toEqual([updated]);
  });

  it('applies archive visibility rules', () => {
    expect(applyArchivedDealTransition([baseDeal], baseDeal, 'archive', false)).toEqual([]);
    expect(applyArchivedDealTransition([], baseDeal, 'unarchive', true)).toEqual([baseDeal]);
  });

  it('updates card mutation results', () => {
    const updated = { ...baseCard, status: 'sold' as const };
    expect(replaceCard([baseCard], updated)).toEqual([updated]);
    expect(removeCard([baseCard], baseCard.id)).toEqual([]);
    expect(applySoldCard([baseCard], updated, 800)[0]?.latestSalePriceCents).toBe(800);
    expect(applyUndoSale([baseCard], updated)[0]?.latestSalePriceCents).toBeNull();
  });
});
