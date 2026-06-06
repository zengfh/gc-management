import { useCallback, useState } from 'react';
import { apiFetch } from './api';
import {
  applyArchivedDealTransition,
  incrementPageTotal,
  mergeCards,
  removeCard,
  replaceCard,
  replaceDeal,
  upsertDeal,
} from './appStateReducers';
import type {
  ApiPayload,
  AiImportAnalyzePayload,
  AiImportAnalyzeResult,
  AiImportModelsResult,
  CardMutationResult,
  CardSalePayload,
  CsvImportResult,
  CsvPreviewPayload,
  DealMutationResult,
} from './appTypes';
import {
  cardSearchQuery,
  mergeCardSearchCriteria,
} from './cardSearch';
import { defaultCardCriteria, defaultPage } from './defaults';
import type {
  ApiResponse,
  Card,
  CardDetail,
  CardInventorySummary,
  CardSearchCriteria,
  Deal,
  DealDetail,
  RevealedCredentials,
} from '../shared/domain';

interface InventoryControllerOptions {
  csrfToken: () => string;
}

type CardListResponse = ApiResponse<Card[]> & {
  summary?: CardInventorySummary;
};

const activeCardStatuses = new Set(['available', 'reserved', 'in_use']);

function criteriaIsTrue(value: unknown): boolean {
  return String(value || '').toLowerCase() === 'true';
}

function cardMatchesCurrentCriteria(card: Card, criteria: CardSearchCriteria): boolean {
  if (criteria.status && card.status !== criteria.status) {
    return false;
  }

  if (!criteria.status && criteriaIsTrue(criteria.activeOnly)) {
    return activeCardStatuses.has(card.status) && card.remainingBalanceCents > 0;
  }

  if (criteria.cardType && card.cardType !== criteria.cardType) {
    return false;
  }

  if (criteria.brand && card.brand.trim().toLowerCase() !== String(criteria.brand).trim().toLowerCase()) {
    return false;
  }

  return true;
}

function replaceCardForCurrentCriteria(currentCards: Card[], card: Card, criteria: CardSearchCriteria): Card[] {
  if (!cardMatchesCurrentCriteria(card, criteria)) {
    return removeCard(currentCards, card.id);
  }
  const exists = currentCards.some((currentCard) => currentCard.id === card.id);
  if (!exists) {
    return [card, ...currentCards];
  }
  return replaceCard(currentCards, card);
}

export function useInventoryController({ csrfToken }: InventoryControllerOptions) {
  const [cards, setCards] = useState<Card[]>([]);
  const [cardsPage, setCardsPage] = useState(defaultPage);
  const [cardCriteria, setCardCriteria] = useState<CardSearchCriteria>(defaultCardCriteria);
  const [cardSummary, setCardSummary] = useState<CardInventorySummary | null>(null);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(false);

  const loadInventory = useCallback(async function loadInventory() {
    setLoading(true);
    try {
      const [cardsResponse, dealsResponse] = await Promise.all([
        apiFetch<CardListResponse>(`/api/cards${cardSearchQuery(defaultCardCriteria)}`),
        apiFetch<ApiResponse<Deal[]>>('/api/deals'),
      ]);
      setCards(cardsResponse.data || []);
      setCardsPage(cardsResponse.page || defaultPage);
      setCardCriteria(defaultCardCriteria);
      setCardSummary(cardsResponse.summary || null);
      setDeals(dealsResponse.data || []);
    } finally {
      setLoading(false);
    }
  }, []);

  const resetInventory = useCallback(function resetInventory() {
    setCards([]);
    setCardsPage(defaultPage);
    setCardCriteria(defaultCardCriteria);
    setCardSummary(null);
    setDeals([]);
  }, []);

  async function searchCards(criteria: CardSearchCriteria = {}) {
    const nextCriteria = mergeCardSearchCriteria(cardCriteria, criteria);
    const query = cardSearchQuery(nextCriteria);
    setLoading(true);
    try {
      const response = await apiFetch<CardListResponse>(`/api/cards${query}`);
      setCards(response.data || []);
      setCardsPage(response.page || defaultPage);
      setCardCriteria(nextCriteria);
      setCardSummary(response.summary || null);
    } finally {
      setLoading(false);
    }
  }

  async function loadDeals({ includeArchived = false }: { includeArchived?: boolean } = {}) {
    const query = includeArchived ? '?includeArchived=true' : '';
    setLoading(true);
    try {
      const response = await apiFetch<ApiResponse<Deal[]>>(`/api/deals${query}`);
      setDeals(response.data || []);
    } finally {
      setLoading(false);
    }
  }

  async function loadCardDetail(cardId: string) {
    return apiFetch<ApiResponse<CardDetail>>(`/api/cards/${cardId}`);
  }

  async function loadDealDetail(dealId: string) {
    return apiFetch<ApiResponse<DealDetail>>(`/api/deals/${dealId}`);
  }

  async function revealCardCredentials(cardId: string) {
    return apiFetch<ApiResponse<RevealedCredentials>>(`/api/cards/${cardId}/reveal`, {
      method: 'POST',
      body: {},
      csrfToken: csrfToken(),
    });
  }

  async function previewCsv(payload: { csv: string }) {
    return apiFetch<ApiResponse<CsvPreviewPayload>>('/api/cards/import-csv', {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
  }

  async function confirmCsv(payload: { csv: string }) {
    const response = await apiFetch<ApiResponse<CsvImportResult>>('/api/cards/import-csv/confirm', {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
    setCards((current) => mergeCards(current, response.data.cards));
    setCardsPage((current) => incrementPageTotal(current, response.data.cards.length));
    setCardSummary(null);
    return response;
  }

  async function analyzeAiImport(payload: AiImportAnalyzePayload) {
    return apiFetch<ApiResponse<AiImportAnalyzeResult>>('/api/ai-import/analyze', {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
  }

  async function loadAiImportModels() {
    return apiFetch<ApiResponse<AiImportModelsResult>>('/api/ai-import/models');
  }

  async function createDeal(payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<DealMutationResult>>('/api/deals', {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
    setDeals((current) => upsertDeal(current, response.data.deal));
    setCards((current) => mergeCards(current, response.data.cards));
    setCardSummary(null);
  }

  async function dealArchiveTransition(dealId: string, action: 'archive' | 'unarchive', includeArchived: boolean) {
    const response = await apiFetch<ApiResponse<{ deal: Deal }>>(`/api/deals/${dealId}/${action}`, {
      method: 'POST',
      body: {},
      csrfToken: csrfToken(),
    });
    const updatedDeal = response.data.deal;
    setDeals((current) => applyArchivedDealTransition(current, updatedDeal, action, includeArchived));
  }

  async function editDeal(dealId: string, payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<{ deal: Deal }>>(`/api/deals/${dealId}`, {
      method: 'PUT',
      body: payload,
      csrfToken: csrfToken(),
    });
    const updatedDeal = response.data.deal;
    setDeals((current) => replaceDeal(current, updatedDeal));
    return response;
  }

  async function useCard(cardId: string, payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<CardDetail>>(`/api/cards/${cardId}/use`, {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
    setCards((current) => replaceCardForCurrentCriteria(current, response.data.card, cardCriteria));
    setCardSummary(null);
    return response;
  }

  async function undoUsage(cardId: string, payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<CardMutationResult>>(`/api/cards/${cardId}/undo-usage`, {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
    setCards((current) => replaceCardForCurrentCriteria(current, response.data.card, cardCriteria));
    setCardSummary(null);
    return response;
  }

  async function editCard(cardId: string, payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<Card>>(`/api/cards/${cardId}`, {
      method: 'PUT',
      body: payload,
      csrfToken: csrfToken(),
    });
    setCards((current) => replaceCardForCurrentCriteria(current, response.data, cardCriteria));
    setCardSummary(null);
    return response;
  }

  async function deleteCard(cardId: string) {
    await apiFetch<ApiResponse<unknown>>(`/api/cards/${cardId}`, {
      method: 'DELETE',
      csrfToken: csrfToken(),
    });
    setCards((current) => removeCard(current, cardId));
    setCardSummary(null);
  }

  async function sellCard(cardId: string, payload: CardSalePayload) {
    const response = await apiFetch<ApiResponse<CardMutationResult>>(`/api/cards/${cardId}/sell`, {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
    setCards((current) =>
      replaceCardForCurrentCriteria(current, {
        ...response.data.card,
        latestSalePriceCents: payload.salePriceCents,
      }, cardCriteria));
    setCardSummary(null);
  }

  async function undoSale(cardId: string, payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<CardMutationResult>>(`/api/cards/${cardId}/undo-sale`, {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
    setCards((current) =>
      replaceCardForCurrentCriteria(current, {
        ...response.data.card,
        latestSalePriceCents: null,
      }, cardCriteria));
    setCardSummary(null);
  }

  async function voidCard(cardId: string, payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<CardMutationResult>>(`/api/cards/${cardId}/void`, {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
    setCards((current) => replaceCardForCurrentCriteria(current, response.data.card, cardCriteria));
    setCardSummary(null);
  }

  async function cardTransition(cardId: string, action: 'reserve' | 'unreserve', payload: ApiPayload = {}) {
    const response = await apiFetch<ApiResponse<Card>>(`/api/cards/${cardId}/${action}`, {
      method: 'POST',
      body: payload,
      csrfToken: csrfToken(),
    });
    setCards((current) => replaceCardForCurrentCriteria(current, response.data, cardCriteria));
    setCardSummary(null);
    return response;
  }

  return {
    cards,
    cardsPage,
    cardCriteria,
    cardSummary,
    deals,
    loading,
    loadInventory,
    resetInventory,
    searchCards,
    loadDeals,
    loadCardDetail,
    loadDealDetail,
    revealCardCredentials,
    previewCsv,
    confirmCsv,
    analyzeAiImport,
    loadAiImportModels,
    createDeal,
    dealArchiveTransition,
    editDeal,
    useCard,
    undoUsage,
    editCard,
    deleteCard,
    sellCard,
    undoSale,
    voidCard,
    cardTransition,
  };
}
