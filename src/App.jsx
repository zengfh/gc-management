import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CircleDollarSign,
  Copy,
  CreditCard,
  DatabaseBackup,
  Download,
  Eye,
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
} from 'lucide-react';

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'cards', label: 'Cards', icon: CreditCard },
  { id: 'deals', label: 'Deals', icon: Tag },
  { id: 'backup', label: 'Backup', icon: DatabaseBackup },
  { id: 'audit', label: 'Audit Log', icon: ScrollText },
  { id: 'settings', label: 'Settings', icon: Settings },
];

const defaultPage = {
  limit: 50,
  offset: 0,
  total: 0,
  hasMore: false,
};

const defaultBackupSettings = {
  allowPlaintextExport: true,
  plaintextExportPolicyLocked: false,
  backupReminderDays: 30,
  backupReminderDue: true,
  lastBackupAt: null,
  nextBackupDueAt: null,
  lastPlaintextExportAt: null,
  lastEncryptedExportAt: null,
  lastRawDatabaseExportAt: null,
};

const defaultSupportPolicy = {
  supportAccessEnabled: false,
  supportContact: '',
  supportPolicyUrl: '',
  supportNotes: '',
  supportUpdatedAt: null,
  supportUpdatedByUserId: null,
};

const defaultDataPolicy = {
  auditRetentionDays: 365,
  idempotencyRetentionDays: 7,
  sessionRetentionDays: 7,
  loginAttemptRetentionDays: 30,
};

const defaultFeatureFlags = {
  plaintextJsonExport: true,
  rawDatabaseExport: true,
  csvImport: true,
  referenceValueHints: true,
  networkSecurityCodeStorage: false,
};

const csvImportTemplates = [
  {
    id: 'gc-manager',
    label: 'GC Manager',
    filename: 'gc-manager-import-template.csv',
    csv: [
      'brand,cardType,network,faceValue,purchaseCost,cardNumber,pin,billingZip,expirationDate,format,source,notes',
      'Target,merchant,,50.00,45.00,4111111111111111,1234,94105,2028-12-31,digital,Costco,Holiday balance',
    ].join('\n'),
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    filename: 'marketplace-import-template.csv',
    csv: [
      'Merchant,Value,Cost,Number,Claim Code,Postal Code,Expires,Delivery,Seller,Memo',
      'Best Buy,100.00,86.25,5555444433332222,7788,94105,2028-08-31,eGift,Raise,Marketplace order',
    ].join('\n'),
  },
  {
    id: 'prepaid',
    label: 'Prepaid',
    filename: 'prepaid-import-template.csv',
    csv: [
      'Issuer,Card Category,Payment Network,Face Amount,Cost Basis,Account Number,Billing Postal Code,Exp Date,Medium,Purchase Source,Description',
      'Vanilla,prepaid,visa,200.00,190.00,4111111111111111,94105,2029-04-30,plastic,Giftcards.com,Activation batch',
    ].join('\n'),
  },
  {
    id: 'code-only',
    label: 'Code only',
    filename: 'code-only-import-template.csv',
    csv: [
      'brand,credentialProfile,faceValue,purchaseCost,redemptionCode,format,source,notes',
      'Amazon,claim_code,50.00,45.00,A1B2-C3D4-E5F6,digital,Amazon Promo,Claim-code card',
    ].join('\n'),
  },
  {
    id: 'barcode',
    label: 'Barcode',
    filename: 'barcode-import-template.csv',
    csv: [
      'brand,credentialProfile,faceValue,purchaseCost,barcodeValue,barcodeFormat,format,source,notes',
      'Starbucks,barcode,25.00,20.00,123456789012,code128,digital,Gift card mall,Scanner-first card',
    ].join('\n'),
  },
  {
    id: 'custom',
    label: 'Custom',
    filename: 'custom-import-template.csv',
    csv: [
      'brand,credentialProfile,faceValue,purchaseCost,custom:Member ID,custom:Security phrase,source,notes',
      'Local Spa,custom,120.00,96.00,MEMBER-2345,frontdesk-only,Direct,Issuer-specific fields',
    ].join('\n'),
  },
];

const statusLabels = {
  available: 'Available',
  reserved: 'Reserved',
  in_use: 'In Use',
  sold: 'Sold',
  used_up: 'Used Up',
  void: 'Void',
};

const terminalCardStatuses = new Set(['sold', 'used_up', 'void']);
const adminRoleSet = new Set(['owner', 'admin']);
const operatorRoleSet = new Set(['owner', 'admin', 'operator']);

const credentialProfileOptions = [
  { value: 'claim_code', label: 'Single code / PIN' },
  { value: 'merchant_number_pin', label: 'Card number + PIN' },
  { value: 'merchant_number_access', label: 'Card number + access code' },
  { value: 'barcode', label: 'Barcode / QR' },
  { value: 'network_prepaid', label: 'Network prepaid card' },
  { value: 'custom', label: 'Custom' },
];

const networkBrandPattern = /\b(visa|mastercard|master card|amex|american express|discover|vanilla|serve)\b/i;
const claimCodeBrandPattern = /\b(amazon|apple|doordash|door dash|uber|ubereats|steam|google play|playstation|xbox)\b/i;
const barcodeBrandPattern = /\b(starbucks|dunkin|chipotle|mcdonald|panera)\b/i;
const accessCodeBrandPattern = /\b(target)\b/i;
const customCredentialFieldKinds = [
  { value: 'primary_code', label: 'Secret code' },
  { value: 'card_number', label: 'Card number' },
  { value: 'pin', label: 'PIN' },
  { value: 'access_code', label: 'Access code' },
  { value: 'barcode_value', label: 'Barcode' },
  { value: 'billing_postal_code', label: 'Billing ZIP' },
  { value: 'cardholder_name', label: 'Name' },
  { value: 'billing_address', label: 'Address' },
  { value: 'metadata', label: 'Note' },
];

function inferCredentialProfileForBrand(brand) {
  if (networkBrandPattern.test(brand)) {
    return 'network_prepaid';
  }
  if (barcodeBrandPattern.test(brand)) {
    return 'barcode';
  }
  if (claimCodeBrandPattern.test(brand)) {
    return 'claim_code';
  }
  if (accessCodeBrandPattern.test(brand)) {
    return 'merchant_number_access';
  }
  return 'merchant_number_pin';
}

function inferNetworkFromBrand(brand) {
  const normalized = String(brand || '').toLowerCase();
  if (normalized.includes('master')) {
    return 'mastercard';
  }
  if (normalized.includes('amex') || normalized.includes('american express')) {
    return 'amex';
  }
  if (normalized.includes('discover')) {
    return 'discover';
  }
  if (normalized.includes('visa') || normalized.includes('vanilla')) {
    return 'visa';
  }
  return 'other';
}

function credentialSummaryText(card) {
  const summary = card?.credentialSummary;
  if (summary?.primaryHint) {
    return summary.primaryLabel ? `${summary.primaryLabel}: ${summary.primaryHint}` : summary.primaryHint;
  }
  if (summary?.primaryLast4) {
    return summary.primaryLabel ? `${summary.primaryLabel}: **** ${summary.primaryLast4}` : `**** ${summary.primaryLast4}`;
  }
  if (card?.cardNumberLast4) {
    return `Card number: **** ${card.cardNumberLast4}`;
  }
  return 'Hidden';
}

const barcodeFormatToBcid = {
  code128: 'code128',
  qr: 'qrcode',
  ean13: 'ean13',
  upca: 'upca',
  pdf417: 'pdf417',
  aztec: 'azteccode',
  data_matrix: 'datamatrix',
  other: 'code128',
};

function barcodeSvgDataUri(value, format, toSvg) {
  const bcid = barcodeFormatToBcid[format] || barcodeFormatToBcid.other;
  const svg = toSvg({
    bcid,
    text: String(value || ''),
    scale: bcid === 'qrcode' ? 4 : 3,
    height: bcid === 'qrcode' ? undefined : 16,
    paddingwidth: 10,
    paddingheight: 10,
    includetext: false,
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function authRole(auth) {
  return auth?.user?.role || 'owner';
}

function canAdmin(auth) {
  return adminRoleSet.has(authRole(auth));
}

function canManageInventory(auth) {
  return operatorRoleSet.has(authRole(auth));
}

function authFeatures(auth) {
  return {
    ...defaultFeatureFlags,
    ...(auth?.features || {}),
  };
}

const referenceValueTypes = {
  dealName: 'deal_name',
  source: 'source',
  cardBrand: 'card_brand',
};

const defaultReferenceValues = {
  [referenceValueTypes.dealName]: [],
  [referenceValueTypes.source]: [],
  [referenceValueTypes.cardBrand]: [],
};

const addDealReferenceFields = [
  { field: 'name', type: referenceValueTypes.dealName, label: 'Deal name' },
  { field: 'source', type: referenceValueTypes.source, label: 'Source' },
  { field: 'cardBrand', type: referenceValueTypes.cardBrand, label: 'Card brand' },
];

function normalizeReferenceText(value) {
  return String(value || '').trim().toLowerCase();
}

function sortReferenceValues(values) {
  return [...values].sort((a, b) => {
    const usageDelta = (b.usageCount || 0) - (a.usageCount || 0);
    if (usageDelta) {
      return usageDelta;
    }
    const updatedDelta = String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || ''));
    if (updatedDelta) {
      return updatedDelta;
    }
    return String(a.value || '').localeCompare(String(b.value || ''), undefined, { sensitivity: 'base' });
  });
}

function mergeReferenceValueState(current, incomingRows) {
  const next = {
    [referenceValueTypes.dealName]: [...(current?.[referenceValueTypes.dealName] || [])],
    [referenceValueTypes.source]: [...(current?.[referenceValueTypes.source] || [])],
    [referenceValueTypes.cardBrand]: [...(current?.[referenceValueTypes.cardBrand] || [])],
  };

  for (const row of incomingRows || []) {
    if (!row?.type || !next[row.type]) {
      continue;
    }
    const normalized = normalizeReferenceText(row.value);
    const existingIndex = next[row.type].findIndex(
      (value) => normalizeReferenceText(value.value) === normalized,
    );
    if (existingIndex >= 0) {
      next[row.type][existingIndex] = row;
    } else {
      next[row.type].push(row);
    }
  }

  return Object.fromEntries(
    Object.entries(next).map(([type, values]) => [type, sortReferenceValues(values)]),
  );
}

function normalizeReferenceValuePayload(data) {
  return {
    [referenceValueTypes.dealName]: Array.isArray(data?.[referenceValueTypes.dealName])
      ? sortReferenceValues(data[referenceValueTypes.dealName])
      : [],
    [referenceValueTypes.source]: Array.isArray(data?.[referenceValueTypes.source])
      ? sortReferenceValues(data[referenceValueTypes.source])
      : [],
    [referenceValueTypes.cardBrand]: Array.isArray(data?.[referenceValueTypes.cardBrand])
      ? sortReferenceValues(data[referenceValueTypes.cardBrand])
      : [],
  };
}

function filterReferenceOptions(options, query, limit = 8) {
  const normalizedQuery = normalizeReferenceText(query);
  const ranked = (options || [])
    .filter((option) => {
      if (!option?.value) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }
      return normalizeReferenceText(option.value).includes(normalizedQuery);
    })
    .map((option) => {
      const normalizedValue = normalizeReferenceText(option.value);
      let rank = 3;
      if (normalizedValue === normalizedQuery) {
        rank = 0;
      } else if (normalizedValue.startsWith(normalizedQuery)) {
        rank = 1;
      } else if (normalizedValue.includes(normalizedQuery)) {
        rank = 2;
      }
      return { option, rank };
    })
    .sort((a, b) => {
      if (a.rank !== b.rank) {
        return a.rank - b.rank;
      }
      const usageDelta = (b.option.usageCount || 0) - (a.option.usageCount || 0);
      if (usageDelta) {
        return usageDelta;
      }
      return String(a.option.value).localeCompare(String(b.option.value), undefined, { sensitivity: 'base' });
    });

  return ranked.slice(0, limit).map(({ option }) => option);
}

function hasIndexedReferenceValue(options, value) {
  const normalized = normalizeReferenceText(value);
  return Boolean(normalized)
    && (options || []).some((option) => normalizeReferenceText(option.value) === normalized);
}

function levenshteinDistance(left, right) {
  if (left === right) {
    return 0;
  }
  if (!left.length) {
    return right.length;
  }
  if (!right.length) {
    return left.length;
  }

  const previous = Array.from({ length: right.length + 1 }, (_unused, index) => index);
  const current = Array(right.length + 1).fill(0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        current[rightIndex - 1] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function typoSuggestions(options, value) {
  const normalizedValue = normalizeReferenceText(value);
  if (normalizedValue.length < 3) {
    return [];
  }
  const maxDistance = normalizedValue.length >= 6 ? 2 : 1;

  return (options || [])
    .map((option) => ({
      option,
      distance: levenshteinDistance(normalizedValue, normalizeReferenceText(option.value)),
    }))
    .filter(({ distance }) => distance > 0 && distance <= maxDistance)
    .sort((a, b) => {
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      return (b.option.usageCount || 0) - (a.option.usageCount || 0);
    })
    .slice(0, 3)
    .map(({ option }) => option);
}

function buildReferenceReviewItems(form, referenceValues) {
  return addDealReferenceFields
    .map((config) => {
      const value = String(form[config.field] || '').trim();
      if (!value) {
        return null;
      }
      const options = referenceValues?.[config.type] || [];
      if (hasIndexedReferenceValue(options, value)) {
        return null;
      }
      return {
        key: `${config.type}:${normalizeReferenceText(value)}`,
        ...config,
        value,
        suggestions: typoSuggestions(options, value),
      };
    })
    .filter(Boolean);
}

function buildReferenceTouchValues(form, referenceValues, approvedItems) {
  const approvedKeys = new Set(
    (approvedItems || []).map((item) => `${item.type}:${normalizeReferenceText(item.value)}`),
  );
  const touched = [];
  const seen = new Set();

  for (const config of addDealReferenceFields) {
    const value = String(form[config.field] || '').trim();
    if (!value) {
      continue;
    }
    const key = `${config.type}:${normalizeReferenceText(value)}`;
    const indexed = hasIndexedReferenceValue(referenceValues?.[config.type] || [], value);
    if (!indexed && !approvedKeys.has(key)) {
      continue;
    }
    if (!seen.has(key)) {
      seen.add(key);
      touched.push({ type: config.type, value });
    }
  }

  return touched;
}

const dialogFocusableSelector = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'a[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function useDialogFocus(onClose) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return undefined;
    }

    const previousFocus = document.activeElement;
    const focusableElements = () =>
      [...dialog.querySelectorAll(dialogFocusableSelector)].filter(
        (element) => !element.hasAttribute('aria-hidden'),
      );
    const initialFocus =
      dialog.querySelector('[data-autofocus]')
      || dialog.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])')
      || focusableElements()[0]
      || dialog;

    initialFocus.focus();

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      const elements = focusableElements();
      if (!elements.length) {
        event.preventDefault();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    dialog.addEventListener('keydown', handleKeyDown);
    return () => {
      dialog.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.focus) {
        previousFocus.focus();
      }
    };
  }, [onClose]);

  return dialogRef;
}

function createUiIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) {
    return `ui_${globalThis.crypto.randomUUID()}`;
  }
  return `ui_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

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
    if (!['GET', 'HEAD'].includes(method.toUpperCase())) {
      options.headers['Idempotency-Key'] = createUiIdempotencyKey();
    }
  }

  const response = await fetch(path, options);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const requestId = payload.error?.requestId || response.headers.get('x-request-id');
    const message = payload.error?.message || 'Request failed.';
    const error = new Error(requestId ? `${message} Request ID: ${requestId}` : message);
    error.code = payload.error?.code;
    error.fieldErrors = payload.error?.fieldErrors || [];
    error.requestId = requestId;
    error.status = response.status;
    throw error;
  }

  return payload;
}

async function apiDownload(path, { method = 'GET', body, csrfToken } = {}) {
  const options = {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/octet-stream',
    },
  };

  if (body !== undefined) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }

  if (csrfToken) {
    options.headers['X-CSRF-Token'] = csrfToken;
    if (!['GET', 'HEAD'].includes(method.toUpperCase())) {
      options.headers['Idempotency-Key'] = createUiIdempotencyKey();
    }
  }

  const response = await fetch(path, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const requestId = payload.error?.requestId || response.headers.get('x-request-id');
    const message = payload.error?.message || 'Request failed.';
    const error = new Error(requestId ? `${message} Request ID: ${requestId}` : message);
    error.code = payload.error?.code;
    error.fieldErrors = payload.error?.fieldErrors || [];
    error.requestId = requestId;
    error.status = response.status;
    throw error;
  }

  return {
    blob: await response.blob(),
    filename: filenameFromContentDisposition(response.headers.get('content-disposition')),
  };
}

function filenameFromContentDisposition(header) {
  if (!header) {
    return null;
  }

  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] || null;
}

function formatMoney(cents = 0) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

function formatDateTime(value) {
  if (!value) {
    return 'Not recorded';
  }
  return new Date(value).toLocaleString();
}

function parseDateOnly(value) {
  if (!value) {
    return null;
  }
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isWithinNextDays(value, days) {
  const parsed = parseDateOnly(value);
  if (!parsed) {
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(end.getDate() + days);
  return parsed >= today && parsed <= end;
}

function isBeforeToday(value) {
  const parsed = parseDateOnly(value);
  if (!parsed) {
    return false;
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return parsed < today;
}

function formatDisplayValue(value) {
  if (!value) {
    return 'Not recorded';
  }
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusText(status) {
  return statusLabels[status] || status;
}

function viewTitle(view) {
  if (view === 'dashboard') {
    return 'Dashboard';
  }
  if (view === 'cards') {
    return 'Cards';
  }
  if (view === 'audit') {
    return 'Audit Log';
  }
  if (view === 'backup') {
    return 'Backup';
  }
  if (view === 'settings') {
    return 'Settings';
  }
  return 'Deals';
}

function isTerminalCard(card) {
  return terminalCardStatuses.has(card.status);
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

function criteriaValue(value) {
  return value == null ? '' : String(value).trim();
}

function downloadBlobFile(filename, blob) {
  if (typeof document === 'undefined' || !globalThis.URL?.createObjectURL) {
    return;
  }

  const url = globalThis.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  globalThis.URL.revokeObjectURL?.(url);
}

function downloadJsonFile(filename, payload) {
  downloadBlobFile(
    filename,
    new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    }),
  );
}

function downloadCsvFile(filename, csv) {
  downloadBlobFile(
    filename,
    new Blob([csv], {
      type: 'text/csv',
    }),
  );
}

function readFileText(file) {
  if (file?.text) {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('CSV file could not be read.'));
    reader.readAsText(file);
  });
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

function BarcodePreview({ value, format }) {
  const barcodeKey = `${format || 'code128'}:${value || ''}`;
  const [barcodeImage, setBarcodeImage] = useState({ key: '', src: null });

  useEffect(() => {
    let canceled = false;
    if (!value) {
      return undefined;
    }

    import('bwip-js')
      .then((module) => {
        if (!canceled) {
          setBarcodeImage({
            key: barcodeKey,
            src: barcodeSvgDataUri(value, format, module.toSVG),
          });
        }
      })
      .catch(() => {
        if (!canceled) {
          setBarcodeImage({ key: barcodeKey, src: null });
        }
      });

    return () => {
      canceled = true;
    };
  }, [barcodeKey, format, value]);

  const src = barcodeImage.key === barcodeKey ? barcodeImage.src : null;

  if (!value || !src) {
    return null;
  }

  return (
    <div className="barcode-preview" aria-label="Scannable barcode">
      <img src={src} alt="Scannable barcode" />
    </div>
  );
}

function SetupScreen({ onSetup }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('Owner');
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
      await onSetup({ email: email.trim(), displayName: displayName.trim(), unlockSecret });
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

function UnlockScreen({ onLogin, onAcceptInvite, onRecoverAccess }) {
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

  async function submitLogin(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onLogin({ email: email.trim(), unlockSecret });
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitInvite(event) {
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
      setError(caught.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRecovery(event) {
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

function DealsTable({ deals, canManage, onViewDeal, onEditDeal, onArchiveDeal, onUnarchiveDeal }) {
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

function AuditTable({ events }) {
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

function AuditFilterForm({ onLoadAudit }) {
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitFilter(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onLoadAudit({ entityType, action, from, to });
    } catch (caught) {
      setError(caught.message);
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
      setError(caught.message);
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

function BackupExportForm({ onExportPlaintext }) {
  const [unlockSecret, setUnlockSecret] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [acknowledgePlaintext, setAcknowledgePlaintext] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitExport(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const response = await onExportPlaintext({
        unlockSecret,
        confirmation,
        acknowledgePlaintext,
      });
      const payload = response.data;
      const exportedDate = (payload?.exportedAt || new Date().toISOString()).slice(0, 10);
      downloadJsonFile(`gift-card-plaintext-export-${exportedDate}.json`, payload);
      setUnlockSecret('');
      setConfirmation('');
      setAcknowledgePlaintext(false);
      setSuccess(`Plaintext export prepared with ${payload?.cards?.length || 0} cards.`);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="backup-export-form" onSubmit={submitExport}>
      <div className="warning-copy danger-warning">
        <AlertTriangle aria-hidden="true" size={18} />
        <span>This export contains full card numbers and PINs. Anyone with the file may be able to spend your cards.</span>
      </div>
      <label>
        <span>Fresh unlock secret</span>
        <input
          type="password"
          value={unlockSecret}
          autoComplete="current-password"
          onChange={(event) => setUnlockSecret(event.target.value)}
        />
      </label>
      <label>
        <span>Type EXPORT to confirm</span>
        <input
          value={confirmation}
          autoCapitalize="characters"
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </label>
      <label className="check-row backup-check">
        <input
          type="checkbox"
          checked={acknowledgePlaintext}
          onChange={(event) => setAcknowledgePlaintext(event.target.checked)}
        />
        <span>I understand this file contains spendable credentials.</span>
      </label>
      <div className="backup-actions">
        <button type="submit" className="primary-action danger" disabled={submitting}>
          <Download aria-hidden="true" size={17} />
          {submitting ? 'Exporting...' : 'Export plaintext JSON'}
        </button>
      </div>
      <FieldError message={error} />
      {success ? <p className="success-copy">{success}</p> : null}
    </form>
  );
}

function EncryptedBackupExportForm({ onExportEncrypted }) {
  const [unlockSecret, setUnlockSecret] = useState('');
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [backupPassphraseConfirmation, setBackupPassphraseConfirmation] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitExport(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (backupPassphrase !== backupPassphraseConfirmation) {
      setError('Backup passphrase confirmation does not match.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await onExportEncrypted({
        unlockSecret,
        backupPassphrase,
        backupPassphraseConfirmation,
        confirmation,
      });
      const payload = response.data;
      const exportedDate = (payload?.exportedAt || new Date().toISOString()).slice(0, 10);
      downloadJsonFile(`gift-card-encrypted-export-${exportedDate}.json`, payload);
      setUnlockSecret('');
      setBackupPassphrase('');
      setBackupPassphraseConfirmation('');
      setConfirmation('');
      setSuccess('Encrypted export prepared.');
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="backup-export-form" onSubmit={submitExport}>
      <div className="warning-copy">
        Encrypted exports protect credentials with a separate backup passphrase.
      </div>
      <label>
        <span>Encrypted export unlock secret</span>
        <input
          type="password"
          value={unlockSecret}
          autoComplete="current-password"
          onChange={(event) => setUnlockSecret(event.target.value)}
        />
      </label>
      <label>
        <span>Backup passphrase</span>
        <input
          type="password"
          value={backupPassphrase}
          autoComplete="new-password"
          onChange={(event) => setBackupPassphrase(event.target.value)}
        />
      </label>
      <label>
        <span>Repeat backup passphrase</span>
        <input
          type="password"
          value={backupPassphraseConfirmation}
          autoComplete="new-password"
          onChange={(event) => setBackupPassphraseConfirmation(event.target.value)}
        />
      </label>
      <label>
        <span>Type ENCRYPT to confirm</span>
        <input
          value={confirmation}
          autoCapitalize="characters"
          onChange={(event) => setConfirmation(event.target.value)}
        />
      </label>
      <div className="backup-actions">
        <button type="submit" className="primary-action" disabled={submitting}>
          <Lock aria-hidden="true" size={17} />
          {submitting ? 'Exporting...' : 'Export encrypted JSON'}
        </button>
      </div>
      <FieldError message={error} />
      {success ? <p className="success-copy">{success}</p> : null}
    </form>
  );
}

function RawDatabaseExportForm({ onExportRawDatabase }) {
  const [unlockSecret, setUnlockSecret] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitExport(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);
    try {
      const response = await onExportRawDatabase({ unlockSecret });
      downloadBlobFile(response.filename || 'gift-card-raw-db-export.sqlite', response.blob);
      setUnlockSecret('');
      setSuccess('Raw database export prepared.');
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="backup-export-form" onSubmit={submitExport}>
      <div className="warning-copy">
        Raw database exports keep credentials encrypted but still contain sensitive inventory metadata.
      </div>
      <label>
        <span>Raw database unlock secret</span>
        <input
          type="password"
          value={unlockSecret}
          autoComplete="current-password"
          onChange={(event) => setUnlockSecret(event.target.value)}
        />
      </label>
      <div className="backup-actions">
        <button type="submit" className="secondary-action" disabled={submitting}>
          <DatabaseBackup aria-hidden="true" size={17} />
          {submitting ? 'Exporting...' : 'Export raw DB'}
        </button>
      </div>
      <FieldError message={error} />
      {success ? <p className="success-copy">{success}</p> : null}
    </form>
  );
}

function CsvPreviewTable({ rows }) {
  if (!rows?.length) {
    return null;
  }

  return (
    <div className="table-wrap import-preview-wrap">
      <table className="import-preview-table">
        <thead>
          <tr>
            <th>Row</th>
            <th>Status</th>
            <th>Brand</th>
            <th>Type</th>
            <th className="numeric">Face</th>
            <th className="numeric">Cost</th>
            <th>Credential</th>
            <th>PIN/access</th>
            <th>ZIP</th>
            <th>Errors</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rowNumber}>
              <td>{row.rowNumber}</td>
              <td>{row.valid ? 'Valid' : 'Invalid'}</td>
              <td>{row.parsed?.brand || 'Not provided'}</td>
              <td>{row.parsed?.cardType || 'Not provided'}</td>
              <td className="numeric">{formatMoney(row.parsed?.faceValueCents || 0)}</td>
              <td className="numeric">{formatMoney(row.parsed?.purchaseCostCents || 0)}</td>
              <td>
                {row.parsed?.credentialHint
                  ? `${row.parsed.credentialLabel || 'Credential'}: ${row.parsed.credentialHint}`
                  : 'Not provided'}
              </td>
              <td>{row.parsed?.hasPin ? 'Yes' : 'No'}</td>
              <td>{row.parsed?.hasBillingZip ? 'Yes' : 'No'}</td>
              <td>
                {row.errors?.length ? (
                  <ul className="import-errors">
                    {row.errors.map((error) => (
                      <li key={`${row.rowNumber}-${error.field}-${error.code}`}>
                        {error.field}: {error.message}
                      </li>
                    ))}
                  </ul>
                ) : (
                  'None'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CsvImportPreviewForm({ onPreviewCsv, onConfirmCsv }) {
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState(csvImportTemplates[0].id);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function updateFile(event) {
    const file = event.target.files?.[0];
    setPreview(null);
    setError('');
    setSuccess('');
    if (!file) {
      setCsvText('');
      setFileName('');
      return;
    }

    setFileName(file.name);
    try {
      setCsvText(await readFileText(file));
    } catch (caught) {
      setCsvText('');
      setError(caught.message);
    }
  }

  async function submitPreview(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    setPreview(null);
    if (!csvText) {
      setError('Choose a CSV file first.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await onPreviewCsv({ csv: csvText });
      setPreview(response.data);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmImport() {
    setError('');
    setSuccess('');
    setConfirming(true);
    try {
      const response = await onConfirmCsv({ csv: csvText });
      setSuccess(`Imported ${response.data.cards.length} ${response.data.cards.length === 1 ? 'card' : 'cards'}.`);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setConfirming(false);
    }
  }

  function downloadSelectedTemplate() {
    const template =
      csvImportTemplates.find((candidate) => candidate.id === selectedTemplateId) || csvImportTemplates[0];
    downloadCsvFile(template.filename, template.csv);
  }

  return (
    <form className="backup-export-form csv-preview-form" onSubmit={submitPreview}>
      <div className="import-template-row">
        <label>
          <span>CSV template</span>
          <select
            value={selectedTemplateId}
            onChange={(event) => setSelectedTemplateId(event.target.value)}
          >
            {csvImportTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="secondary-action" onClick={downloadSelectedTemplate}>
          <Download aria-hidden="true" size={17} />
          Download template
        </button>
      </div>
      <label>
        <span>CSV file</span>
        <input type="file" accept=".csv,text/csv" onChange={updateFile} />
      </label>
      <div className="backup-actions">
        <button type="submit" className="secondary-action" disabled={submitting}>
          <FilePlus2 aria-hidden="true" size={17} />
          {submitting ? 'Previewing...' : 'Preview CSV'}
        </button>
      </div>
      {fileName ? <p className="muted-text import-file-name">{fileName}</p> : null}
      <FieldError message={error} />
      {success ? <p className="success-copy">{success}</p> : null}
      {preview ? (
        <div className="import-preview-result">
          <div className="import-summary">
            <span>{preview.summary.validCount} valid</span>
            <span>{preview.summary.invalidCount} invalid</span>
            <span>{preview.summary.rowCount} rows</span>
          </div>
          <CsvPreviewTable rows={preview.rows} />
          {preview.summary.rowCount > 0 && preview.summary.invalidCount === 0 ? (
            <div className="backup-actions">
              <button type="button" className="primary-action" onClick={confirmImport} disabled={confirming}>
                <FilePlus2 aria-hidden="true" size={17} />
                {confirming ? 'Importing...' : 'Confirm CSV import'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}

function PlaintextJsonImportForm({ onImportBackup }) {
  const [payload, setPayload] = useState(null);
  const [fileName, setFileName] = useState('');
  const [unlockSecret, setUnlockSecret] = useState('');
  const [mode, setMode] = useState('merge');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function updateFile(event) {
    const file = event.target.files?.[0];
    setPayload(null);
    setFileName('');
    setError('');
    setSuccess('');
    if (!file) {
      return;
    }

    setFileName(file.name);
    try {
      const text = await readFileText(file);
      setPayload(JSON.parse(text));
    } catch {
      setPayload(null);
      setError('Choose a valid plaintext JSON backup file.');
    }
  }

  async function submitImport(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!payload) {
      setError('Choose a plaintext JSON backup file first.');
      return;
    }
    if (mode === 'replace' && confirmation !== 'REPLACE') {
      setError('Type REPLACE to confirm destructive import.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await onImportBackup({
        unlockSecret,
        mode,
        confirmation,
        payload,
      });
      const summary = response.data.summary;
      setUnlockSecret('');
      setConfirmation('');
      setSuccess(
        `JSON ${summary.mode} import completed: ${summary.cardCount} ${
          summary.cardCount === 1 ? 'card' : 'cards'
        }, ${summary.dealCount} ${summary.dealCount === 1 ? 'deal' : 'deals'}.`,
      );
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="backup-export-form json-import-form" onSubmit={submitImport}>
      <div className="warning-copy">
        Merge adds backup records to this vault. Replace removes current cards and deals after creating a server-side database backup.
      </div>
      <label>
        <span>Plaintext JSON backup file</span>
        <input type="file" accept=".json,application/json" onChange={updateFile} />
      </label>
      <label>
        <span>Import mode</span>
        <select value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="merge">Merge into current vault</option>
          <option value="replace">Replace current cards and deals</option>
        </select>
      </label>
      <label>
        <span>JSON import unlock secret</span>
        <input
          type="password"
          value={unlockSecret}
          autoComplete="current-password"
          onChange={(event) => setUnlockSecret(event.target.value)}
        />
      </label>
      {mode === 'replace' ? (
        <label>
          <span>Type REPLACE to confirm</span>
          <input
            value={confirmation}
            autoCapitalize="characters"
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
      ) : null}
      <div className="backup-actions">
        <button type="submit" className={mode === 'replace' ? 'primary-action danger' : 'primary-action'} disabled={submitting}>
          <FilePlus2 aria-hidden="true" size={17} />
          {submitting ? 'Importing...' : 'Import JSON backup'}
        </button>
      </div>
      {fileName ? <p className="muted-text import-file-name">{fileName}</p> : null}
      <FieldError message={error} />
      {success ? <p className="success-copy">{success}</p> : null}
    </form>
  );
}

function EncryptedJsonImportForm({ onImportBackup }) {
  const [payload, setPayload] = useState(null);
  const [fileName, setFileName] = useState('');
  const [unlockSecret, setUnlockSecret] = useState('');
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [mode, setMode] = useState('merge');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function updateFile(event) {
    const file = event.target.files?.[0];
    setPayload(null);
    setFileName('');
    setError('');
    setSuccess('');
    if (!file) {
      return;
    }

    setFileName(file.name);
    try {
      const parsedPayload = JSON.parse(await readFileText(file));
      if (parsedPayload?.exportType !== 'encrypted_portable_json') {
        throw new Error('Invalid encrypted backup.');
      }
      setPayload(parsedPayload);
    } catch {
      setPayload(null);
      setError('Choose a valid encrypted JSON backup file.');
    }
  }

  async function submitImport(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    if (!payload) {
      setError('Choose an encrypted JSON backup file first.');
      return;
    }
    if (mode === 'replace' && confirmation !== 'REPLACE') {
      setError('Type REPLACE to confirm destructive import.');
      return;
    }

    setSubmitting(true);
    try {
      const response = await onImportBackup({
        unlockSecret,
        backupPassphrase,
        mode,
        confirmation,
        payload,
      });
      const summary = response.data.summary;
      setUnlockSecret('');
      setBackupPassphrase('');
      setConfirmation('');
      setSuccess(
        `Encrypted JSON ${summary.mode} import completed: ${summary.cardCount} ${
          summary.cardCount === 1 ? 'card' : 'cards'
        }, ${summary.dealCount} ${summary.dealCount === 1 ? 'deal' : 'deals'}.`,
      );
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="backup-export-form json-import-form" onSubmit={submitImport}>
      <div className="warning-copy">
        Merge adds backup records to this vault. Replace removes current cards and deals after creating a server-side database backup.
      </div>
      <label>
        <span>Encrypted JSON backup file</span>
        <input type="file" accept=".json,application/json" onChange={updateFile} />
      </label>
      <label>
        <span>Encrypted import mode</span>
        <select value={mode} onChange={(event) => setMode(event.target.value)}>
          <option value="merge">Merge into current vault</option>
          <option value="replace">Replace current cards and deals</option>
        </select>
      </label>
      <label>
        <span>Encrypted import unlock secret</span>
        <input
          type="password"
          value={unlockSecret}
          autoComplete="current-password"
          onChange={(event) => setUnlockSecret(event.target.value)}
        />
      </label>
      <label>
        <span>Encrypted import backup passphrase</span>
        <input
          type="password"
          value={backupPassphrase}
          autoComplete="current-password"
          onChange={(event) => setBackupPassphrase(event.target.value)}
        />
      </label>
      {mode === 'replace' ? (
        <label>
          <span>Type REPLACE to confirm</span>
          <input
            value={confirmation}
            autoCapitalize="characters"
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
      ) : null}
      <div className="backup-actions">
        <button type="submit" className={mode === 'replace' ? 'primary-action danger' : 'primary-action'} disabled={submitting}>
          <Lock aria-hidden="true" size={17} />
          {submitting ? 'Importing...' : 'Import encrypted JSON backup'}
        </button>
      </div>
      {fileName ? <p className="muted-text import-file-name">{fileName}</p> : null}
      <FieldError message={error} />
      {success ? <p className="success-copy">{success}</p> : null}
    </form>
  );
}

function BackupSettingsForm({ settings, onUpdateBackupSettings }) {
  const effectiveSettings = settings || defaultBackupSettings;
  const [allowPlaintextExport, setAllowPlaintextExport] = useState(effectiveSettings.allowPlaintextExport);
  const [backupReminderDays, setBackupReminderDays] = useState(String(effectiveSettings.backupReminderDays));
  const [unlockSecret, setUnlockSecret] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitSettings(event) {
    event.preventDefault();
    setError('');
    setSuccess('');
    const reminderDays = Number(backupReminderDays);
    if (!Number.isInteger(reminderDays) || reminderDays < 0 || reminderDays > 365) {
      setError('Backup reminder days must be between 0 and 365.');
      return;
    }

    setSubmitting(true);
    try {
      await onUpdateBackupSettings({
        unlockSecret,
        allowPlaintextExport: effectiveSettings.plaintextExportPolicyLocked ? false : allowPlaintextExport,
        backupReminderDays: reminderDays,
      });
      setUnlockSecret('');
      setSuccess('Backup settings saved.');
    } catch (caught) {
      setError(caught.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="settings-form backup-settings-form" onSubmit={submitSettings}>
      <div className="settings-summary-grid" aria-label="Backup status">
        <div className="settings-summary-item">
          <span>Last backup</span>
          <strong>{formatDateTime(effectiveSettings.lastBackupAt)}</strong>
        </div>
        <div className="settings-summary-item">
          <span>Next due</span>
          <strong>
            {effectiveSettings.backupReminderDue
              ? 'Due now'
              : formatDateTime(effectiveSettings.nextBackupDueAt)}
          </strong>
        </div>
        <div className="settings-summary-item">
          <span>Plaintext export</span>
          <strong>
            {effectiveSettings.plaintextExportPolicyLocked
              ? 'Policy locked'
              : allowPlaintextExport
                ? 'Enabled'
                : 'Disabled'}
          </strong>
        </div>
      </div>
      <label className="check-row settings-check">
        <input
          type="checkbox"
          checked={allowPlaintextExport}
          disabled={effectiveSettings.plaintextExportPolicyLocked}
          onChange={(event) => setAllowPlaintextExport(event.target.checked)}
        />
        <span>Allow plaintext JSON export</span>
      </label>
      <label>
        <span>Backup reminder days</span>
        <input
          type="number"
          min="0"
          max="365"
          step="1"
          value={backupReminderDays}
          onChange={(event) => setBackupReminderDays(event.target.value)}
        />
      </label>
      <label>
        <span>Settings unlock secret</span>
        <input
          type="password"
          value={unlockSecret}
          autoComplete="current-password"
          onChange={(event) => setUnlockSecret(event.target.value)}
        />
      </label>
      <div className="backup-actions">
        <button type="submit" className="primary-action" disabled={submitting}>
          <DatabaseBackup aria-hidden="true" size={17} />
          {submitting ? 'Saving...' : 'Save backup settings'}
        </button>
      </div>
      <FieldError message={error} />
      {success ? <p className="success-copy">{success}</p> : null}
      <div className="backup-settings-history" aria-label="Backup history">
        <span>Encrypted: {formatDateTime(effectiveSettings.lastEncryptedExportAt)}</span>
        <span>Plaintext: {formatDateTime(effectiveSettings.lastPlaintextExportAt)}</span>
        <span>Raw DB: {formatDateTime(effectiveSettings.lastRawDatabaseExportAt)}</span>
      </div>
    </form>
  );
}

function UserAdminPanel({
  users,
  invites,
  loading,
  loaded,
  error,
  onCreateInvite,
  onRevokeInvite,
  onUpdateUser,
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('operator');
  const [currentUnlockSecret, setCurrentUnlockSecret] = useState('');
  const [createdInvite, setCreatedInvite] = useState(null);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitCreate(event) {
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
      setFormError(caught.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="user-admin-stack">
      {loading ? <div className="loading-strip inline-loading">Loading users...</div> : null}
      <FieldError message={error} />
      {loaded ? (
        <div className="table-wrap">
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
        <div className="table-wrap">
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

function UserAdminRow({ user, onUpdateUser }) {
  const [role, setRole] = useState(user.role);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function updateRole(event) {
    const nextRole = event.target.value;
    setRole(nextRole);
    setError('');
    setSubmitting(true);
    try {
      await onUpdateUser(user.id, { role: nextRole });
    } catch (caught) {
      setRole(user.role);
      setError(caught.message);
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
      setError(caught.message);
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

function RecoveryCodesPanel({ activeCount, onGenerateRecoveryCodes }) {
  const [currentUnlockSecret, setCurrentUnlockSecret] = useState('');
  const [codes, setCodes] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function generateCodes(event) {
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
      setError(caught.message);
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

function SupportPolicyForm({ policy, onUpdateSupportPolicy }) {
  const [supportAccessEnabled, setSupportAccessEnabled] = useState(policy.supportAccessEnabled);
  const [supportContact, setSupportContact] = useState(policy.supportContact || '');
  const [supportPolicyUrl, setSupportPolicyUrl] = useState(policy.supportPolicyUrl || '');
  const [supportNotes, setSupportNotes] = useState(policy.supportNotes || '');
  const [unlockSecret, setUnlockSecret] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitPolicy(event) {
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
      setError(caught.message);
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

function DataPolicyForm({ policy, onUpdateDataPolicy }) {
  const [auditRetentionDays, setAuditRetentionDays] = useState(String(policy.auditRetentionDays));
  const [idempotencyRetentionDays, setIdempotencyRetentionDays] = useState(String(policy.idempotencyRetentionDays));
  const [sessionRetentionDays, setSessionRetentionDays] = useState(String(policy.sessionRetentionDays));
  const [loginAttemptRetentionDays, setLoginAttemptRetentionDays] = useState(String(policy.loginAttemptRetentionDays));
  const [unlockSecret, setUnlockSecret] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitPolicy(event) {
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
      setError(caught.message);
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

function DataOperationsPanel({ onExportAccountData, onRunRetention, onDeleteAccountData }) {
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
  const [deleteUnlockSecret, setDeleteUnlockSecret] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleteSuccess, setDeleteSuccess] = useState('');
  const [deleting, setDeleting] = useState(false);

  async function submitExport(event) {
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
      setExportError(caught.message);
    } finally {
      setExporting(false);
    }
  }

  async function submitRetention(event) {
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
      setRetentionError(caught.message);
    } finally {
      setRetentionRunning(false);
    }
  }

  async function submitDelete(event) {
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
      setDeleteError(caught.message);
    } finally {
      setDeleting(false);
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

function ChangeUnlockSecretForm({ onChangeUnlockSecret }) {
  const [oldUnlockSecret, setOldUnlockSecret] = useState('');
  const [newUnlockSecret, setNewUnlockSecret] = useState('');
  const [confirmUnlockSecret, setConfirmUnlockSecret] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitChange(event) {
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
      setError(caught.message);
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

function CardSearchForm({ deals, onSearchCards }) {
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

  async function submitSearch(event) {
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
      setError(caught.message);
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
      setError(caught.message);
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

function CardsPagination({ page, currentCount, onPageCards }) {
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

function canUndoUsage(usage) {
  return !usage.isReversed && !usage.reversedAt && !usage.isWriteOff;
}

function HistoryList({ title, items, renderItem, emptyText, children }) {
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

function CardDetailPanel({ detailState, canManage, onClose, onLogout, onUndoUsage, onRevealCredentials }) {
  const { card, data, error, loading } = detailState;
  const detailCard = data?.card || card;
  const [undoUsage, setUndoUsage] = useState(null);
  const [undoReason, setUndoReason] = useState('');
  const [undoError, setUndoError] = useState('');
  const [submittingUndo, setSubmittingUndo] = useState(false);
  const [credentials, setCredentials] = useState(null);
  const [credentialError, setCredentialError] = useState('');
  const [credentialMessage, setCredentialMessage] = useState('');
  const [revealing, setRevealing] = useState(false);
  const dialogRef = useDialogFocus(onClose);

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

  function startUndoUsage(usage) {
    setUndoUsage(usage);
    setUndoReason('');
    setUndoError('');
  }

  async function submitUndoUsage(event) {
    event.preventDefault();
    setUndoError('');

    const reason = undoReason.trim();
    if (!reason) {
      setUndoError('Reason is required.');
      return;
    }

    setSubmittingUndo(true);
    try {
      await onUndoUsage(undoUsage.id, reason);
      setUndoUsage(null);
      setUndoReason('');
    } catch (caught) {
      setUndoError(caught.message);
    } finally {
      setSubmittingUndo(false);
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
      setCredentialError(caught.message);
      return null;
    } finally {
      setRevealing(false);
    }
  }

  async function copyValue(value, label) {
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

  async function copyCredential(fieldKey, label) {
    const currentCredentials = credentials || (await revealCredentials());
    const field = currentCredentials?.credentials?.fields?.find((item) => item.fieldKey === fieldKey);
    await copyValue(field?.value ?? currentCredentials?.[fieldKey], label);
  }

  async function copyPrimaryCredential() {
    const currentCredentials = credentials || (await revealCredentials());
    const field = currentCredentials?.credentials?.fields?.find((item) =>
      ['card_number', 'primary_code', 'barcode_value'].includes(item.fieldKind),
    ) || currentCredentials?.credentials?.fields?.[0];
    await copyValue(field?.value ?? currentCredentials?.cardNumber, field?.label || 'Credential');
  }

  const revealedCredentialFields = credentials?.credentials?.fields?.length
    ? credentials.credentials.fields
    : credentials
      ? [
          {
            fieldKey: 'cardNumber',
            label: 'Card number',
            fieldKind: 'card_number',
            value: credentials.cardNumber,
            copyable: true,
          },
          {
            fieldKey: 'pin',
            label: 'PIN',
            fieldKind: 'pin',
            value: credentials.pin,
            copyable: true,
          },
          {
            fieldKey: 'billingZip',
            label: 'Billing ZIP',
            fieldKind: 'billing_postal_code',
            value: credentials.billingZip,
            copyable: true,
          },
        ].filter((field) => field.value)
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
          <FieldError message={error} />
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
                      <BarcodePreview value={field.value} format={field.barcodeFormat} />
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

function DealDetailPanel({ detailState, onClose }) {
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
          <FieldError message={error} />
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
              <div className="table-wrap detail-table-wrap">
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

function EditCardPanel({ card, onClose, onEditCard }) {
  const terminal = isTerminalCard(card);
  const [form, setForm] = useState({
    brand: card.brand || '',
    expirationDate: card.expirationDate || '',
    notes: card.notes || '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus(onClose);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submitEdit(event) {
    event.preventDefault();
    setError('');

    const notes = form.notes.trim();
    const payload = {
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
      setError(caught.message);
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

function DeleteCardPanel({ card, onClose, onDeleteCard }) {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus(onClose);

  async function submitDelete(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await onDeleteCard(card.id);
      onClose();
    } catch (caught) {
      setError(caught.message);
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

function ReferenceCombobox({ label, value, onChange, options, required = false, placeholder = '' }) {
  const generatedId = useId();
  const inputId = `reference-combobox-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${generatedId}`;
  const listboxId = `${inputId}-listbox`;
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const matches = useMemo(() => filterReferenceOptions(options, value), [options, value]);

  function selectOption(option) {
    onChange(option.value);
    setOpen(false);
    setHighlightedIndex(0);
  }

  function handleKeyDown(event) {
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
      onBlur={(event) => {
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

function ReferenceReviewModal({ items, onClose, onConfirm, onUseSuggestion, submitting }) {
  const [checked, setChecked] = useState(() =>
    Object.fromEntries(items.map((item) => [item.key, true])),
  );
  const dialogRef = useDialogFocus(onClose);

  function toggleItem(key, value) {
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
  onLoadReferenceValues = async () => {},
  onUpsertReferenceValues = async () => {},
  referenceValueHintsEnabled = true,
  features = defaultFeatureFlags,
}) {
  const [form, setForm] = useState({
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
  const [reviewItems, setReviewItems] = useState([]);
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
        setReferenceError(caught.message);
      }
    });
    return () => {
      canceled = true;
    };
  }, [referenceValueHintsEnabled]);

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
      ...(field === 'cardBrand' && !current.profileTouched
        ? { credentialProfile: inferCredentialProfileForBrand(value) }
        : {}),
    }));
  }

  function updateCredentialProfile(value) {
    setForm((current) => ({
      ...current,
      credentialProfile: value,
      profileTouched: true,
    }));
  }

  function updateCustomField(id, patch) {
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

  function removeCustomField(id) {
    setForm((current) => ({
      ...current,
      customFields:
        current.customFields.length > 1
          ? current.customFields.filter((field) => field.id !== id)
          : current.customFields,
    }));
  }

  function credentialFields() {
    const fields = [];
    const push = (fieldKey, label, fieldKind, value, extra = {}) => {
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

  function dealPayload(totalCostCents, faceValueCents) {
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

  async function createDeal({ skipReview = false, approvedReferenceItems = [] } = {}) {
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
      setError(caught.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitDeal(event) {
    event.preventDefault();
    await createDeal();
  }

  function useSuggestion(item, suggestion) {
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
                  onChange={(event) => updateCustomField(field.id, { fieldKind: event.target.value })}
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
            <select value={form.credentialProfile} onChange={(event) => updateCredentialProfile(event.target.value)}>
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

function EditDealPanel({ deal, onClose, onEditDeal }) {
  const [form, setForm] = useState({
    name: deal.name || '',
    source: deal.source || '',
    purchaseDate: deal.purchaseDate || '',
    notes: deal.notes || '',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus(onClose);

  function updateField(field, value) {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  async function submitEdit(event) {
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
      setError(caught.message);
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

function ReserveCardPanel({ card, onClose, onReserveCard }) {
  const [reservedFor, setReservedFor] = useState('');
  const [reservedUntil, setReservedUntil] = useState('');
  const [reservedNotes, setReservedNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus(onClose);

  async function submitReserve(event) {
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
      setError(caught.message);
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
            <textarea rows="3" value={reservedNotes} onChange={(event) => setReservedNotes(event.target.value)} />
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

function VoidCardPanel({ card, onClose, onVoidCard }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus(onClose);

  async function submitVoid(event) {
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
      setError(caught.message);
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

function UndoSalePanel({ card, onClose, onUndoSale }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus(onClose);

  async function submitUndoSale(event) {
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
      setError(caught.message);
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

function SellCardPanel({ card, onClose, onSellCard }) {
  const [salePrice, setSalePrice] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [buyerType, setBuyerType] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus(onClose);

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

function UseCardPanel({ card, onClose, onUseCard }) {
  const [amount, setAmount] = useState('');
  const [merchant, setMerchant] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useDialogFocus(onClose);

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
}) {
  const [activeView, setActiveView] = useState('dashboard');
  const [showAddDeal, setShowAddDeal] = useState(false);
  const [editDeal, setEditDeal] = useState(null);
  const [usageCard, setUsageCard] = useState(null);
  const [editCard, setEditCard] = useState(null);
  const [deleteCard, setDeleteCard] = useState(null);
  const [reserveCard, setReserveCard] = useState(null);
  const [saleCard, setSaleCard] = useState(null);
  const [undoSaleCard, setUndoSaleCard] = useState(null);
  const [voidCard, setVoidCard] = useState(null);
  const [detailState, setDetailState] = useState(null);
  const [dealDetailState, setDealDetailState] = useState(null);
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

  async function activateView(view) {
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

  async function toggleArchivedDeals(event) {
    const nextValue = event.target.checked;
    setDealError('');
    setShowArchivedDeals(nextValue);
    try {
      await onLoadDeals(nextValue);
    } catch (caught) {
      setShowArchivedDeals(!nextValue);
      setDealError(caught.message);
    }
  }

  async function archiveDeal(deal) {
    setDealError('');
    try {
      await onArchiveDeal(deal, showArchivedDeals);
    } catch (caught) {
      setDealError(caught.message);
    }
  }

  async function unarchiveDeal(deal) {
    setDealError('');
    try {
      await onUnarchiveDeal(deal, showArchivedDeals);
    } catch (caught) {
      setDealError(caught.message);
    }
  }

  async function openCardDetail(card) {
    setDetailState({ card, data: null, error: '', loading: true });
    try {
      const response = await onLoadCardDetail(card.id);
      setDetailState({ card: response.data.card, data: response.data, error: '', loading: false });
    } catch (caught) {
      setDetailState({ card, data: null, error: caught.message, loading: false });
    }
  }

  async function openDealDetail(deal) {
    setDealDetailState({ deal, data: null, error: '', loading: true });
    try {
      const response = await onLoadDealDetail(deal.id);
      setDealDetailState({ deal: response.data.deal, data: response.data, error: '', loading: false });
    } catch (caught) {
      setDealDetailState({ deal, data: null, error: caught.message, loading: false });
    }
  }

  async function undoUsageFromDetail(usageId, reason) {
    const cardId = (detailState?.data?.card || detailState?.card)?.id;
    const response = await onUndoUsage(cardId, { usageId, reason });
    setDetailState({ card: response.data.card, data: response.data, error: '', loading: false });
    return response;
  }

  async function pageCards(offset) {
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
  const [auth, setAuth] = useState(null);
  const [cards, setCards] = useState([]);
  const [cardsPage, setCardsPage] = useState(defaultPage);
  const [cardCriteria, setCardCriteria] = useState({});
  const [deals, setDeals] = useState([]);
  const [auditEvents, setAuditEvents] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [backupSettings, setBackupSettings] = useState(defaultBackupSettings);
  const [backupSettingsLoading, setBackupSettingsLoading] = useState(false);
  const [backupSettingsLoaded, setBackupSettingsLoaded] = useState(false);
  const [backupSettingsError, setBackupSettingsError] = useState('');
  const [users, setUsers] = useState([]);
  const [userInvites, setUserInvites] = useState([]);
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
  const [referenceValues, setReferenceValues] = useState(defaultReferenceValues);
  const [loading, setLoading] = useState(true);
  const [inventoryLoading, setInventoryLoading] = useState(false);
  const [error, setError] = useState('');
  const features = authFeatures(auth);

  async function loadInventory() {
    setInventoryLoading(true);
    try {
      const [cardsResponse, dealsResponse] = await Promise.all([
        apiFetch('/api/cards'),
        apiFetch('/api/deals'),
      ]);
      setCards(cardsResponse.data || []);
      setCardsPage(cardsResponse.page || defaultPage);
      setCardCriteria({});
      setDeals(dealsResponse.data || []);
    } finally {
      setInventoryLoading(false);
    }
  }

  async function handleSearchCards(criteria = {}) {
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
      const response = await apiFetch(`/api/cards${query}`);
      setCards(response.data || []);
      setCardsPage(response.page || defaultPage);
      setCardCriteria(nextCriteria);
    } finally {
      setInventoryLoading(false);
    }
  }

  async function handleLoadCardDetail(cardId) {
    return apiFetch(`/api/cards/${cardId}`);
  }

  async function handleLoadDealDetail(dealId) {
    return apiFetch(`/api/deals/${dealId}`);
  }

  async function handleRevealCardCredentials(cardId) {
    return apiFetch(`/api/cards/${cardId}/reveal`, {
      method: 'POST',
      body: {},
      csrfToken: auth.csrfToken,
    });
  }

  async function handleLoadAudit(criteria = {}) {
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
      const response = await apiFetch(`/api/audit${query}`);
      setAuditEvents(response.data || []);
    } catch (caught) {
      setAuditError(caught.message);
    } finally {
      setAuditLoading(false);
    }
  }

  async function handleLoadBackupSettings() {
    setBackupSettingsLoading(true);
    setBackupSettingsError('');
    try {
      const response = await apiFetch('/api/settings/backup');
      setBackupSettings(response.data || defaultBackupSettings);
      setBackupSettingsLoaded(true);
      return response;
    } catch (caught) {
      setBackupSettingsError(caught.message);
      return null;
    } finally {
      setBackupSettingsLoading(false);
    }
  }

  async function handleUpdateBackupSettings(payload) {
    const response = await apiFetch('/api/settings/backup', {
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
        apiFetch('/api/users'),
        apiFetch('/api/users/invites'),
      ]);
      setUsers(Array.isArray(response.data) ? response.data : []);
      setUserInvites(Array.isArray(invitesResponse.data) ? invitesResponse.data : []);
      setUsersLoaded(true);
      return response;
    } catch (caught) {
      setUsersError(caught.message);
      return null;
    } finally {
      setUsersLoading(false);
    }
  }

  async function handleCreateInvite(payload) {
    const response = await apiFetch('/api/users/invites', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setUserInvites((current) => [response.data, ...current.filter((invite) => invite.id !== response.data.id)]);
    setUsersLoaded(true);
    return response.data;
  }

  async function handleRevokeInvite(inviteId) {
    const response = await apiFetch(`/api/users/invites/${inviteId}`, {
      method: 'DELETE',
      csrfToken: auth.csrfToken,
    });
    setUserInvites((current) => current.filter((invite) => invite.id !== response.data.id));
    return response.data;
  }

  async function handleUpdateUser(userId, payload) {
    const response = await apiFetch(`/api/users/${userId}`, {
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
      const response = await apiFetch('/api/admin/support-policy');
      setSupportPolicy(response.data || defaultSupportPolicy);
      setSupportPolicyLoaded(true);
      return response;
    } catch (caught) {
      setSupportPolicyError(caught.message);
      return null;
    } finally {
      setSupportPolicyLoading(false);
    }
  }

  async function handleUpdateSupportPolicy(payload) {
    const response = await apiFetch('/api/admin/support-policy', {
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
      const response = await apiFetch('/api/admin/data-policy');
      setDataPolicy(response.data || defaultDataPolicy);
      setDataPolicyLoaded(true);
      return response;
    } catch (caught) {
      setDataPolicyError(caught.message);
      return null;
    } finally {
      setDataPolicyLoading(false);
    }
  }

  async function handleUpdateDataPolicy(payload) {
    const response = await apiFetch('/api/admin/data-policy', {
      method: 'PUT',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setDataPolicy(response.data || defaultDataPolicy);
    setDataPolicyLoaded(true);
    return response;
  }

  async function handleExportAccountData(payload) {
    return apiFetch('/api/admin/data-export', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
  }

  async function handleRunRetention(payload) {
    return apiFetch('/api/admin/retention/run', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
  }

  async function handleDeleteAccountData(payload) {
    const response = await apiFetch('/api/admin/data-delete', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    await loadInventory();
    return response;
  }

  async function handleExportPlaintext(payload) {
    return apiFetch('/api/backup/export', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
  }

  async function handleExportEncrypted(payload) {
    return apiFetch('/api/backup/export-encrypted', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
  }

  async function handleExportRawDatabase(payload) {
    return apiDownload('/api/backup/db-file', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
  }

  async function handlePreviewCsv(payload) {
    return apiFetch('/api/cards/import-csv', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
  }

  async function handleConfirmCsv(payload) {
    const response = await apiFetch('/api/cards/import-csv/confirm', {
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

  async function handleImportBackup(payload) {
    const response = await apiFetch('/api/backup/import', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    await loadInventory();
    return response;
  }

  async function handleChangeUnlockSecret(payload) {
    return apiFetch('/api/auth/change-unlock-secret', {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
  }

  async function handleGenerateRecoveryCodes(payload) {
    const response = await apiFetch('/api/auth/recovery-codes', {
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

  async function loadDeals({ includeArchived = false } = {}) {
    const query = includeArchived ? '?includeArchived=true' : '';
    setInventoryLoading(true);
    try {
      const response = await apiFetch(`/api/deals${query}`);
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

  async function handleSetup(payload) {
    const response = await apiFetch('/api/auth/setup', {
      method: 'POST',
      body: payload,
    });
    setAuth(response.data);
    await loadInventory();
  }

  async function handleLogin({ email, unlockSecret }) {
    const response = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: {
        ...(email ? { email } : {}),
        unlockSecret,
      },
    });
    setAuth(response.data);
    await loadInventory();
  }

  async function handleAcceptInvite(payload) {
    const response = await apiFetch('/api/auth/accept-invite', {
      method: 'POST',
      body: payload,
    });
    setAuth(response.data);
    await loadInventory();
  }

  async function handleRecoverAccess(payload) {
    return apiFetch('/api/auth/recover', {
      method: 'POST',
      body: payload,
    });
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
    const response = await apiFetch('/api/reference-values?types=deal_name,source,card_brand&limit=200');
    const nextValues = normalizeReferenceValuePayload(response.data);
    setReferenceValues(nextValues);
    return nextValues;
  }

  async function handleUpsertReferenceValues(values) {
    if (!features.referenceValueHints || !values.length) {
      return [];
    }
    const response = await apiFetch('/api/reference-values', {
      method: 'POST',
      body: { values },
      csrfToken: auth.csrfToken,
    });
    setReferenceValues((current) => mergeReferenceValueState(current, response.data || []));
    return response.data || [];
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

  async function handleDealArchiveTransition(dealId, action, includeArchived) {
    const response = await apiFetch(`/api/deals/${dealId}/${action}`, {
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

  async function handleEditDeal(dealId, payload) {
    const response = await apiFetch(`/api/deals/${dealId}`, {
      method: 'PUT',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    const updatedDeal = response.data.deal;
    setDeals((current) => current.map((deal) => (deal.id === updatedDeal.id ? updatedDeal : deal)));
    return response;
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

  async function handleUndoUsage(cardId, payload) {
    const response = await apiFetch(`/api/cards/${cardId}/undo-usage`, {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setCards((current) =>
      current.map((card) => (card.id === response.data.card.id ? response.data.card : card)),
    );
    return response;
  }

  async function handleEditCard(cardId, payload) {
    const response = await apiFetch(`/api/cards/${cardId}`, {
      method: 'PUT',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setCards((current) =>
      current.map((card) => (card.id === response.data.id ? response.data : card)),
    );
    return response;
  }

  async function handleDeleteCard(cardId) {
    await apiFetch(`/api/cards/${cardId}`, {
      method: 'DELETE',
      csrfToken: auth.csrfToken,
    });
    setCards((current) => current.filter((card) => card.id !== cardId));
  }

  async function handleSellCard(cardId, payload) {
    const response = await apiFetch(`/api/cards/${cardId}/sell`, {
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

  async function handleUndoSale(cardId, payload) {
    const response = await apiFetch(`/api/cards/${cardId}/undo-sale`, {
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

  async function handleVoidCard(cardId, payload) {
    const response = await apiFetch(`/api/cards/${cardId}/void`, {
      method: 'POST',
      body: payload,
      csrfToken: auth.csrfToken,
    });
    setCards((current) =>
      current.map((card) => (card.id === response.data.card.id ? response.data.card : card)),
    );
  }

  async function handleCardTransition(cardId, action, payload = {}) {
    const response = await apiFetch(`/api/cards/${cardId}/${action}`, {
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
