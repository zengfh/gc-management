import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { CircleDollarSign, Copy, CreditCard, Eye, LogOut, PackageCheck, RefreshCw, X } from 'lucide-react';
import type {
  ApiResponse,
  Card,
  CredentialField,
  CredentialFieldKind,
  Deal,
  RevealedCredentials,
  Usage,
} from '../shared/domain';
import { BarcodePreview } from './BarcodePreview';
import type { ApiPayload, CardDetailState, CardSalePayload, DealDetailState, VoidHandler } from './appTypes';
import { credentialSummaryText } from './credentialHelpers';
import {
  dollarsToCents,
  errorMessage,
  formatDateTime,
  formatDisplayValue,
  formatMoney,
  isTerminalCard,
  statusText,
} from './display';
import { FieldError } from './formUi';
import { StatusBadge } from './StatusBadge';
import { useDialogFocus } from './useDialogFocus';

function canUndoUsage(usage: Usage): boolean {
  return !usage.isReversed && !usage.reversedAt && !usage.isWriteOff;
}

function normalizeCredentialDisplayField(field: CredentialField): CredentialField {
  if (field.fieldKind !== 'access_code') {
    return field;
  }
  return {
    ...field,
    fieldKind: 'pin',
    label: 'PIN',
  };
}

function mergeRevealedCredentialFields(credentials: RevealedCredentials): CredentialField[] {
  const fields = (credentials.credentials?.fields || []).map(normalizeCredentialDisplayField);
  const hasKind = (kind: CredentialFieldKind) => fields.some((field) => field.fieldKind === kind && field.value);
  const appendIfMissing = (
    fieldKind: CredentialFieldKind,
    fieldKey: string,
    label: string,
    value: string | null | undefined,
  ) => {
    if (!value || hasKind(fieldKind)) {
      return;
    }
    fields.push({
      fieldKey,
      label,
      fieldKind,
      value,
      copyable: true,
    });
  };

  appendIfMissing('card_number', 'cardNumber', 'Card number', credentials.cardNumber);
  appendIfMissing('pin', 'pin', 'PIN', credentials.pin);
  appendIfMissing('billing_postal_code', 'billingZip', 'Billing ZIP', credentials.billingZip);
  return fields.filter((field) => field.value);
}

function centsToInput(cents: number | null | undefined): string {
  if (cents == null) {
    return '';
  }
  return (cents / 100).toFixed(2);
}

function HistoryList<T extends { id: string | number }>({
  title,
  items,
  renderItem,
  emptyText,
  children = null,
}: {
  title: string;
  items: T[];
  renderItem: (item: T) => ReactNode;
  emptyText: string;
  children?: ReactNode;
}) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      {children}
      {items?.length ? (
        <ul className="detail-list">
          {items.map((item) => (
            <li key={`${title}-${item.id}`}>{renderItem(item)}</li>
          ))}
        </ul>
      ) : (
        <p className="muted-text">{emptyText}</p>
      )}
    </section>
  );
}

export function CardDetailPanel({
  detailState,
  canManage,
  onClose,
  onLogout,
  onEditCard,
  onUndoUsage,
  onRevealCredentials,
}: {
  detailState: CardDetailState;
  canManage: boolean;
  onClose: VoidHandler;
  onLogout: VoidHandler;
  onEditCard: (cardId: string, payload: ApiPayload) => Promise<ApiResponse<Card>>;
  onUndoUsage: (usageId: string, reason: string) => Promise<unknown>;
  onRevealCredentials: (cardId: string) => Promise<ApiResponse<RevealedCredentials>>;
}) {
  const { card, data, error, loading } = detailState;
  const [editedCard, setEditedCard] = useState<Card | null>(null);
  const detailCard = editedCard || data?.card || card;
  const [undoUsage, setUndoUsage] = useState<Usage | null>(null);
  const [undoReason, setUndoReason] = useState('');
  const [undoError, setUndoError] = useState('');
  const [submittingUndo, setSubmittingUndo] = useState(false);
  const [editForm, setEditForm] = useState({
    brand: detailCard.brand || '',
    cardType: detailCard.cardType || 'merchant',
    network: detailCard.network || '',
    faceValue: centsToInput(detailCard.faceValueCents),
    remainingBalance: centsToInput(detailCard.remainingBalanceCents),
    purchaseCost: centsToInput(detailCard.purchaseCostCents),
    expirationDate: detailCard.expirationDate || '',
    format: detailCard.format || '',
    source: detailCard.source || '',
    notes: detailCard.notes || '',
  });
  const [editError, setEditError] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [submittingEdit, setSubmittingEdit] = useState(false);
  const [credentials, setCredentials] = useState<RevealedCredentials | null>(null);
  const [credentialError, setCredentialError] = useState('');
  const [credentialMessage, setCredentialMessage] = useState('');
  const [revealing, setRevealing] = useState(false);
  const dialogRef = useDialogFocus(onClose);
  const terminal = isTerminalCard(detailCard);

  useEffect(() => {
    if (!credentials) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setCredentials(null);
      setCredentialMessage('');
    }, 5000);
    return () => clearTimeout(timer);
  }, [credentials]);

  useEffect(() => {
    function hideCredentials() {
      setCredentials(null);
      setCredentialMessage('');
    }

    window.addEventListener('blur', hideCredentials);
    document.addEventListener('visibilitychange', hideCredentials);
    return () => {
      window.removeEventListener('blur', hideCredentials);
      document.removeEventListener('visibilitychange', hideCredentials);
    };
  }, []);

  function startUndoUsage(usage: Usage) {
    setUndoUsage(usage);
    setUndoReason('');
    setUndoError('');
  }

  async function submitUndoUsage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setUndoError('');

    const reason = undoReason.trim();
    if (!reason) {
      setUndoError('Reason is required.');
      return;
    }

    setSubmittingUndo(true);
    try {
      if (undoUsage) {
        await onUndoUsage(undoUsage.id, reason);
      }
      setUndoUsage(null);
      setUndoReason('');
    } catch (caught) {
      setUndoError(errorMessage(caught));
    } finally {
      setSubmittingUndo(false);
    }
  }

  function updateEditField(field: keyof typeof editForm, value: string) {
    setEditForm((current) => ({ ...current, [field]: value }));
  }

  async function submitCardEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEditError('');
    setEditMessage('');

    const notes = editForm.notes.trim();
    const payload: ApiPayload = {
      rowVersion: detailCard.rowVersion,
      notes: notes || null,
    };

    if (!terminal) {
      const brand = editForm.brand.trim();
      const faceValueCents = dollarsToCents(editForm.faceValue);
      const remainingBalanceCents = dollarsToCents(editForm.remainingBalance);
      const purchaseCostCents = dollarsToCents(editForm.purchaseCost);

      if (!brand) {
        setEditError('Brand is required.');
        return;
      }
      if (!faceValueCents || faceValueCents <= 0) {
        setEditError('Face value must be greater than $0.00.');
        return;
      }
      if (remainingBalanceCents == null || remainingBalanceCents < 0) {
        setEditError('Remaining balance must be $0.00 or more.');
        return;
      }
      if (remainingBalanceCents > faceValueCents) {
        setEditError('Remaining balance cannot exceed face value.');
        return;
      }
      if (purchaseCostCents == null || purchaseCostCents < 0) {
        setEditError('Purchase cost must be $0.00 or more.');
        return;
      }

      payload.brand = brand;
      payload.cardType = editForm.cardType === 'prepaid' ? 'prepaid' : 'merchant';
      payload.network = editForm.network || null;
      payload.faceValueCents = faceValueCents;
      payload.remainingBalanceCents = remainingBalanceCents;
      payload.purchaseCostCents = purchaseCostCents;
      payload.expirationDate = editForm.expirationDate || null;
      payload.format = editForm.format || null;
      payload.source = editForm.source.trim() || null;
    }

    setSubmittingEdit(true);
    try {
      const response = await onEditCard(detailCard.id, payload);
      setEditedCard(response.data);
      setEditMessage('Card updated.');
    } catch (caught) {
      setEditError(errorMessage(caught));
    } finally {
      setSubmittingEdit(false);
    }
  }

  async function revealCredentials() {
    setCredentialError('');
    setCredentialMessage('');
    setRevealing(true);
    try {
      const response = await onRevealCredentials(detailCard.id);
      setCredentials(response.data);
      return response.data;
    } catch (caught) {
      setCredentialError(errorMessage(caught));
      return null;
    } finally {
      setRevealing(false);
    }
  }

  async function copyValue(value: string | null | undefined, label: string) {
    setCredentialError('');
    setCredentialMessage('');
    if (!value) {
      setCredentialError(`${label} is not recorded.`);
      return;
    }
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard?.writeText) {
      setCredentialError('Clipboard is not available.');
      return;
    }
    await clipboard.writeText(value);
    setCredentialMessage(`${label} copied.`);
  }

  async function copyCredential(fieldKey: string, label: string) {
    const currentCredentials = credentials || (await revealCredentials());
    const field = currentCredentials?.credentials?.fields?.find((item) => item.fieldKey === fieldKey);
    const legacyValues: Record<string, string | null | undefined> = {
      cardNumber: currentCredentials?.cardNumber,
      pin: currentCredentials?.pin,
      billingZip: currentCredentials?.billingZip,
    };
    await copyValue(field?.value ?? legacyValues[fieldKey], label);
  }

  async function copyPrimaryCredential() {
    const currentCredentials = credentials || (await revealCredentials());
    const field = currentCredentials?.credentials?.fields?.find((item) =>
      ['card_number', 'primary_code', 'barcode_value'].includes(item.fieldKind),
    ) || currentCredentials?.credentials?.fields?.[0];
    await copyValue(field?.value ?? currentCredentials?.cardNumber, field?.label || 'Credential');
  }

  const revealedCredentialFields: CredentialField[] = credentials
    ? mergeRevealedCredentialFields(credentials)
    : [];

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={dialogRef} className="slide-panel" role="dialog" aria-modal="true" aria-labelledby="card-detail-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{detailCard.brand}</p>
            <h2 id="card-detail-title">Card details</h2>
          </div>
          <div className="panel-heading-actions">
            <button type="button" className="secondary-action" onClick={onLogout}>
              <LogOut aria-hidden="true" size={17} />
              Logout
            </button>
            <button type="button" className="icon-button" aria-label="Close card details" onClick={onClose}>
              <X aria-hidden="true" size={18} />
            </button>
          </div>
        </div>
        <div className="detail-panel-body">
          {loading ? <div className="loading-strip">Loading card detail...</div> : null}
          <FieldError message={error ?? null} />
          <div className="detail-grid">
            <div className="preview-box">
              <span>Status</span>
              <strong>{statusText(detailCard.status)}</strong>
            </div>
            <div className="preview-box">
              <span>Reserved for</span>
              <strong>{detailCard.reservedFor || 'Not reserved'}</strong>
            </div>
            <div className="preview-box">
              <span>Reserved until</span>
              <strong>{detailCard.reservedUntil || 'Not recorded'}</strong>
            </div>
            <div className="preview-box">
              <span>Credential</span>
              <strong className="mono">{credentialSummaryText(detailCard)}</strong>
            </div>
            <div className="preview-box">
              <span>Remaining</span>
              <strong>{formatMoney(detailCard.remainingBalanceCents)}</strong>
            </div>
            <div className="preview-box">
              <span>Face value</span>
              <strong>{formatMoney(detailCard.faceValueCents)}</strong>
            </div>
            <div className="preview-box">
              <span>Cost</span>
              <strong>{formatMoney(detailCard.purchaseCostCents)}</strong>
            </div>
            <div className="preview-box">
              <span>Type</span>
              <strong>{formatDisplayValue(detailCard.cardType)}</strong>
            </div>
            <div className="preview-box">
              <span>Source</span>
              <strong>{detailCard.source || 'Not recorded'}</strong>
            </div>
            <div className="preview-box">
              <span>Expiration</span>
              <strong>{detailCard.expirationDate || 'Not recorded'}</strong>
            </div>
            <div className="preview-box">
              <span>Format</span>
              <strong>{formatDisplayValue(detailCard.format)}</strong>
            </div>
            <div className="preview-box detail-note">
              <span>Notes</span>
              <strong>{detailCard.notes || 'Not recorded'}</strong>
            </div>
            <div className="preview-box detail-note">
              <span>Reservation notes</span>
              <strong>{detailCard.reservedNotes || 'Not recorded'}</strong>
            </div>
          </div>
          {canManage ? (
            <section className="detail-section">
              <div className="credential-heading">
                <h3>Edit card</h3>
                {terminal ? (
                  <span className="detail-pill">{statusText(detailCard.status)} cards allow notes only</span>
                ) : null}
              </div>
              <form className="inline-detail-form detail-edit-form" onSubmit={submitCardEdit}>
                <div className="detail-edit-grid">
                  <label>
                    <span>Brand</span>
                    <input
                      value={editForm.brand}
                      disabled={terminal}
                      required={!terminal}
                      onChange={(event) => updateEditField('brand', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Card type</span>
                    <select
                      value={editForm.cardType}
                      disabled={terminal}
                      onChange={(event) => updateEditField('cardType', event.target.value)}
                    >
                      <option value="merchant">Merchant gift card</option>
                      <option value="prepaid">Prepaid cash card</option>
                    </select>
                  </label>
                  <label>
                    <span>Network</span>
                    <select
                      value={editForm.network}
                      disabled={terminal}
                      onChange={(event) => updateEditField('network', event.target.value)}
                    >
                      <option value="">None</option>
                      <option value="visa">Visa</option>
                      <option value="mastercard">Mastercard</option>
                      <option value="amex">Amex</option>
                      <option value="discover">Discover</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label>
                    <span>Face value</span>
                    <input
                      inputMode="decimal"
                      value={editForm.faceValue}
                      disabled={terminal}
                      onChange={(event) => updateEditField('faceValue', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Remaining</span>
                    <input
                      inputMode="decimal"
                      value={editForm.remainingBalance}
                      disabled={terminal}
                      onChange={(event) => updateEditField('remainingBalance', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Cost</span>
                    <input
                      inputMode="decimal"
                      value={editForm.purchaseCost}
                      disabled={terminal}
                      onChange={(event) => updateEditField('purchaseCost', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Expiration date</span>
                    <input
                      type="date"
                      value={editForm.expirationDate}
                      disabled={terminal}
                      onChange={(event) => updateEditField('expirationDate', event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Format</span>
                    <select
                      value={editForm.format}
                      disabled={terminal}
                      onChange={(event) => updateEditField('format', event.target.value)}
                    >
                      <option value="">Not recorded</option>
                      <option value="digital">Digital</option>
                      <option value="physical">Physical</option>
                    </select>
                  </label>
                  <label>
                    <span>Source</span>
                    <input
                      value={editForm.source}
                      disabled={terminal}
                      onChange={(event) => updateEditField('source', event.target.value)}
                    />
                  </label>
                  <label className="detail-edit-notes">
                    <span>Notes</span>
                    <textarea value={editForm.notes} rows={4} onChange={(event) => updateEditField('notes', event.target.value)} />
                  </label>
                </div>
                <FieldError message={editError} />
                {editMessage ? <p className="success-copy">{editMessage}</p> : null}
                <div className="inline-form-actions">
                  <button type="submit" className="primary-action compact" disabled={submittingEdit}>
                    {submittingEdit ? 'Saving...' : 'Save card'}
                  </button>
                </div>
              </form>
            </section>
          ) : null}
          <section className="detail-section credential-section">
            <div className="credential-heading">
              <h3>Credentials</h3>
              {canManage ? (
                <button type="button" className="secondary-action" onClick={revealCredentials} disabled={revealing}>
                  <Eye aria-hidden="true" size={17} />
                  {revealing ? 'Revealing...' : 'Reveal credentials'}
                </button>
              ) : null}
            </div>
            <div className="credential-grid">
              {revealedCredentialFields.length > 0 ? (
                revealedCredentialFields.map((field) => (
                  <div className="credential-field-block" key={field.fieldKey}>
                    <div className="credential-row">
                      <span>{field.label}</span>
                      <strong className="mono">{field.value || 'Not recorded'}</strong>
                      {canManage && field.copyable ? (
                        <button
                          type="button"
                          className="table-action"
                          aria-label={`Copy ${field.label}`}
                          onClick={() => copyCredential(field.fieldKey, field.label)}
                        >
                          <Copy aria-hidden="true" size={15} />
                          {`Copy ${field.label.toLowerCase()}`}
                        </button>
                      ) : null}
                    </div>
                    {field.fieldKind === 'barcode_value' ? (
                      <BarcodePreview value={field.value ?? null} format={field.barcodeFormat ?? null} />
                    ) : null}
                  </div>
                ))
              ) : (
                <div className="credential-row">
                  <span>{detailCard.credentialSummary?.primaryLabel || 'Primary'}</span>
                  <strong className="mono">{credentialSummaryText(detailCard)}</strong>
                  {canManage ? (
                    <button
                      type="button"
                      className="table-action"
                      onClick={copyPrimaryCredential}
                    >
                      <Copy aria-hidden="true" size={15} />
                      {`Copy ${(detailCard.credentialSummary?.primaryLabel || 'card number').toLowerCase()}`}
                    </button>
                  ) : null}
                </div>
              )}
            </div>
            <FieldError message={credentialError} />
            {credentialMessage ? <p className="success-copy">{credentialMessage}</p> : null}
          </section>
          <HistoryList
            title="Transactions"
            items={data?.transactions || []}
            emptyText="No transactions recorded."
            renderItem={(transaction) => (
              <>
                <strong>{transaction.type}</strong>
                <span>{transaction.buyerName || transaction.platform || 'No counterparty'}</span>
                {transaction.salePriceCents != null ? <span>{formatMoney(transaction.salePriceCents)}</span> : null}
              </>
            )}
          />
          <HistoryList
            title="Usages"
            items={data?.usages || []}
            emptyText="No usages recorded."
            children={
              undoUsage ? (
                <form className="inline-detail-form" onSubmit={submitUndoUsage}>
                  <p className="muted-text">
                    Undo {undoUsage.merchant || 'usage'} for {formatMoney(undoUsage.amountCents)}.
                  </p>
                  <label>
                    <span>Reason</span>
                    <input value={undoReason} onChange={(event) => setUndoReason(event.target.value)} />
                  </label>
                  <FieldError message={undoError} />
                  <div className="inline-form-actions">
                    <button
                      type="button"
                      className="secondary-action"
                      onClick={() => setUndoUsage(null)}
                      disabled={submittingUndo}
                    >
                      Cancel
                    </button>
                    <button type="submit" className="primary-action compact" disabled={submittingUndo}>
                      {submittingUndo ? 'Undoing...' : 'Undo usage'}
                    </button>
                  </div>
                </form>
              ) : null
            }
            renderItem={(usage) => (
              <>
                <strong>{usage.merchant || 'Usage'}</strong>
                <span>{formatMoney(usage.amountCents)}</span>
                {usage.usageDate ? <span>{usage.usageDate}</span> : null}
                {usage.isWriteOff ? <span className="detail-pill">Write-off</span> : null}
                {usage.isReversed ? <span className="detail-pill">Reversed</span> : null}
                {usage.reversalReason ? <span>{usage.reversalReason}</span> : null}
                {canManage && canUndoUsage(usage) ? (
                  <button
                    type="button"
                    className="table-action"
                    aria-label={`Undo ${usage.merchant || 'usage'} usage`}
                    onClick={() => startUndoUsage(usage)}
                  >
                    Undo usage
                  </button>
                ) : null}
              </>
            )}
          />
          <HistoryList
            title="Audit"
            items={data?.audit || []}
            emptyText="No audit events recorded."
            renderItem={(event) => (
              <>
                <strong>{event.action}</strong>
                <span>{formatDateTime(event.timestamp || event.createdAt)}</span>
              </>
            )}
          />
        </div>
      </section>
    </div>
  );
}

export function DealDetailPanel({ detailState, onClose }: { detailState: DealDetailState; onClose: VoidHandler }) {
  const { deal, data, error, loading } = detailState;
  const detailDeal = data?.deal || deal;
  const dealCards = data?.cards || [];
  const totalFace = dealCards.reduce((sum, card) => sum + card.faceValueCents, 0);
  const totalRemaining = dealCards.reduce((sum, card) => sum + card.remainingBalanceCents, 0);
  const totalCost = dealCards.reduce((sum, card) => sum + card.purchaseCostCents, 0);
  const cardCount = `${dealCards.length} ${dealCards.length === 1 ? 'card' : 'cards'}`;
  const dialogRef = useDialogFocus(onClose);

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={dialogRef} className="slide-panel" role="dialog" aria-modal="true" aria-labelledby="deal-detail-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{detailDeal.name}</p>
            <h2 id="deal-detail-title">Deal details</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close deal details" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="detail-panel-body">
          {loading ? <div className="loading-strip">Loading deal detail...</div> : null}
          <FieldError message={error ?? null} />
          <div className="detail-grid">
            <div className="preview-box">
              <span>Status</span>
              <strong>{detailDeal.archivedAt ? 'Archived' : 'Active'}</strong>
            </div>
            <div className="preview-box">
              <span>Source</span>
              <strong>{detailDeal.source || 'Not recorded'}</strong>
            </div>
            <div className="preview-box">
              <span>Purchase date</span>
              <strong>{detailDeal.purchaseDate || 'Not recorded'}</strong>
            </div>
            <div className="preview-box">
              <span>Cards</span>
              <strong>{cardCount}</strong>
            </div>
            <div className="preview-box">
              <span>Face value</span>
              <strong>{formatMoney(totalFace)}</strong>
            </div>
            <div className="preview-box">
              <span>Remaining</span>
              <strong>{formatMoney(totalRemaining)}</strong>
            </div>
            <div className="preview-box">
              <span>Cost basis</span>
              <strong>{formatMoney(totalCost)}</strong>
            </div>
            <div className="preview-box">
              <span>Input cost</span>
              <strong>{formatMoney(detailDeal.inputTotalCostCents || 0)}</strong>
            </div>
            <div className="preview-box detail-note">
              <span>Notes</span>
              <strong>{detailDeal.notes || 'Not recorded'}</strong>
            </div>
          </div>
          <section className="detail-section">
            <h3>Cards</h3>
            {dealCards.length ? (
              <div className="table-wrap detail-table-wrap" tabIndex={0}>
                <table className="detail-table">
                  <thead>
                    <tr>
                      <th>Status</th>
                      <th>Brand</th>
                      <th>Credential</th>
                      <th className="numeric">Face</th>
                      <th className="numeric">Remaining</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dealCards.map((card) => (
                      <tr key={card.id}>
                        <td>
                          <StatusBadge status={card.status} />
                        </td>
                        <td>{card.brand}</td>
                        <td className="mono">{credentialSummaryText(card)}</td>
                        <td className="numeric">{formatMoney(card.faceValueCents)}</td>
                        <td className="numeric">{formatMoney(card.remainingBalanceCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted-text">No cards attached to this deal.</p>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

export function EditCardPanel({
  card,
  onClose,
  onEditCard,
}: {
  card: Card;
  onClose: VoidHandler;
  onEditCard: (cardId: string, payload: ApiPayload) => Promise<unknown>;
}) {
  const terminal = isTerminalCard(card);
  const [form, setForm] = useState({
    brand: card.brand || '',
    expirationDate: card.expirationDate || '',
    notes: card.notes || '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus(onClose);

  function updateField(field: 'brand' | 'expirationDate' | 'notes', value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    const notes = form.notes.trim();
    const payload: {
      rowVersion: number;
      brand?: string;
      expirationDate?: string | null;
      notes?: string | null;
    } = {
      rowVersion: card.rowVersion,
    };

    if (!terminal) {
      const brand = form.brand.trim();
      if (!brand) {
        setError('Brand is required.');
        return;
      }
      payload.brand = brand;
      payload.expirationDate = form.expirationDate.trim() || null;
    }
    payload.notes = notes || null;

    setSubmitting(true);
    try {
      await onEditCard(card.id, payload);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={dialogRef} className="slide-panel" role="dialog" aria-modal="true" aria-labelledby="edit-card-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{card.brand}</p>
            <h2 id="edit-card-title">Edit card</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close edit card" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <form className="panel-form" onSubmit={submitEdit}>
          {terminal ? (
            <p className="warning-copy">
              This card is {statusText(card.status).toLowerCase()}. Only notes can be edited.
            </p>
          ) : null}
          <label>
            <span>Brand</span>
            <input
              value={form.brand}
              disabled={terminal}
              onChange={(event) => updateField('brand', event.target.value)}
              required={!terminal}
            />
          </label>
          <label>
            <span>Expiration date</span>
            <input
              type="date"
              value={form.expirationDate}
              disabled={terminal}
              onChange={(event) => updateField('expirationDate', event.target.value)}
            />
          </label>
          <label>
            <span>Notes</span>
            <textarea value={form.notes} onChange={(event) => updateField('notes', event.target.value)} rows={4} />
          </label>
          <FieldError message={error} />
          <div className="panel-actions">
            <button type="button" className="secondary-action" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function DeleteCardPanel({
  card,
  onClose,
  onDeleteCard,
}: {
  card: Card;
  onClose: VoidHandler;
  onDeleteCard: (cardId: string) => Promise<unknown>;
}) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus(onClose);

  async function submitDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onDeleteCard(card.id);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={dialogRef} className="slide-panel" role="dialog" aria-modal="true" aria-labelledby="delete-card-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{card.brand}</p>
            <h2 id="delete-card-title">Delete card</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close delete card" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <form className="panel-form" onSubmit={submitDelete}>
          <p className="warning-copy">
            Delete only if this card was entered by mistake and has no activity. This cannot be undone.
          </p>
          <div className="preview-box">
            <span>Credential</span>
            <strong className="mono">{credentialSummaryText(card)}</strong>
          </div>
          <div className="preview-box">
            <span>Face value</span>
            <strong>{formatMoney(card.faceValueCents)}</strong>
          </div>
          <FieldError message={error} />
          <div className="panel-actions">
            <button type="button" className="secondary-action" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action danger" disabled={submitting}>
              {submitting ? 'Deleting...' : 'Delete card'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function EditDealPanel({
  deal,
  onClose,
  onEditDeal,
}: {
  deal: Deal;
  onClose: VoidHandler;
  onEditDeal: (dealId: string, payload: ApiPayload) => Promise<unknown>;
}) {
  const [form, setForm] = useState({
    name: deal.name || '',
    source: deal.source || '',
    purchaseDate: deal.purchaseDate || '',
    notes: deal.notes || '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus(onClose);

  function updateField(field: 'name' | 'source' | 'purchaseDate' | 'notes', value: string) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    const name = form.name.trim();
    if (!name) {
      setError('Deal name is required.');
      return;
    }

    setSubmitting(true);
    try {
      await onEditDeal(deal.id, {
        rowVersion: deal.rowVersion,
        name,
        source: form.source.trim() || null,
        purchaseDate: form.purchaseDate.trim() || null,
        notes: form.notes.trim() || null,
      });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={dialogRef} className="slide-panel" role="dialog" aria-modal="true" aria-labelledby="edit-deal-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{deal.name}</p>
            <h2 id="edit-deal-title">Edit deal</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close edit deal" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <form className="panel-form" onSubmit={submitEdit}>
          <label>
            <span>Deal name</span>
            <input value={form.name} onChange={(event) => updateField('name', event.target.value)} required />
          </label>
          <label>
            <span>Source</span>
            <input value={form.source} onChange={(event) => updateField('source', event.target.value)} />
          </label>
          <label>
            <span>Purchase date</span>
            <input
              type="date"
              value={form.purchaseDate}
              onChange={(event) => updateField('purchaseDate', event.target.value)}
            />
          </label>
          <label>
            <span>Notes</span>
            <textarea value={form.notes} onChange={(event) => updateField('notes', event.target.value)} rows={4} />
          </label>
          <FieldError message={error} />
          <div className="panel-actions">
            <button type="button" className="secondary-action" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function ReserveCardPanel({
  card,
  onClose,
  onReserveCard,
}: {
  card: Card;
  onClose: VoidHandler;
  onReserveCard: (cardId: string, payload: ApiPayload) => Promise<unknown>;
}) {
  const [reservedFor, setReservedFor] = useState('');
  const [reservedUntil, setReservedUntil] = useState('');
  const [reservedNotes, setReservedNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus(onClose);

  async function submitReserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    setSubmitting(true);
    try {
      await onReserveCard(card.id, {
        ...(reservedFor.trim() ? { reservedFor: reservedFor.trim() } : {}),
        ...(reservedUntil ? { reservedUntil } : {}),
        ...(reservedNotes.trim() ? { reservedNotes: reservedNotes.trim() } : {}),
      });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={dialogRef} className="slide-panel" role="dialog" aria-modal="true" aria-labelledby="reserve-card-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{card.brand}</p>
            <h2 id="reserve-card-title">Reserve card</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close reserve card" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <form className="panel-form" onSubmit={submitReserve}>
          <div className="preview-box">
            <span>Remaining reserved</span>
            <strong>{formatMoney(card.remainingBalanceCents)}</strong>
          </div>
          <label>
            <span>Reserved for</span>
            <input value={reservedFor} onChange={(event) => setReservedFor(event.target.value)} />
          </label>
          <label>
            <span>Reserved until</span>
            <input type="date" value={reservedUntil} onChange={(event) => setReservedUntil(event.target.value)} />
          </label>
          <label>
            <span>Reservation notes</span>
            <textarea rows={3} value={reservedNotes} onChange={(event) => setReservedNotes(event.target.value)} />
          </label>
          <FieldError message={error} />
          <div className="panel-actions">
            <button type="button" className="secondary-action" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action" disabled={submitting}>
              <PackageCheck aria-hidden="true" size={17} />
              {submitting ? 'Reserving...' : 'Reserve card'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function VoidCardPanel({
  card,
  onClose,
  onVoidCard,
}: {
  card: Card;
  onClose: VoidHandler;
  onVoidCard: (cardId: string, payload: ApiPayload) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus(onClose);

  async function submitVoid(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!reason.trim()) {
      setError('Reason is required.');
      return;
    }

    setSubmitting(true);
    try {
      await onVoidCard(card.id, { reason: reason.trim() });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={dialogRef} className="slide-panel" role="dialog" aria-modal="true" aria-labelledby="void-card-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{card.brand}</p>
            <h2 id="void-card-title">Void card</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close void card" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <form className="panel-form" onSubmit={submitVoid}>
          <div className="preview-box">
            <span>Remaining write-off</span>
            <strong>{formatMoney(card.remainingBalanceCents)}</strong>
          </div>
          <p className="panel-note">
            This creates a write-off usage for the remaining balance and makes the card terminal.
          </p>
          <label>
            <span>Reason</span>
            <input value={reason} onChange={(event) => setReason(event.target.value)} required />
          </label>
          <FieldError message={error} />
          <div className="panel-actions">
            <button type="button" className="secondary-action" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action danger" disabled={submitting}>
              <X aria-hidden="true" size={17} />
              {submitting ? 'Voiding...' : 'Void card'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function UndoSalePanel({
  card,
  onClose,
  onUndoSale,
}: {
  card: Card;
  onClose: VoidHandler;
  onUndoSale: (cardId: string, payload: ApiPayload) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus(onClose);

  async function submitUndoSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!reason.trim()) {
      setError('Reason is required.');
      return;
    }

    setSubmitting(true);
    try {
      await onUndoSale(card.id, { reason: reason.trim() });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={dialogRef} className="slide-panel" role="dialog" aria-modal="true" aria-labelledby="undo-sale-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{card.brand}</p>
            <h2 id="undo-sale-title">Undo sale</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close undo sale" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <form className="panel-form" onSubmit={submitUndoSale}>
          <div className="preview-box">
            <span>Current status</span>
            <strong>{statusText(card.status)}</strong>
          </div>
          <p className="panel-note">
            This restores the card from the sale snapshot and records a reversal audit event.
          </p>
          <label>
            <span>Reason</span>
            <input value={reason} onChange={(event) => setReason(event.target.value)} required />
          </label>
          <FieldError message={error} />
          <div className="panel-actions">
            <button type="button" className="secondary-action" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary-action" disabled={submitting}>
              <RefreshCw aria-hidden="true" size={17} />
              {submitting ? 'Undoing...' : 'Undo sale'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

export function SellCardPanel({
  card,
  onClose,
  onSellCard,
}: {
  card: Card;
  onClose: VoidHandler;
  onSellCard: (cardId: string, payload: CardSalePayload) => Promise<unknown>;
}) {
  const [salePrice, setSalePrice] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerType, setBuyerType] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus(onClose);

  async function submitSale(event: FormEvent<HTMLFormElement>) {
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
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={dialogRef} className="slide-panel" role="dialog" aria-modal="true" aria-labelledby="sell-card-title">
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

export function UseCardPanel({
  card,
  onClose,
  onUseCard,
}: {
  card: Card;
  onClose: VoidHandler;
  onUseCard: (cardId: string, payload: ApiPayload) => Promise<unknown>;
}) {
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus(onClose);

  async function submitUsage(event: FormEvent<HTMLFormElement>) {
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
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={dialogRef} className="slide-panel" role="dialog" aria-modal="true" aria-labelledby="use-card-title">
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
