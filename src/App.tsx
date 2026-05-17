import { useEffect, useMemo, useState } from 'react';
import type {
  ChangeEvent,
  FormEvent,
} from 'react';
import {
  CircleDollarSign,
  CreditCard,
  DatabaseBackup,
  FilePlus2,
  LayoutDashboard,
  Lock,
  LogOut,
  PackageCheck,
  Plus,
  RefreshCw,
  ScrollText,
  Settings,
  ShieldCheck,
  Tag,
  type LucideIcon,
} from 'lucide-react';
import { apiDownload, apiFetch } from './api';
import { AddDealPanel } from './AddDealPanel';
import {
  AuditFilterForm,
  AuditTable,
  CardSearchForm,
  CardsPagination,
  CardsTable,
  DealsTable,
  Metric,
} from './tableComponents';
import {
  BackupExportForm,
  BackupSettingsForm,
  CsvImportPreviewForm,
  EncryptedBackupExportForm,
  EncryptedJsonImportForm,
  PlaintextJsonImportForm,
  RawDatabaseExportForm,
} from './backupComponents';
import {
  defaultBackupSettings,
  defaultDataPolicy,
  defaultFeatureFlags,
  defaultPage,
  defaultSupportPolicy,
} from './defaults';
import {
  ChangeUnlockSecretForm,
  DataOperationsPanel,
  DataPolicyForm,
  RecoveryCodesPanel,
  SupportPolicyForm,
  UserAdminPanel,
} from './settingsComponents';
import type {
  ApiPayload,
  AsyncApiHandler,
  CardDetailState,
  CardMutationResult,
  CardSalePayload,
  CountSummary,
  CsvImportResult,
  CsvPreviewPayload,
  DealDetailState,
  DealMutationResult,
  ImportSummary,
  PortableExportPayload,
  ViewId,
  WorkSurfaceProps,
} from './appTypes';
import {
  CardDetailPanel,
  DealDetailPanel,
  DeleteCardPanel,
  EditCardPanel,
  EditDealPanel,
  ReserveCardPanel,
  SellCardPanel,
  UndoSalePanel,
  UseCardPanel,
  VoidCardPanel,
} from './cardDealPanels';
import {
  criteriaValue,
  errorMessage,
  formatDisplayValue,
  formatMoney,
  isBeforeToday,
  isWithinNextDays,
  viewTitle,
} from './display';
import { FieldError } from './formUi';
import {
  defaultReferenceValues,
  mergeReferenceValueState,
  normalizeReferenceValuePayload,
} from './referenceValues';
import type {
  AuditCriteria,
  AuditEvent,
  ApiResponse,
  AuthState,
  BackupSettings,
  Card,
  CardDetail,
  CardSearchCriteria,
  DataPolicy,
  Deal,
  DealDetail,
  FeatureFlags,
  Page,
  ReferenceValue,
  ReferenceValueState,
  RevealedCredentials,
  SupportPolicy,
  UserInvite,
  AuthUser,
} from '../shared/domain';

const navItems: Array<{ id: ViewId; label: string; icon: LucideIcon }> = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'cards', label: 'Cards', icon: CreditCard },
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

function authFeatures(auth: AuthState | null | undefined): FeatureFlags {
  return {
    ...defaultFeatureFlags,
    ...(auth?.features || {}),
  };
}

function SetupScreen({ onSetup }: { onSetup: AsyncApiHandler<{ email: string; displayName: string; unlockSecret: string }> }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('Owner');
  const [unlockSecret, setUnlockSecret] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (unlockSecret !== confirmation) {
      setError('Unlock secrets do not match.');
      return;
    }

    if (!acknowledged) {
      setError('Acknowledge the recovery warning before creating the vault.');
      return;
    }

    setSubmitting(true);
    try {
      await onSetup({ email: email.trim(), displayName: displayName.trim(), unlockSecret });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-panel" aria-labelledby="setup-title">
        <div className="auth-mark">
          <ShieldCheck aria-hidden="true" size={28} />
        </div>
        <p className="eyebrow">First run setup</p>
          <h1 id="setup-title">Create unlock secret</h1>
        <p className="auth-copy">
          This passphrase protects encrypted card credentials. Store it safely; losing it can make
          encrypted card data inaccessible.
        </p>
        <form className="auth-form" onSubmit={submitSetup}>
          <label>
            <span>Owner email</span>
            <input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </label>
          <label>
            <span>Display name</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              required
            />
          </label>
          <label>
            <span>Unlock secret</span>
            <input
              type="password"
              autoComplete="new-password"
              value={unlockSecret}
              onChange={(event) => setUnlockSecret(event.target.value)}
              required
            />
          </label>
          <label>
            <span>Confirm unlock secret</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              required
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.target.checked)}
            />
            <span>I understand this secret is required to unlock encrypted card data.</span>
          </label>
          <FieldError message={error} />
          <button type="submit" className="primary-action" disabled={submitting}>
            <Lock aria-hidden="true" size={18} />
            {submitting ? 'Creating vault...' : 'Create secure vault'}
          </button>
        </form>
      </section>
    </main>
  );
}

function UnlockScreen({
  onLogin,
  onAcceptInvite,
  onRecoverAccess,
}: {
  onLogin: AsyncApiHandler<{ email: string; unlockSecret: string }>;
  onAcceptInvite: AsyncApiHandler<{ email: string; inviteCode: string; unlockSecret: string }>;
  onRecoverAccess: AsyncApiHandler<{ email: string; recoveryCode: string; newUnlockSecret: string }>;
}) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [unlockSecret, setUnlockSecret] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [inviteUnlockSecret, setInviteUnlockSecret] = useState('');
  const [inviteConfirmation, setInviteConfirmation] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryUnlockSecret, setRecoveryUnlockSecret] = useState('');
  const [recoveryConfirmation, setRecoveryConfirmation] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onLogin({ email: email.trim(), unlockSecret });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (inviteUnlockSecret !== inviteConfirmation) {
      setError('Unlock secrets do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await onAcceptInvite({
        email: inviteEmail.trim(),
        inviteCode,
        unlockSecret: inviteUnlockSecret,
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (recoveryUnlockSecret !== recoveryConfirmation) {
      setError('Unlock secrets do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await onRecoverAccess({
        email: recoveryEmail.trim(),
        recoveryCode,
        newUnlockSecret: recoveryUnlockSecret,
      });
      setRecoveryCode('');
      setRecoveryUnlockSecret('');
      setRecoveryConfirmation('');
      setSuccess('Unlock secret reset. Sign in with the new unlock secret.');
      setMode('login');
      setEmail(recoveryEmail.trim());
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-panel" aria-labelledby="unlock-title">
        <div className="auth-mark">
          <Lock aria-hidden="true" size={28} />
        </div>
        <p className="eyebrow">Encrypted data locked</p>
        <h1 id="unlock-title">Unlock card data</h1>
        <p className="auth-copy">
          Enter your unlock secret to load the encryption key into memory for this session.
        </p>
        <div className="auth-mode-switch" role="tablist" aria-label="Access method">
          <button
            type="button"
            aria-label="Show unlock form"
            className={mode === 'login' ? 'active' : ''}
            onClick={() => setMode('login')}
          >
            Unlock
          </button>
          <button
            type="button"
            aria-label="Show invite form"
            className={mode === 'invite' ? 'active' : ''}
            onClick={() => setMode('invite')}
          >
            Accept invite
          </button>
          <button
            type="button"
            aria-label="Show recovery form"
            className={mode === 'recover' ? 'active' : ''}
            onClick={() => setMode('recover')}
          >
            Recover
          </button>
        </div>
        {mode === 'login' ? (
          <form className="auth-form" onSubmit={submitLogin}>
            <label>
              <span>Email</span>
              <input
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              <span>Unlock secret</span>
              <input
                type="password"
                autoComplete="current-password"
                value={unlockSecret}
                onChange={(event) => setUnlockSecret(event.target.value)}
                required
              />
            </label>
            <FieldError message={error} />
            {success ? <p className="success-copy">{success}</p> : null}
            <button type="submit" className="primary-action" disabled={submitting}>
              <Lock aria-hidden="true" size={18} />
              {submitting ? 'Unlocking...' : 'Unlock'}
            </button>
          </form>
        ) : null}
        {mode === 'invite' ? (
          <form className="auth-form" onSubmit={submitInvite}>
            <label>
              <span>Email</span>
              <input
                type="email"
                autoComplete="username"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Invite code</span>
              <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} required />
            </label>
            <label>
              <span>New unlock secret</span>
              <input
                type="password"
                autoComplete="new-password"
                value={inviteUnlockSecret}
                onChange={(event) => setInviteUnlockSecret(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Confirm unlock secret</span>
              <input
                type="password"
                autoComplete="new-password"
                value={inviteConfirmation}
                onChange={(event) => setInviteConfirmation(event.target.value)}
                required
              />
            </label>
            <FieldError message={error} />
            <button type="submit" className="primary-action" disabled={submitting}>
              <ShieldCheck aria-hidden="true" size={18} />
              {submitting ? 'Accepting...' : 'Accept invite'}
            </button>
          </form>
        ) : null}
        {mode === 'recover' ? (
          <form className="auth-form" onSubmit={submitRecovery}>
            <label>
              <span>Email</span>
              <input
                type="email"
                autoComplete="username"
                value={recoveryEmail}
                onChange={(event) => setRecoveryEmail(event.target.value)}
              />
            </label>
            <label>
              <span>Recovery code</span>
              <input value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} required />
            </label>
            <label>
              <span>New unlock secret</span>
              <input
                type="password"
                autoComplete="new-password"
                value={recoveryUnlockSecret}
                onChange={(event) => setRecoveryUnlockSecret(event.target.value)}
                required
              />
            </label>
            <label>
              <span>Confirm unlock secret</span>
              <input
                type="password"
                autoComplete="new-password"
                value={recoveryConfirmation}
                onChange={(event) => setRecoveryConfirmation(event.target.value)}
                required
              />
            </label>
            <FieldError message={error} />
            <button type="submit" className="primary-action" disabled={submitting}>
              <RefreshCw aria-hidden="true" size={18} />
              {submitting ? 'Resetting...' : 'Reset unlock secret'}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}

function WorkSurface({
  auth,
  cards,
  cardsPage,
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
  onDeleteAccountData,
  onUpdateBackupSettings,
  onExportPlaintext,
  onExportEncrypted,
  onExportRawDatabase,
  onPreviewCsv,
  onConfirmCsv,
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
  const [editDeal, setEditDeal] = useState<Deal | null>(null);
  const [usageCard, setUsageCard] = useState<Card | null>(null);
  const [editCard, setEditCard] = useState<Card | null>(null);
  const [deleteCard, setDeleteCard] = useState<Card | null>(null);
  const [reserveCard, setReserveCard] = useState<Card | null>(null);
  const [saleCard, setSaleCard] = useState<Card | null>(null);
  const [undoSaleCard, setUndoSaleCard] = useState<Card | null>(null);
  const [voidCard, setVoidCard] = useState<Card | null>(null);
  const [detailState, setDetailState] = useState<CardDetailState | null>(null);
  const [dealDetailState, setDealDetailState] = useState<DealDetailState | null>(null);
  const [showArchivedDeals, setShowArchivedDeals] = useState(false);
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
  const staleReservationCount = cards.filter(
    (card) => card.status === 'reserved' && isBeforeToday(card.reservedUntil),
  ).length;

  const summaryCards = useMemo(
    () => [
      { label: 'Active remaining', value: formatMoney(activeRemaining), icon: CircleDollarSign },
      { label: 'Active cost basis', value: formatMoney(activeCostBasis), icon: Tag },
      { label: 'Active gross margin', value: formatMoney(activeGrossMargin), icon: CircleDollarSign },
      { label: 'Sold proceeds', value: formatMoney(soldProceeds), icon: CircleDollarSign },
      { label: 'Realized P&L', value: formatMoney(realizedProfit), icon: CircleDollarSign },
      { label: 'Available face', value: formatMoney(availableFace), icon: PackageCheck },
      { label: 'Reserved remaining', value: formatMoney(reservedRemaining), icon: PackageCheck },
      { label: 'In-use remaining', value: formatMoney(inUseRemaining), icon: CreditCard },
      { label: 'Expiring 30d', value: formatMoney(expiringSoonRemaining), icon: CreditCard },
      { label: 'Stale reservations', value: String(staleReservationCount), icon: PackageCheck },
      { label: 'Tracked cards', value: String(cards.length), icon: CreditCard },
    ],
    [
      activeRemaining,
      activeCostBasis,
      activeGrossMargin,
      soldProceeds,
      realizedProfit,
      availableFace,
      reservedRemaining,
      inUseRemaining,
      expiringSoonRemaining,
      staleReservationCount,
      cards.length,
    ],
  );

  async function activateView(view: ViewId) {
    setActiveView(view);
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
    const cardId = (detailState?.data?.card || detailState?.card)?.id;
    const response = await onUndoUsage(cardId, { usageId, reason });
    setDetailState({ card: response.data.card, data: response.data, error: '', loading: false });
    return response;
  }

  async function pageCards(offset: number) {
    await onSearchCards({
      limit: cardsPage?.limit || defaultPage.limit,
      offset,
    });
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
            <button type="button" className="secondary-action" onClick={onRefresh}>
              <RefreshCw aria-hidden="true" size={17} />
              Refresh
            </button>
            {userCanManageInventory ? (
              <button type="button" className="secondary-action" onClick={() => setActiveView('backup')}>
                <FilePlus2 aria-hidden="true" size={17} />
                Import
              </button>
            ) : null}
            {userCanManageInventory ? (
              <button type="button" className="primary-action compact" onClick={() => setShowAddDeal(true)}>
                <Plus aria-hidden="true" size={17} />
                Add Deal
              </button>
            ) : null}
          </div>
        </header>

        {loading ? <div className="loading-strip">Loading inventory...</div> : null}

        {activeView === 'dashboard' ? (
          <>
            <section className="metrics-grid" aria-label="Inventory summary">
              {summaryCards.map((metric) => (
                <Metric key={metric.label} {...metric} />
              ))}
            </section>
            <section className="content-section">
              <div className="section-heading">
                <h2>Cards</h2>
                <button type="button" onClick={() => setActiveView('cards')}>
                  View all
                </button>
              </div>
              <CardsTable
                cards={cards.slice(0, 6)}
                canManage={userCanManageInventory}
                onUseCard={setUsageCard}
                onViewCard={openCardDetail}
                onEditCard={setEditCard}
                onDeleteCard={setDeleteCard}
                onSellCard={setSaleCard}
                onUndoSale={setUndoSaleCard}
                onVoidCard={setVoidCard}
                onReserveCard={setReserveCard}
                onUnreserveCard={onUnreserveCard}
              />
            </section>
            <section className="content-section">
              <div className="section-heading">
                <h2>Deals</h2>
                <button type="button" onClick={() => setActiveView('deals')}>
                  View all
                </button>
              </div>
              <DealsTable
                deals={deals.slice(0, 6)}
                canManage={userCanManageInventory}
                onViewDeal={openDealDetail}
                onEditDeal={setEditDeal}
                onArchiveDeal={archiveDeal}
                onUnarchiveDeal={unarchiveDeal}
              />
            </section>
          </>
        ) : null}

        {activeView === 'cards' ? (
          <section className="content-section">
            <div className="section-heading">
              <h2>Card Inventory</h2>
              <span>{cards.length} records</span>
            </div>
            <CardSearchForm deals={deals} onSearchCards={onSearchCards} />
            <CardsTable
              cards={cards}
              canManage={userCanManageInventory}
              onUseCard={setUsageCard}
              onViewCard={openCardDetail}
              onEditCard={setEditCard}
              onDeleteCard={setDeleteCard}
              onSellCard={setSaleCard}
              onUndoSale={setUndoSaleCard}
              onVoidCard={setVoidCard}
              onReserveCard={setReserveCard}
              onUnreserveCard={onUnreserveCard}
            />
            <CardsPagination page={cardsPage} currentCount={cards.length} onPageCards={pageCards} />
          </section>
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
        />
      ) : null}
      {editCard ? (
        <EditCardPanel
          card={editCard}
          onClose={() => setEditCard(null)}
          onEditCard={onEditCard}
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
          detailState={detailState}
          canManage={userCanManageInventory}
          onClose={() => setDetailState(null)}
          onLogout={onLogout}
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

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [cardsPage, setCardsPage] = useState<Page>(defaultPage);
  const [cardCriteria, setCardCriteria] = useState<CardSearchCriteria>({});
  const [deals, setDeals] = useState<Deal[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [backupSettings, setBackupSettings] = useState(defaultBackupSettings);
  const [backupSettingsLoading, setBackupSettingsLoading] = useState(false);
  const [backupSettingsLoaded, setBackupSettingsLoaded] = useState(false);
  const [backupSettingsError, setBackupSettingsError] = useState('');
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [userInvites, setUserInvites] = useState<UserInvite[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [supportPolicy, setSupportPolicy] = useState(defaultSupportPolicy);
  const [supportPolicyLoading, setSupportPolicyLoading] = useState(false);
  const [supportPolicyLoaded, setSupportPolicyLoaded] = useState(false);
  const [supportPolicyError, setSupportPolicyError] = useState('');
  const [dataPolicy, setDataPolicy] = useState(defaultDataPolicy);
  const [dataPolicyLoading, setDataPolicyLoading] = useState(false);
  const [dataPolicyLoaded, setDataPolicyLoaded] = useState(false);
  const [dataPolicyError, setDataPolicyError] = useState('');
  const [referenceValues, setReferenceValues] = useState<ReferenceValueState>(defaultReferenceValues);
  const [loading, setLoading] = useState(true);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [error, setError] = useState('');
  const features = authFeatures(auth);

  async function loadInventory() {
    setInventoryLoading(true);
    try {
      const [cardsResponse, dealsResponse] = await Promise.all([
        apiFetch<ApiResponse<Card[]>>('/api/cards'),
        apiFetch<ApiResponse<Deal[]>>('/api/deals'),
      ]);
      setCards(cardsResponse.data || []);
      setCardsPage(cardsResponse.page || defaultPage);
      setCardCriteria({});
      setDeals(dealsResponse.data || []);
    } finally {
      setInventoryLoading(false);
    }
  }

  async function handleSearchCards(criteria: CardSearchCriteria = {}) {
    const nextCriteria = {
      ...cardCriteria,
      ...criteria,
    };

    if (!Object.prototype.hasOwnProperty.call(criteria, 'offset')) {
      nextCriteria.offset = 0;
    }

    const params = new URLSearchParams();
    const limit = criteriaValue(nextCriteria.limit);
    const offset = criteriaValue(nextCriteria.offset);
    const status = criteriaValue(nextCriteria.status);
    const brand = criteriaValue(nextCriteria.brand);
    const source = criteriaValue(nextCriteria.source);
    const dealId = criteriaValue(nextCriteria.dealId);
    const expiresBefore = criteriaValue(nextCriteria.expiresBefore);
    const text = criteriaValue(nextCriteria.text);
    const sortBy = criteriaValue(nextCriteria.sortBy);
    const sortDir = criteriaValue(nextCriteria.sortDir);
    const cardNumber = criteriaValue(nextCriteria.cardNumber);
    if (limit) {
      params.set('limit', limit);
    }
    if (offset && offset !== '0') {
      params.set('offset', offset);
    }
    if (status) {
      params.set('status', status);
    }
    if (brand) {
      params.set('brand', brand);
    }
    if (source) {
      params.set('source', source);
    }
    if (dealId) {
      params.set('dealId', dealId);
    }
    if (expiresBefore) {
      params.set('expiresBefore', expiresBefore);
    }
    if (text) {
      params.set('text', text);
    }
    if (sortBy) {
      params.set('sortBy', sortBy);
    }
    if (sortDir) {
      params.set('sortDir', sortDir);
    }
    if (cardNumber) {
      params.set('credential', cardNumber);
    }
    const query = params.toString() ? `?${params.toString()}` : '';
    setInventoryLoading(true);
    try {
      const response = await apiFetch<ApiResponse<Card[]>>(`/api/cards${query}`);
      setCards(response.data || []);
      setCardsPage(response.page || defaultPage);
      setCardCriteria(nextCriteria);
    } finally {
      setInventoryLoading(false);
    }
  }

  async function handleLoadCardDetail(cardId: string) {
    return apiFetch<ApiResponse<CardDetail>>(`/api/cards/${cardId}`);
  }

  async function handleLoadDealDetail(dealId: string) {
    return apiFetch<ApiResponse<DealDetail>>(`/api/deals/${dealId}`);
  }

  async function handleRevealCardCredentials(cardId: string) {
    return apiFetch<ApiResponse<RevealedCredentials>>(`/api/cards/${cardId}/reveal`, {
      method: 'POST',
      body: {},
      csrfToken: auth.csrfToken,
    });
  }

  async function handleLoadAudit(criteria: AuditCriteria = {}) {
    const params = new URLSearchParams();
    const entityType = criteriaValue(criteria.entityType);
    const action = criteriaValue(criteria.action);
    const from = criteriaValue(criteria.from);
    const to = criteriaValue(criteria.to);
    if (entityType) {
      params.set('entityType', entityType);
    }
    if (action) {
      params.set('action', action);
    }
    if (from) {
      params.set('from', from);
    }
    if (to) {
      params.set('to', to);
    }

    const query = params.toString() ? `?${params.toString()}` : '';
    setAuditLoading(true);
    setAuditError('');
    try {
      const response = await apiFetch<ApiResponse<AuditEvent[]>>(`/api/audit${query}`);
      setAuditEvents(response.data || []);
    } catch (caught) {
      setAuditError(errorMessage(caught));
    } finally {
      setAuditLoading(false);
    }
  }

  async function handleLoadBackupSettings() {
    setBackupSettingsLoading(true);
    setBackupSettingsError('');
    try {
      const response = await apiFetch<ApiResponse<BackupSettings>>('/api/settings/backup');
      setBackupSettings(response.data || defaultBackupSettings);
      setBackupSettingsLoaded(true);
      return response;
    } catch (caught) {
      setBackupSettingsError(errorMessage(caught));
      return null;
    } finally {
      setBackupSettingsLoading(false);
    }
  }

  async function handleUpdateBackupSettings(payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<BackupSettings>>('/api/settings/backup', {
      method: 'PUT',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setBackupSettings(response.data || defaultBackupSettings);
    setBackupSettingsLoaded(true);
    return response;
  }

  async function handleLoadUsers() {
    setUsersLoading(true);
    setUsersError('');
    try {
      const [response, invitesResponse] = await Promise.all([
        apiFetch<ApiResponse<AuthUser[]>>('/api/users'),
        apiFetch<ApiResponse<UserInvite[]>>('/api/users/invites'),
      ]);
      setUsers(Array.isArray(response.data) ? response.data : []);
      setUserInvites(Array.isArray(invitesResponse.data) ? invitesResponse.data : []);
      setUsersLoaded(true);
      return response;
    } catch (caught) {
      setUsersError(errorMessage(caught));
      return null;
    } finally {
      setUsersLoading(false);
    }
  }

  async function handleCreateInvite(payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<UserInvite>>('/api/users/invites', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setUserInvites((current) => [response.data, ...current.filter((invite) => invite.id !== response.data.id)]);
    setUsersLoaded(true);
    return response.data;
  }

  async function handleRevokeInvite(inviteId: string) {
    const response = await apiFetch<ApiResponse<UserInvite>>(`/api/users/invites/${inviteId}`, {
      method: 'DELETE',
      csrfToken: auth.csrfToken,
    });
    setUserInvites((current) => current.filter((invite) => invite.id !== response.data.id));
    return response.data;
  }

  async function handleUpdateUser(userId: string, payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<AuthUser>>(`/api/users/${userId}`, {
      method: 'PUT',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setUsers((current) => current.map((user) => (user.id === response.data.id ? response.data : user)));
    return response.data;
  }

  async function handleLoadSupportPolicy() {
    setSupportPolicyLoading(true);
    setSupportPolicyError('');
    try {
      const response = await apiFetch<ApiResponse<SupportPolicy>>('/api/admin/support-policy');
      setSupportPolicy(response.data || defaultSupportPolicy);
      setSupportPolicyLoaded(true);
      return response;
    } catch (caught) {
      setSupportPolicyError(errorMessage(caught));
      return null;
    } finally {
      setSupportPolicyLoading(false);
    }
  }

  async function handleUpdateSupportPolicy(payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<SupportPolicy>>('/api/admin/support-policy', {
      method: 'PUT',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setSupportPolicy(response.data || defaultSupportPolicy);
    setSupportPolicyLoaded(true);
    return response;
  }

  async function handleLoadDataPolicy() {
    setDataPolicyLoading(true);
    setDataPolicyError('');
    try {
      const response = await apiFetch<ApiResponse<DataPolicy>>('/api/admin/data-policy');
      setDataPolicy(response.data || defaultDataPolicy);
      setDataPolicyLoaded(true);
      return response;
    } catch (caught) {
      setDataPolicyError(errorMessage(caught));
      return null;
    } finally {
      setDataPolicyLoading(false);
    }
  }

  async function handleUpdateDataPolicy(payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<DataPolicy>>('/api/admin/data-policy', {
      method: 'PUT',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setDataPolicy(response.data || defaultDataPolicy);
    setDataPolicyLoaded(true);
    return response;
  }

  async function handleExportAccountData(payload: ApiPayload) {
    return apiFetch<ApiResponse<PortableExportPayload>>('/api/admin/data-export', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
  }

  async function handleRunRetention(payload: ApiPayload) {
    return apiFetch<ApiResponse<{ counts?: CountSummary }>>('/api/admin/retention/run', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
  }

  async function handleDeleteAccountData(payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<{ counts?: CountSummary }>>('/api/admin/data-delete', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    await loadInventory();
    return response;
  }

  async function handleExportPlaintext(payload: ApiPayload) {
    return apiFetch<ApiResponse<PortableExportPayload>>('/api/backup/export', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
  }

  async function handleExportEncrypted(payload: ApiPayload) {
    return apiFetch<ApiResponse<PortableExportPayload>>('/api/backup/export-encrypted', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
  }

  async function handleExportRawDatabase(payload: ApiPayload) {
    return apiDownload('/api/backup/db-file', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
  }

  async function handlePreviewCsv(payload: { csv: string }) {
    return apiFetch<ApiResponse<CsvPreviewPayload>>('/api/cards/import-csv', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
  }

  async function handleConfirmCsv(payload: { csv: string }) {
    const response = await apiFetch<ApiResponse<CsvImportResult>>('/api/cards/import-csv/confirm', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setCards((current) => [
      ...response.data.cards,
      ...current.filter((card) => !response.data.cards.some((created) => created.id === card.id)),
    ]);
    setCardsPage((current) => ({
      ...current,
      total: current.total + response.data.cards.length,
    }));
    return response;
  }

  async function handleImportBackup(payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<{ summary: ImportSummary }>>('/api/backup/import', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    await loadInventory();
    return response;
  }

  async function handleChangeUnlockSecret(payload: ApiPayload) {
    return apiFetch<ApiResponse<unknown>>('/api/auth/change-unlock-secret', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
  }

  async function handleGenerateRecoveryCodes(payload: { currentUnlockSecret: string }) {
    const response = await apiFetch<ApiResponse<{ codes: string[]; activeCount: number }>>('/api/auth/recovery-codes', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setAuth((current) => ({
      ...current,
      recoveryCodes: {
        activeCount: response.data.activeCount,
      },
    }));
    return response.data;
  }

  async function loadDeals({ includeArchived = false }: { includeArchived?: boolean } = {}) {
    const query = includeArchived ? '?includeArchived=true' : '';
    setInventoryLoading(true);
    try {
      const response = await apiFetch<ApiResponse<Deal[]>>(`/api/deals${query}`);
      setDeals(response.data || []);
    } finally {
      setInventoryLoading(false);
    }
  }

  useEffect(() => {
    let canceled = false;

    async function loadStatus() {
      setLoading(true);
      setError('');
      try {
        const response = await apiFetch<ApiResponse<AuthState>>('/api/auth/status');
        if (canceled) {
          return;
        }
        setAuth(response.data);
        if (response.data.sessionValid && response.data.dekLoaded) {
          await loadInventory();
        }
      } catch (caught) {
        if (!canceled) {
          setError(errorMessage(caught));
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    }

    loadStatus();
    return () => {
      canceled = true;
    };
  }, []);

  async function handleSetup(payload: { email: string; displayName: string; unlockSecret: string }) {
    const response = await apiFetch<ApiResponse<AuthState>>('/api/auth/setup', {
      method: 'POST',
      body: payload,
    });
    setAuth(response.data);
    await loadInventory();
  }

  async function handleLogin({ email, unlockSecret }: { email: string; unlockSecret: string }) {
    const response = await apiFetch<ApiResponse<AuthState>>('/api/auth/login', {
      method: 'POST',
      body: {
        ...(email ? { email } : {}),
        unlockSecret,
      },
    });
    setAuth(response.data);
    await loadInventory();
  }

  async function handleAcceptInvite(payload: { email: string; inviteCode: string; unlockSecret: string }) {
    const response = await apiFetch<ApiResponse<AuthState>>('/api/auth/accept-invite', {
      method: 'POST',
      body: payload,
    });
    setAuth(response.data);
    await loadInventory();
  }

  async function handleRecoverAccess(payload: { email: string; recoveryCode: string; newUnlockSecret: string }) {
    return apiFetch<ApiResponse<unknown>>('/api/auth/recover', {
      method: 'POST',
      body: payload,
    });
  }

  async function handleLogout() {
    if (auth?.csrfToken) {
      await apiFetch<ApiResponse<unknown>>('/api/auth/logout', {
        method: 'POST',
        body: {},
        csrfToken: auth.csrfToken,
      }).catch(() => {});
    }
    setAuth({ setupComplete: true, sessionValid: false, dekLoaded: false });
    setCards([]);
    setCardsPage(defaultPage);
    setCardCriteria({});
    setDeals([]);
    setAuditEvents([]);
    setAuditError('');
    setBackupSettings(defaultBackupSettings);
    setBackupSettingsLoaded(false);
    setBackupSettingsError('');
    setUsers([]);
    setUserInvites([]);
    setUsersLoaded(false);
    setUsersError('');
    setSupportPolicy(defaultSupportPolicy);
    setSupportPolicyLoaded(false);
    setSupportPolicyError('');
    setDataPolicy(defaultDataPolicy);
    setDataPolicyLoaded(false);
    setDataPolicyError('');
    setReferenceValues(defaultReferenceValues);
  }

  async function handleLoadReferenceValues() {
    if (!features.referenceValueHints) {
      setReferenceValues(defaultReferenceValues);
      return defaultReferenceValues;
    }
    const response = await apiFetch<ApiResponse<ReferenceValueState>>('/api/reference-values?types=deal_name,source,card_brand&limit=200');
    const nextValues = normalizeReferenceValuePayload(response.data);
    setReferenceValues(nextValues);
    return nextValues;
  }

  async function handleUpsertReferenceValues(values: ReferenceValue[] = []) {
    if (!features.referenceValueHints || !values.length) {
      return [];
    }
    const response = await apiFetch<ApiResponse<ReferenceValue[]>>('/api/reference-values', {
      method: 'POST',
      body: { values },
      csrfToken: auth.csrfToken,
    });
    setReferenceValues((current) => mergeReferenceValueState(current, response.data || []));
    return response.data || [];
  }

  async function handleCreateDeal(payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<DealMutationResult>>('/api/deals', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setDeals((current) => [response.data.deal, ...current.filter((deal) => deal.id !== response.data.deal.id)]);
    setCards((current) => [
      ...response.data.cards,
      ...current.filter((card) => !response.data.cards.some((created) => created.id === card.id)),
    ]);
  }

  async function handleDealArchiveTransition(dealId: string, action: 'archive' | 'unarchive', includeArchived: boolean) {
    const response = await apiFetch<ApiResponse<{ deal: Deal }>>(`/api/deals/${dealId}/${action}`, {
      method: 'POST',
      body: {},
      csrfToken: auth.csrfToken,
    });
    const updatedDeal = response.data.deal;
    setDeals((current) => {
      if (action === 'archive' && !includeArchived) {
        return current.filter((deal) => deal.id !== updatedDeal.id);
      }

      const exists = current.some((deal) => deal.id === updatedDeal.id);
      if (!exists) {
        return [updatedDeal, ...current];
      }
      return current.map((deal) => (deal.id === updatedDeal.id ? updatedDeal : deal));
    });
  }

  async function handleEditDeal(dealId: string, payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<{ deal: Deal }>>(`/api/deals/${dealId}`, {
      method: 'PUT',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    const updatedDeal = response.data.deal;
    setDeals((current) => current.map((deal) => (deal.id === updatedDeal.id ? updatedDeal : deal)));
    return response;
  }

  async function handleUseCard(cardId: string, payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<CardMutationResult>>(`/api/cards/${cardId}/use`, {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setCards((current) =>
      current.map((card) => (card.id === response.data.card.id ? response.data.card : card)),
    );
  }

  async function handleUndoUsage(cardId: string, payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<CardMutationResult>>(`/api/cards/${cardId}/undo-usage`, {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setCards((current) =>
      current.map((card) => (card.id === response.data.card.id ? response.data.card : card)),
    );
    return response;
  }

  async function handleEditCard(cardId: string, payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<Card>>(`/api/cards/${cardId}`, {
      method: 'PUT',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setCards((current) =>
      current.map((card) => (card.id === response.data.id ? response.data : card)),
    );
    return response;
  }

  async function handleDeleteCard(cardId: string) {
    await apiFetch<ApiResponse<unknown>>(`/api/cards/${cardId}`, {
      method: 'DELETE',
      csrfToken: auth.csrfToken,
    });
    setCards((current) => current.filter((card) => card.id !== cardId));
  }

  async function handleSellCard(cardId: string, payload: CardSalePayload) {
    const response = await apiFetch<ApiResponse<CardMutationResult>>(`/api/cards/${cardId}/sell`, {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    const soldCard = {
      ...response.data.card,
      latestSalePriceCents: payload.salePriceCents,
    };
    setCards((current) =>
      current.map((card) => (card.id === soldCard.id ? soldCard : card)),
    );
  }

  async function handleUndoSale(cardId: string, payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<CardMutationResult>>(`/api/cards/${cardId}/undo-sale`, {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setCards((current) =>
      current.map((card) =>
        card.id === response.data.card.id ? { ...response.data.card, latestSalePriceCents: null } : card,
      ),
    );
  }

  async function handleVoidCard(cardId: string, payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<CardMutationResult>>(`/api/cards/${cardId}/void`, {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setCards((current) =>
      current.map((card) => (card.id === response.data.card.id ? response.data.card : card)),
    );
  }

  async function handleCardTransition(cardId: string, action: 'reserve' | 'unreserve', payload: ApiPayload = {}) {
    const response = await apiFetch<ApiResponse<Card>>(`/api/cards/${cardId}/${action}`, {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setCards((current) =>
      current.map((card) => (card.id === response.data.id ? response.data : card)),
    );
  }

  if (loading) {
    return (
      <main className="auth-layout">
        <section className="auth-panel">
          <p className="eyebrow">Loading</p>
          <h1>Secure Gift Card Manager</h1>
          <p className="auth-copy">Checking encrypted storage state...</p>
        </section>
      </main>
    );
  }

  if (error) {
    return (
      <main className="auth-layout">
        <section className="auth-panel">
          <p className="eyebrow">Server unavailable</p>
          <h1>Secure Gift Card Manager</h1>
          <p className="auth-copy">{error}</p>
          <button type="button" className="primary-action" onClick={() => window.location.reload()}>
            <RefreshCw aria-hidden="true" size={18} />
            Retry
          </button>
        </section>
      </main>
    );
  }

  if (!auth?.setupComplete) {
    return <SetupScreen onSetup={handleSetup} />;
  }

  if (!auth.sessionValid || !auth.dekLoaded) {
    return (
      <UnlockScreen
        onLogin={handleLogin}
        onAcceptInvite={handleAcceptInvite}
        onRecoverAccess={handleRecoverAccess}
      />
    );
  }

  return (
    <WorkSurface
      auth={auth}
      cards={cards}
      cardsPage={cardsPage}
      deals={deals}
      auditEvents={auditEvents}
      auditLoading={auditLoading}
      auditError={auditError}
      backupSettings={backupSettings}
      backupSettingsLoading={backupSettingsLoading}
      backupSettingsLoaded={backupSettingsLoaded}
      backupSettingsError={backupSettingsError}
      users={users}
      userInvites={userInvites}
      usersLoading={usersLoading}
      usersLoaded={usersLoaded}
      usersError={usersError}
      supportPolicy={supportPolicy}
      supportPolicyLoading={supportPolicyLoading}
      supportPolicyLoaded={supportPolicyLoaded}
      supportPolicyError={supportPolicyError}
      dataPolicy={dataPolicy}
      dataPolicyLoading={dataPolicyLoading}
      dataPolicyLoaded={dataPolicyLoaded}
      dataPolicyError={dataPolicyError}
      features={features}
      referenceValues={referenceValues}
      loading={inventoryLoading}
      onRefresh={loadInventory}
      onLogout={handleLogout}
      onLoadAudit={handleLoadAudit}
      onLoadBackupSettings={handleLoadBackupSettings}
      onLoadUsers={handleLoadUsers}
      onLoadSupportPolicy={handleLoadSupportPolicy}
      onLoadDataPolicy={handleLoadDataPolicy}
      onCreateInvite={handleCreateInvite}
      onRevokeInvite={handleRevokeInvite}
      onUpdateUser={handleUpdateUser}
      onUpdateSupportPolicy={handleUpdateSupportPolicy}
      onUpdateDataPolicy={handleUpdateDataPolicy}
      onExportAccountData={handleExportAccountData}
      onRunRetention={handleRunRetention}
      onDeleteAccountData={handleDeleteAccountData}
      onUpdateBackupSettings={handleUpdateBackupSettings}
      onExportPlaintext={handleExportPlaintext}
      onExportEncrypted={handleExportEncrypted}
      onExportRawDatabase={handleExportRawDatabase}
      onPreviewCsv={handlePreviewCsv}
      onConfirmCsv={handleConfirmCsv}
      onImportBackup={handleImportBackup}
      onChangeUnlockSecret={handleChangeUnlockSecret}
      onGenerateRecoveryCodes={handleGenerateRecoveryCodes}
      onLoadReferenceValues={handleLoadReferenceValues}
      onUpsertReferenceValues={handleUpsertReferenceValues}
      onCreateDeal={handleCreateDeal}
      onLoadDeals={(includeArchived) => loadDeals({ includeArchived })}
      onEditDeal={handleEditDeal}
      onArchiveDeal={(deal, includeArchived) =>
        handleDealArchiveTransition(deal.id, 'archive', includeArchived)}
      onUnarchiveDeal={(deal, includeArchived) =>
        handleDealArchiveTransition(deal.id, 'unarchive', includeArchived)}
      onSearchCards={handleSearchCards}
      onLoadCardDetail={handleLoadCardDetail}
      onLoadDealDetail={handleLoadDealDetail}
      onRevealCardCredentials={handleRevealCardCredentials}
      onUseCard={handleUseCard}
      onUndoUsage={handleUndoUsage}
      onEditCard={handleEditCard}
      onDeleteCard={handleDeleteCard}
      onSellCard={handleSellCard}
      onUndoSale={handleUndoSale}
      onVoidCard={handleVoidCard}
      onReserveCard={(cardId, payload) => handleCardTransition(cardId, 'reserve', payload)}
      onUnreserveCard={(card) => handleCardTransition(card.id, 'unreserve')}
    />
  );
}
