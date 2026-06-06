import { useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ArrowUpRight, CreditCard, MoreHorizontal, ScrollText, Search, Tag, type LucideIcon } from 'lucide-react';
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

function normalizeDealFilterName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function dealFilterOptions(deals: Deal[]) {
  const groups = new Map<string, { name: string; ids: string[] }>();
  for (const deal of deals) {
    const name = String(deal.name || '').trim() || 'Unnamed deal';
    const key = normalizeDealFilterName(name);
    const current = groups.get(key);
    if (current) {
      current.ids.push(String(deal.id));
    } else {
      groups.set(key, { name, ids: [String(deal.id)] });
    }
  }

  return Array.from(groups.values())
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((group) => {
      if (group.ids.length === 1) {
        const id = group.ids[0] || '';
        return {
          value: id,
          label: group.name,
          dealId: id,
          dealName: '',
        };
      }
      return {
        value: `name:${group.name}`,
        label: `${group.name} (${group.ids.length} deals)`,
        dealId: '',
        dealName: group.name,
      };
    });
}

function parseDealFilter(value: string) {
  if (value.startsWith('name:')) {
    return { dealId: '', dealName: value.slice('name:'.length) };
  }
  if (value.startsWith('id:')) {
    return { dealId: value.slice('id:'.length), dealName: '' };
  }
  return { dealId: value, dealName: '' };
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
  onUndoUsage,
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
  onUndoUsage: (card: Card) => void;
  onVoidCard: (card: Card) => void;
  onReserveCard: (card: Card) => void;
  onUnreserveCard: (card: Card) => void;
}) {
  const [openActionMenuCardId, setOpenActionMenuCardId] = useState<string | null>(null);

  if (cards.length === 0) {
    return (
      <div className="empty-state">
        <CreditCard aria-hidden="true" size={24} />
        <p>No cards yet. Start by adding a deal or importing CSV.</p>
      </div>
    );
  }

  function closeActionMenu() {
    setOpenActionMenuCardId(null);
  }

  function actionButton({
    key,
    label,
    ariaLabel,
    onClick,
    danger = false,
    primary = false,
  }: {
    key: string;
    label: string;
    ariaLabel: string;
    onClick: () => void;
    danger?: boolean;
    primary?: boolean;
  }) {
    return (
      <button
        key={key}
        type="button"
        className={`table-action${primary ? ' primary' : ''}${danger ? ' danger' : ''}`}
        aria-label={ariaLabel}
        onClick={() => {
          closeActionMenu();
          onClick();
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="table-wrap" tabIndex={0} aria-label="Scrollable card inventory table">
      <table className="cards-table">
        <caption className="visually-hidden">Card inventory</caption>
        <thead>
          <tr>
            {selectedCardIds && onToggleCardSelected ? (
              <th scope="col" aria-label="Select cards">
                <input
                  aria-label="Select all visible cards"
                  type="checkbox"
                  checked={cards.length > 0 && cards.every((card) => selectedCardIds.has(String(card.id)))}
                  onChange={(event) => onToggleAllCardsSelected?.(event.target.checked)}
                />
              </th>
            ) : null}
            <SortableHeader field="brand" label="Card" sortBy={sortBy} sortDir={sortDir} onSortCards={onSortCards} />
            <SortableHeader field="status" label="Status" sortBy={sortBy} sortDir={sortDir} onSortCards={onSortCards} />
            <SortableHeader field="remainingBalanceCents" label="Remaining" numeric sortBy={sortBy} sortDir={sortDir} onSortCards={onSortCards} />
            <th scope="col">Actions</th>
            <th scope="col">Credential</th>
            <SortableHeader field="expirationDate" label="Expiration" sortBy={sortBy} sortDir={sortDir} onSortCards={onSortCards} />
            <SortableHeader field="faceValueCents" label="Face" numeric sortBy={sortBy} sortDir={sortDir} onSortCards={onSortCards} />
            <SortableHeader field="updatedAt" label="Updated" sortBy={sortBy} sortDir={sortDir} onSortCards={onSortCards} />
          </tr>
        </thead>
        <tbody>
          {cards.map((card) => {
            const cardId = String(card.id);
            const visibleActions = [
              actionButton({
                key: 'details',
                label: 'Details',
                ariaLabel: `Open ${card.brand} details`,
                primary: true,
                onClick: () => onViewCard(card),
              }),
            ];
            const overflowActions: ReactNode[] = [];

            if (canManage && card.status === 'available') {
              visibleActions.push(actionButton({
                key: 'reserve',
                label: 'Reserve',
                ariaLabel: `Reserve ${card.brand}`,
                onClick: () => onReserveCard(card),
              }));
              overflowActions.push(
                actionButton({ key: 'use', label: 'Use', ariaLabel: `Use ${card.brand}`, onClick: () => onUseCard(card) }),
                actionButton({ key: 'sell', label: 'Sell', ariaLabel: `Sell ${card.brand}`, onClick: () => onSellCard(card) }),
                actionButton({ key: 'void', label: 'Void', ariaLabel: `Void ${card.brand}`, danger: true, onClick: () => onVoidCard(card) }),
                actionButton({ key: 'delete', label: 'Delete', ariaLabel: `Delete ${card.brand}`, danger: true, onClick: () => onDeleteCard(card) }),
              );
            }
            if (canManage && card.status === 'reserved') {
              visibleActions.push(actionButton({
                key: 'unreserve',
                label: 'Unreserve',
                ariaLabel: `Unreserve ${card.brand}`,
                onClick: () => onUnreserveCard(card),
              }));
              overflowActions.push(
                actionButton({ key: 'sell', label: 'Sell', ariaLabel: `Sell ${card.brand}`, onClick: () => onSellCard(card) }),
                actionButton({ key: 'void', label: 'Void', ariaLabel: `Void ${card.brand}`, danger: true, onClick: () => onVoidCard(card) }),
              );
            }
            if (canManage && card.status === 'in_use') {
              visibleActions.push(actionButton({
                key: 'use',
                label: 'Use',
                ariaLabel: `Use ${card.brand}`,
                onClick: () => onUseCard(card),
              }));
              overflowActions.push(
                actionButton({ key: 'undo-use', label: 'Undo use', ariaLabel: `Undo usage ${card.brand}`, onClick: () => onUndoUsage(card) }),
                actionButton({ key: 'sell', label: 'Sell', ariaLabel: `Sell ${card.brand}`, onClick: () => onSellCard(card) }),
                actionButton({ key: 'void', label: 'Void', ariaLabel: `Void ${card.brand}`, danger: true, onClick: () => onVoidCard(card) }),
              );
            }
            if (canManage && card.status === 'used_up') {
              visibleActions.push(actionButton({
                key: 'undo-use',
                label: 'Undo use',
                ariaLabel: `Undo usage ${card.brand}`,
                onClick: () => onUndoUsage(card),
              }));
            }
            if (canManage && card.status === 'sold') {
              visibleActions.push(actionButton({
                key: 'undo-sale',
                label: 'Undo sale',
                ariaLabel: `Undo sale ${card.brand}`,
                onClick: () => onUndoSale(card),
              }));
            }

            const menuOpen = openActionMenuCardId === cardId;
            return (
              <tr key={card.id}>
                {selectedCardIds && onToggleCardSelected ? (
                  <td data-label="Select">
                    <input
                      type="checkbox"
                      checked={selectedCardIds.has(cardId)}
                      aria-label={`Select ${card.brand}`}
                      onChange={(event) => onToggleCardSelected(cardId, event.target.checked)}
                    />
                  </td>
                ) : null}
                <td data-label="Card">
                  <div className="card-summary-cell" aria-label={`${card.brand} ${formatDisplayCardType(card.cardType)}`}>
                    <strong aria-hidden="true">{card.brand}</strong>
                    <span aria-hidden="true">{formatDisplayCardType(card.cardType)}</span>
                  </div>
                </td>
                <td data-label="Status">
                  <StatusBadge status={card.status} />
                </td>
                <td data-label="Remaining" className="numeric">{formatMoney(card.remainingBalanceCents)}</td>
                <td data-label="Actions">
                  <div className="row-actions card-row-actions">
                    {visibleActions}
                    {overflowActions.length > 0 ? (
                      <span className="card-action-overflow">
                        <button
                          type="button"
                          className="table-action icon-table-action"
                          aria-label={`More actions for ${card.brand}`}
                          aria-expanded={menuOpen}
                          aria-controls={`card-actions-${cardId}`}
                          onClick={() => setOpenActionMenuCardId(menuOpen ? null : cardId)}
                        >
                          <MoreHorizontal aria-hidden="true" size={16} />
                        </button>
                        {menuOpen ? (
                          <span className="row-action-menu" id={`card-actions-${cardId}`}>
                            {overflowActions}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td data-label="Credential" className="mono credential-cell">
                  {credentialsVisible
                    ? revealedCredentialText(revealedCredentialsByCardId[cardId]) || credentialSummaryText(card)
                    : credentialSummaryText(card)}
                </td>
                <td data-label="Expiration">{card.expirationDate || 'Not recorded'}</td>
                <td data-label="Face" className="numeric">{formatMoney(card.faceValueCents)}</td>
                <td data-label="Updated">{card.updatedAt ? new Date(card.updatedAt).toLocaleDateString() : 'Not recorded'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatDisplayCardType(value: unknown): string {
  const normalized = String(value || '').trim();
  if (normalized === 'prepaid') {
    return 'Prepaid cash';
  }
  if (normalized === 'merchant') {
    return 'Merchant card';
  }
  return normalized || 'Card';
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
  const [dealFilter, setDealFilter] = useState(
    initialCriteria.dealName
      ? `name:${initialCriteria.dealName}`
      : initialCriteria.dealId
        ? String(initialCriteria.dealId)
        : '',
  );
  const [expiresBefore, setExpiresBefore] = useState(String(initialCriteria.expiresBefore || ''));
  const [text, setText] = useState(String(initialCriteria.text || ''));
  const [sortValue, setSortValue] = useState(initialSortValue);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dealOptions = dealFilterOptions(deals);
  const brandOptions = referenceOptionsWithCards(
    referenceValues?.[referenceValueTypes.cardBrand] || [],
    cards.map((card) => card.brand),
    'card_brand',
  );

  async function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    const [sortBy, sortDir] = sortValue ? sortValue.split(':') : [];
    const sortCriteria = sortBy && sortDir ? { sortBy, sortDir } : {};
    const dealCriteria = parseDealFilter(dealFilter);
    try {
      await onSearchCards({
        cardNumber,
        status,
        cardType,
        activeOnly: status ? '' : true,
        brand,
        source: '',
        ...dealCriteria,
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
    setDealFilter('');
    setExpiresBefore('');
    setText('');
    setSortValue('');
    setSubmitting(true);
    try {
      await onSearchCards({
        cardNumber: '',
        status: '',
        cardType: '',
        activeOnly: true,
        brand: '',
        source: '',
        dealId: '',
        dealName: '',
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
          <option value="">Active inventory</option>
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
      <label>
        <span>Deal</span>
        <select value={dealFilter} onChange={(event) => setDealFilter(event.target.value)}>
          <option value="">All deals</option>
          {dealOptions.map((deal) => (
            <option key={deal.value} value={deal.value}>
              {deal.label}
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
