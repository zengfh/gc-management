import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { apiFetch } from './api';
import { SetupScreen, UnlockScreen } from './authScreens';
import { defaultFeatureFlags } from './defaults';
import { WorkSurface } from './WorkSurface';
import { useAdminController } from './useAdminController';
import { useBackupController } from './useBackupController';
import { useInventoryController } from './useInventoryController';
import { useReferenceValuesController } from './useReferenceValuesController';
import type {
  ApiPayload,
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
  FeatureFlags,
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
  const backup = useBackupController({
    csrfToken: () => authenticatedAuth().csrfToken,
    onImported: inventory.loadInventory,
  });
  const admin = useAdminController({
    csrfToken: () => authenticatedAuth().csrfToken,
    onDataDeleted: inventory.loadInventory,
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
    backup.resetBackupState();
    admin.resetAdminState();
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
      backupSettings={backup.backupSettings}
      backupSettingsLoading={backup.backupSettingsLoading}
      backupSettingsLoaded={backup.backupSettingsLoaded}
      backupSettingsError={backup.backupSettingsError}
      users={admin.users}
      userInvites={admin.userInvites}
      usersLoading={admin.usersLoading}
      usersLoaded={admin.usersLoaded}
      usersError={admin.usersError}
      supportPolicy={admin.supportPolicy}
      supportPolicyLoading={admin.supportPolicyLoading}
      supportPolicyLoaded={admin.supportPolicyLoaded}
      supportPolicyError={admin.supportPolicyError}
      dataPolicy={admin.dataPolicy}
      dataPolicyLoading={admin.dataPolicyLoading}
      dataPolicyLoaded={admin.dataPolicyLoaded}
      dataPolicyError={admin.dataPolicyError}
      features={features}
      referenceValues={referenceValues.referenceValues}
      loading={inventory.loading}
      onRefresh={inventory.loadInventory}
      onLogout={handleLogout}
      onLoadAudit={handleLoadAudit}
      onLoadBackupSettings={backup.loadBackupSettings}
      onLoadUsers={admin.loadUsers}
      onLoadSupportPolicy={admin.loadSupportPolicy}
      onLoadDataPolicy={admin.loadDataPolicy}
      onCreateInvite={admin.createInvite}
      onRevokeInvite={admin.revokeInvite}
      onUpdateUser={admin.updateUser}
      onUpdateSupportPolicy={admin.updateSupportPolicy}
      onUpdateDataPolicy={admin.updateDataPolicy}
      onExportAccountData={admin.exportAccountData}
      onRunRetention={admin.runRetention}
      onDeleteAccountData={admin.deleteAccountData}
      onUpdateBackupSettings={backup.updateBackupSettings}
      onExportPlaintext={backup.exportPlaintext}
      onExportEncrypted={backup.exportEncrypted}
      onExportRawDatabase={backup.exportRawDatabase}
      onPreviewCsv={inventory.previewCsv}
      onConfirmCsv={inventory.confirmCsv}
      onImportBackup={backup.importBackup}
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
