import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FocusEvent, FormEvent, KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import type {
  CredentialField,
  CredentialFieldKind,
  FeatureFlags,
  ReferenceReviewItem,
  ReferenceValue,
  ReferenceValueState,
} from '../shared/domain';
import type { AddDealCustomField, AddDealFormState, ApiPayload, AsyncApiHandler, VoidHandler } from './appTypes';
import { defaultFeatureFlags } from './defaults';
import {
  credentialProfileOptions,
  customCredentialFieldKinds,
  inferCredentialProfileForBrand,
  inferNetworkFromBrand,
} from './credentialHelpers';
import { dollarsToCents, errorMessage } from './display';
import { FieldError, HelpHint } from './formUi';
import {
  buildReferenceReviewItems,
  buildReferenceTouchValues,
  defaultReferenceValues,
  filterReferenceOptions,
  referenceValueTypes,
} from './referenceValues';
import { useDialogFocus } from './useDialogFocus';

function ReferenceCombobox({
  label,
  value,
  onChange,
  options,
  required = false,
  placeholder = '',
  helpText = '',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReferenceValue[];
  required?: boolean;
  placeholder?: string;
  helpText?: string;
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
        <span className="label-with-help">
          {label}
          {helpText ? <HelpHint text={helpText} /> : null}
        </span>
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

export function AddDealPanel({
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

    push('card_number', 'Card number', 'card_number', form.cardNumber);
    push('pin', 'PIN', 'pin', form.pin);
    return fields;
  }

  function dealPayload(totalCostCents: number | undefined, faceValueCents: number) {
    const profile = form.credentialProfile;
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
            <span className="label-with-help">
              Code / PIN / Claim code
              <HelpHint text="Use the single secret needed to redeem this card, such as a DoorDash code or Amazon claim code." />
            </span>
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
            <span className="label-with-help">
              Barcode value
              <HelpHint text="Enter the exact value encoded by the barcode or QR code." />
            </span>
            <input
              className="mono"
              autoComplete="off"
              value={form.barcodeValue}
              onChange={(event) => updateField('barcodeValue', event.target.value)}
            />
          </label>
          <label>
            <span className="label-with-help">
              Barcode format
              <HelpHint text="Choose the barcode symbology when you know it. Code 128 is a safe default for many merchant barcodes." />
            </span>
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
            <span className="label-with-help">
              Card number
              <HelpHint text="For prepaid cards, enter the card number printed on the card or issued digitally." />
            </span>
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
              <span className="label-with-help">
                Exp. month
                <HelpHint text="Two-digit expiration month, for example 08." />
              </span>
              <input
                inputMode="numeric"
                autoComplete="cc-exp-month"
                value={form.expirationMonth}
                onChange={(event) => updateField('expirationMonth', event.target.value)}
              />
            </label>
            <label>
              <span className="label-with-help">
                Exp. year
                <HelpHint text="Two- or four-digit expiration year, matching the card." />
              </span>
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
                  <span className="label-with-help">
                    Security code
                    <HelpHint text="Only save this for a private local vault when you accept the risk. Hosted/product use should not store CVV/CID." />
                  </span>
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
            <span className="label-with-help">
              Billing ZIP
              <HelpHint text="ZIP or postal code required by some prepaid card balance and payment flows." />
            </span>
            <input
              autoComplete="postal-code"
              value={form.billingZip}
              onChange={(event) => updateField('billingZip', event.target.value)}
            />
          </label>
          <label>
            <span className="label-with-help">
              Cardholder name
              <HelpHint text="Name to use for prepaid card billing forms when the issuer requires it." />
            </span>
            <input
              autoComplete="cc-name"
              value={form.cardholderName}
              onChange={(event) => updateField('cardholderName', event.target.value)}
            />
          </label>
          <label>
            <span className="label-with-help">
              Billing address
              <HelpHint text="Billing address for prepaid cards that require address registration." />
            </span>
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
                <span className="label-with-help">
                  Label
                  <HelpHint text="Name this custom credential field, such as Member ID, Security phrase, or Barcode." />
                </span>
                <input
                  value={field.label}
                  onChange={(event) => updateCustomField(field.id, { label: event.target.value })}
                />
              </label>
              <label>
                <span className="label-with-help">
                  Type
                  <HelpHint text="Select how this custom field should be treated for masking, copying, and search." />
                </span>
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
                <span className="label-with-help">
                  Value
                  <HelpHint text="Enter the sensitive or display value for this custom field." />
                </span>
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

    return (
      <div className="credential-mode-block">
        <label>
          <span className="label-with-help">
            Card number
            <HelpHint text="Merchant gift-card number or primary code for cards that also require a PIN." />
          </span>
          <input
            className="mono"
            autoComplete="off"
            value={form.cardNumber}
            onChange={(event) => updateField('cardNumber', event.target.value)}
          />
        </label>
        <label>
          <span className="label-with-help">
            PIN
            <HelpHint text="Secondary PIN required by cards like Best Buy, Target, or Home Depot. If the issuer calls it an access number, enter it here." />
          </span>
          <input
            className="mono"
            autoComplete="off"
            value={form.pin}
            onChange={(event) => updateField('pin', event.target.value)}
          />
        </label>
        <p className="muted-text">
          Use this for Best Buy, Target, Home Depot, and similar cards that ask for a gift-card number plus PIN.
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
            helpText="Optional label for this purchase group. Existing entries are suggested while typing and substring matches work."
            onChange={(value) => updateField('name', value)}
          />
          <ReferenceCombobox
            label="Source"
            value={form.source}
            options={referenceValues[referenceValueTypes.source]}
            helpText="Where the card came from, such as a marketplace, store, promotion, or manual entry."
            onChange={(value) => updateField('source', value)}
          />
          <label>
            <span className="label-with-help">
              Total cost
              <HelpHint text="Optional purchase cost for this deal. Use dollars, for example 45 or 45.00." />
            </span>
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
            helpText="Merchant or network brand. Existing indexed brands are suggested while typing."
            onChange={(value) => updateField('cardBrand', value)}
          />
          <label>
            <span className="label-with-help">
              Face value
              <HelpHint text="Required card value in dollars. Dollar sign is optional, for example 50 or 50.00." />
            </span>
            <input
              inputMode="decimal"
              placeholder="50.00"
              value={form.faceValue}
              onChange={(event) => updateField('faceValue', event.target.value)}
              required
            />
          </label>
          <label>
            <span className="label-with-help">
              Credential type
              <HelpHint text="Choose the fields needed to redeem the card: single code, number plus PIN, barcode, prepaid, or custom." />
            </span>
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
