import { useState, type ChangeEvent, type FormEvent } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  CircleDollarSign,
  CreditCard,
  DatabaseBackup,
  Eye,
  EyeOff,
  FilePlus2,
  LayoutDashboard,
  LogOut,
  PackageCheck,
  Plus,
  RefreshCw,
  ScrollText,
  Settings,
  ShieldCheck,
  Sparkles,
  Tag,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { AIImportWorkspace } from './AIImportWorkspace';
import { AddDealPanel } from './AddDealPanel';
import { BulkImportPanel } from './BulkImportPanel';
import {
  BackupExportForm,
  BackupSettingsForm,
  CsvImportPreviewForm,
  EncryptedBackupExportForm,
  EncryptedJsonImportForm,
  PlaintextJsonImportForm,
  RawDatabaseExportForm,
} from './backupComponents';
import { ThemeSwitcher } from './ThemeSwitcher';
import {
  CardDetailPanel,
  DealDetailPanel,
  DeleteCardPanel,
  EditDealPanel,
  ReserveCardPanel,
  SellCardPanel,
  UndoSalePanel,
  UndoUsagePanel,
  UseCardPanel,
  VoidCardPanel,
} from './cardDealPanels';
import type { CardDetailState, DealDetailState, ViewId, WorkSurfaceProps } from './appTypes';
import { defaultCardCriteria, defaultFeatureFlags, defaultPage } from './defaults';
import { errorMessage, formatDisplayValue, formatMoney, isBeforeToday, isWithinNextDays, statusText, viewTitle } from './display';
import { FieldError } from './formUi';
import { buildReserveSummary, reserveSummaryToTsv, type ReserveSummary } from './reserveSummary';
import {
  ChangeUnlockSecretForm,
  DataOperationsPanel,
  DataPolicyForm,
  McpTokenPanel,
  PasskeyPanel,
  RecoveryCodesPanel,
  SupportPolicyForm,
  UserAdminPanel,
} from './settingsComponents';
import {
  AuditFilterForm,
  AuditTable,
  CardSearchForm,
  CardsPagination,
  CardsTable,
  DealsTable,
  Metric,
} from './tableComponents';
import type { AuthState, Card, CardInventorySummary, CardSearchCriteria, Deal, RevealedCredentials, Usage } from '../shared/domain';

const navItems: Array<{ id: ViewId; label: string; icon: LucideIcon }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'cards', label: 'Cards', icon: CreditCard },
  { id: 'aiImport', label: 'AI Import', icon: Sparkles },
  { id: 'deals', label: 'Deals', icon: Tag },
  { id: 'backup', label: 'Backup', icon: DatabaseBackup },
  { id: 'audit', label: 'Audit Log', icon: ScrollText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const mcpDocsUrl = 'https://github.com/zengfh/gc-management/blob/feat/sota-ui-redesign/docs/mcp_server_usage.md';

const adminRoleSet = new Set(['owner', 'admin']);
const operatorRoleSet = new Set(['owner', 'admin', 'operator']);
type BulkCardAction = 'reserve' | 'unreserve' | 'use' | 'sell' | 'void';

function authRole(auth: AuthState | null | undefined): string {
  return auth?.user?.role || 'owner';
}

function canAdmin(auth: AuthState | null | undefined): boolean {
  return adminRoleSet.has(authRole(auth));
}

function canManageInventory(auth: AuthState | null | undefined): boolean {
  return operatorRoleSet.has(authRole(auth));
}

function dateInDays(days: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function unfilteredCardCriteria(): CardSearchCriteria {
  return {
    ...defaultCardCriteria,
    cardNumber: '',
    status: '',
    cardType: '',
    brand: '',
    source: '',
    dealId: '',
    dealName: '',
    expiresBefore: '',
    text: '',
    sortBy: '',
    sortDir: '',
    limit: '',
    offset: 0,
  };
}

function summarizeCards(cards: Card[]): CardInventorySummary {
  const activeCards = cards.filter((card) => ['available', 'reserved', 'in_use'].includes(card.status));
  const soldCards = cards.filter((card) => card.status === 'sold');
  const activeRemainingCents = activeCards.reduce((sum, card) => sum + card.remainingBalanceCents, 0);
  const activeCostBasisCents = activeCards.reduce((sum, card) => sum + card.purchaseCostCents, 0);
  const soldProceedsCents = soldCards.reduce((sum, card) => sum + (card.latestSalePriceCents || 0), 0);
  const soldCostBasisCents = soldCards.reduce((sum, card) => sum + card.purchaseCostCents, 0);

  return {
    activeRemainingCents,
    activeCostBasisCents,
    activeGrossMarginCents: activeRemainingCents - activeCostBasisCents,
    availableFaceCents: cards
      .filter((card) => card.status === 'available')
      .reduce((sum, card) => sum + card.faceValueCents, 0),
    reservedRemainingCents: cards
      .filter((card) => card.status === 'reserved')
      .reduce((sum, card) => sum + card.remainingBalanceCents, 0),
    inUseRemainingCents: cards
      .filter((card) => card.status === 'in_use')
      .reduce((sum, card) => sum + card.remainingBalanceCents, 0),
    soldProceedsCents,
    soldCostBasisCents,
    realizedProfitCents: soldProceedsCents - soldCostBasisCents,
    expiringSoonRemainingCents: activeCards
      .filter((card) => isWithinNextDays(card.expirationDate, 30))
      .reduce((sum, card) => sum + card.remainingBalanceCents, 0),
    prepaidRemainingCents: activeCards
      .filter((card) => card.cardType === 'prepaid')
      .reduce((sum, card) => sum + card.remainingBalanceCents, 0),
    staleReservationCount: cards.filter(
      (card) => card.status === 'reserved' && isBeforeToday(card.reservedUntil),
    ).length,
    trackedCards: cards.length,
    activeCards: activeCards.filter((card) => card.remainingBalanceCents > 0).length,
    availableCards: cards.filter((card) => card.status === 'available').length,
    reservedCards: cards.filter((card) => card.status === 'reserved').length,
    inUseCards: cards.filter((card) => card.status === 'in_use').length,
    soldCards: soldCards.length,
    usedUpCards: cards.filter((card) => card.status === 'used_up').length,
    voidCards: cards.filter((card) => card.status === 'void').length,
  };
}

function BulkCardActionPanel({
  action,
  selectedCount,
  submitting,
  error,
  message,
  onSelectAction,
  onSubmit,
  onClear,
}: {
  action: BulkCardAction | null;
  selectedCount: number;
  submitting: boolean;
  error: string;
  message: string;
  onSelectAction: (action: BulkCardAction) => void;
  onSubmit: (payload?: Record<string, unknown>) => Promise<void>;
  onClear: () => void;
}) {
  const [form, setForm] = useState({
    reservedFor: '',
    reservedUntil: '',
    reservedNotes: '',
    merchant: '',
    description: '',
    buyerName: '',
    buyerType: '',
    platform: '',
    notes: '',
    reason: '',
  });

  function updateField(field: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (action === 'reserve') {
      await onSubmit({
        reservedFor: form.reservedFor || null,
        reservedUntil: form.reservedUntil || null,
        reservedNotes: form.reservedNotes || null,
      });
      return;
    }
    if (action === 'use') {
      await onSubmit({ merchant: form.merchant || null, description: form.description || null });
      return;
    }
    if (action === 'sell') {
      await onSubmit({
        buyerName: form.buyerName || null,
        buyerType: form.buyerType || null,
        platform: form.platform || null,
        notes: form.notes || null,
      });
      return;
    }
    if (action === 'unreserve') {
      await onSubmit({});
      return;
    }
    await onSubmit({ reason: form.reason || null });
  }

  if (selectedCount === 0) {
    return message ? <p className="success-copy">{message}</p> : null;
  }

  return (
    <div className="bulk-action-panel">
      <div className="bulk-action-toolbar">
        <strong>{selectedCount} selected</strong>
        <button type="button" className="table-action" onClick={() => onSelectAction('reserve')}>Reserve</button>
        <button type="button" className="table-action" onClick={() => onSelectAction('unreserve')}>Unreserve</button>
        <button type="button" className="table-action" onClick={() => onSelectAction('use')}>Use remaining</button>
        <button type="button" className="table-action" onClick={() => onSelectAction('sell')}>Sell remaining</button>
        <button type="button" className="table-action danger" onClick={() => onSelectAction('void')}>Void</button>
        <button type="button" className="table-action" onClick={onClear}>Clear</button>
      </div>
      {action ? (
        <form className="bulk-action-form" onSubmit={submit}>
          {action === 'reserve' ? (
            <>
              <input placeholder="Reserved for" value={form.reservedFor} onChange={(event) => updateField('reservedFor', event.target.value)} />
              <input type="date" value={form.reservedUntil} onChange={(event) => updateField('reservedUntil', event.target.value)} />
              <input placeholder="Reservation notes" value={form.reservedNotes} onChange={(event) => updateField('reservedNotes', event.target.value)} />
            </>
          ) : null}
          {action === 'use' ? (
            <>
              <input placeholder="Merchant" value={form.merchant} onChange={(event) => updateField('merchant', event.target.value)} />
              <input placeholder="Description" value={form.description} onChange={(event) => updateField('description', event.target.value)} />
            </>
          ) : null}
          {action === 'sell' ? (
            <>
              <input placeholder="Buyer" value={form.buyerName} onChange={(event) => updateField('buyerName', event.target.value)} />
              <select value={form.buyerType} onChange={(event) => updateField('buyerType', event.target.value)}>
                <option value="">Buyer type</option>
                <option value="dealer">Dealer</option>
                <option value="group_chat">Group chat</option>
                <option value="friend">Friend</option>
                <option value="self">Self</option>
                <option value="other">Other</option>
              </select>
              <input placeholder="Platform" value={form.platform} onChange={(event) => updateField('platform', event.target.value)} />
              <input placeholder="Notes" value={form.notes} onChange={(event) => updateField('notes', event.target.value)} />
            </>
          ) : null}
          {action === 'void' ? (
            <input placeholder="Void reason" value={form.reason} onChange={(event) => updateField('reason', event.target.value)} />
          ) : null}
          {action === 'unreserve' ? (
            <p className="bulk-action-note">Release the selected reserved cards back to available inventory.</p>
          ) : null}
          <button type="submit" className="primary-action compact" disabled={submitting}>
            {submitting ? 'Applying...' : `Apply ${action}`}
          </button>
        </form>
      ) : null}
      <FieldError message={error} />
      {message ? <p className="success-copy">{message}</p> : null}
    </div>
  );
}

function ReservedCardsSummaryPanel({
  summary,
  copyMessage,
  copyError,
  onCopy,
  onClear,
}: {
  summary: ReserveSummary;
  copyMessage: string;
  copyError: string;
  onCopy: () => void;
  onClear: () => void;
}) {
  return (
    <section className="reserved-summary-panel" aria-labelledby="reserved-summary-title">
      <div className="reserved-summary-header">
        <div>
          <h3 id="reserved-summary-title">Reserved cards summary</h3>
          <p>These are the cards reserved by the last bulk reserve action. Copy includes brand, remaining balance, and required redemption fields only, with one card per tab-separated row.</p>
        </div>
        <div className="reserved-summary-actions">
          <button type="button" className="primary-action" onClick={onCopy}>Copy redemption info</button>
          <button type="button" className="table-action" onClick={onClear}>Dismiss</button>
        </div>
      </div>
      {copyMessage ? <p className="success-copy">{copyMessage}</p> : null}
      {copyError ? <p className="error-copy">{copyError}</p> : null}
      <div className="table-wrap reserved-summary-wrap" tabIndex={0}>
        <table className="reserved-summary-table">
          <caption>Cards reserved in the last bulk reserve action</caption>
          <thead>
            <tr>
              {summary.columns.map((column) => <th key={column.key} scope="col">{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <tr key={String(row.card.id)}>
                {summary.columns.map((column) => <td key={column.key}>{row.values[column.key] || ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function WorkSurface({
  auth,
  cards,
  cardsPage,
  cardCriteria,
  cardSummary,
  deals,
  auditEvents,
  auditLoading,
  auditError,
  backupSettings,
  backupSettingsLoading,
  backupSettingsLoaded,
  backupSettingsError,
  users,
  userInvites,
  usersLoading,
  usersLoaded,
  usersError,
  supportPolicy,
  supportPolicyLoading,
  supportPolicyLoaded,
  supportPolicyError,
  dataPolicy,
  dataPolicyLoading,
  dataPolicyLoaded,
  dataPolicyError,
  features = defaultFeatureFlags,
  referenceValues,
  loading,
  onRefresh,
  onLogout,
  onLoadAudit,
  onLoadBackupSettings,
  onLoadUsers,
  onLoadSupportPolicy,
  onLoadDataPolicy,
  onCreateInvite,
  onRevokeInvite,
  onUpdateUser,
  onUpdateSupportPolicy,
  onUpdateDataPolicy,
  onExportAccountData,
  onRunRetention,
  onSendExpirationNotificationTest,
  onDeleteAccountData,
  onUpdateBackupSettings,
  onExportPlaintext,
  onExportEncrypted,
  onExportRawDatabase,
  onPreviewCsv,
  onConfirmCsv,
  onAnalyzeAiImport,
  onLoadAiImportModels,
  onImportBackup,
  onChangeUnlockSecret,
  onGenerateRecoveryCodes,
  onLoadPasskeys,
  onRegisterPasskey,
  onDeletePasskey,
  onLoadMcpTokens,
  onCreateMcpToken,
  onRevokeMcpToken,
  onLoadReferenceValues,
  onUpsertReferenceValues,
  onCreateDeal,
  onLoadDeals,
  onEditDeal,
  onArchiveDeal,
  onUnarchiveDeal,
  onSearchCards,
  onLoadCardDetail,
  onLoadDealDetail,
  onRevealCardCredentials,
  onUpdateCardRedemptionFields,
  onBackfillRedemptionFields,
  onUseCard,
  onUndoUsage,
  onEditCard,
  onDeleteCard,
  onSellCard,
  onUndoSale,
  onVoidCard,
  onReserveCard,
  onUnreserveCard,
}: WorkSurfaceProps) {
  const [activeView, setActiveView] = useState<ViewId>('dashboard');
  const [showAddDeal, setShowAddDeal] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [editDeal, setEditDeal] = useState<Deal | null>(null);
  const [usageCard, setUsageCard] = useState<Card | null>(null);
  const [undoUsageCard, setUndoUsageCard] = useState<Card | null>(null);
  const [undoUsageCandidate, setUndoUsageCandidate] = useState<Usage | null>(null);
  const [undoUsageLoading, setUndoUsageLoading] = useState(false);
  const [undoUsageError, setUndoUsageError] = useState('');
  const [deleteCard, setDeleteCard] = useState<Card | null>(null);
  const [reserveCard, setReserveCard] = useState<Card | null>(null);
  const [saleCard, setSaleCard] = useState<Card | null>(null);
  const [undoSaleCard, setUndoSaleCard] = useState<Card | null>(null);
  const [voidCard, setVoidCard] = useState<Card | null>(null);
  const [detailState, setDetailState] = useState<CardDetailState | null>(null);
  const [dealDetailState, setDealDetailState] = useState<DealDetailState | null>(null);
  const [showArchivedDeals, setShowArchivedDeals] = useState(false);
  const [cardCredentialsVisible, setCardCredentialsVisible] = useState(false);
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<BulkCardAction | null>(null);
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkError, setBulkError] = useState('');
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [reserveSummary, setReserveSummary] = useState<ReserveSummary | null>(null);
  const [reserveSummaryCopyMessage, setReserveSummaryCopyMessage] = useState('');
  const [reserveSummaryCopyError, setReserveSummaryCopyError] = useState('');
  const [revealedCardCredentials, setRevealedCardCredentials] = useState<Record<string, RevealedCredentials>>({});
  const [revealingCardCredentials, setRevealingCardCredentials] = useState(false);
  const [cardCredentialError, setCardCredentialError] = useState('');
  const [redemptionBackfillMessage, setRedemptionBackfillMessage] = useState('');
  const [redemptionBackfillError, setRedemptionBackfillError] = useState('');
  const [redemptionBackfillRunning, setRedemptionBackfillRunning] = useState(false);
  const [dealError, setDealError] = useState('');
  const userCanAdmin = canAdmin(auth);
  const userCanManageInventory = canManageInventory(auth);
  const enabledFeatures = {
    ...defaultFeatureFlags,
    ...(features || {}),
  };
  const activeCards = cards.filter((card) => ['available', 'reserved', 'in_use'].includes(card.status));
  const dashboardSummary = cardSummary || summarizeCards(cards);
  const activeRemaining = dashboardSummary.activeRemainingCents;
  const activeCostBasis = dashboardSummary.activeCostBasisCents;
  const availableFace = dashboardSummary.availableFaceCents;
  const reservedRemaining = dashboardSummary.reservedRemainingCents;
  const inUseRemaining = dashboardSummary.inUseRemainingCents;
  const soldProceeds = dashboardSummary.soldProceedsCents;
  const activeGrossMargin = dashboardSummary.activeGrossMarginCents;
  const realizedProfit = dashboardSummary.realizedProfitCents;
  const expiringSoonCards = activeCards.filter((card) => isWithinNextDays(card.expirationDate, 30));
  const expiringSoonRemaining = dashboardSummary.expiringSoonRemainingCents;
  const prepaidCards = activeCards.filter((card) => card.cardType === 'prepaid');
  const prepaidRemaining = dashboardSummary.prepaidRemainingCents;
  const staleReservationCount = dashboardSummary.staleReservationCount;
  const selectedCards = cards.filter((card) => selectedCardIds.has(String(card.id)));
  const dashboardIsEmpty = dashboardSummary.trackedCards === 0;

  const primaryMetrics = [
    { label: 'Expiring 30d', value: formatMoney(expiringSoonRemaining), icon: AlertTriangle, onClick: () => void goToCards({ activeOnly: true, expiresBefore: dateInDays(30), sortBy: 'expirationDate', sortDir: 'asc' }) },
    { label: 'Active remaining', value: formatMoney(activeRemaining), icon: CircleDollarSign, onClick: () => void goToCards({ activeOnly: true, sortBy: 'remainingBalanceCents', sortDir: 'desc' }) },
    { label: 'Prepaid cash', value: formatMoney(prepaidRemaining), icon: CreditCard, onClick: () => void goToCards({ activeOnly: true, cardType: 'prepaid', sortBy: 'expirationDate', sortDir: 'asc' }) },
    { label: 'Reserved', value: formatMoney(reservedRemaining), icon: PackageCheck, onClick: () => void goToCards({ status: 'reserved', sortBy: 'updatedAt', sortDir: 'desc' }) },
  ];

  const secondaryMetrics = [
    { label: 'Active cost basis', value: formatMoney(activeCostBasis), icon: Tag },
    { label: 'Active gross margin', value: formatMoney(activeGrossMargin), icon: CircleDollarSign },
    { label: 'Sold proceeds', value: formatMoney(soldProceeds), icon: CircleDollarSign },
    { label: 'Realized P&L', value: formatMoney(realizedProfit), icon: CircleDollarSign },
    { label: 'Available face', value: formatMoney(availableFace), icon: PackageCheck },
    { label: 'In-use remaining', value: formatMoney(inUseRemaining), icon: CreditCard },
    { label: 'Stale reservations', value: String(staleReservationCount), icon: PackageCheck },
    { label: 'Tracked cards', value: String(dashboardSummary.trackedCards), icon: CreditCard },
  ];

  async function activateView(view: ViewId) {
    setActiveView(view);
    if (view === 'dashboard') {
      await searchCardsAndHideCredentials(unfilteredCardCriteria());
    }
    if (view === 'audit') {
      await onLoadAudit({});
    }
    if (view === 'settings') {
      if (userCanAdmin) {
        await Promise.all([
          onLoadBackupSettings(),
          onLoadUsers(),
          onLoadSupportPolicy(),
          onLoadDataPolicy(),
        ]);
      }
    }
  }

  async function toggleArchivedDeals(event: ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.checked;
    setDealError('');
    setShowArchivedDeals(nextValue);
    try {
      await onLoadDeals(nextValue);
    } catch (caught) {
      setShowArchivedDeals(!nextValue);
      setDealError(errorMessage(caught));
    }
  }

  async function archiveDeal(deal: Deal) {
    setDealError('');
    try {
      await onArchiveDeal(deal, showArchivedDeals);
    } catch (caught) {
      setDealError(errorMessage(caught));
    }
  }

  async function unarchiveDeal(deal: Deal) {
    setDealError('');
    try {
      await onUnarchiveDeal(deal, showArchivedDeals);
    } catch (caught) {
      setDealError(errorMessage(caught));
    }
  }

  async function openCardDetail(card: Card) {
    setDetailState({ card, data: null, error: '', loading: true });
    try {
      const response = await onLoadCardDetail(card.id);
      setDetailState({ card: response.data.card, data: response.data, error: '', loading: false });
    } catch (caught) {
      setDetailState({ card, data: null, error: errorMessage(caught), loading: false });
    }
  }

  async function openDealDetail(deal: Deal) {
    setDealDetailState({ deal, data: null, error: '', loading: true });
    try {
      const response = await onLoadDealDetail(deal.id);
      setDealDetailState({ deal: response.data.deal, data: response.data, error: '', loading: false });
    } catch (caught) {
      setDealDetailState({ deal, data: null, error: errorMessage(caught), loading: false });
    }
  }

  async function undoUsageFromDetail(usageId: string | number, reason: string) {
    const currentCard = detailState?.data?.card || detailState?.card;
    if (!currentCard) {
      throw new Error('Card detail is not loaded.');
    }
    const response = await onUndoUsage(currentCard.id, { usageId, reason });
    setDetailState({ card: response.data.card, data: response.data, error: '', loading: false });
    return response;
  }

  async function openUndoUsage(card: Card) {
    setUndoUsageCard(card);
    setUndoUsageCandidate(null);
    setUndoUsageError('');
    setUndoUsageLoading(true);
    try {
      const response = await onLoadCardDetail(card.id);
      const latestUsage = (response.data.usages || []).find(
        (usage) => !usage.isWriteOff && !usage.isReversed && !usage.reversedAt,
      ) || null;
      setUndoUsageCandidate(latestUsage);
      if (!latestUsage) {
        setUndoUsageError('No reversible usage was found for this card.');
      }
    } catch (caught) {
      setUndoUsageError(errorMessage(caught));
    } finally {
      setUndoUsageLoading(false);
    }
  }

  async function pageCards(offset: number) {
    setCardCredentialsVisible(false);
    setCardCredentialError('');
    await onSearchCards({
      limit: cardsPage?.limit || defaultPage.limit,
      offset,
    });
  }

  async function searchCardsAndHideCredentials(criteria: CardSearchCriteria = {}) {
    setCardCredentialsVisible(false);
    setCardCredentialError('');
    setSelectedCardIds(new Set());
    await onSearchCards(criteria);
  }

  async function sortCards(field: string) {
    const currentSortBy = String(cardCriteria.sortBy || '');
    const currentSortDir = String(cardCriteria.sortDir || '');
    if (currentSortBy !== field) {
      await searchCardsAndHideCredentials({ sortBy: field, sortDir: 'asc' });
      return;
    }
    if (currentSortDir === 'asc') {
      await searchCardsAndHideCredentials({ sortBy: field, sortDir: 'desc' });
      return;
    }
    await searchCardsAndHideCredentials({ sortBy: '', sortDir: '' });
  }

  async function goToCards(criteria: CardSearchCriteria = {}) {
    setActiveView('cards');
    const nextCriteria = {
      ...unfilteredCardCriteria(),
      ...criteria,
    };
    if (nextCriteria.status) {
      nextCriteria.activeOnly = '';
    }
    await searchCardsAndHideCredentials(nextCriteria);
  }

  function toggleCardSelected(cardId: string, checked: boolean) {
    setSelectedCardIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(cardId);
      } else {
        next.delete(cardId);
      }
      return next;
    });
  }

  function toggleAllCardsSelected(checked: boolean) {
    setSelectedCardIds(checked ? new Set(cards.map((card) => String(card.id))) : new Set());
  }


  async function revealCredentialsForReserveSummary(cardsToReveal: Card[]) {
    const revealed: Record<string, RevealedCredentials | null> = {};
    const unavailable = new Set<string>();
    for (const card of cardsToReveal) {
      const cardId = String(card.id);
      if (revealedCardCredentials[cardId]) {
        revealed[cardId] = revealedCardCredentials[cardId];
        continue;
      }
      try {
        const response = await onRevealCardCredentials(cardId);
        revealed[cardId] = response.data;
      } catch {
        revealed[cardId] = null;
        unavailable.add(cardId);
      }
    }
    const successful = Object.entries(revealed).filter((entry): entry is [string, RevealedCredentials] => Boolean(entry[1]));
    if (successful.length > 0) {
      setRevealedCardCredentials((current) => ({
        ...current,
        ...Object.fromEntries(successful),
      }));
    }
    return { revealed, unavailable };
  }

  async function copyReserveSummary() {
    if (!reserveSummary) {
      return;
    }
    setReserveSummaryCopyError('');
    setReserveSummaryCopyMessage('');
    try {
      await navigator.clipboard.writeText(reserveSummaryToTsv(reserveSummary));
      setReserveSummaryCopyMessage(`Copied ${reserveSummary.rows.length} card${reserveSummary.rows.length === 1 ? '' : 's'}.`);
    } catch (caught) {
      setReserveSummaryCopyError(errorMessage(caught));
    }
  }

  async function submitBulkAction(payload: Record<string, unknown> = {}) {
    if (!bulkAction || selectedCards.length === 0) {
      return;
    }
    setBulkError('');
    setBulkMessage('');
    setBulkSubmitting(true);
    try {
      const eligibleCards = selectedCards.filter((card) => {
        if (bulkAction === 'reserve') return card.status === 'available';
        if (bulkAction === 'unreserve') return card.status === 'reserved';
        if (bulkAction === 'use') return ['available', 'in_use'].includes(card.status) && card.remainingBalanceCents > 0;
        if (bulkAction === 'sell' || bulkAction === 'void') return ['available', 'reserved', 'in_use'].includes(card.status);
        return false;
      });
      if (eligibleCards.length === 0) {
        setBulkError('No selected cards are eligible for this action.');
        return;
      }
      const updatedReserveCards: Card[] = [];
      for (const card of eligibleCards) {
        if (bulkAction === 'reserve') {
          const response = await onReserveCard(card.id, payload);
          updatedReserveCards.push(response.data);
        } else if (bulkAction === 'unreserve') {
          await onUnreserveCard(card);
        } else if (bulkAction === 'use') {
          await onUseCard(card.id, {
            amountCents: card.remainingBalanceCents,
            merchant: payload.merchant || null,
            description: payload.description || 'Bulk use remaining balance',
          });
        } else if (bulkAction === 'sell') {
          await onSellCard(card.id, {
            salePriceCents: card.remainingBalanceCents,
            buyerName: payload.buyerName || null,
            buyerType: payload.buyerType || null,
            platform: payload.platform || null,
            notes: payload.notes || 'Bulk sale at remaining balance',
          });
        } else if (bulkAction === 'void') {
          await onVoidCard(card.id, { reason: payload.reason || 'Bulk void' });
        }
      }
      if (bulkAction === 'reserve' && updatedReserveCards.length > 0) {
        const credentials = await revealCredentialsForReserveSummary(updatedReserveCards);
        setReserveSummary(buildReserveSummary(updatedReserveCards, credentials.revealed, credentials.unavailable));
        setReserveSummaryCopyMessage('');
        setReserveSummaryCopyError('');
      } else {
        setReserveSummary(null);
      }
      setBulkMessage(`${eligibleCards.length} card${eligibleCards.length === 1 ? '' : 's'} updated.`);
      setSelectedCardIds(new Set());
      setBulkAction(null);
    } catch (caught) {
      setBulkError(errorMessage(caught));
    } finally {
      setBulkSubmitting(false);
    }
  }

  async function backfillRedemptionFields() {
    setRedemptionBackfillError('');
    setRedemptionBackfillMessage('');
    setRedemptionBackfillRunning(true);
    try {
      const response = await onBackfillRedemptionFields({ mode: 'all' });
      const { scannedCards, updatedCards, updatedFields } = response.data;
      setRedemptionBackfillMessage(
        `Backfilled ${updatedFields} field${updatedFields === 1 ? '' : 's'} on ${updatedCards} card${updatedCards === 1 ? '' : 's'} (${scannedCards} scanned).`,
      );
      setReserveSummary(null);
      setRevealedCardCredentials({});
    } catch (caught) {
      setRedemptionBackfillError(errorMessage(caught));
    } finally {
      setRedemptionBackfillRunning(false);
    }
  }

  async function toggleCardCredentialVisibility() {
    setCardCredentialError('');
    if (cardCredentialsVisible) {
      setCardCredentialsVisible(false);
      return;
    }

    if (cards.length === 0) {
      setCardCredentialsVisible(true);
      return;
    }

    setRevealingCardCredentials(true);
    try {
      const missingCards = cards.filter((card) => !revealedCardCredentials[String(card.id)]);
      const responses = await Promise.all(
        missingCards.map(async (card) => {
          const response = await onRevealCardCredentials(card.id);
          return [String(card.id), response.data] as const;
        }),
      );
      if (responses.length > 0) {
        setRevealedCardCredentials((current) => ({
          ...current,
          ...Object.fromEntries(responses),
        }));
      }
      setCardCredentialsVisible(true);
    } catch (caught) {
      setCardCredentialError(errorMessage(caught));
    } finally {
      setRevealingCardCredentials(false);
    }
  }

  return (
    <div className="product-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <ShieldCheck aria-hidden="true" size={24} />
          <span>Gift Card Manager</span>
        </div>
        <nav aria-label="Primary">
          {navItems
            .filter((item) => {
              if (item.id === 'settings') {
                return userCanAdmin;
              }
              if (item.id === 'backup') {
                return userCanManageInventory;
              }
              if (item.id === 'aiImport') {
                return userCanManageInventory;
              }
              return true;
            })
            .map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={activeView === item.id ? 'nav-item active' : 'nav-item'}
                aria-current={activeView === item.id ? 'page' : undefined}
                onClick={() => {
                  void activateView(item.id);
                }}
              >
                <Icon aria-hidden="true" size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <a
          className="nav-item nav-doc-link"
          href={mcpDocsUrl}
          target="_blank"
          rel="noreferrer"
          aria-label="Open MCP server usage documentation"
        >
          <ScrollText aria-hidden="true" size={18} />
          MCP Docs
          <ArrowUpRight aria-hidden="true" size={14} />
        </a>
        <button type="button" className="nav-item logout-button" onClick={onLogout}>
          <LogOut aria-hidden="true" size={18} />
          Logout
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local secure inventory</p>
            <h1>{viewTitle(activeView)}</h1>
            <span className="muted-text">
              {auth?.user?.displayName || 'Current user'} · {formatDisplayValue(authRole(auth))}
            </span>
          </div>
          <div className="topbar-actions">
            <ThemeSwitcher />
            <button type="button" className="secondary-action" onClick={onRefresh} title="Reload cards and deals from the server.">
              <RefreshCw aria-hidden="true" size={17} />
              Refresh
            </button>
            {userCanManageInventory ? (
              <button type="button" className="secondary-action" onClick={() => setActiveView('backup')} title="Open strict CSV import and backup import/export tools.">
                <FilePlus2 aria-hidden="true" size={17} />
                Import
              </button>
            ) : null}
            {userCanManageInventory ? (
              <button type="button" className="secondary-action" onClick={() => void activateView('aiImport')} title="Open the agent-style AI import workspace for messy gift-card text.">
                <Sparkles aria-hidden="true" size={17} />
                AI Import
              </button>
            ) : null}
            {userCanManageInventory ? (
              <button type="button" className="secondary-action" onClick={() => setShowBulkImport(true)} title="Paste loose gift-card lines or upload a simple CSV/TSV file for rule-based parsing.">
                <Upload aria-hidden="true" size={17} />
                Bulk Import
              </button>
            ) : null}
            {userCanManageInventory ? (
              <button type="button" className="primary-action compact" onClick={() => setShowAddDeal(true)} title="Create one deal and one card with guided credential fields.">
                <Plus aria-hidden="true" size={17} />
                Add Deal
              </button>
            ) : null}
          </div>
        </header>

        {loading ? <div className="loading-strip">Loading inventory...</div> : null}

        {activeView === 'dashboard' ? (
          <>
            {dashboardIsEmpty ? (
              <section className="dashboard-onboarding" aria-labelledby="dashboard-onboarding-title">
                <div>
                  <p className="eyebrow">First run</p>
                  <h2 id="dashboard-onboarding-title">Start your secure inventory</h2>
                  <p>
                    Add one card manually, import a batch, or review backup settings before storing real balances.
                  </p>
                </div>
                <div className="dashboard-onboarding-actions">
                  {userCanManageInventory ? (
                    <button type="button" className="primary-action compact" onClick={() => setShowAddDeal(true)}>
                      <Plus aria-hidden="true" size={17} />
                      Add first deal
                    </button>
                  ) : null}
                  {userCanManageInventory ? (
                    <button type="button" className="secondary-action" onClick={() => setShowBulkImport(true)}>
                      <Upload aria-hidden="true" size={17} />
                      Bulk import cards
                    </button>
                  ) : null}
                  {userCanManageInventory ? (
                    <button type="button" className="secondary-action" onClick={() => setActiveView('backup')}>
                      <DatabaseBackup aria-hidden="true" size={17} />
                      Set up backup
                    </button>
                  ) : null}
                </div>
              </section>
            ) : null}
            <section className="metrics-grid metrics-grid-primary" aria-label="Priority inventory summary">
              {primaryMetrics.map((metric) => (
                <Metric key={metric.label} {...metric} />
              ))}
            </section>
            <section className="metrics-grid metrics-grid-secondary" aria-label="Secondary inventory summary">
              {secondaryMetrics.map((metric) => (
                <Metric key={metric.label} {...metric} />
              ))}
            </section>
            <section className="content-section">
              <div className="section-heading">
                <h2>Alerts</h2>
                <button type="button" onClick={() => void goToCards({ activeOnly: true, expiresBefore: dateInDays(30), sortBy: 'expirationDate', sortDir: 'asc' })}>
                  View expiring
                  <ArrowUpRight aria-hidden="true" size={15} />
                </button>
              </div>
              <div className="dashboard-feed">
                {expiringSoonCards.slice(0, 5).map((card) => (
                  <button
                    type="button"
                    className="feed-item alert-feed-item"
                    key={card.id}
                    aria-label={`Open ${card.brand} details`}
                    onClick={() => openCardDetail(card)}
                  >
                    <AlertTriangle aria-hidden="true" size={17} />
                    <span>
                      <strong>{card.brand}</strong>
                      <small>{formatMoney(card.remainingBalanceCents)} expires {card.expirationDate}</small>
                    </span>
                  </button>
                ))}
                {expiringSoonCards.length === 0 ? <p className="muted-text">No active cards expiring in the next 30 days.</p> : null}
              </div>
            </section>
            <section className="content-section">
              <div className="section-heading">
                <h2>Recent Activity</h2>
                <button type="button" aria-label="Open audit log" onClick={() => void activateView('audit')}>
                  Audit log
                  <ArrowUpRight aria-hidden="true" size={15} />
                </button>
              </div>
              <div className="dashboard-feed">
                {[...cards]
                  .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
                  .slice(0, 6)
                  .map((card) => (
                    <button
                      type="button"
                      className="feed-item"
                      key={card.id}
                      aria-label={`Open ${card.brand} details`}
                      onClick={() => openCardDetail(card)}
                    >
                      <Bell aria-hidden="true" size={17} />
                      <span>
                        <strong>{card.brand}</strong>
                        <small>{statusText(card.status)} · {formatMoney(card.remainingBalanceCents)} remaining</small>
                      </span>
                    </button>
                  ))}
                {cards.length === 0 ? <p className="muted-text">No card activity yet.</p> : null}
              </div>
            </section>
          </>
        ) : null}

        {activeView === 'cards' ? (
          <section className="content-section">
            <div className="section-heading">
              <h2>Card Inventory</h2>
              <div className="section-heading-actions">
                <span>{cards.length} records</span>
                {userCanManageInventory ? (
                  <>
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => void backfillRedemptionFields()}
                      disabled={redemptionBackfillRunning}
                      title="Reset reservation-copy fields to safe defaults for existing cards."
                    >
                      {redemptionBackfillRunning ? 'Backfilling...' : 'Backfill redemption fields'}
                    </button>
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={toggleCardCredentialVisibility}
                      disabled={revealingCardCredentials}
                      title="Show or hide full card credentials for the currently loaded table page."
                    >
                      {cardCredentialsVisible ? <EyeOff aria-hidden="true" size={17} /> : <Eye aria-hidden="true" size={17} />}
                      {cardCredentialsVisible ? 'Hide card codes' : revealingCardCredentials ? 'Revealing...' : 'Show card codes'}
                    </button>
                  </>
                ) : null}
              </div>
            </div>
            {cardCredentialError ? <FieldError message={cardCredentialError} /> : null}
            {redemptionBackfillError ? <FieldError message={redemptionBackfillError} /> : null}
            {redemptionBackfillMessage ? <p className="success-copy">{redemptionBackfillMessage}</p> : null}
            <CardSearchForm
              key={JSON.stringify(cardCriteria)}
              deals={deals}
              cards={cards}
              referenceValues={referenceValues}
              onSearchCards={searchCardsAndHideCredentials}
              initialCriteria={cardCriteria}
            />
            {prepaidCards.length > 0 ? (
              <section className="prepaid-focus">
                <div className="section-heading">
                  <h3>Prepaid cash cards</h3>
                  <button type="button" onClick={() => void goToCards({ activeOnly: true, cardType: 'prepaid', sortBy: 'expirationDate', sortDir: 'asc' })}>
                    View prepaid only
                    <ArrowUpRight aria-hidden="true" size={15} />
                  </button>
                </div>
                <p>{prepaidCards.length} active prepaid cards · {formatMoney(prepaidRemaining)} remaining</p>
              </section>
            ) : null}
            {userCanManageInventory ? (
              <BulkCardActionPanel
                action={bulkAction}
                selectedCount={selectedCards.length}
                submitting={bulkSubmitting}
                error={bulkError}
                message={bulkMessage}
                onSelectAction={setBulkAction}
                onSubmit={submitBulkAction}
                onClear={() => {
                  setSelectedCardIds(new Set());
                  setBulkAction(null);
                  setBulkError('');
                }}
              />
            ) : null}
            {reserveSummary ? (
              <ReservedCardsSummaryPanel
                summary={reserveSummary}
                copyMessage={reserveSummaryCopyMessage}
                copyError={reserveSummaryCopyError}
                onCopy={() => void copyReserveSummary()}
                onClear={() => setReserveSummary(null)}
              />
            ) : null}
            <CardsTable
              cards={cards}
              canManage={userCanManageInventory}
              sortBy={String(cardCriteria.sortBy || '')}
              sortDir={String(cardCriteria.sortDir || '')}
              credentialsVisible={cardCredentialsVisible}
              revealedCredentialsByCardId={revealedCardCredentials}
              onSortCards={(field) => void sortCards(field)}
              {...(userCanManageInventory
                ? {
                    selectedCardIds,
                    onToggleCardSelected: toggleCardSelected,
                    onToggleAllCardsSelected: toggleAllCardsSelected,
                  }
                : {})}
              onUseCard={setUsageCard}
              onViewCard={openCardDetail}
              onDeleteCard={setDeleteCard}
              onSellCard={setSaleCard}
              onUndoSale={setUndoSaleCard}
              onUndoUsage={(card) => void openUndoUsage(card)}
              onVoidCard={setVoidCard}
              onReserveCard={setReserveCard}
              onUnreserveCard={onUnreserveCard}
            />
            <CardsPagination page={cardsPage} currentCount={cards.length} onPageCards={pageCards} />
          </section>
        ) : null}

        {activeView === 'aiImport' ? (
          <AIImportWorkspace
            onCreateDeal={async (payload) => {
              await onCreateDeal(payload);
              setActiveView('dashboard');
            }}
            onAnalyzeAiImport={onAnalyzeAiImport}
            onLoadAiImportModels={onLoadAiImportModels}
            referenceValues={referenceValues}
            onLoadReferenceValues={onLoadReferenceValues}
            onUpsertReferenceValues={onUpsertReferenceValues}
            features={enabledFeatures}
          />
        ) : null}

        {activeView === 'deals' ? (
          <section className="content-section">
            <div className="section-heading">
              <h2>Deal Groups</h2>
              <span>{deals.length} records</span>
            </div>
            <div className="deal-controls">
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={showArchivedDeals}
                  onChange={toggleArchivedDeals}
                />
                <span>Show archived</span>
              </label>
              <FieldError message={dealError} />
            </div>
            <DealsTable
              deals={deals}
              canManage={userCanManageInventory}
              onViewDeal={openDealDetail}
              onEditDeal={setEditDeal}
              onArchiveDeal={archiveDeal}
              onUnarchiveDeal={unarchiveDeal}
            />
          </section>
        ) : null}

        {activeView === 'audit' ? (
          <section className="content-section">
            <div className="section-heading">
              <h2>Audit Log</h2>
              <span>{auditEvents.length} records</span>
            </div>
            <AuditFilterForm onLoadAudit={onLoadAudit} />
            {auditLoading ? <div className="loading-strip inline-loading">Loading audit log...</div> : null}
            <FieldError message={auditError} />
            <AuditTable events={auditEvents} />
          </section>
        ) : null}

        {activeView === 'backup' ? (
          <section className="content-section">
            <div className="section-heading">
              <h2>Backup and Export</h2>
              <span>{cards.length} cards tracked</span>
            </div>
            <div className="backup-stack">
              {enabledFeatures.csvImport ? (
                <section className="backup-block">
                  <h3>CSV Import Preview</h3>
                  <CsvImportPreviewForm onPreviewCsv={onPreviewCsv} onConfirmCsv={onConfirmCsv} />
                </section>
              ) : null}
              {userCanAdmin ? (
                <>
                  <section className="backup-block">
                    <h3>Plaintext JSON Import</h3>
                    <PlaintextJsonImportForm onImportBackup={onImportBackup} />
                  </section>
                  <section className="backup-block">
                    <h3>Encrypted JSON Import</h3>
                    <EncryptedJsonImportForm onImportBackup={onImportBackup} />
                  </section>
                  <section className="backup-block">
                    <h3>Encrypted JSON Export</h3>
                    <EncryptedBackupExportForm onExportEncrypted={onExportEncrypted} />
                  </section>
                  {enabledFeatures.plaintextJsonExport ? (
                    <section className="backup-block">
                      <h3>Plaintext JSON Export</h3>
                      <BackupExportForm onExportPlaintext={onExportPlaintext} />
                    </section>
                  ) : null}
                  {enabledFeatures.rawDatabaseExport ? (
                    <section className="backup-block">
                      <h3>Raw Encrypted Database Export</h3>
                      <RawDatabaseExportForm onExportRawDatabase={onExportRawDatabase} />
                    </section>
                  ) : null}
                </>
              ) : null}
            </div>
          </section>
        ) : null}

        {activeView === 'settings' ? (
          <section className="content-section">
            <div className="section-heading">
              <h2>Security Settings</h2>
              <span>Local vault</span>
            </div>
            <div className="settings-stack">
              <section className="backup-block">
                <h3>Backup Settings</h3>
                {backupSettingsLoading ? (
                  <div className="loading-strip inline-loading">Loading backup settings...</div>
                ) : null}
                <FieldError message={backupSettingsError} />
                {backupSettingsLoaded ? (
                  <BackupSettingsForm
                    settings={backupSettings}
                    onUpdateBackupSettings={onUpdateBackupSettings}
                  />
                ) : null}
              </section>
              <section className="backup-block">
                <h3>User Access</h3>
                <UserAdminPanel
                  users={users}
                  invites={userInvites}
                  loading={usersLoading}
                  loaded={usersLoaded}
                  error={usersError}
                  onCreateInvite={onCreateInvite}
                  onRevokeInvite={onRevokeInvite}
                  onUpdateUser={onUpdateUser}
                />
              </section>
              <section className="backup-block">
                <h3>Recovery Codes</h3>
                <RecoveryCodesPanel
                  activeCount={auth?.recoveryCodes?.activeCount}
                  onGenerateRecoveryCodes={onGenerateRecoveryCodes}
                />
              </section>
              <section className="backup-block">
                <h3>Support Policy</h3>
                {supportPolicyLoading ? (
                  <div className="loading-strip inline-loading">Loading support policy...</div>
                ) : null}
                <FieldError message={supportPolicyError} />
                {supportPolicyLoaded ? (
                  <SupportPolicyForm
                    policy={supportPolicy}
                    onUpdateSupportPolicy={onUpdateSupportPolicy}
                  />
                ) : null}
              </section>
              <section className="backup-block">
                <h3>Data Policy</h3>
                {dataPolicyLoading ? (
                  <div className="loading-strip inline-loading">Loading data policy...</div>
                ) : null}
                <FieldError message={dataPolicyError} />
                {dataPolicyLoaded ? (
                  <DataPolicyForm
                    policy={dataPolicy}
                    onUpdateDataPolicy={onUpdateDataPolicy}
                  />
                ) : null}
              </section>
              <section className="backup-block">
                <h3>Data Operations</h3>
                <DataOperationsPanel
                  onExportAccountData={onExportAccountData}
                  onRunRetention={onRunRetention}
                  onSendExpirationNotificationTest={onSendExpirationNotificationTest}
                  onDeleteAccountData={onDeleteAccountData}
                />
              </section>
              <section className="backup-block">
                <h3>Unlock Secret</h3>
                <ChangeUnlockSecretForm onChangeUnlockSecret={onChangeUnlockSecret} />
              </section>
              <section className="backup-block">
                <h3>Passkeys</h3>
                <PasskeyPanel
                  passkeyCount={auth.passkeys?.count}
                  onLoadPasskeys={onLoadPasskeys}
                  onRegisterPasskey={onRegisterPasskey}
                  onDeletePasskey={onDeletePasskey}
                />
              </section>
              <section className="backup-block">
                <h3>MCP Agent Access</h3>
                <McpTokenPanel
                  onLoadMcpTokens={onLoadMcpTokens}
                  onCreateMcpToken={onCreateMcpToken}
                  onRevokeMcpToken={onRevokeMcpToken}
                />
              </section>
            </div>
          </section>
        ) : null}
      </main>
      {showAddDeal ? (
        <AddDealPanel
          onClose={() => setShowAddDeal(false)}
          onCreateDeal={async (payload) => {
            await onCreateDeal(payload);
            setActiveView('dashboard');
          }}
          referenceValues={referenceValues}
          onLoadReferenceValues={onLoadReferenceValues}
          onUpsertReferenceValues={onUpsertReferenceValues}
          referenceValueHintsEnabled={enabledFeatures.referenceValueHints}
          features={enabledFeatures}
        />
      ) : null}
      {showBulkImport ? (
        <BulkImportPanel
          onClose={() => setShowBulkImport(false)}
          onCreateDeal={async (payload) => {
            await onCreateDeal(payload);
            setActiveView('dashboard');
          }}
          onAnalyzeAiImport={onAnalyzeAiImport}
          onLoadAiImportModels={onLoadAiImportModels}
          referenceValues={referenceValues}
          onLoadReferenceValues={onLoadReferenceValues}
          onUpsertReferenceValues={onUpsertReferenceValues}
          features={enabledFeatures}
        />
      ) : null}
      {editDeal ? (
        <EditDealPanel
          deal={editDeal}
          onClose={() => setEditDeal(null)}
          onEditDeal={onEditDeal}
        />
      ) : null}
      {usageCard ? (
        <UseCardPanel
          card={usageCard}
          onClose={() => setUsageCard(null)}
          onUseCard={onUseCard}
          onUndoUsage={onUndoUsage}
        />
      ) : null}
      {undoUsageCard ? (
        <UndoUsagePanel
          card={undoUsageCard}
          usage={undoUsageCandidate}
          loading={undoUsageLoading}
          error={undoUsageError}
          onClose={() => {
            setUndoUsageCard(null);
            setUndoUsageCandidate(null);
            setUndoUsageError('');
          }}
          onUndoUsage={onUndoUsage}
        />
      ) : null}
      {deleteCard ? (
        <DeleteCardPanel
          card={deleteCard}
          onClose={() => setDeleteCard(null)}
          onDeleteCard={onDeleteCard}
        />
      ) : null}
      {reserveCard ? (
        <ReserveCardPanel
          card={reserveCard}
          onClose={() => setReserveCard(null)}
          onReserveCard={onReserveCard}
        />
      ) : null}
      {saleCard ? (
        <SellCardPanel
          card={saleCard}
          onClose={() => setSaleCard(null)}
          onSellCard={onSellCard}
        />
      ) : null}
      {undoSaleCard ? (
        <UndoSalePanel
          card={undoSaleCard}
          onClose={() => setUndoSaleCard(null)}
          onUndoSale={onUndoSale}
        />
      ) : null}
      {voidCard ? (
        <VoidCardPanel
          card={voidCard}
          onClose={() => setVoidCard(null)}
          onVoidCard={onVoidCard}
        />
      ) : null}
      {detailState ? (
        <CardDetailPanel
          key={detailState.card.id}
          detailState={detailState}
          canManage={userCanManageInventory}
          onClose={() => setDetailState(null)}
          onLogout={onLogout}
          onEditCard={onEditCard}
          onUndoUsage={undoUsageFromDetail}
          onRevealCredentials={onRevealCardCredentials}
          onUpdateRedemptionFields={onUpdateCardRedemptionFields}
        />
      ) : null}
      {dealDetailState ? (
        <DealDetailPanel detailState={dealDetailState} onClose={() => setDealDetailState(null)} />
      ) : null}
    </div>
  );
}
