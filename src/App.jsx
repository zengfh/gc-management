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
  X,
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

function dollarsToCents(value) {
  if (!value) {
    return undefined;
  }

  const normalized = String(value).replace(/[$,]/g, '').trim();
  if (!normalized) {
    return undefined;
  }

  return Math.round(Number(normalized) * 100);
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

function CardsTable({ cards, onUseCard, onSellCard, onReserveCard, onUnreserveCard }) {
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
            <th>Actions</th>
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
              <td>
                <div className="row-actions">
                  {card.status === 'available' ? (
                    <button
                      type="button"
                      className="table-action"
                      aria-label={`Reserve ${card.brand}`}
                      onClick={() => onReserveCard(card)}
                    >
                      Reserve
                    </button>
                  ) : null}
                  {card.status === 'reserved' ? (
                    <button
                      type="button"
                      className="table-action"
                      aria-label={`Unreserve ${card.brand}`}
                      onClick={() => onUnreserveCard(card)}
                    >
                      Unreserve
                    </button>
                  ) : null}
                  {['available', 'reserved', 'in_use'].includes(card.status) ? (
                    <button
                      type="button"
                      className="table-action"
                      aria-label={`Sell ${card.brand}`}
                      onClick={() => onSellCard(card)}
                    >
                      Sell
                    </button>
                  ) : null}
                  {['available', 'in_use'].includes(card.status) ? (
                    <button
                      type="button"
                      className="table-action"
                      aria-label={`Use ${card.brand}`}
                      onClick={() => onUseCard(card)}
                    >
                      Use
                    </button>
                  ) : null}
                  {!['available', 'reserved', 'in_use'].includes(card.status) ? (
                    <span className="muted-text">No action</span>
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

function AddDealPanel({ onClose, onCreateDeal }) {
  const [form, setForm] = useState({
    name: '',
    source: '',
    totalCost: '',
    cardBrand: '',
    faceValue: '',
    cardNumber: '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function submitDeal(event) {
    event.preventDefault();
    setError('');

    const totalCostCents = dollarsToCents(form.totalCost);
    const faceValueCents = dollarsToCents(form.faceValue);

    if (!form.name.trim() || !form.cardBrand.trim() || !faceValueCents) {
      setError('Deal name, card brand, and face value are required.');
      return;
    }

    setSubmitting(true);
    try {
      await onCreateDeal({
        name: form.name.trim(),
        ...(form.source.trim() ? { source: form.source.trim() } : {}),
        ...(totalCostCents !== undefined ? { totalCostCents } : {}),
        cards: [
          {
            brand: form.cardBrand.trim(),
            cardType: 'merchant',
            faceValueCents,
            ...(form.cardNumber.trim() ? { cardNumber: form.cardNumber.trim() } : {}),
          },
        ],
      });
      onClose();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="slide-panel" role="dialog" aria-modal="true" aria-labelledby="add-deal-title">
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
          <label>
            <span>Deal name</span>
            <input value={form.name} onChange={(event) => updateField('name', event.target.value)} required />
          </label>
          <label>
            <span>Source</span>
            <input value={form.source} onChange={(event) => updateField('source', event.target.value)} />
          </label>
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
          <label>
            <span>Card brand</span>
            <input value={form.cardBrand} onChange={(event) => updateField('cardBrand', event.target.value)} required />
          </label>
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
            <span>Card number</span>
            <input
              className="mono"
              inputMode="numeric"
              value={form.cardNumber}
              onChange={(event) => updateField('cardNumber', event.target.value)}
            />
          </label>
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
    </div>
  );
}

function SellCardPanel({ card, onClose, onSellCard }) {
  const [salePrice, setSalePrice] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerType, setBuyerType] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitSale(event) {
    event.preventDefault();
    setError('');
    const salePriceCents = dollarsToCents(salePrice);

    if (salePriceCents === undefined || !Number.isFinite(salePriceCents)) {
      setError('Sale price is required.');
      return;
    }

    setSubmitting(true);
    try {
      await onSellCard(card.id, {
        salePriceCents,
        ...(buyerName.trim() ? { buyerName: buyerName.trim() } : {}),
        ...(buyerType ? { buyerType } : {}),
      });
      onClose();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="slide-panel" role="dialog" aria-modal="true" aria-labelledby="sell-card-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{card.brand}</p>
            <h2 id="sell-card-title">Sell card</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close sell card" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <form className="panel-form" onSubmit={submitSale}>
          <div className="preview-box">
            <span>Remaining being sold</span>
            <strong>{formatMoney(card.remainingBalanceCents)}</strong>
          </div>
          {card.status === 'in_use' ? (
            <p className="panel-note">
              This records a sale for the remaining balance and snapshots the current card state.
            </p>
          ) : null}
          <label>
            <span>Sale price</span>
            <input
              inputMode="decimal"
              placeholder="38.00"
              value={salePrice}
              onChange={(event) => setSalePrice(event.target.value)}
              required
            />
          </label>
          <label>
            <span>Buyer</span>
            <input value={buyerName} onChange={(event) => setBuyerName(event.target.value)} />
          </label>
          <label>
            <span>Buyer type</span>
            <select value={buyerType} onChange={(event) => setBuyerType(event.target.value)}>
              <option value="">Not specified</option>
              <option value="dealer">Dealer</option>
              <option value="group_chat">Group chat</option>
              <option value="friend">Friend</option>
              <option value="self">Self</option>
              <option value="other">Other</option>
            </select>
          </label>
          <FieldError message={error} />
          <div className="panel-actions">
            <button type="button" className="secondary-action" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action" disabled={submitting}>
              <CircleDollarSign aria-hidden="true" size={17} />
              {submitting ? 'Recording...' : 'Record sale'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function UseCardPanel({ card, onClose, onUseCard }) {
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitUsage(event) {
    event.preventDefault();
    setError('');
    const amountCents = dollarsToCents(amount);

    if (!amountCents) {
      setError('Usage amount is required.');
      return;
    }

    setSubmitting(true);
    try {
      await onUseCard(card.id, {
        amountCents,
        ...(merchant.trim() ? { merchant: merchant.trim() } : {}),
      });
      onClose();
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="slide-panel" role="dialog" aria-modal="true" aria-labelledby="use-card-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{card.brand}</p>
            <h2 id="use-card-title">Record usage</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close record usage" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <form className="panel-form" onSubmit={submitUsage}>
          <div className="preview-box">
            <span>Current remaining</span>
            <strong>{formatMoney(card.remainingBalanceCents)}</strong>
          </div>
          <label>
            <span>Amount</span>
            <input
              inputMode="decimal"
              placeholder="12.50"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </label>
          <label>
            <span>Merchant</span>
            <input value={merchant} onChange={(event) => setMerchant(event.target.value)} />
          </label>
          <FieldError message={error} />
          <div className="panel-actions">
            <button type="button" className="secondary-action" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action" disabled={submitting}>
              <CreditCard aria-hidden="true" size={17} />
              {submitting ? 'Recording...' : 'Record usage'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function WorkSurface({
  cards,
  deals,
  loading,
  onRefresh,
  onLogout,
  onCreateDeal,
  onUseCard,
  onSellCard,
  onReserveCard,
  onUnreserveCard,
}) {
  const [activeView, setActiveView] = useState('dashboard');
  const [showAddDeal, setShowAddDeal] = useState(false);
  const [usageCard, setUsageCard] = useState(null);
  const [saleCard, setSaleCard] = useState(null);
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
            <button type="button" className="primary-action compact" onClick={() => setShowAddDeal(true)}>
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
              <CardsTable
                cards={cards.slice(0, 6)}
                onUseCard={setUsageCard}
                onSellCard={setSaleCard}
                onReserveCard={onReserveCard}
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
            <CardsTable
              cards={cards}
              onUseCard={setUsageCard}
              onSellCard={setSaleCard}
              onReserveCard={onReserveCard}
              onUnreserveCard={onUnreserveCard}
            />
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
      {showAddDeal ? (
        <AddDealPanel
          onClose={() => setShowAddDeal(false)}
          onCreateDeal={async (payload) => {
            await onCreateDeal(payload);
            setActiveView('dashboard');
          }}
        />
      ) : null}
      {usageCard ? (
        <UseCardPanel
          card={usageCard}
          onClose={() => setUsageCard(null)}
          onUseCard={onUseCard}
        />
      ) : null}
      {saleCard ? (
        <SellCardPanel
          card={saleCard}
          onClose={() => setSaleCard(null)}
          onSellCard={onSellCard}
        />
      ) : null}
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

  async function handleCreateDeal(payload) {
    const response = await apiFetch('/api/deals', {
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

  async function handleUseCard(cardId, payload) {
    const response = await apiFetch(`/api/cards/${cardId}/use`, {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setCards((current) =>
      current.map((card) => (card.id === response.data.card.id ? response.data.card : card)),
    );
  }

  async function handleSellCard(cardId, payload) {
    const response = await apiFetch(`/api/cards/${cardId}/sell`, {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setCards((current) =>
      current.map((card) => (card.id === response.data.card.id ? response.data.card : card)),
    );
  }

  async function handleCardTransition(cardId, action) {
    const response = await apiFetch(`/api/cards/${cardId}/${action}`, {
      method: 'POST',
      body: {},
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
    return <UnlockScreen onLogin={handleLogin} />;
  }

  return (
    <WorkSurface
      cards={cards}
      deals={deals}
      loading={inventoryLoading}
      onRefresh={loadInventory}
      onLogout={handleLogout}
      onCreateDeal={handleCreateDeal}
      onUseCard={handleUseCard}
      onSellCard={handleSellCard}
      onReserveCard={(card) => handleCardTransition(card.id, 'reserve')}
      onUnreserveCard={(card) => handleCardTransition(card.id, 'unreserve')}
    />
  );
}
