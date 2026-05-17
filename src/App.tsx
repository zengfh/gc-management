import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiDownload, apiFetch } from './api';
import { SetupScreen, UnlockScreen } from './authScreens';
import {
  defaultBackupSettings,
  defaultDataPolicy,
  defaultFeatureFlags,
  defaultSupportPolicy,
} from './defaults';
import { WorkSurface } from './WorkSurface';
import { useInventoryController } from './useInventoryController';
import { useReferenceValuesController } from './useReferenceValuesController';
import type {
  ApiPayload,
  CountSummary,
  ImportSummary,
  PortableExportPayload,
} from './appTypes';
import {
  criteriaValue,
  errorMessage,
} from './display';
import type {
  AuditCriteria,
  AuditEvent,
  ApiResponse,
  AuthState,
  BackupSettings,
  DataPolicy,
  FeatureFlags,
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const features = authFeatures(auth);

  function authenticatedAuth(): AuthState & { csrfToken: string } {
    if (!auth?.csrfToken) {
      throw new Error('Authenticated session is required.');
    }
    return auth as AuthState & { csrfToken: string };
  }

  const inventory = useInventoryController({
    csrfToken: () => authenticatedAuth().csrfToken,
  });
  const referenceValues = useReferenceValuesController({
    features,
    csrfToken: () => authenticatedAuth().csrfToken,
  });
  const { loadInventory } = inventory;

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
    await inventory.loadInventory();
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

  async function handleImportBackup(payload: ApiPayload) {
    const response = await apiFetch<ApiResponse<{ summary: ImportSummary }>>('/api/backup/import', {
      method: 'POST',
      body: payload,
      csrfToken: authenticatedAuth().csrfToken,
    });
    await inventory.loadInventory();
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
  }, [loadInventory]);

  async function handleSetup(payload: { email: string; displayName: string; unlockSecret: string }) {
    const response = await apiFetch<ApiResponse<AuthState>>('/api/auth/setup', {
      method: 'POST',
      body: payload,
    });
    setAuth(response.data);
    await inventory.loadInventory();
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
    await inventory.loadInventory();
  }

  async function handleAcceptInvite(payload: { email: string; inviteCode: string; unlockSecret: string }) {
    const response = await apiFetch<ApiResponse<AuthState>>('/api/auth/accept-invite', {
      method: 'POST',
      body: payload,
    });
    setAuth(response.data);
    await inventory.loadInventory();
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
    inventory.resetInventory();
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
    referenceValues.resetReferenceValues();
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
      cards={inventory.cards}
      cardsPage={inventory.cardsPage}
      deals={inventory.deals}
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
      referenceValues={referenceValues.referenceValues}
      loading={inventory.loading}
      onRefresh={inventory.loadInventory}
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
      onPreviewCsv={inventory.previewCsv}
      onConfirmCsv={inventory.confirmCsv}
      onImportBackup={handleImportBackup}
      onChangeUnlockSecret={handleChangeUnlockSecret}
      onGenerateRecoveryCodes={handleGenerateRecoveryCodes}
      onLoadReferenceValues={referenceValues.loadReferenceValues}
      onUpsertReferenceValues={referenceValues.upsertReferenceValues}
      onCreateDeal={inventory.createDeal}
      onLoadDeals={(includeArchived) => inventory.loadDeals({ includeArchived })}
      onEditDeal={inventory.editDeal}
      onArchiveDeal={(deal, includeArchived) =>
        inventory.dealArchiveTransition(deal.id, 'archive', includeArchived)}
      onUnarchiveDeal={(deal, includeArchived) =>
        inventory.dealArchiveTransition(deal.id, 'unarchive', includeArchived)}
      onSearchCards={inventory.searchCards}
      onLoadCardDetail={inventory.loadCardDetail}
      onLoadDealDetail={inventory.loadDealDetail}
      onRevealCardCredentials={inventory.revealCardCredentials}
      onUseCard={inventory.useCard}
      onUndoUsage={inventory.undoUsage}
      onEditCard={inventory.editCard}
      onDeleteCard={inventory.deleteCard}
      onSellCard={inventory.sellCard}
      onUndoSale={inventory.undoSale}
      onVoidCard={inventory.voidCard}
      onReserveCard={(cardId, payload) => inventory.cardTransition(cardId, 'reserve', payload)}
      onUnreserveCard={(card) => inventory.cardTransition(card.id, 'unreserve')}
    />
  );
}
