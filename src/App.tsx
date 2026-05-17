import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiDownload, apiFetch } from './api';
import { SetupScreen, UnlockScreen } from './authScreens';
import {
  defaultBackupSettings,
  defaultDataPolicy,
  defaultFeatureFlags,
  defaultPage,
  defaultSupportPolicy,
} from './defaults';
import { WorkSurface } from './WorkSurface';
import type {
  ApiPayload,
  CardMutationResult,
  CardSalePayload,
  CountSummary,
  CsvImportResult,
  CsvPreviewPayload,
  DealMutationResult,
  ImportSummary,
  PortableExportPayload,
} from './appTypes';
import {
  criteriaValue,
  errorMessage,
} from './display';
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

function authFeatures(auth: AuthState | null | undefined): FeatureFlags {
  return {
    ...defaultFeatureFlags,
    ...(auth?.features || {}),
  };
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

  function authenticatedAuth(): AuthState & { csrfToken: string } {
    if (!auth?.csrfToken) {
      throw new Error('Authenticated session is required.');
    }
    return auth as AuthState & { csrfToken: string };
  }

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
      csrfToken: authenticatedAuth().csrfToken,
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
      csrfToken: authenticatedAuth().csrfToken,
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
      csrfToken: authenticatedAuth().csrfToken,
    });
    setUserInvites((current) => [response.data, ...current.filter((invite) => invite.id !== response.data.id)]);
    setUsersLoaded(true);
    return response.data;
  }

  async function handleRevokeInvite(inviteId: string) {
    const response = await apiFetch<ApiResponse<UserInvite>>(`/api/users/invites/${inviteId}`, {
      method: 'DELETE',
      csrfToken: authenticatedAuth().csrfToken,
    });
    setUserInvites((current) => current.filter((invite) => invite.id !== response.data.id));
    return response.data;
  }

  async function handleUpdateUser(userId: string, payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<AuthUser>>(`/api/users/${userId}`, {
      method: 'PUT',
      body: payload,
      csrfToken: authenticatedAuth().csrfToken,
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
      csrfToken: authenticatedAuth().csrfToken,
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
      csrfToken: authenticatedAuth().csrfToken,
    });
    setDataPolicy(response.data || defaultDataPolicy);
    setDataPolicyLoaded(true);
    return response;
  }

  async function handleExportAccountData(payload: ApiPayload) {
    return apiFetch<ApiResponse<PortableExportPayload>>('/api/admin/data-export', {
      method: 'POST',
      body: payload,
      csrfToken: authenticatedAuth().csrfToken,
    });
  }

  async function handleRunRetention(payload: ApiPayload) {
    return apiFetch<ApiResponse<{ counts?: CountSummary }>>('/api/admin/retention/run', {
      method: 'POST',
      body: payload,
      csrfToken: authenticatedAuth().csrfToken,
    });
  }

  async function handleDeleteAccountData(payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<{ counts?: CountSummary }>>('/api/admin/data-delete', {
      method: 'POST',
      body: payload,
      csrfToken: authenticatedAuth().csrfToken,
    });
    await loadInventory();
    return response;
  }

  async function handleExportPlaintext(payload: ApiPayload) {
    return apiFetch<ApiResponse<PortableExportPayload>>('/api/backup/export', {
      method: 'POST',
      body: payload,
      csrfToken: authenticatedAuth().csrfToken,
    });
  }

  async function handleExportEncrypted(payload: ApiPayload) {
    return apiFetch<ApiResponse<PortableExportPayload>>('/api/backup/export-encrypted', {
      method: 'POST',
      body: payload,
      csrfToken: authenticatedAuth().csrfToken,
    });
  }

  async function handleExportRawDatabase(payload: ApiPayload) {
    return apiDownload('/api/backup/db-file', {
      method: 'POST',
      body: payload,
      csrfToken: authenticatedAuth().csrfToken,
    });
  }

  async function handlePreviewCsv(payload: { csv: string }) {
    return apiFetch<ApiResponse<CsvPreviewPayload>>('/api/cards/import-csv', {
      method: 'POST',
      body: payload,
      csrfToken: authenticatedAuth().csrfToken,
    });
  }

  async function handleConfirmCsv(payload: { csv: string }) {
    const response = await apiFetch<ApiResponse<CsvImportResult>>('/api/cards/import-csv/confirm', {
      method: 'POST',
      body: payload,
      csrfToken: authenticatedAuth().csrfToken,
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
      csrfToken: authenticatedAuth().csrfToken,
    });
    await loadInventory();
    return response;
  }

  async function handleChangeUnlockSecret(payload: ApiPayload) {
    return apiFetch<ApiResponse<unknown>>('/api/auth/change-unlock-secret', {
      method: 'POST',
      body: payload,
      csrfToken: authenticatedAuth().csrfToken,
    });
  }

  async function handleGenerateRecoveryCodes(payload: { currentUnlockSecret: string }) {
    const response = await apiFetch<ApiResponse<{ codes: string[]; activeCount: number }>>('/api/auth/recovery-codes', {
      method: 'POST',
      body: payload,
      csrfToken: authenticatedAuth().csrfToken,
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
        csrfToken: authenticatedAuth().csrfToken,
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
      csrfToken: authenticatedAuth().csrfToken,
    });
    setReferenceValues((current) => mergeReferenceValueState(current, response.data || []));
    return response.data || [];
  }

  async function handleCreateDeal(payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<DealMutationResult>>('/api/deals', {
      method: 'POST',
      body: payload,
      csrfToken: authenticatedAuth().csrfToken,
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
      csrfToken: authenticatedAuth().csrfToken,
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
      csrfToken: authenticatedAuth().csrfToken,
    });
    const updatedDeal = response.data.deal;
    setDeals((current) => current.map((deal) => (deal.id === updatedDeal.id ? updatedDeal : deal)));
    return response;
  }

  async function handleUseCard(cardId: string, payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<CardMutationResult>>(`/api/cards/${cardId}/use`, {
      method: 'POST',
      body: payload,
      csrfToken: authenticatedAuth().csrfToken,
    });
    setCards((current) =>
      current.map((card) => (card.id === response.data.card.id ? response.data.card : card)),
    );
  }

  async function handleUndoUsage(cardId: string, payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<CardMutationResult>>(`/api/cards/${cardId}/undo-usage`, {
      method: 'POST',
      body: payload,
      csrfToken: authenticatedAuth().csrfToken,
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
      csrfToken: authenticatedAuth().csrfToken,
    });
    setCards((current) =>
      current.map((card) => (card.id === response.data.id ? response.data : card)),
    );
    return response;
  }

  async function handleDeleteCard(cardId: string) {
    await apiFetch<ApiResponse<unknown>>(`/api/cards/${cardId}`, {
      method: 'DELETE',
      csrfToken: authenticatedAuth().csrfToken,
    });
    setCards((current) => current.filter((card) => card.id !== cardId));
  }

  async function handleSellCard(cardId: string, payload: CardSalePayload) {
    const response = await apiFetch<ApiResponse<CardMutationResult>>(`/api/cards/${cardId}/sell`, {
      method: 'POST',
      body: payload,
      csrfToken: authenticatedAuth().csrfToken,
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
      csrfToken: authenticatedAuth().csrfToken,
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
      csrfToken: authenticatedAuth().csrfToken,
    });
    setCards((current) =>
      current.map((card) => (card.id === response.data.card.id ? response.data.card : card)),
    );
  }

  async function handleCardTransition(cardId: string, action: 'reserve' | 'unreserve', payload: ApiPayload = {}) {
    const response = await apiFetch<ApiResponse<Card>>(`/api/cards/${cardId}/${action}`, {
      method: 'POST',
      body: payload,
      csrfToken: authenticatedAuth().csrfToken,
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
