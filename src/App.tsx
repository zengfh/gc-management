import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type {
  ChangeEvent,
  FocusEvent,
  FormEvent,
  KeyboardEvent,
  ReactNode,
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
  Search,
  Settings,
  ShieldCheck,
  Tag,
  X,
  type LucideIcon,
} from 'lucide-react';
import { apiDownload, apiFetch } from './api';
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
  AddDealCustomField,
  AddDealFormState,
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
  VoidHandler,
  WorkSurfaceProps,
} from './appTypes';
import {
  credentialProfileOptions,
  credentialSummaryText,
  customCredentialFieldKinds,
  inferCredentialProfileForBrand,
  inferNetworkFromBrand,
} from './credentialHelpers';
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
  dollarsToCents,
  errorMessage,
  formatDateTime,
  formatDisplayValue,
  formatMoney,
  isBeforeToday,
  isWithinNextDays,
  statusLabels,
  viewTitle,
} from './display';
import { FieldError } from './formUi';
import { StatusBadge } from './StatusBadge';
import {
  buildReferenceReviewItems,
  buildReferenceTouchValues,
  defaultReferenceValues,
  filterReferenceOptions,
  mergeReferenceValueState,
  normalizeReferenceValuePayload,
  referenceValueTypes,
} from './referenceValues';
import { useDialogFocus } from './useDialogFocus';
import type {
  AuditCriteria,
  AuditEvent,
  ApiResponse,
  AuthState,
  BackupSettings,
  Card,
  CardDetail,
  CardSearchCriteria,
  CredentialField,
  CredentialFieldKind,
  DataPolicy,
  Deal,
  DealDetail,
  FeatureFlags,
  Page,
  ReferenceReviewItem,
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

function Metric({ label, value, icon: Icon }: { label: string; value: ReactNode; icon: LucideIcon }) {
  return (
    <article className="metric">
      <div className="metric-icon">
        <Icon aria-hidden="true" size={18} />
      </div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
    </article>
  );
}

function CardsTable({
  cards,
  canManage,
  onUseCard,
  onViewCard,
  onEditCard,
  onDeleteCard,
  onSellCard,
  onUndoSale,
  onVoidCard,
  onReserveCard,
  onUnreserveCard,
}: {
  cards: Card[];
  canManage: boolean;
  onUseCard: (card: Card) => void;
  onViewCard: (card: Card) => void;
  onEditCard: (card: Card) => void;
  onDeleteCard: (card: Card) => void;
  onSellCard: (card: Card) => void;
  onUndoSale: (card: Card) => void;
  onVoidCard: (card: Card) => void;
  onReserveCard: (card: Card) => void;
  onUnreserveCard: (card: Card) => void;
}) {
  if (cards.length === 0) {
    return (
      <div className="empty-state">
        <CreditCard aria-hidden="true" size={24} />
        <p>No cards yet. Start by adding a deal or importing CSV.</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Brand</th>
            <th>Reservation</th>
            <th>Credential</th>
            <th>Source</th>
            <th>Expiration</th>
            <th className="numeric">Face</th>
            <th className="numeric">Remaining</th>
            <th className="numeric">Cost</th>
            <th>Updated</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => (
            <tr key={card.id}>
              <td>
                <StatusBadge status={card.status} />
              </td>
              <td>
                <button
                  type="button"
                  className="table-link"
                  aria-label={`Open ${card.brand} details`}
                  onClick={() => onViewCard(card)}
                >
                  {card.brand}
                </button>
              </td>
              <td>
                {card.status === 'reserved' ? (
                  <div className="reservation-cell">
                    <strong>{card.reservedFor || 'Reserved'}</strong>
                    <span>{card.reservedUntil ? `Until ${card.reservedUntil}` : 'No expiration'}</span>
                  </div>
                ) : (
                  'Not reserved'
                )}
              </td>
              <td className="mono">{credentialSummaryText(card)}</td>
              <td>{card.source || 'Not recorded'}</td>
              <td>{card.expirationDate || 'Not recorded'}</td>
              <td className="numeric">{formatMoney(card.faceValueCents)}</td>
              <td className="numeric">{formatMoney(card.remainingBalanceCents)}</td>
              <td className="numeric">{formatMoney(card.purchaseCostCents)}</td>
              <td>{card.updatedAt ? new Date(card.updatedAt).toLocaleDateString() : 'Not recorded'}</td>
              <td>
                <div className="row-actions">
                  {canManage ? (
                    <button
                      type="button"
                      className="table-action"
                      aria-label={`Edit ${card.brand}`}
                      onClick={() => onEditCard(card)}
                    >
                      Edit
                    </button>
                  ) : null}
                  {canManage && card.status === 'available' ? (
                    <button
                      type="button"
                      className="table-action danger"
                      aria-label={`Delete ${card.brand}`}
                      onClick={() => onDeleteCard(card)}
                    >
                      Delete
                    </button>
                  ) : null}
                  {canManage && card.status === 'available' ? (
                    <button
                      type="button"
                      className="table-action"
                      aria-label={`Reserve ${card.brand}`}
                      onClick={() => onReserveCard(card)}
                    >
                      Reserve
                    </button>
                  ) : null}
                  {canManage && card.status === 'reserved' ? (
                    <button
                      type="button"
                      className="table-action"
                      aria-label={`Unreserve ${card.brand}`}
                      onClick={() => onUnreserveCard(card)}
                    >
                      Unreserve
                    </button>
                  ) : null}
                  {canManage && ['available', 'reserved', 'in_use'].includes(card.status) ? (
                    <button
                      type="button"
                      className="table-action"
                      aria-label={`Sell ${card.brand}`}
                      onClick={() => onSellCard(card)}
                    >
                      Sell
                    </button>
                  ) : null}
                  {canManage && ['available', 'in_use'].includes(card.status) ? (
                    <button
                      type="button"
                      className="table-action"
                      aria-label={`Use ${card.brand}`}
                      onClick={() => onUseCard(card)}
                    >
                      Use
                    </button>
                  ) : null}
                  {canManage && ['available', 'reserved', 'in_use'].includes(card.status) ? (
                    <button
                      type="button"
                      className="table-action danger"
                      aria-label={`Void ${card.brand}`}
                      onClick={() => onVoidCard(card)}
                    >
                      Void
                    </button>
                  ) : null}
                  {canManage && card.status === 'sold' ? (
                    <button
                      type="button"
                      className="table-action"
                      aria-label={`Undo sale ${card.brand}`}
                      onClick={() => onUndoSale(card)}
                    >
                      Undo sale
                    </button>
                  ) : null}
                  {!canManage || !['available', 'reserved', 'in_use', 'sold'].includes(card.status) ? (
                    <span className="muted-text">{canManage ? 'No action' : 'Read only'}</span>
                  ) : null}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DealsTable({
  deals,
  canManage,
  onViewDeal,
  onEditDeal,
  onArchiveDeal,
  onUnarchiveDeal,
}: {
  deals: Deal[];
  canManage: boolean;
  onViewDeal: (deal: Deal) => void;
  onEditDeal: (deal: Deal) => void;
  onArchiveDeal: (deal: Deal) => void;
  onUnarchiveDeal: (deal: Deal) => void;
}) {
  if (deals.length === 0) {
    return (
      <div className="empty-state">
        <Tag aria-hidden="true" size={24} />
        <p>No deals yet. Create a deal to group acquisition cost and cards.</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>Name</th>
            <th>Source</th>
            <th>Purchase date</th>
            <th className="numeric">Input cost</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.id}>
              <td>
                <span className={deal.archivedAt ? 'status-badge status-used_up' : 'status-badge status-available'}>
                  {deal.archivedAt ? 'Archived' : 'Active'}
                </span>
              </td>
              <td>
                <button
                  type="button"
                  className="table-link"
                  aria-label={`Open ${deal.name} details`}
                  onClick={() => onViewDeal(deal)}
                >
                  {deal.name}
                </button>
              </td>
              <td>{deal.source || 'Not recorded'}</td>
              <td>{deal.purchaseDate || 'Not recorded'}</td>
              <td className="numeric">{formatMoney(deal.inputTotalCostCents || 0)}</td>
              <td>
                <div className="row-actions">
                  {canManage ? (
                    <button
                      type="button"
                      className="table-action"
                      aria-label={`Edit ${deal.name}`}
                      onClick={() => onEditDeal(deal)}
                    >
                      Edit
                    </button>
                  ) : null}
                  {canManage && deal.archivedAt ? (
                    <button
                      type="button"
                      className="table-action"
                      aria-label={`Unarchive ${deal.name}`}
                      onClick={() => onUnarchiveDeal(deal)}
                    >
                      Unarchive
                    </button>
                  ) : canManage ? (
                    <button
                      type="button"
                      className="table-action"
                      aria-label={`Archive ${deal.name}`}
                      onClick={() => onArchiveDeal(deal)}
                    >
                      Archive
                    </button>
                  ) : (
                    <span className="muted-text">Read only</span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditTable({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="empty-state">
        <ScrollText aria-hidden="true" size={24} />
        <p>No audit events match the current view.</p>
      </div>
    );
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Entity</th>
            <th>Entity ID</th>
            <th>Action</th>
            <th>Request</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td>{formatDateTime(event.timestamp)}</td>
              <td>{event.entityType}</td>
              <td>{event.entityId || 'Not recorded'}</td>
              <td>{event.action}</td>
              <td className="mono">{event.requestId || 'Not recorded'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditFilterForm({ onLoadAudit }: { onLoadAudit: (criteria?: AuditCriteria) => Promise<unknown> }) {
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onLoadAudit({ entityType, action, from, to });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function clearFilter() {
    setEntityType('');
    setAction('');
    setFrom('');
    setTo('');
    setError('');
    setSubmitting(true);
    try {
      await onLoadAudit({});
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="card-search audit-filter" onSubmit={submitFilter}>
      <label>
        <span>Entity type</span>
        <select value={entityType} onChange={(event) => setEntityType(event.target.value)}>
          <option value="">All entities</option>
          <option value="card">Card</option>
          <option value="deal">Deal</option>
          <option value="transaction">Transaction</option>
          <option value="usage">Usage</option>
          <option value="auth">Auth</option>
          <option value="backup">Backup</option>
          <option value="import">Import</option>
          <option value="system">System</option>
        </select>
      </label>
      <label>
        <span>Action</span>
        <input value={action} onChange={(event) => setAction(event.target.value)} />
      </label>
      <label>
        <span>From</span>
        <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
      </label>
      <label>
        <span>To</span>
        <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
      </label>
      <div className="card-search-actions">
        <button type="submit" className="primary-action compact" disabled={submitting}>
          <Search aria-hidden="true" size={17} />
          {submitting ? 'Filtering...' : 'Filter audit'}
        </button>
        <button type="button" className="secondary-action" onClick={clearFilter} disabled={submitting}>
          Clear filter
        </button>
      </div>
      <FieldError message={error} />
    </form>
  );
}

function CardSearchForm({
  deals,
  onSearchCards,
}: {
  deals: Deal[];
  onSearchCards: (criteria?: CardSearchCriteria) => Promise<unknown>;
}) {
  const [cardNumber, setCardNumber] = useState('');
  const [status, setStatus] = useState('');
  const [brand, setBrand] = useState('');
  const [source, setSource] = useState('');
  const [dealId, setDealId] = useState('');
  const [expiresBefore, setExpiresBefore] = useState('');
  const [text, setText] = useState('');
  const [sortValue, setSortValue] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    const [sortBy, sortDir] = sortValue ? sortValue.split(':') : [];
    try {
      await onSearchCards({
        cardNumber,
        status,
        brand,
        source,
        dealId,
        expiresBefore,
        text,
        sortBy,
        sortDir,
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function clearSearch() {
    setError('');
    setCardNumber('');
    setStatus('');
    setBrand('');
    setSource('');
    setDealId('');
    setExpiresBefore('');
    setText('');
    setSortValue('');
    setSubmitting(true);
    try {
      await onSearchCards({
        cardNumber: '',
        status: '',
        brand: '',
        source: '',
        dealId: '',
        expiresBefore: '',
        text: '',
        sortBy: '',
        sortDir: '',
        limit: '',
        offset: 0,
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="card-search" onSubmit={submitSearch}>
      <label>
        <span>Exact credential</span>
        <input
          type="password"
          autoComplete="off"
          value={cardNumber}
          onChange={(event) => setCardNumber(event.target.value)}
        />
      </label>
      <label>
        <span>Status</span>
        <select value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Brand</span>
        <input value={brand} onChange={(event) => setBrand(event.target.value)} />
      </label>
      <label>
        <span>Source</span>
        <input value={source} onChange={(event) => setSource(event.target.value)} />
      </label>
      <label>
        <span>Deal</span>
        <select value={dealId} onChange={(event) => setDealId(event.target.value)}>
          <option value="">All deals</option>
          {deals.map((deal) => (
            <option key={deal.id} value={deal.id}>
              {deal.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Expiring by</span>
        <input
          type="date"
          value={expiresBefore}
          onChange={(event) => setExpiresBefore(event.target.value)}
        />
      </label>
      <label>
        <span>Text</span>
        <input value={text} onChange={(event) => setText(event.target.value)} />
      </label>
      <label>
        <span>Sort</span>
        <select value={sortValue} onChange={(event) => setSortValue(event.target.value)}>
          <option value="">Updated newest</option>
          <option value="expirationDate:asc">Expiration soonest</option>
          <option value="brand:asc">Brand A-Z</option>
          <option value="remainingBalanceCents:desc">Remaining high-low</option>
          <option value="faceValueCents:desc">Face value high-low</option>
        </select>
      </label>
      <div className="card-search-actions">
        <button type="submit" className="primary-action compact" disabled={submitting}>
          <Search aria-hidden="true" size={17} />
          {submitting ? 'Searching...' : 'Search cards'}
        </button>
        <button type="button" className="secondary-action" onClick={clearSearch} disabled={submitting}>
          Clear search
        </button>
      </div>
      <FieldError message={error} />
    </form>
  );
}

function CardsPagination({
  page,
  currentCount,
  onPageCards,
}: {
  page: Page;
  currentCount: number;
  onPageCards: (offset: number) => void;
}) {
  if (!page?.total) {
    return null;
  }

  const start = page.offset + 1;
  const end = page.offset + currentCount;
  const previousOffset = Math.max(page.offset - page.limit, 0);
  const nextOffset = page.offset + page.limit;

  return (
    <div className="pagination-bar" aria-label="Card pagination">
      <span>
        {start}-{end} of {page.total}
      </span>
      <div className="pagination-actions">
        <button
          type="button"
          className="secondary-action"
          aria-label="Previous page"
          disabled={page.offset === 0}
          onClick={() => onPageCards(previousOffset)}
        >
          Previous
        </button>
        <button
          type="button"
          className="secondary-action"
          aria-label="Next page"
          disabled={!page.hasMore}
          onClick={() => onPageCards(nextOffset)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

function ReferenceCombobox({
  label,
  value,
  onChange,
  options,
  required = false,
  placeholder = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReferenceValue[];
  required?: boolean;
  placeholder?: string;
}) {
  const generatedId = useId();
  const inputId = `reference-combobox-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${generatedId}`;
  const listboxId = `${inputId}-listbox`;
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const matches = useMemo(() => filterReferenceOptions(options, value), [options, value]);

  function selectOption(option: ReferenceValue) {
    onChange(option.value);
    setOpen(false);
    setHighlightedIndex(0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((current) => Math.min(current + 1, Math.max(matches.length - 1, 0)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter' && open && matches[highlightedIndex]) {
      event.preventDefault();
      selectOption(matches[highlightedIndex]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div
      className="combobox-field"
      onBlur={(event: FocusEvent<HTMLDivElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <label htmlFor={inputId}>
        <span>{label}</span>
      </label>
      <input
        id={inputId}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open && matches.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={open && matches[highlightedIndex] ? `${listboxId}-${highlightedIndex}` : undefined}
        value={value}
        placeholder={placeholder}
        required={required}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setHighlightedIndex(0);
        }}
      />
      {open && matches.length > 0 ? (
        <ul id={listboxId} className="combobox-menu" role="listbox">
          {matches.map((option, index) => (
            <li
              id={`${listboxId}-${index}`}
              key={`${option.type}-${option.id || option.value}`}
              className={index === highlightedIndex ? 'combobox-option highlighted' : 'combobox-option'}
              role="option"
              aria-selected={index === highlightedIndex}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlightedIndex(index)}
              onClick={() => selectOption(option)}
            >
              <span>{option.value}</span>
              {option.usageCount ? <small>{option.usageCount} uses</small> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ReferenceReviewModal({
  items,
  onClose,
  onConfirm,
  onUseSuggestion,
  submitting,
}: {
  items: ReferenceReviewItem[];
  onClose: VoidHandler;
  onConfirm: (items: ReferenceReviewItem[]) => void;
  onUseSuggestion: (item: ReferenceReviewItem, suggestion: ReferenceValue) => void;
  submitting: boolean;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(items.map((item) => [item.key, true])),
  );
  const dialogRef = useDialogFocus(onClose);

  function toggleItem(key: string, value: boolean) {
    setChecked((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <div className="modal-backdrop review-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="review-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reference-review-title"
      >
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Index review</p>
            <h2 id="reference-review-title">Review new entries</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close index review" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="reference-review-body">
          {items.map((item) => (
            <article className="reference-review-item" key={item.key}>
              <div className="reference-review-heading">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
              {item.suggestions.length > 0 ? (
                <div className="reference-suggestions">
                  <span>Possible typo</span>
                  {item.suggestions.map((suggestion) => (
                    <button
                      key={`${item.key}-${suggestion.id || suggestion.value}`}
                      type="button"
                      className="reference-suggestion"
                      onClick={() => onUseSuggestion(item, suggestion)}
                    >
                      Use {suggestion.value}
                    </button>
                  ))}
                </div>
              ) : null}
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={Boolean(checked[item.key])}
                  onChange={(event) => toggleItem(item.key, event.target.checked)}
                />
                <span>Add to index</span>
              </label>
            </article>
          ))}
          <div className="panel-actions">
            <button type="button" className="secondary-action" onClick={onClose}>
              Back
            </button>
            <button
              type="button"
              className="primary-action"
              disabled={submitting}
              onClick={() => onConfirm(items.filter((item) => checked[item.key]))}
            >
              {submitting ? 'Creating...' : 'Create deal'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function AddDealPanel({
  onClose,
  onCreateDeal,
  referenceValues = defaultReferenceValues,
  onLoadReferenceValues = async () => defaultReferenceValues,
  onUpsertReferenceValues = async (_values?: ReferenceValue[]) => [],
  referenceValueHintsEnabled = true,
  features = defaultFeatureFlags,
}: {
  onClose: VoidHandler;
  onCreateDeal: AsyncApiHandler<ApiPayload, unknown>;
  referenceValues?: ReferenceValueState;
  onLoadReferenceValues?: () => Promise<ReferenceValueState>;
  onUpsertReferenceValues?: (values?: ReferenceValue[]) => Promise<ReferenceValue[]>;
  referenceValueHintsEnabled?: boolean;
  features?: FeatureFlags;
}) {
  const [form, setForm] = useState<AddDealFormState>({
    name: '',
    source: '',
    totalCost: '',
    cardBrand: '',
    faceValue: '',
    credentialProfile: 'merchant_number_pin',
    profileTouched: false,
    cardNumber: '',
    redemptionCode: '',
    pin: '',
    accessCode: '',
    barcodeValue: '',
    barcodeFormat: 'code128',
    expirationMonth: '',
    expirationYear: '',
    networkSecurityCode: '',
    saveNetworkSecurityCode: false,
    billingZip: '',
    cardholderName: '',
    billingAddress: '',
    customFields: [
      {
        id: 'custom-1',
        label: '',
        fieldKind: 'primary_code',
        value: '',
      },
    ],
  });
  const [error, setError] = useState('');
  const [referenceError, setReferenceError] = useState('');
  const [reviewItems, setReviewItems] = useState<ReferenceReviewItem[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus(onClose);
  const loadReferenceValuesRef = useRef(onLoadReferenceValues);

  useEffect(() => {
    loadReferenceValuesRef.current = onLoadReferenceValues;
  }, [onLoadReferenceValues]);

  useEffect(() => {
    let canceled = false;
    if (!referenceValueHintsEnabled) {
      return undefined;
    }
    loadReferenceValuesRef.current().catch((caught) => {
      if (!canceled) {
        setReferenceError(errorMessage(caught));
      }
    });
    return () => {
      canceled = true;
    };
  }, [referenceValueHintsEnabled]);

  function updateField(field: keyof AddDealFormState, value: string | boolean) {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === 'cardBrand' && !current.profileTouched
        ? { credentialProfile: inferCredentialProfileForBrand(String(value)) as AddDealFormState['credentialProfile'] }
        : {}),
    }));
  }

  function updateCredentialProfile(value: AddDealFormState['credentialProfile']) {
    setForm((current) => ({
      ...current,
      credentialProfile: value,
      profileTouched: true,
    }));
  }

  function updateCustomField(id: string, patch: Partial<AddDealCustomField>) {
    setForm((current) => ({
      ...current,
      customFields: current.customFields.map((field) =>
        field.id === id ? { ...field, ...patch } : field,
      ),
    }));
  }

  function addCustomField() {
    setForm((current) => ({
      ...current,
      customFields: [
        ...current.customFields,
        {
          id: `custom-${current.customFields.length + 1}-${Date.now()}`,
          label: '',
          fieldKind: 'primary_code',
          value: '',
        },
      ],
    }));
  }

  function removeCustomField(id: string) {
    setForm((current) => ({
      ...current,
      customFields:
        current.customFields.length > 1
          ? current.customFields.filter((field) => field.id !== id)
          : current.customFields,
    }));
  }

  function credentialFields(): CredentialField[] {
    const fields: CredentialField[] = [];
    const push = (
      fieldKey: string,
      label: string,
      fieldKind: CredentialFieldKind,
      value: string,
      extra: Partial<CredentialField> = {},
    ) => {
      if (!String(value || '').trim()) {
        return;
      }
      fields.push({
        fieldKey,
        label,
        fieldKind,
        value: String(value).trim(),
        ...extra,
      });
    };

    if (form.credentialProfile === 'claim_code') {
      push('primary_code', 'Code / PIN / Claim code', 'primary_code', form.redemptionCode);
      return fields;
    }

    if (form.credentialProfile === 'barcode') {
      push('barcode_value', 'Barcode', 'barcode_value', form.barcodeValue, {
        barcodeFormat: form.barcodeFormat,
      });
      return fields;
    }

    if (form.credentialProfile === 'network_prepaid') {
      push('card_number', 'Card number', 'card_number', form.cardNumber);
      push('expiration_month', 'Exp. month', 'expiration_month', form.expirationMonth);
      push('expiration_year', 'Exp. year', 'expiration_year', form.expirationYear);
      if (features.networkSecurityCodeStorage && form.saveNetworkSecurityCode) {
        push('network_security_code', 'Security code', 'network_security_code', form.networkSecurityCode);
      }
      push('billing_postal_code', 'Billing ZIP', 'billing_postal_code', form.billingZip);
      push('cardholder_name', 'Cardholder name', 'cardholder_name', form.cardholderName);
      push('billing_address', 'Billing address', 'billing_address', form.billingAddress);
      return fields;
    }

    if (form.credentialProfile === 'custom') {
      form.customFields.forEach((field, index) => {
        const label = field.label.trim();
        const value = field.value.trim();
        if (!label || !value) {
          return;
        }
        push(label, label, field.fieldKind, value, {
          sortOrder: (index + 1) * 10,
          ...(field.fieldKind === 'barcode_value' ? { barcodeFormat: 'code128' } : {}),
        });
      });
      return fields;
    }

    if (form.credentialProfile === 'merchant_number_access') {
      push('card_number', 'Card number', 'card_number', form.cardNumber);
      push('access_code', 'Access code', 'access_code', form.accessCode);
      return fields;
    }

    push('card_number', 'Card number', 'card_number', form.cardNumber);
    push('pin', 'PIN', 'pin', form.pin);
    return fields;
  }

  function dealPayload(totalCostCents: number | undefined, faceValueCents: number) {
    const profile = form.credentialProfile === 'merchant_number_access'
      ? 'merchant_number_pin'
      : form.credentialProfile;
    const fields = credentialFields();
    const network = profile === 'network_prepaid'
      ? inferNetworkFromBrand(form.cardBrand)
      : null;
    return {
      ...(form.name.trim() ? { name: form.name.trim() } : {}),
      ...(form.source.trim() ? { source: form.source.trim() } : {}),
      ...(totalCostCents !== undefined ? { totalCostCents } : {}),
      cards: [
        {
          brand: form.cardBrand.trim(),
          cardType: profile === 'network_prepaid' ? 'prepaid' : 'merchant',
          credentialProfile: profile,
          credentials: {
            profile,
            fields,
          },
          ...(network ? { network } : {}),
          ...(form.cardNumber.trim() && ['merchant_number_pin', 'network_prepaid'].includes(profile)
            ? { cardNumber: form.cardNumber.trim() }
            : {}),
          ...(form.pin.trim() && form.credentialProfile === 'merchant_number_pin' ? { pin: form.pin.trim() } : {}),
          ...(form.billingZip.trim() && profile === 'network_prepaid' ? { billingZip: form.billingZip.trim() } : {}),
          faceValueCents,
        },
      ],
    };
  }

  async function createDeal({
    skipReview = false,
    approvedReferenceItems = [],
  }: {
    skipReview?: boolean;
    approvedReferenceItems?: ReferenceReviewItem[];
  } = {}) {
    setError('');

    const totalCostCents = dollarsToCents(form.totalCost);
    const faceValueCents = dollarsToCents(form.faceValue);

    if (!form.cardBrand.trim() || !faceValueCents) {
      setError('Card brand and face value are required.');
      return;
    }
    const missingReferenceItems = referenceValueHintsEnabled
      ? buildReferenceReviewItems(form, referenceValues)
      : [];
    if (!skipReview && missingReferenceItems.length > 0) {
      setReviewItems(missingReferenceItems);
      return;
    }

    setSubmitting(true);
    try {
      const referenceTouches = referenceValueHintsEnabled
        ? buildReferenceTouchValues(form, referenceValues, approvedReferenceItems)
        : [];
      if (referenceTouches.length > 0) {
        await onUpsertReferenceValues(referenceTouches);
      }
      await onCreateDeal(dealPayload(totalCostCents, faceValueCents));
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitDeal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await createDeal();
  }

  function useSuggestion(item: ReferenceReviewItem, suggestion: ReferenceValue) {
    updateField(item.field, suggestion.value);
    setReviewItems([]);
    setError('');
  }

  function renderCredentialInputs() {
    if (form.credentialProfile === 'claim_code') {
      return (
        <div className="credential-mode-block">
          <label>
            <span>Code / PIN / Claim code</span>
            <input
              className="mono"
              autoComplete="off"
              value={form.redemptionCode}
              onChange={(event) => updateField('redemptionCode', event.target.value)}
            />
          </label>
          <p className="muted-text">
            Use this for one-secret cards such as DoorDash, Uber, Amazon-style claim codes, or cards that call the only redeemable value a PIN.
          </p>
        </div>
      );
    }

    if (form.credentialProfile === 'barcode') {
      return (
        <div className="credential-mode-block">
          <label>
            <span>Barcode value</span>
            <input
              className="mono"
              autoComplete="off"
              value={form.barcodeValue}
              onChange={(event) => updateField('barcodeValue', event.target.value)}
            />
          </label>
          <label>
            <span>Barcode format</span>
            <select value={form.barcodeFormat} onChange={(event) => updateField('barcodeFormat', event.target.value)}>
              <option value="code128">Code 128</option>
              <option value="qr">QR</option>
              <option value="ean13">EAN-13</option>
              <option value="upca">UPC-A</option>
              <option value="pdf417">PDF417</option>
              <option value="other">Other</option>
            </select>
          </label>
          <p className="muted-text">
            Use Custom if the barcode card also needs a separate PIN or issuer-specific field.
          </p>
        </div>
      );
    }

    if (form.credentialProfile === 'network_prepaid') {
      return (
        <>
          <label>
            <span>Card number</span>
            <input
              className="mono"
              inputMode="numeric"
              autoComplete="cc-number"
              value={form.cardNumber}
              onChange={(event) => updateField('cardNumber', event.target.value)}
            />
          </label>
          <div className="inline-fields">
            <label>
              <span>Exp. month</span>
              <input
                inputMode="numeric"
                autoComplete="cc-exp-month"
                value={form.expirationMonth}
                onChange={(event) => updateField('expirationMonth', event.target.value)}
              />
            </label>
            <label>
              <span>Exp. year</span>
              <input
                inputMode="numeric"
                autoComplete="cc-exp-year"
                value={form.expirationYear}
                onChange={(event) => updateField('expirationYear', event.target.value)}
              />
            </label>
          </div>
          {features.networkSecurityCodeStorage ? (
            <>
              <p className="warning-copy">
                Security-code storage is local-only and should stay disabled for hosted or commercial use.
              </p>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={form.saveNetworkSecurityCode}
                  onChange={(event) => updateField('saveNetworkSecurityCode', event.target.checked)}
                />
                <span>Save security code for this local vault</span>
              </label>
              {form.saveNetworkSecurityCode ? (
                <label>
                  <span>Security code</span>
                  <input
                    className="mono"
                    inputMode="numeric"
                    autoComplete="cc-csc"
                    value={form.networkSecurityCode}
                    onChange={(event) => updateField('networkSecurityCode', event.target.value)}
                  />
                </label>
              ) : null}
            </>
          ) : (
            <p className="muted-text">
              Network-card security codes are not saved. Keep the physical card or original source available.
            </p>
          )}
          <label>
            <span>Billing ZIP</span>
            <input
              autoComplete="postal-code"
              value={form.billingZip}
              onChange={(event) => updateField('billingZip', event.target.value)}
            />
          </label>
          <label>
            <span>Cardholder name</span>
            <input
              autoComplete="cc-name"
              value={form.cardholderName}
              onChange={(event) => updateField('cardholderName', event.target.value)}
            />
          </label>
          <label>
            <span>Billing address</span>
            <textarea
              value={form.billingAddress}
              onChange={(event) => updateField('billingAddress', event.target.value)}
            />
          </label>
        </>
      );
    }

    if (form.credentialProfile === 'custom') {
      return (
        <div className="custom-credential-list">
          {form.customFields.map((field, index) => (
            <div className="custom-credential-row" key={field.id}>
              <label>
                <span>Label</span>
                <input
                  value={field.label}
                  onChange={(event) => updateCustomField(field.id, { label: event.target.value })}
                />
              </label>
              <label>
                <span>Type</span>
                <select
                  value={field.fieldKind}
                  onChange={(event) => updateCustomField(field.id, { fieldKind: event.target.value as CredentialFieldKind })}
                >
                  {customCredentialFieldKinds.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Value</span>
                <input
                  className="mono"
                  autoComplete="off"
                  value={field.value}
                  onChange={(event) => updateCustomField(field.id, { value: event.target.value })}
                />
              </label>
              <button
                type="button"
                className="table-action"
                disabled={form.customFields.length === 1}
                onClick={() => removeCustomField(field.id)}
              >
                Remove field {index + 1}
              </button>
            </div>
          ))}
          <button type="button" className="secondary-action compact" onClick={addCustomField}>
            <Plus aria-hidden="true" size={16} />
            Add custom field
          </button>
        </div>
      );
    }

    if (form.credentialProfile === 'merchant_number_access') {
      return (
        <div className="credential-mode-block">
          <label>
            <span>Card number</span>
            <input
              className="mono"
              autoComplete="off"
              value={form.cardNumber}
              onChange={(event) => updateField('cardNumber', event.target.value)}
            />
          </label>
          <label>
            <span>Access code</span>
            <input
              className="mono"
              autoComplete="off"
              value={form.accessCode}
              onChange={(event) => updateField('accessCode', event.target.value)}
            />
          </label>
          <p className="muted-text">
            Use this for Target-style cards that ask for a card number plus Access Number or PIN.
          </p>
        </div>
      );
    }

    return (
      <div className="credential-mode-block">
        <label>
          <span>Card number</span>
          <input
            className="mono"
            autoComplete="off"
            value={form.cardNumber}
            onChange={(event) => updateField('cardNumber', event.target.value)}
          />
        </label>
        <label>
          <span>PIN</span>
          <input
            className="mono"
            autoComplete="off"
            value={form.pin}
            onChange={(event) => updateField('pin', event.target.value)}
          />
        </label>
        <p className="muted-text">
          Use this for Best Buy, Home Depot, and similar cards that ask for a gift-card number plus PIN.
        </p>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={dialogRef} className="slide-panel" role="dialog" aria-modal="true" aria-labelledby="add-deal-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Acquisition</p>
            <h2 id="add-deal-title">Add deal</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close add deal" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <form className="panel-form" onSubmit={submitDeal}>
          <ReferenceCombobox
            label="Deal name (optional)"
            value={form.name}
            options={referenceValues[referenceValueTypes.dealName]}
            placeholder="Optional"
            onChange={(value) => updateField('name', value)}
          />
          <ReferenceCombobox
            label="Source"
            value={form.source}
            options={referenceValues[referenceValueTypes.source]}
            onChange={(value) => updateField('source', value)}
          />
          <label>
            <span>Total cost</span>
            <input
              inputMode="decimal"
              placeholder="45.00"
              value={form.totalCost}
              onChange={(event) => updateField('totalCost', event.target.value)}
            />
          </label>
          <div className="form-divider" />
          <ReferenceCombobox
            label="Card brand"
            value={form.cardBrand}
            options={referenceValues[referenceValueTypes.cardBrand]}
            required
            onChange={(value) => updateField('cardBrand', value)}
          />
          <label>
            <span>Face value</span>
            <input
              inputMode="decimal"
              placeholder="50.00"
              value={form.faceValue}
              onChange={(event) => updateField('faceValue', event.target.value)}
              required
            />
          </label>
          <label>
            <span>Credential type</span>
            <select
              value={form.credentialProfile}
              onChange={(event) => updateCredentialProfile(event.target.value as AddDealFormState['credentialProfile'])}
            >
              {credentialProfileOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {renderCredentialInputs()}
          {referenceError ? <FieldError message={`Suggestions unavailable: ${referenceError}`} /> : null}
          <FieldError message={error} />
          <div className="panel-actions">
            <button type="button" className="secondary-action" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action" disabled={submitting}>
              <Plus aria-hidden="true" size={17} />
              {submitting ? 'Creating...' : 'Create deal'}
            </button>
          </div>
        </form>
      </section>
      {reviewItems.length > 0 ? (
        <ReferenceReviewModal
          items={reviewItems}
          submitting={submitting}
          onClose={() => setReviewItems([])}
          onUseSuggestion={useSuggestion}
          onConfirm={(approvedReferenceItems) => {
            setReviewItems([]);
            void createDeal({ skipReview: true, approvedReferenceItems });
          }}
        />
      ) : null}
    </div>
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
