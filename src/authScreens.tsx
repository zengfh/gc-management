import { useState, type FormEvent } from 'react';
import { KeyRound, Lock, RefreshCw, ShieldCheck } from 'lucide-react';
import type { AsyncApiHandler } from './appTypes';
import { errorMessage } from './display';
import { FieldError } from './formUi';

export function SetupScreen({ onSetup }: { onSetup: AsyncApiHandler<{ email: string; displayName: string; unlockSecret: string }> }) {
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

export function UnlockScreen({
  onLogin,
  onPasskeyLogin,
  onAcceptInvite,
  onRecoverAccess,
}: {
  onLogin: AsyncApiHandler<{ email: string; unlockSecret: string }>;
  onPasskeyLogin: AsyncApiHandler<{ email: string }>;
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

  async function submitPasskeyLogin() {
    setError('');
    setSubmitting(true);
    try {
      await onPasskeyLogin({ email: email.trim() });
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
            <button type="button" className="secondary-action" disabled={submitting} onClick={submitPasskeyLogin}>
              <KeyRound aria-hidden="true" size={18} />
              Use passkey
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
