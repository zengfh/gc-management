import type { Card, Deal, Page } from '../shared/domain';

export function mergeCards(currentCards: Card[], incomingCards: Card[]): Card[] {
  return [
    ...incomingCards,
    ...currentCards.filter((card) => !incomingCards.some((incoming) => incoming.id === card.id)),
  ];
}

export function incrementPageTotal(page: Page, delta: number): Page {
  return {
    ...page,
    total: page.total + delta,
  };
}

export function upsertDeal(currentDeals: Deal[], deal: Deal): Deal[] {
  const exists = currentDeals.some((currentDeal) => currentDeal.id === deal.id);
  if (!exists) {
    return [deal, ...currentDeals];
  }
  return currentDeals.map((currentDeal) => (currentDeal.id === deal.id ? deal : currentDeal));
}

export function replaceDeal(currentDeals: Deal[], deal: Deal): Deal[] {
  return currentDeals.map((currentDeal) => (currentDeal.id === deal.id ? deal : currentDeal));
}

export function applyArchivedDealTransition(
  currentDeals: Deal[],
  updatedDeal: Deal,
  action: 'archive' | 'unarchive',
  includeArchived: boolean,
): Deal[] {
  if (action === 'archive' && !includeArchived) {
    return currentDeals.filter((deal) => deal.id !== updatedDeal.id);
  }
  return upsertDeal(currentDeals, updatedDeal);
}

export function replaceCard(currentCards: Card[], card: Card): Card[] {
  return currentCards.map((currentCard) => (currentCard.id === card.id ? card : currentCard));
}

export function removeCard(currentCards: Card[], cardId: string): Card[] {
  return currentCards.filter((card) => card.id !== cardId);
}

export function applySoldCard(currentCards: Card[], card: Card, salePriceCents: number): Card[] {
  return replaceCard(currentCards, {
    ...card,
    latestSalePriceCents: salePriceCents,
  });
}

export function applyUndoSale(currentCards: Card[], card: Card): Card[] {
  return replaceCard(currentCards, {
    ...card,
    latestSalePriceCents: null,
  });
}
