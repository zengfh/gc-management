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
import { defaultFeatureFlags, defaultPage } from './defaults';
import { errorMessage, formatDisplayValue, formatMoney, isBeforeToday, isWithinNextDays, statusText, viewTitle } from './display';
import { FieldError } from './formUi';
import {
  ChangeUnlockSecretForm,
  DataOperationsPanel,
  DataPolicyForm,
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
import type { AuthState, Card, CardSearchCriteria, Deal, RevealedCredentials, Usage } from '../shared/domain';

const navItems: Array<{ id: ViewId; label: string; icon: LucideIcon }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'cards', label: 'Cards', icon: CreditCard },
  { id: 'aiImport', label: 'AI Import', icon: Sparkles },
  { id: 'deals', label: 'Deals', icon: Tag },
  { id: 'backup', label: 'Backup', icon: DatabaseBackup },
  { id: 'audit', label: 'Audit Log', icon: ScrollText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const adminRoleSet = new Set(['owner', 'admin']);
const operatorRoleSet = new Set(['owner', 'admin', 'operator']);

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
    cardNumber: '',
    status: '',
    cardType: '',
    activeOnly: '',
    brand: '',
    source: '',
    dealId: '',
    expiresBefore: '',
    text: '',
    sortBy: '',
    sortDir: '',
    limit: '',
    offset: 0,
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
  action: 'reserve' | 'use' | 'sell' | 'void' | null;
  selectedCount: number;
  submitting: boolean;
  error: string;
  message: string;
  onSelectAction: (action: 'reserve' | 'use' | 'sell' | 'void') => void;
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

export function WorkSurface({
  auth,
  cards,
  cardsPage,
  cardCriteria,
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
  const [bulkAction, setBulkAction] = useState<'reserve' | 'use' | 'sell' | 'void' | null>(null);
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkError, setBulkError] = useState('');
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [revealedCardCredentials, setRevealedCardCredentials] = useState<Record<string, RevealedCredentials>>({});
  const [revealingCardCredentials, setRevealingCardCredentials] = useState(false);
  const [cardCredentialError, setCardCredentialError] = useState('');
  const [dealError, setDealError] = useState('');
  const userCanAdmin = canAdmin(auth);
  const userCanManageInventory = canManageInventory(auth);
  const enabledFeatures = {
    ...defaultFeatureFlags,
    ...(features || {}),
  };
  const activeCards = cards.filter((card) => ['available', 'reserved', 'in_use'].includes(card.status));
  const soldCards = cards.filter((card) => card.status === 'sold');
  const activeRemaining = activeCards.reduce((sum, card) => sum + card.remainingBalanceCents, 0);
  const activeCostBasis = activeCards.reduce((sum, card) => sum + card.purchaseCostCents, 0);
  const availableFace = cards
    .filter((card) => card.status === 'available')
    .reduce((sum, card) => sum + card.faceValueCents, 0);
  const reservedRemaining = cards
    .filter((card) => card.status === 'reserved')
    .reduce((sum, card) => sum + card.remainingBalanceCents, 0);
  const inUseRemaining = cards
    .filter((card) => card.status === 'in_use')
    .reduce((sum, card) => sum + card.remainingBalanceCents, 0);
  const soldProceeds = soldCards.reduce((sum, card) => sum + (card.latestSalePriceCents || 0), 0);
  const soldCostBasis = soldCards.reduce((sum, card) => sum + card.purchaseCostCents, 0);
  const activeGrossMargin = activeRemaining - activeCostBasis;
  const realizedProfit = soldProceeds - soldCostBasis;
  const expiringSoonCards = activeCards.filter((card) => isWithinNextDays(card.expirationDate, 30));
  const expiringSoonRemaining = expiringSoonCards.reduce((sum, card) => sum + card.remainingBalanceCents, 0);
  const prepaidCards = activeCards.filter((card) => card.cardType === 'prepaid');
  const prepaidRemaining = prepaidCards.reduce((sum, card) => sum + card.remainingBalanceCents, 0);
  const staleReservationCount = cards.filter(
    (card) => card.status === 'reserved' && isBeforeToday(card.reservedUntil),
  ).length;
  const selectedCards = cards.filter((card) => selectedCardIds.has(String(card.id)));

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
    { label: 'Tracked cards', value: String(cards.length), icon: CreditCard },
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
    await searchCardsAndHideCredentials(criteria);
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
        if (bulkAction === 'use') return ['available', 'in_use'].includes(card.status) && card.remainingBalanceCents > 0;
        if (bulkAction === 'sell' || bulkAction === 'void') return ['available', 'reserved', 'in_use'].includes(card.status);
        return false;
      });
      if (eligibleCards.length === 0) {
        setBulkError('No selected cards are eligible for this action.');
        return;
      }
      for (const card of eligibleCards) {
        if (bulkAction === 'reserve') {
          await onReserveCard(card.id, payload);
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
      setBulkMessage(`${eligibleCards.length} card${eligibleCards.length === 1 ? '' : 's'} updated.`);
      setSelectedCardIds(new Set());
      setBulkAction(null);
    } catch (caught) {
      setBulkError(errorMessage(caught));
    } finally {
      setBulkSubmitting(false);
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
                ) : null}
              </div>
            </div>
            {cardCredentialError ? <FieldError message={cardCredentialError} /> : null}
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
        />
      ) : null}
      {dealDetailState ? (
        <DealDetailPanel detailState={dealDetailState} onClose={() => setDealDetailState(null)} />
      ) : null}
    </div>
  );
}
