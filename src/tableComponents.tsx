import { useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ArrowUpRight, CreditCard, ScrollText, Search, Tag, type LucideIcon } from 'lucide-react';
import type {
  AuditCriteria,
  AuditEvent,
  Card,
  CardSearchCriteria,
  Deal,
  Page,
  ReferenceValue,
  ReferenceValueState,
  ReferenceValueType,
  RevealedCredentials,
} from '../shared/domain';
import { credentialSummaryText } from './credentialHelpers';
import { errorMessage, formatDateTime, formatMoney, statusLabels } from './display';
import { FieldError } from './formUi';
import { ReferenceCombobox } from './ReferenceCombobox';
import { defaultReferenceValues, referenceValueTypes } from './referenceValues';
import { StatusBadge } from './StatusBadge';

export function Metric({
  label,
  value,
  icon: Icon,
  onClick,
}: {
  label: string;
  value: ReactNode;
  icon: LucideIcon;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="metric-icon">
        <Icon aria-hidden="true" size={18} />
      </div>
      <div>
        <p>{label}</p>
        <strong>{value}</strong>
      </div>
      {onClick ? <ArrowUpRight className="metric-link-icon" aria-hidden="true" size={17} /> : null}
    </>
  );
  return onClick ? (
    <button type="button" className="metric metric-clickable" onClick={onClick}>
      {content}
    </button>
  ) : (
    <article className="metric">
      {content}
    </article>
  );
}

function revealedCredentialText(credentials?: RevealedCredentials): string {
  const fields = credentials?.credentials?.fields
    ?.filter((field) => field.value)
    .map((field) => ({
      ...field,
      label: field.fieldKind === 'access_code' ? 'PIN' : field.label,
      fieldKind: field.fieldKind === 'access_code' ? 'pin' : field.fieldKind,
    })) || [];
  if (credentials?.cardNumber && !fields.some((field) => field.fieldKind === 'card_number')) {
    fields.push({
      fieldKey: 'cardNumber',
      fieldKind: 'card_number',
      label: 'Card number',
      value: credentials.cardNumber,
      copyable: true,
    });
  }
  if (credentials?.pin && !fields.some((field) => field.fieldKind === 'pin')) {
    fields.push({
      fieldKey: 'pin',
      fieldKind: 'pin',
      label: 'PIN',
      value: credentials.pin,
      copyable: true,
    });
  }
  if (credentials?.billingZip && !fields.some((field) => field.fieldKind === 'billing_postal_code')) {
    fields.push({
      fieldKey: 'billingZip',
      fieldKind: 'billing_postal_code',
      label: 'Billing ZIP',
      value: credentials.billingZip,
      copyable: true,
    });
  }
  if (fields.length > 0) {
    return fields
      .map((field) => `${field.label}: ${field.value}`)
      .join(' | ');
  }

  const legacyFields = [
    ['Card number', credentials?.cardNumber],
    ['PIN', credentials?.pin],
    ['Billing ZIP', credentials?.billingZip],
  ].filter((field): field is [string, string] => Boolean(field[1]));

  return legacyFields.map(([label, value]) => `${label}: ${value}`).join(' | ');
}

function referenceOptionsWithCards(
  indexedOptions: ReferenceValue[],
  values: string[],
  type: ReferenceValueType,
): ReferenceValue[] {
  const seen = new Set<string>();
  const options: ReferenceValue[] = [];
  for (const option of indexedOptions) {
    const key = String(option.value || '').trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    options.push(option);
  }
  for (const value of values) {
    const trimmed = String(value || '').trim();
    const key = trimmed.toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    options.push({
      type,
      value: trimmed,
      usageCount: 1,
      lastUsedAt: '',
    });
  }
  return options;
}

function SortableHeader({
  field,
  label,
  numeric = false,
  sortBy,
  sortDir,
  onSortCards,
}: {
  field: string;
  label: string;
  numeric?: boolean;
  sortBy: string;
  sortDir: string;
  onSortCards: ((sortBy: string) => void) | undefined;
}) {
  const active = sortBy === field && (sortDir === 'asc' || sortDir === 'desc');
  const ariaSort = !active ? 'none' : sortDir === 'asc' ? 'ascending' : 'descending';
  const Icon = !active ? ArrowUpDown : sortDir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className={numeric ? 'numeric' : undefined} aria-sort={ariaSort}>
      <button
        type="button"
        className={`sort-header${active ? ' active' : ''}`}
        onClick={() => onSortCards?.(field)}
        title={`Sort by ${label}`}
      >
        <span>{label}</span>
        <Icon aria-hidden="true" size={13} />
      </button>
    </th>
  );
}

export function CardsTable({
  cards,
  canManage,
  sortBy = '',
  sortDir = '',
  credentialsVisible = false,
  revealedCredentialsByCardId = {},
  selectedCardIds,
  onToggleCardSelected,
  onToggleAllCardsSelected,
  onSortCards,
  onUseCard,
  onViewCard,
  onDeleteCard,
  onSellCard,
  onUndoSale,
  onVoidCard,
  onReserveCard,
  onUnreserveCard,
}: {
  cards: Card[];
  canManage: boolean;
  sortBy?: string;
  sortDir?: string;
  credentialsVisible?: boolean;
  revealedCredentialsByCardId?: Record<string, RevealedCredentials>;
  selectedCardIds?: Set<string>;
  onToggleCardSelected?: (cardId: string, checked: boolean) => void;
  onToggleAllCardsSelected?: (checked: boolean) => void;
  onSortCards?: (sortBy: string) => void;
  onUseCard: (card: Card) => void;
  onViewCard: (card: Card) => void;
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
    <div className="table-wrap" tabIndex={0}>
      <table>
        <thead>
          <tr>
            {selectedCardIds && onToggleCardSelected ? (
              <th aria-label="Select cards">
                <input
                  type="checkbox"
                  checked={cards.length > 0 && cards.every((card) => selectedCardIds.has(String(card.id)))}
                  onChange={(event) => onToggleAllCardsSelected?.(event.target.checked)}
                />
              </th>
            ) : null}
            <SortableHeader field="status" label="Status" sortBy={sortBy} sortDir={sortDir} onSortCards={onSortCards} />
            <SortableHeader field="brand" label="Brand" sortBy={sortBy} sortDir={sortDir} onSortCards={onSortCards} />
            <th>Reservation</th>
            <th>Credential</th>
            <SortableHeader field="source" label="Source" sortBy={sortBy} sortDir={sortDir} onSortCards={onSortCards} />
            <SortableHeader field="expirationDate" label="Expiration" sortBy={sortBy} sortDir={sortDir} onSortCards={onSortCards} />
            <SortableHeader field="faceValueCents" label="Face" numeric sortBy={sortBy} sortDir={sortDir} onSortCards={onSortCards} />
            <SortableHeader field="remainingBalanceCents" label="Remaining" numeric sortBy={sortBy} sortDir={sortDir} onSortCards={onSortCards} />
            <SortableHeader field="purchaseCostCents" label="Cost" numeric sortBy={sortBy} sortDir={sortDir} onSortCards={onSortCards} />
            <SortableHeader field="updatedAt" label="Updated" sortBy={sortBy} sortDir={sortDir} onSortCards={onSortCards} />
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => (
            <tr key={card.id}>
              {selectedCardIds && onToggleCardSelected ? (
                <td>
                  <input
                    type="checkbox"
                    checked={selectedCardIds.has(String(card.id))}
                    aria-label={`Select ${card.brand}`}
                    onChange={(event) => onToggleCardSelected(String(card.id), event.target.checked)}
                  />
                </td>
              ) : null}
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
              <td className="mono credential-cell">
                {credentialsVisible
                  ? revealedCredentialText(revealedCredentialsByCardId[String(card.id)]) || credentialSummaryText(card)
                  : credentialSummaryText(card)}
              </td>
              <td>{card.source || 'Not recorded'}</td>
              <td>{card.expirationDate || 'Not recorded'}</td>
              <td className="numeric">{formatMoney(card.faceValueCents)}</td>
              <td className="numeric">{formatMoney(card.remainingBalanceCents)}</td>
              <td className="numeric">{formatMoney(card.purchaseCostCents)}</td>
              <td>{card.updatedAt ? new Date(card.updatedAt).toLocaleDateString() : 'Not recorded'}</td>
              <td>
                <div className="row-actions">
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

export function DealsTable({
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
    <div className="table-wrap" tabIndex={0}>
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

export function AuditTable({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="empty-state">
        <ScrollText aria-hidden="true" size={24} />
        <p>No audit events match the current view.</p>
      </div>
    );
  }

  return (
    <div className="table-wrap" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th>Time</th>
            <th>Entity</th>
            <th>Entity ID</th>
            <th>Action</th>
            <th>Details</th>
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
              <td>{event.metadataSummary || 'Not recorded'}</td>
              <td className="mono">{event.requestId || 'Not recorded'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AuditFilterForm({ onLoadAudit }: { onLoadAudit: (criteria?: AuditCriteria) => Promise<unknown> }) {
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

export function CardSearchForm({
  deals,
  cards = [],
  referenceValues = defaultReferenceValues,
  onSearchCards,
  initialCriteria = {},
}: {
  deals: Deal[];
  cards?: Card[];
  referenceValues?: ReferenceValueState;
  onSearchCards: (criteria?: CardSearchCriteria) => Promise<unknown>;
  initialCriteria?: CardSearchCriteria;
}) {
  const initialSortValue = initialCriteria.sortBy && initialCriteria.sortDir
    ? `${initialCriteria.sortBy}:${initialCriteria.sortDir}`
    : '';
  const [cardNumber, setCardNumber] = useState(String(initialCriteria.cardNumber || ''));
  const [status, setStatus] = useState(initialCriteria.status || '');
  const [cardType, setCardType] = useState(initialCriteria.cardType || '');
  const [brand, setBrand] = useState(String(initialCriteria.brand || ''));
  const [source, setSource] = useState(String(initialCriteria.source || ''));
  const [dealId, setDealId] = useState(String(initialCriteria.dealId || ''));
  const [expiresBefore, setExpiresBefore] = useState(String(initialCriteria.expiresBefore || ''));
  const [text, setText] = useState(String(initialCriteria.text || ''));
  const [sortValue, setSortValue] = useState(initialSortValue);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const brandOptions = referenceOptionsWithCards(
    referenceValues?.[referenceValueTypes.cardBrand] || [],
    cards.map((card) => card.brand),
    'card_brand',
  );
  const sourceOptions = referenceOptionsWithCards(
    referenceValues?.[referenceValueTypes.source] || [],
    cards.map((card) => card.source || ''),
    'source',
  );

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    const [sortBy, sortDir] = sortValue ? sortValue.split(':') : [];
    const sortCriteria = sortBy && sortDir ? { sortBy, sortDir } : {};
    try {
      await onSearchCards({
        cardNumber,
        status,
        cardType,
        brand,
        source,
        dealId,
        expiresBefore,
        text,
        ...sortCriteria,
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
    setCardType('');
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
        <span>Card type</span>
        <select value={cardType} onChange={(event) => setCardType(event.target.value)}>
          <option value="">All card types</option>
          <option value="merchant">Merchant gift cards</option>
          <option value="prepaid">Prepaid cash cards</option>
        </select>
      </label>
      <ReferenceCombobox
        label="Brand"
        value={brand}
        onChange={setBrand}
        options={brandOptions}
        helpText="Filter by indexed card brand. Substring matches work, so Amazon matches A, Am, maz, or zon."
      />
      <ReferenceCombobox
        label="Source"
        value={source}
        onChange={setSource}
        options={sourceOptions}
        helpText="Filter by indexed purchase source. Substring matches work while typing."
      />
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

export function CardsPagination({
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
