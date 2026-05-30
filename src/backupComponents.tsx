import { useState, type ChangeEvent, type FormEvent } from 'react';
import { AlertTriangle, DatabaseBackup, Download, FilePlus2, Lock } from 'lucide-react';
import type { ApiResponse, BackupSettings } from '../shared/domain';
import type {
  ApiPayload,
  AsyncApiHandler,
  CsvImportResult,
  CsvPreviewPayload,
  CsvPreviewRow,
  ImportSummary,
  PortableExportPayload,
} from './appTypes';
import { defaultBackupSettings } from './defaults';
import { errorMessage, formatDateTime, formatMoney, isRecord } from './display';
import { downloadBlobFile, downloadCsvFile, downloadJsonFile, readFileText } from './fileHelpers';
import { FieldError, HelpHint } from './formUi';

type CsvImportTemplate = {
  id: string;
  label: string;
  filename: string;
  csv: string;
};

const csvImportTemplates: [CsvImportTemplate, ...CsvImportTemplate[]] = [
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

const defaultCsvImportTemplate = csvImportTemplates[0];

export function BackupExportForm({ onExportPlaintext }: { onExportPlaintext: AsyncApiHandler<ApiPayload, ApiResponse<PortableExportPayload>> }) {
  const [unlockSecret, setUnlockSecret] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [acknowledgePlaintext, setAcknowledgePlaintext] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitExport(event: FormEvent<HTMLFormElement>) {
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
      setError(errorMessage(caught));
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

export function EncryptedBackupExportForm({ onExportEncrypted }: { onExportEncrypted: AsyncApiHandler<ApiPayload, ApiResponse<PortableExportPayload>> }) {
  const [unlockSecret, setUnlockSecret] = useState('');
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [backupPassphraseConfirmation, setBackupPassphraseConfirmation] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitExport(event: FormEvent<HTMLFormElement>) {
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
      setError(errorMessage(caught));
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

export function RawDatabaseExportForm({
  onExportRawDatabase,
}: {
  onExportRawDatabase: AsyncApiHandler<ApiPayload, { blob: Blob; filename: string | null }>;
}) {
  const [unlockSecret, setUnlockSecret] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitExport(event: FormEvent<HTMLFormElement>) {
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
      setError(errorMessage(caught));
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

function CsvPreviewTable({ rows }: { rows: CsvPreviewRow[] }) {
  if (!rows?.length) {
    return null;
  }

  return (
    <div className="table-wrap import-preview-wrap" tabIndex={0}>
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
            <th>PIN</th>
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

export function CsvImportPreviewForm({
  onPreviewCsv,
  onConfirmCsv,
}: {
  onPreviewCsv: AsyncApiHandler<{ csv: string }, ApiResponse<CsvPreviewPayload>>;
  onConfirmCsv: AsyncApiHandler<{ csv: string }, ApiResponse<CsvImportResult>>;
}) {
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState(defaultCsvImportTemplate.id);
  const [preview, setPreview] = useState<CsvPreviewPayload | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function updateFile(event: ChangeEvent<HTMLInputElement>) {
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
      setError(errorMessage(caught));
    }
  }

  async function submitPreview(event: FormEvent<HTMLFormElement>) {
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
      setError(errorMessage(caught));
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
      setError(errorMessage(caught));
    } finally {
      setConfirming(false);
    }
  }

  function downloadSelectedTemplate() {
    const template =
      csvImportTemplates.find((candidate) => candidate.id === selectedTemplateId) || defaultCsvImportTemplate;
    downloadCsvFile(template.filename, template.csv);
  }

  return (
    <form className="backup-export-form csv-preview-form" onSubmit={submitPreview}>
      <div className="import-template-row">
        <label>
          <span className="label-with-help">
            CSV template
            <HelpHint text="Download a template that matches the credential format you want to import." />
          </span>
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
        <span className="label-with-help">
          CSV file
          <HelpHint text="Use a GC Manager template CSV for strict preview and confirm import. For loose pasted lines, use Bulk Import." />
        </span>
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

export function PlaintextJsonImportForm({ onImportBackup }: { onImportBackup: AsyncApiHandler<ApiPayload, ApiResponse<{ summary: ImportSummary }>> }) {
  const [payload, setPayload] = useState<unknown | null>(null);
  const [fileName, setFileName] = useState('');
  const [unlockSecret, setUnlockSecret] = useState('');
  const [mode, setMode] = useState('merge');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function updateFile(event: ChangeEvent<HTMLInputElement>) {
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

  async function submitImport(event: FormEvent<HTMLFormElement>) {
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
      setError(errorMessage(caught));
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

export function EncryptedJsonImportForm({ onImportBackup }: { onImportBackup: AsyncApiHandler<ApiPayload, ApiResponse<{ summary: ImportSummary }>> }) {
  const [payload, setPayload] = useState<unknown | null>(null);
  const [fileName, setFileName] = useState('');
  const [unlockSecret, setUnlockSecret] = useState('');
  const [backupPassphrase, setBackupPassphrase] = useState('');
  const [mode, setMode] = useState('merge');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function updateFile(event: ChangeEvent<HTMLInputElement>) {
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
      if (!isRecord(parsedPayload) || parsedPayload.exportType !== 'encrypted_portable_json') {
        throw new Error('Invalid encrypted backup.');
      }
      setPayload(parsedPayload);
    } catch {
      setPayload(null);
      setError('Choose a valid encrypted JSON backup file.');
    }
  }

  async function submitImport(event: FormEvent<HTMLFormElement>) {
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
      setError(errorMessage(caught));
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

export function BackupSettingsForm({
  settings,
  onUpdateBackupSettings,
}: {
  settings: BackupSettings;
  onUpdateBackupSettings: AsyncApiHandler<ApiPayload, ApiResponse<BackupSettings>>;
}) {
  const effectiveSettings = settings || defaultBackupSettings;
  const [allowPlaintextExport, setAllowPlaintextExport] = useState(effectiveSettings.allowPlaintextExport);
  const [backupReminderDays, setBackupReminderDays] = useState(String(effectiveSettings.backupReminderDays));
  const [unlockSecret, setUnlockSecret] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submitSettings(event: FormEvent<HTMLFormElement>) {
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
      setError(errorMessage(caught));
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
