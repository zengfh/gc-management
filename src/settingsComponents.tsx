import { useState, type ChangeEvent, type FormEvent } from 'react';
import { AlertTriangle, Bell, Download, Lock, RefreshCw, ShieldCheck } from 'lucide-react';
import type { ApiResponse, AuthUser, DataPolicy, SupportPolicy, UserInvite } from '../shared/domain';
import type { ApiPayload, AsyncApiHandler, CountSummary, NotificationTestSummary, PortableExportPayload } from './appTypes';
import { errorMessage, formatDateTime, formatDisplayValue } from './display';
import { downloadJsonFile } from './fileHelpers';
import { FieldError } from './formUi';

export function UserAdminPanel({
  users,
  invites,
  loading,
  loaded,
  error,
  onCreateInvite,
  onRevokeInvite,
  onUpdateUser,
}: {
  users: AuthUser[];
  invites: UserInvite[];
  loading: boolean;
  loaded: boolean;
  error: string;
  onCreateInvite: AsyncApiHandler<ApiPayload, UserInvite>;
  onRevokeInvite: (inviteId: string) => Promise<UserInvite>;
  onUpdateUser: (userId: string, payload: ApiPayload) => Promise<AuthUser>;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('operator');
  const [currentUnlockSecret, setCurrentUnlockSecret] = useState('');
  const [createdInvite, setCreatedInvite] = useState<UserInvite | null>(null);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const created = await onCreateInvite({
        currentUnlockSecret,
        email,
        displayName,
        role,
      });
      setEmail('');
      setDisplayName('');
      setRole('operator');
      setCurrentUnlockSecret('');
      setCreatedInvite(created);
      setSuccess(`Invite created for ${created.displayName}.`);
    } catch (caught) {
      setFormError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="user-admin-stack">
      {loading ? <div className="loading-strip inline-loading">Loading users...</div> : null}
      <FieldError message={error} />
      {loaded ? (
        <div className="table-wrap" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last login</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <UserAdminRow key={user.id} user={user} onUpdateUser={onUpdateUser} />
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {loaded && invites?.length ? (
        <div className="table-wrap" tabIndex={0}>
          <table>
            <thead>
              <tr>
                <th>Pending invite</th>
                <th>Role</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invites.map((invite) => (
                <tr key={invite.id}>
                  <td>
                    <strong>{invite.displayName}</strong>
                    <span className="muted-block">{invite.email}</span>
                  </td>
                  <td>{formatDisplayValue(invite.role)}</td>
                  <td>{formatDateTime(invite.expiresAt)}</td>
                  <td>
                    <button
                      type="button"
                      className="table-action danger"
                      onClick={() => {
                        void onRevokeInvite(invite.id);
                      }}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <form className="settings-form user-create-form" onSubmit={submitCreate}>
        <label>
          <span>User email</span>
          <input
            type="email"
            value={email}
            autoComplete="off"
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>
        <label>
          <span>Display name</span>
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
        </label>
        <label>
          <span>Role</span>
          <select value={role} onChange={(event) => setRole(event.target.value)}>
            <option value="operator">Operator</option>
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <label>
          <span>Your unlock secret</span>
          <input
            type="password"
            autoComplete="current-password"
            value={currentUnlockSecret}
            onChange={(event) => setCurrentUnlockSecret(event.target.value)}
            required
          />
        </label>
        <div className="backup-actions">
          <button type="submit" className="primary-action" disabled={submitting}>
            <ShieldCheck aria-hidden="true" size={17} />
            {submitting ? 'Creating...' : 'Create invite'}
          </button>
        </div>
        <FieldError message={formError} />
        {success ? <p className="success-copy">{success}</p> : null}
        {createdInvite?.inviteCode ? (
          <div className="one-time-secret" role="status">
            <span>Invite code shown once</span>
            <code>{createdInvite.inviteCode}</code>
          </div>
        ) : null}
      </form>
    </div>
  );
}

function UserAdminRow({
  user,
  onUpdateUser,
}: {
  user: AuthUser;
  onUpdateUser: (userId: string, payload: ApiPayload) => Promise<AuthUser>;
}) {
  const [role, setRole] = useState(user.role);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function updateRole(event: ChangeEvent<HTMLSelectElement>) {
    const nextRole = event.target.value as AuthUser['role'];
    setRole(nextRole);
    setError('');
    setSubmitting(true);
    try {
      await onUpdateUser(user.id, { role: nextRole });
    } catch (caught) {
      setRole(user.role);
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleDisabled() {
    setError('');
    setSubmitting(true);
    try {
      await onUpdateUser(user.id, { disabled: !user.disabledAt });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <tr>
      <td>
        <strong>{user.displayName}</strong>
        <span className="muted-block">{user.email || 'No email'}</span>
        <FieldError message={error} />
      </td>
      <td>
        <select
          value={role}
          onChange={updateRole}
          disabled={submitting || user.role === 'owner'}
          aria-label={`Role for ${user.displayName}`}
        >
          <option value="owner">Owner</option>
          <option value="admin">Admin</option>
          <option value="operator">Operator</option>
          <option value="viewer">Viewer</option>
        </select>
      </td>
      <td>{user.disabledAt ? 'Disabled' : 'Active'}</td>
      <td>{formatDateTime(user.lastLoginAt)}</td>
      <td>
        <button
          type="button"
          className={user.disabledAt ? 'table-action' : 'table-action danger'}
          onClick={toggleDisabled}
          disabled={submitting || user.role === 'owner'}
          aria-label={`${user.disabledAt ? 'Enable' : 'Disable'} ${user.displayName}`}
        >
          {user.disabledAt ? 'Enable' : 'Disable'}
        </button>
      </td>
    </tr>
  );
}

export function RecoveryCodesPanel({
  activeCount,
  onGenerateRecoveryCodes,
}: {
  activeCount?: number | undefined;
  onGenerateRecoveryCodes: AsyncApiHandler<{ currentUnlockSecret: string }, { codes: string[]; activeCount: number }>;
}) {
  const [currentUnlockSecret, setCurrentUnlockSecret] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function generateCodes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setCodes([]);
    setSubmitting(true);
    try {
      const response = await onGenerateRecoveryCodes({ currentUnlockSecret });
      setCodes(response.codes || []);
      setCurrentUnlockSecret('');
      setSuccess('Recovery codes regenerated. Store them now; they are shown once.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="settings-form" onSubmit={generateCodes}>
      <p className="muted-text">
        Active recovery codes: {activeCount || 0}. Regenerating codes revokes any unused older codes.
      </p>
      <label>
        <span>Recovery setup unlock secret</span>
        <input
          type="password"
          autoComplete="current-password"
          value={currentUnlockSecret}
          onChange={(event) => setCurrentUnlockSecret(event.target.value)}
          required
        />
      </label>
      <div className="backup-actions">
        <button type="submit" className="primary-action" disabled={submitting}>
          <ShieldCheck aria-hidden="true" size={17} />
          {submitting ? 'Generating...' : 'Generate recovery codes'}
        </button>
      </div>
      <FieldError message={error} />
      {success ? <p className="success-copy">{success}</p> : null}
      {codes.length ? (
        <div className="recovery-code-grid" aria-label="New recovery codes">
          {codes.map((code) => (
            <code key={code}>{code}</code>
          ))}
        </div>
      ) : null}
    </form>
  );
}

export function SupportPolicyForm({
  policy,
  onUpdateSupportPolicy,
}: {
  policy: SupportPolicy;
  onUpdateSupportPolicy: AsyncApiHandler<ApiPayload, ApiResponse<SupportPolicy>>;
}) {
  const [supportAccessEnabled, setSupportAccessEnabled] = useState(policy.supportAccessEnabled);
  const [supportContact, setSupportContact] = useState(policy.supportContact || '');
  const [supportPolicyUrl, setSupportPolicyUrl] = useState(policy.supportPolicyUrl || '');
  const [supportNotes, setSupportNotes] = useState(policy.supportNotes || '');
  const [unlockSecret, setUnlockSecret] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      await onUpdateSupportPolicy({
        unlockSecret,
        supportAccessEnabled,
        supportContact,
        supportPolicyUrl,
        supportNotes,
      });
      setUnlockSecret('');
      setSuccess('Support policy saved.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="settings-form" onSubmit={submitPolicy}>
      <label className="check-row settings-check">
        <input
          type="checkbox"
          checked={supportAccessEnabled}
          onChange={(event) => setSupportAccessEnabled(event.target.checked)}
        />
        <span>Support access enabled</span>
      </label>
      <label>
        <span>Support contact</span>
        <input value={supportContact} onChange={(event) => setSupportContact(event.target.value)} />
      </label>
      <label>
        <span>Support policy URL</span>
        <input value={supportPolicyUrl} onChange={(event) => setSupportPolicyUrl(event.target.value)} />
      </label>
      <label>
        <span>Support notes</span>
        <textarea value={supportNotes} onChange={(event) => setSupportNotes(event.target.value)} rows={3} />
      </label>
      <label>
        <span>Support policy unlock secret</span>
        <input
          type="password"
          value={unlockSecret}
          autoComplete="current-password"
          onChange={(event) => setUnlockSecret(event.target.value)}
        />
      </label>
      <div className="settings-summary-grid">
        <span className="metric-tile">
          <small>Last updated</small>
          <strong>{formatDateTime(policy.supportUpdatedAt)}</strong>
        </span>
      </div>
      <div className="backup-actions">
        <button type="submit" className="primary-action" disabled={submitting}>
          <ShieldCheck aria-hidden="true" size={17} />
          {submitting ? 'Saving...' : 'Save support policy'}
        </button>
      </div>
      <FieldError message={error} />
      {success ? <p className="success-copy">{success}</p> : null}
    </form>
  );
}

export function DataPolicyForm({
  policy,
  onUpdateDataPolicy,
}: {
  policy: DataPolicy;
  onUpdateDataPolicy: AsyncApiHandler<ApiPayload, ApiResponse<DataPolicy>>;
}) {
  const [auditRetentionDays, setAuditRetentionDays] = useState(String(policy.auditRetentionDays));
  const [idempotencyRetentionDays, setIdempotencyRetentionDays] = useState(String(policy.idempotencyRetentionDays));
  const [sessionRetentionDays, setSessionRetentionDays] = useState(String(policy.sessionRetentionDays));
  const [loginAttemptRetentionDays, setLoginAttemptRetentionDays] = useState(String(policy.loginAttemptRetentionDays));
  const [unlockSecret, setUnlockSecret] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitPolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      await onUpdateDataPolicy({
        unlockSecret,
        auditRetentionDays: Number(auditRetentionDays),
        idempotencyRetentionDays: Number(idempotencyRetentionDays),
        sessionRetentionDays: Number(sessionRetentionDays),
        loginAttemptRetentionDays: Number(loginAttemptRetentionDays),
      });
      setUnlockSecret('');
      setSuccess('Data policy saved.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="settings-form" onSubmit={submitPolicy}>
      <label>
        <span>Audit retention days</span>
        <input
          type="number"
          min="1"
          max="3650"
          value={auditRetentionDays}
          onChange={(event) => setAuditRetentionDays(event.target.value)}
        />
      </label>
      <label>
        <span>Idempotency retention days</span>
        <input
          type="number"
          min="1"
          max="3650"
          value={idempotencyRetentionDays}
          onChange={(event) => setIdempotencyRetentionDays(event.target.value)}
        />
      </label>
      <label>
        <span>Session retention days</span>
        <input
          type="number"
          min="1"
          max="3650"
          value={sessionRetentionDays}
          onChange={(event) => setSessionRetentionDays(event.target.value)}
        />
      </label>
      <label>
        <span>Login attempt retention days</span>
        <input
          type="number"
          min="1"
          max="3650"
          value={loginAttemptRetentionDays}
          onChange={(event) => setLoginAttemptRetentionDays(event.target.value)}
        />
      </label>
      <label>
        <span>Data policy unlock secret</span>
        <input
          type="password"
          value={unlockSecret}
          autoComplete="current-password"
          onChange={(event) => setUnlockSecret(event.target.value)}
        />
      </label>
      <div className="backup-actions">
        <button type="submit" className="primary-action" disabled={submitting}>
          <ShieldCheck aria-hidden="true" size={17} />
          {submitting ? 'Saving...' : 'Save data policy'}
        </button>
      </div>
      <FieldError message={error} />
      {success ? <p className="success-copy">{success}</p> : null}
    </form>
  );
}

export function DataOperationsPanel({
  onExportAccountData,
  onRunRetention,
  onSendExpirationNotificationTest,
  onDeleteAccountData,
}: {
  onExportAccountData: AsyncApiHandler<ApiPayload, ApiResponse<PortableExportPayload>>;
  onRunRetention: AsyncApiHandler<ApiPayload, ApiResponse<{ counts?: CountSummary }>>;
  onSendExpirationNotificationTest: AsyncApiHandler<ApiPayload, ApiResponse<NotificationTestSummary>>;
  onDeleteAccountData: AsyncApiHandler<ApiPayload, ApiResponse<{ counts?: CountSummary }>>;
}) {
  const [exportUnlockSecret, setExportUnlockSecret] = useState('');
  const [exportConfirmation, setExportConfirmation] = useState('');
  const [exportError, setExportError] = useState('');
  const [exportSuccess, setExportSuccess] = useState('');
  const [exporting, setExporting] = useState(false);
  const [retentionUnlockSecret, setRetentionUnlockSecret] = useState('');
  const [retentionConfirmation, setRetentionConfirmation] = useState('');
  const [retentionError, setRetentionError] = useState('');
  const [retentionSuccess, setRetentionSuccess] = useState('');
  const [retentionRunning, setRetentionRunning] = useState(false);
  const [notificationError, setNotificationError] = useState('');
  const [notificationSuccess, setNotificationSuccess] = useState('');
  const [notificationSending, setNotificationSending] = useState(false);
  const [deleteUnlockSecret, setDeleteUnlockSecret] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteSuccess, setDeleteSuccess] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function submitExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setExportError('');
    setExportSuccess('');
    setExporting(true);
    try {
      const response = await onExportAccountData({
        unlockSecret: exportUnlockSecret,
        confirmation: exportConfirmation,
      });
      const payload = response.data;
      const exportedDate = (payload?.exportedAt || new Date().toISOString()).slice(0, 10);
      downloadJsonFile(`gift-card-sanitized-export-${exportedDate}.json`, payload);
      setExportUnlockSecret('');
      setExportConfirmation('');
      setExportSuccess(`Sanitized export prepared with ${payload?.counts?.cards || 0} cards.`);
    } catch (caught) {
      setExportError(errorMessage(caught));
    } finally {
      setExporting(false);
    }
  }

  async function submitRetention(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRetentionError('');
    setRetentionSuccess('');
    setRetentionRunning(true);
    try {
      const response = await onRunRetention({
        unlockSecret: retentionUnlockSecret,
        confirmation: retentionConfirmation,
      });
      const counts = response.data.counts || {};
      setRetentionUnlockSecret('');
      setRetentionConfirmation('');
      setRetentionSuccess(`Retention purged ${counts.auditLog || 0} audit rows and ${counts.idempotencyKeys || 0} idempotency rows.`);
    } catch (caught) {
      setRetentionError(errorMessage(caught));
    } finally {
      setRetentionRunning(false);
    }
  }

  async function submitDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setDeleteError('');
    setDeleteSuccess('');
    setDeleting(true);
    try {
      const response = await onDeleteAccountData({
        unlockSecret: deleteUnlockSecret,
        confirmation: deleteConfirmation,
      });
      const counts = response.data.counts || {};
      setDeleteUnlockSecret('');
      setDeleteConfirmation('');
      setDeleteSuccess(`Deleted ${counts.cards || 0} cards and ${counts.deals || 0} deals.`);
    } catch (caught) {
      setDeleteError(errorMessage(caught));
    } finally {
      setDeleting(false);
    }
  }

  async function sendNotificationTest() {
    setNotificationError('');
    setNotificationSuccess('');
    setNotificationSending(true);
    try {
      const response = await onSendExpirationNotificationTest({});
      const summary = response.data || {};
      const sent = summary.sentEmails || 0;
      const skipped = summary.skipped?.length ? ` ${summary.skipped.join(' ')}` : '';
      setNotificationSuccess(`Sent ${sent} expiration notification test email${sent === 1 ? '' : 's'}.${skipped}`);
    } catch (caught) {
      setNotificationError(errorMessage(caught));
    } finally {
      setNotificationSending(false);
    }
  }

  return (
    <div className="data-operations-grid">
      <form className="settings-form" onSubmit={submitExport}>
        <label>
          <span>Sanitized export unlock secret</span>
          <input
            type="password"
            value={exportUnlockSecret}
            autoComplete="current-password"
            onChange={(event) => setExportUnlockSecret(event.target.value)}
          />
        </label>
        <label>
          <span>Type EXPORT to confirm</span>
          <input
            value={exportConfirmation}
            autoCapitalize="characters"
            onChange={(event) => setExportConfirmation(event.target.value)}
          />
        </label>
        <div className="backup-actions">
          <button type="submit" className="primary-action" disabled={exporting}>
            <Download aria-hidden="true" size={17} />
            {exporting ? 'Exporting...' : 'Export sanitized data'}
          </button>
        </div>
        <FieldError message={exportError} />
        {exportSuccess ? <p className="success-copy">{exportSuccess}</p> : null}
      </form>

      <form className="settings-form" onSubmit={submitRetention}>
        <label>
          <span>Retention unlock secret</span>
          <input
            type="password"
            value={retentionUnlockSecret}
            autoComplete="current-password"
            onChange={(event) => setRetentionUnlockSecret(event.target.value)}
          />
        </label>
        <label>
          <span>Type PURGE to confirm</span>
          <input
            value={retentionConfirmation}
            autoCapitalize="characters"
            onChange={(event) => setRetentionConfirmation(event.target.value)}
          />
        </label>
        <div className="backup-actions">
          <button type="submit" className="primary-action" disabled={retentionRunning}>
            <RefreshCw aria-hidden="true" size={17} />
            {retentionRunning ? 'Purging...' : 'Run retention purge'}
          </button>
        </div>
        <FieldError message={retentionError} />
        {retentionSuccess ? <p className="success-copy">{retentionSuccess}</p> : null}
      </form>

      <div className="settings-form">
        <div className="backup-actions">
          <button type="button" className="primary-action" disabled={notificationSending} onClick={sendNotificationTest}>
            <Bell aria-hidden="true" size={17} />
            {notificationSending ? 'Sending...' : 'Send expiration email test'}
          </button>
        </div>
        <FieldError message={notificationError} />
        {notificationSuccess ? <p className="success-copy">{notificationSuccess}</p> : null}
      </div>

      <form className="settings-form" onSubmit={submitDelete}>
        <div className="warning-copy danger-warning">
          <AlertTriangle aria-hidden="true" size={18} />
          <span>Inventory deletion removes cards, deals, usage, sale history, import jobs, and idempotency records.</span>
        </div>
        <label>
          <span>Delete inventory unlock secret</span>
          <input
            type="password"
            value={deleteUnlockSecret}
            autoComplete="current-password"
            onChange={(event) => setDeleteUnlockSecret(event.target.value)}
          />
        </label>
        <label>
          <span>Type DELETE_ACCOUNT_DATA to confirm</span>
          <input
            value={deleteConfirmation}
            autoCapitalize="characters"
            onChange={(event) => setDeleteConfirmation(event.target.value)}
          />
        </label>
        <div className="backup-actions">
          <button type="submit" className="primary-action danger" disabled={deleting}>
            <AlertTriangle aria-hidden="true" size={17} />
            {deleting ? 'Deleting...' : 'Delete inventory data'}
          </button>
        </div>
        <FieldError message={deleteError} />
        {deleteSuccess ? <p className="success-copy">{deleteSuccess}</p> : null}
      </form>
    </div>
  );
}

export function ChangeUnlockSecretForm({ onChangeUnlockSecret }: { onChangeUnlockSecret: AsyncApiHandler<ApiPayload, ApiResponse<unknown>> }) {
  const [oldUnlockSecret, setOldUnlockSecret] = useState('');
  const [newUnlockSecret, setNewUnlockSecret] = useState('');
  const [confirmUnlockSecret, setConfirmUnlockSecret] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (newUnlockSecret !== confirmUnlockSecret) {
      setError('New unlock secrets do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await onChangeUnlockSecret({ oldUnlockSecret, newUnlockSecret });
      setOldUnlockSecret('');
      setNewUnlockSecret('');
      setConfirmUnlockSecret('');
      setSuccess('Unlock secret changed.');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="settings-form" onSubmit={submitChange}>
      <label>
        <span>Current unlock secret</span>
        <input
          type="password"
          value={oldUnlockSecret}
          autoComplete="current-password"
          onChange={(event) => setOldUnlockSecret(event.target.value)}
        />
      </label>
      <label>
        <span>New unlock secret</span>
        <input
          type="password"
          value={newUnlockSecret}
          autoComplete="new-password"
          onChange={(event) => setNewUnlockSecret(event.target.value)}
        />
      </label>
      <label>
        <span>Confirm new unlock secret</span>
        <input
          type="password"
          value={confirmUnlockSecret}
          autoComplete="new-password"
          onChange={(event) => setConfirmUnlockSecret(event.target.value)}
        />
      </label>
      <div className="backup-actions">
        <button type="submit" className="primary-action" disabled={submitting}>
          <Lock aria-hidden="true" size={17} />
          {submitting ? 'Changing...' : 'Change unlock secret'}
        </button>
      </div>
      <FieldError message={error} />
      {success ? <p className="success-copy">{success}</p> : null}
    </form>
  );
}
