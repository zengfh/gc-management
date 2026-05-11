import { useEffect, useMemo, useState } from 'react';
import {
  CircleDollarSign,
  CreditCard,
  FilePlus2,
  LayoutDashboard,
  Lock,
  LogOut,
  PackageCheck,
  Plus,
  RefreshCw,
  ShieldCheck,
  Tag,
} from 'lucide-react';

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'cards', label: 'Cards', icon: CreditCard },
  { id: 'deals', label: 'Deals', icon: Tag },
];

const statusLabels = {
  available: 'Available',
  reserved: 'Reserved',
  in_use: 'In Use',
  sold: 'Sold',
  used_up: 'Used Up',
  void: 'Void',
};

async function apiFetch(path, { method = 'GET', body, csrfToken } = {}) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
    },
  };

  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  if (csrfToken) {
    options.headers['X-CSRF-Token'] = csrfToken;
  }

  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.error?.message || 'Request failed.');
    error.code = payload.error?.code;
    error.fieldErrors = payload.error?.fieldErrors || [];
    error.status = response.status;
    throw error;
  }

  return payload;
}

function formatMoney(cents = 0) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function statusText(status) {
  return statusLabels[status] || status;
}

function FieldError({ message }) {
  if (!message) {
    return null;
  }

  return (
    <p className="field-error" role="alert">
      {message}
    </p>
  );
}

function SetupScreen({ onSetup }) {
  const [unlockSecret, setUnlockSecret] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitSetup(event) {
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
      await onSetup(unlockSecret);
    } catch (caught) {
      setError(caught.message);
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

function UnlockScreen({ onLogin }) {
  const [unlockSecret, setUnlockSecret] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitLogin(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onLogin(unlockSecret);
    } catch (caught) {
      setError(caught.message);
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
        <form className="auth-form" onSubmit={submitLogin}>
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
          <button type="submit" className="primary-action" disabled={submitting}>
            <Lock aria-hidden="true" size={18} />
            {submitting ? 'Unlocking...' : 'Unlock'}
          </button>
        </form>
      </section>
    </main>
  );
}

function StatusBadge({ status }) {
  return <span className={`status-badge status-${status}`}>{statusText(status)}</span>;
}

function Metric({ label, value, icon: Icon }) {
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

function CardsTable({ cards }) {
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
            <th>Last 4</th>
            <th className="numeric">Face</th>
            <th className="numeric">Remaining</th>
            <th className="numeric">Cost</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => (
            <tr key={card.id}>
              <td>
                <StatusBadge status={card.status} />
              </td>
              <td>{card.brand}</td>
              <td className="mono">{card.cardNumberLast4 ? `**** ${card.cardNumberLast4}` : 'Hidden'}</td>
              <td className="numeric">{formatMoney(card.faceValueCents)}</td>
              <td className="numeric">{formatMoney(card.remainingBalanceCents)}</td>
              <td className="numeric">{formatMoney(card.purchaseCostCents)}</td>
              <td>{card.updatedAt ? new Date(card.updatedAt).toLocaleDateString() : 'Not recorded'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DealsTable({ deals }) {
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
            <th>Name</th>
            <th>Source</th>
            <th>Purchase date</th>
            <th className="numeric">Input cost</th>
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => (
            <tr key={deal.id}>
              <td>{deal.name}</td>
              <td>{deal.source || 'Not recorded'}</td>
              <td>{deal.purchaseDate || 'Not recorded'}</td>
              <td className="numeric">{formatMoney(deal.inputTotalCostCents || 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WorkSurface({ cards, deals, loading, onRefresh, onLogout }) {
  const [activeView, setActiveView] = useState('dashboard');
  const activeRemaining = cards
    .filter((card) => ['available', 'reserved', 'in_use'].includes(card.status))
    .reduce((sum, card) => sum + card.remainingBalanceCents, 0);
  const availableFace = cards
    .filter((card) => card.status === 'available')
    .reduce((sum, card) => sum + card.faceValueCents, 0);
  const costBasis = cards.reduce((sum, card) => sum + card.purchaseCostCents, 0);

  const summaryCards = useMemo(
    () => [
      { label: 'Active remaining', value: formatMoney(activeRemaining), icon: CircleDollarSign },
      { label: 'Available face', value: formatMoney(availableFace), icon: PackageCheck },
      { label: 'Tracked cards', value: String(cards.length), icon: CreditCard },
      { label: 'Cost basis', value: formatMoney(costBasis), icon: Tag },
    ],
    [activeRemaining, availableFace, cards.length, costBasis],
  );

  return (
    <div className="product-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <ShieldCheck aria-hidden="true" size={24} />
          <span>Gift Card Manager</span>
        </div>
        <nav aria-label="Primary">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={activeView === item.id ? 'nav-item active' : 'nav-item'}
                onClick={() => setActiveView(item.id)}
              >
                <Icon aria-hidden="true" size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <button type="button" className="nav-item logout-button" onClick={onLogout}>
          <LogOut aria-hidden="true" size={18} />
          Lock
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Local secure inventory</p>
            <h1>{activeView === 'dashboard' ? 'Dashboard' : activeView === 'cards' ? 'Cards' : 'Deals'}</h1>
          </div>
          <div className="topbar-actions">
            <button type="button" className="secondary-action" onClick={onRefresh}>
              <RefreshCw aria-hidden="true" size={17} />
              Refresh
            </button>
            <button type="button" className="secondary-action">
              <FilePlus2 aria-hidden="true" size={17} />
              Import
            </button>
            <button type="button" className="primary-action compact">
              <Plus aria-hidden="true" size={17} />
              Add Deal
            </button>
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
              <CardsTable cards={cards.slice(0, 6)} />
            </section>
            <section className="content-section">
              <div className="section-heading">
                <h2>Deals</h2>
                <button type="button" onClick={() => setActiveView('deals')}>
                  View all
                </button>
              </div>
              <DealsTable deals={deals.slice(0, 6)} />
            </section>
          </>
        ) : null}

        {activeView === 'cards' ? (
          <section className="content-section">
            <div className="section-heading">
              <h2>Card Inventory</h2>
              <span>{cards.length} records</span>
            </div>
            <CardsTable cards={cards} />
          </section>
        ) : null}

        {activeView === 'deals' ? (
          <section className="content-section">
            <div className="section-heading">
              <h2>Deal Groups</h2>
              <span>{deals.length} records</span>
            </div>
            <DealsTable deals={deals} />
          </section>
        ) : null}
      </main>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState(null);
  const [cards, setCards] = useState([]);
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadInventory() {
    setInventoryLoading(true);
    try {
      const [cardsResponse, dealsResponse] = await Promise.all([
        apiFetch('/api/cards'),
        apiFetch('/api/deals'),
      ]);
      setCards(cardsResponse.data || []);
      setDeals(dealsResponse.data || []);
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
        const response = await apiFetch('/api/auth/status');
        if (canceled) {
          return;
        }
        setAuth(response.data);
        if (response.data.sessionValid && response.data.dekLoaded) {
          await loadInventory();
        }
      } catch (caught) {
        if (!canceled) {
          setError(caught.message);
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

  async function handleSetup(unlockSecret) {
    const response = await apiFetch('/api/auth/setup', {
      method: 'POST',
      body: { unlockSecret },
    });
    setAuth(response.data);
    await loadInventory();
  }

  async function handleLogin(unlockSecret) {
    const response = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: { unlockSecret },
    });
    setAuth(response.data);
    await loadInventory();
  }

  async function handleLogout() {
    if (auth?.csrfToken) {
      await apiFetch('/api/auth/logout', {
        method: 'POST',
        body: {},
        csrfToken: auth.csrfToken,
      }).catch(() => {});
    }
    setAuth({ setupComplete: true, sessionValid: false, dekLoaded: false });
    setCards([]);
    setDeals([]);
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
    return <UnlockScreen onLogin={handleLogin} />;
  }

  return (
    <WorkSurface
      cards={cards}
      deals={deals}
      loading={inventoryLoading}
      onRefresh={loadInventory}
      onLogout={handleLogout}
    />
  );
}
