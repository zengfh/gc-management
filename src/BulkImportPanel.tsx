import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { CaseUpper, FilePlus2, Upload, X } from 'lucide-react';
import type { FeatureFlags, ReferenceValue, ReferenceValueState } from '../shared/domain';
import type { AiImportAnalyzePayload, AiImportAnalyzeResult, AiImportModelOption, ApiPayload, AsyncApiHandler, VoidHandler } from './appTypes';
import { aiImportErrorMessage, formatElapsedTime } from './aiImportUi';
import {
  analyzeBulkImportText,
  bulkImportExpirationDate,
  bulkImportExpirationPatch,
  bulkImportMissingFields,
  bulkImportRowsToDealPayload,
  canUppercaseBulkImportPrimaryCode,
  refreshBulkImportWarnings,
  type BulkImportDraft,
  type BulkImportProfile,
} from './bulkImport';
import { credentialProfileOptions } from './credentialHelpers';
import { defaultFeatureFlags } from './defaults';
import { errorMessage } from './display';
import { readFileText } from './fileHelpers';
import { FieldError, HelpHint } from './formUi';
import {
  hasIndexedReferenceValue,
  referenceValueTypes,
} from './referenceValues';
import { useDialogFocus } from './useDialogFocus';

const sampleText = [
  'Doordash 50 abcd',
  'Bestbuy $50 abcd ef',
  'Doordash\t50\tabcd',
  'abcd ef',
  'Doordash abcd',
].join('\n');

function indexedBrandValues(referenceValues: ReferenceValueState): string[] {
  return (referenceValues?.[referenceValueTypes.cardBrand] || []).map((row) => row.value).filter(Boolean);
}

function indexedSourceValues(referenceValues: ReferenceValueState): string[] {
  return (referenceValues?.[referenceValueTypes.source] || []).map((row) => row.value).filter(Boolean);
}

function BulkImportReviewModal({
  rows,
  referenceValues,
  analysisSource,
  submitting,
  error,
  onRowsChange,
  onClose,
  onConfirm,
}: {
  rows: BulkImportDraft[];
  referenceValues: ReferenceValueState;
  analysisSource: string;
  submitting: boolean;
  error: string;
  onRowsChange: (rows: BulkImportDraft[]) => void;
  onClose: VoidHandler;
  onConfirm: VoidHandler;
}) {
  const dialogRef = useDialogFocus(onClose);
  const brandOptions = indexedBrandValues(referenceValues);
  const sourceOptions = indexedSourceValues(referenceValues);
  const invalidRows = rows.filter((row) => bulkImportMissingFields(row).length > 0);
  const newBrands = rows
    .map((row) => row.brand.trim())
    .filter((brand, index, all) =>
      brand
        && all.findIndex((candidate) => candidate.toLowerCase() === brand.toLowerCase()) === index
        && !hasIndexedReferenceValue(referenceValues?.[referenceValueTypes.cardBrand] || [], brand),
    );

  function updateRow(rowId: string, patch: Partial<BulkImportDraft>) {
    onRowsChange(rows.map((row) => (
      row.id === rowId ? refreshBulkImportWarnings({ ...row, ...patch }) : row
    )));
  }

  function removeRow(rowId: string) {
    onRowsChange(rows.filter((row) => row.id !== rowId));
  }

  function uppercaseRowCode(row: BulkImportDraft) {
    updateRow(row.id, { primaryCode: row.primaryCode.toUpperCase() });
  }

  const isAiAnalysis = analysisSource.startsWith('AI:');

  return (
    <div className="modal-backdrop review-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="review-modal bulk-review-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-review-title"
      >
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Bulk import</p>
            <h2 id="bulk-review-title">Review parsed cards</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close bulk import review" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="bulk-review-summary">
          <span>{rows.length} parsed</span>
          <span>{invalidRows.length} need edits</span>
          <span>{newBrands.length} new brands</span>
          {analysisSource ? <span>{analysisSource}</span> : null}
        </div>
        {isAiAnalysis ? (
          <details className="bulk-ai-diagnostics">
            <summary>AI diagnostics</summary>
            <dl>
              <div>
                <dt>Parser</dt>
                <dd>{analysisSource}</dd>
              </div>
              <div>
                <dt>Parsed</dt>
                <dd>{rows.length}</dd>
              </div>
              <div>
                <dt>Needs edits</dt>
                <dd>{invalidRows.length}</dd>
              </div>
              <div>
                <dt>New brands</dt>
                <dd>{newBrands.length}</dd>
              </div>
            </dl>
          </details>
        ) : null}
        <div className="table-wrap bulk-review-wrap" tabIndex={0}>
          <table className="bulk-review-table">
            <colgroup>
              <col className="bulk-col-action" />
              <col className="bulk-col-line" />
              <col className="bulk-col-status" />
              <col className="bulk-col-brand" />
              <col className="bulk-col-value" />
              <col className="bulk-col-type" />
              <col className="bulk-col-exp" />
              <col className="bulk-col-code" />
              <col className="bulk-col-pin" />
              <col className="bulk-col-security" />
              <col className="bulk-col-source" />
              <col className="bulk-col-notes" />
            </colgroup>
            <thead>
              <tr>
                <th aria-label="Discard row" />
                <th>Line</th>
                <th>Status</th>
                <th>Brand</th>
                <th>Value</th>
                <th>Credential type</th>
                <th>EXP date</th>
                <th>Code / number</th>
                <th>PIN</th>
                <th>Security code</th>
                <th>Source</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const missing = bulkImportMissingFields(row);
                return (
                  <Fragment key={row.id}>
                    <tr>
                      <td data-label="Action">
                        <button
                          type="button"
                          className="icon-button compact"
                          aria-label={`Discard line ${row.lineNumber}`}
                          onClick={() => removeRow(row.id)}
                        >
                          <X aria-hidden="true" size={15} />
                        </button>
                      </td>
                      <td data-label="Line">{row.lineNumber}</td>
                      <td data-label="Status">
                        {missing.length > 0 ? (
                          <span className="status-badge status-reserved">Needs edit</span>
                        ) : (
                          <span className="status-badge status-available">Ready</span>
                        )}
                      </td>
                      <td data-label="Brand">
                        <input
                          list="bulk-brand-options"
                          value={row.brand}
                          aria-label={`Line ${row.lineNumber} brand`}
                          onChange={(event) => updateRow(row.id, { brand: event.target.value })}
                        />
                      </td>
                      <td data-label="Value">
                        <input
                          inputMode="decimal"
                          value={row.faceValue}
                          aria-label={`Line ${row.lineNumber} face value`}
                          onChange={(event) => updateRow(row.id, { faceValue: event.target.value })}
                        />
                      </td>
                      <td data-label="Credential type">
                        <select
                          value={row.credentialProfile}
                          aria-label={`Line ${row.lineNumber} credential type`}
                          onChange={(event) => updateRow(row.id, { credentialProfile: event.target.value as BulkImportProfile })}
                        >
                          {credentialProfileOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td data-label="EXP date">
                        <input
                          className="mono"
                          autoComplete="off"
                          placeholder="MM/YYYY"
                          value={bulkImportExpirationDate(row)}
                          aria-label={`Line ${row.lineNumber} EXP date`}
                          onChange={(event) => updateRow(row.id, bulkImportExpirationPatch(event.target.value))}
                        />
                      </td>
                      <td data-label="Code / number">
                        <div className="bulk-code-editor">
                          <input
                            className="mono"
                            autoComplete="off"
                            value={row.primaryCode}
                            aria-label={`Line ${row.lineNumber} code or card number`}
                            onChange={(event) => updateRow(row.id, { primaryCode: event.target.value })}
                          />
                          {canUppercaseBulkImportPrimaryCode(row) ? (
                            <button
                              type="button"
                              className="table-action bulk-code-action"
                              aria-label={`Uppercase line ${row.lineNumber} code`}
                              title="Convert this code to uppercase. Claim-link URLs are never changed."
                              onClick={() => uppercaseRowCode(row)}
                            >
                              <CaseUpper aria-hidden="true" size={14} />
                              Uppercase
                            </button>
                          ) : null}
                        </div>
                      </td>
                      <td data-label="PIN">
                        <input
                          className="mono"
                          autoComplete="off"
                          value={row.secondaryCode}
                          aria-label={`Line ${row.lineNumber} PIN`}
                          onChange={(event) => updateRow(row.id, { secondaryCode: event.target.value })}
                        />
                      </td>
                      <td data-label="Security code">
                        <input
                          className="mono"
                          autoComplete="off"
                          value={row.networkSecurityCode || ''}
                          aria-label={`Line ${row.lineNumber} security code`}
                          onChange={(event) => updateRow(row.id, { networkSecurityCode: event.target.value })}
                        />
                      </td>
                      <td data-label="Source">
                        <input
                          list="bulk-source-options"
                          value={row.source}
                          aria-label={`Line ${row.lineNumber} source`}
                          onChange={(event) => updateRow(row.id, { source: event.target.value })}
                        />
                      </td>
                      <td data-label="Notes">
                        <input
                          value={row.notes}
                          aria-label={`Line ${row.lineNumber} notes`}
                          onChange={(event) => updateRow(row.id, { notes: event.target.value })}
                        />
                      </td>
                    </tr>
                    {(missing.length > 0 || row.warnings.length > 0) ? (
                      <tr className="bulk-row-diagnostics">
                        <td />
                        <td colSpan={11} data-label="Warnings">
                          {missing.length > 0 ? (
                            <span>Needs {missing.join(', ')}</span>
                          ) : null}
                          {row.warnings.length > 0 ? (
                            <small className="bulk-warning">{row.warnings.join(' ')}</small>
                          ) : null}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          <datalist id="bulk-brand-options">
            {brandOptions.map((brand) => (
              <option key={brand} value={brand} />
            ))}
          </datalist>
          <datalist id="bulk-source-options">
            {sourceOptions.map((source) => (
              <option key={source} value={source} />
            ))}
          </datalist>
        </div>
        {newBrands.length > 0 ? (
          <p className="muted-text">
            New brands will be added to the hint index on import: {newBrands.join(', ')}.
          </p>
        ) : null}
        <FieldError message={error} />
        <div className="panel-actions">
          <button type="button" className="secondary-action" onClick={onClose}>
            Back
          </button>
          <button
            type="button"
            className="primary-action"
            disabled={submitting || invalidRows.length > 0 || rows.length === 0}
            onClick={onConfirm}
          >
            <FilePlus2 aria-hidden="true" size={17} />
            {submitting ? 'Importing...' : `Import ${rows.length} cards`}
          </button>
        </div>
      </section>
    </div>
  );
}

export function BulkImportPanel({
  onClose,
  onCreateDeal,
  onAnalyzeAiImport,
  onLoadAiImportModels,
  referenceValues,
  onLoadReferenceValues = async () => referenceValues,
  onUpsertReferenceValues,
  features = defaultFeatureFlags,
}: {
  onClose: VoidHandler;
  onCreateDeal: AsyncApiHandler<ApiPayload, unknown>;
  onAnalyzeAiImport: AsyncApiHandler<AiImportAnalyzePayload, { data: AiImportAnalyzeResult }>;
  onLoadAiImportModels: () => Promise<{ data: { defaultSelection: string; options: AiImportModelOption[] } }>;
  referenceValues: ReferenceValueState;
  onLoadReferenceValues?: () => Promise<ReferenceValueState>;
  onUpsertReferenceValues: (values?: ReferenceValue[]) => Promise<ReferenceValue[]>;
  features?: FeatureFlags;
}) {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<BulkImportDraft[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [aiStatus, setAiStatus] = useState('');
  const [analysisSource, setAnalysisSource] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [modelSelection, setModelSelection] = useState('auto');
  const [modelOptions, setModelOptions] = useState<AiImportModelOption[]>([
    { id: 'auto', label: 'Auto', provider: 'Auto', model: 'Auto', auto: true },
  ]);
  const [modelError, setModelError] = useState('');
  const dialogRef = useDialogFocus(onClose);
  const loadReferenceValuesRef = useRef(onLoadReferenceValues);
  const canImport = features.csvImport;
  const parsedSummary = useMemo(() => {
    const ready = rows.filter((row) => bulkImportMissingFields(row).length === 0).length;
    return `${ready}/${rows.length} ready`;
  }, [rows]);

  useEffect(() => {
    loadReferenceValuesRef.current = onLoadReferenceValues;
  }, [onLoadReferenceValues]);

  useEffect(() => {
    let canceled = false;
    loadReferenceValuesRef.current().catch((caught) => {
      if (!canceled) {
        setError(errorMessage(caught));
      }
    });
    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let canceled = false;
    onLoadAiImportModels()
      .then((response) => {
        if (canceled) {
          return;
        }
        setModelOptions(response.data.options.length > 0
          ? response.data.options
          : [{ id: 'auto', label: 'Auto', provider: 'Auto', model: 'Auto', auto: true }]);
        setModelSelection(response.data.defaultSelection || 'auto');
        setModelError('');
      })
      .catch((caught) => {
        if (!canceled) {
          setModelError(errorMessage(caught));
        }
      });
    return () => {
      canceled = true;
    };
  }, [onLoadAiImportModels]);

  async function updateFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setError('');
    setSuccess('');
    setAiStatus('');
    setRows([]);
    setReviewOpen(false);
    setAnalysisSource('');
    if (!file) {
      setFileName('');
      return;
    }
    setFileName(file.name);
    try {
      setText(await readFileText(file));
    } catch (caught) {
      setError(errorMessage(caught));
    }
  }

  function analyze() {
    setError('');
    setSuccess('');
    setAiStatus('');
    const analysis = analyzeBulkImportText(text, referenceValues);
    if (analysis.rows.length === 0) {
      setRows([]);
      setError('Paste at least one gift-card line or choose a CSV/TSV file.');
      return;
    }
    setRows(analysis.rows);
    setAnalysisSource('Fast parser: no AI');
    setReviewOpen(true);
  }

  async function analyzeWithAi() {
    setError('');
    setSuccess('');
    setAiStatus('');
    if (!text.trim()) {
      setRows([]);
      setError('Paste gift-card text before running AI analysis.');
      return;
    }
    setAiAnalyzing(true);
    const startedAt = Date.now();
    setAiStatus('Contacting AI service. This is a live provider request; the review will show the provider and model that parsed the cards.');
    try {
      const response = await onAnalyzeAiImport({ text, modelSelection });
      const analysis = response.data;
      const source = `${analysis.provider || 'AI'}${analysis.model ? `/${analysis.model}` : ''}`;
      const elapsed = formatElapsedTime(Date.now() - startedAt);
      if (analysis.rows.length === 0) {
        setRows([]);
        setError('AI did not find any gift cards to review.');
        return;
      }
      setRows(analysis.rows);
      setAnalysisSource(`AI: ${source} · ${elapsed}`);
      setSuccess(`AI parsed ${analysis.rows.length} cards with ${source} in ${elapsed}. Review before import.`);
      setReviewOpen(true);
    } catch (caught) {
      setError(aiImportErrorMessage(caught, Date.now() - startedAt));
    } finally {
      setAiStatus('');
      setAiAnalyzing(false);
    }
  }

  async function confirmImport() {
    setError('');
    setSuccess('');
    const invalidRows = rows.filter((row) => bulkImportMissingFields(row).length > 0);
    if (invalidRows.length > 0) {
      setError('Complete all required fields before importing.');
      return;
    }
    setSubmitting(true);
    try {
      const newBrands = rows
        .map((row) => row.brand.trim())
        .filter((brand, index, all) =>
          brand
            && all.findIndex((candidate) => candidate.toLowerCase() === brand.toLowerCase()) === index
            && !hasIndexedReferenceValue(referenceValues?.[referenceValueTypes.cardBrand] || [], brand),
        )
        .map((brand) => ({ type: referenceValueTypes.cardBrand, value: brand }));
      if (newBrands.length > 0) {
        await onUpsertReferenceValues(newBrands);
      }
      await onCreateDeal(bulkImportRowsToDealPayload(rows));
      setReviewOpen(false);
      setSuccess(`Imported ${rows.length} ${rows.length === 1 ? 'card' : 'cards'}.`);
      setAiStatus('');
      setRows([]);
      setAnalysisSource('');
      setText('');
      setFileName('');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section ref={dialogRef} className="slide-panel bulk-import-panel" role="dialog" aria-modal="true" aria-labelledby="bulk-import-title">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">Bulk import</p>
            <h2 id="bulk-import-title">Paste or upload cards</h2>
          </div>
          <button type="button" className="icon-button" aria-label="Close bulk import" onClick={onClose}>
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <div className="panel-form">
          {!canImport ? (
            <FieldError message="CSV import is disabled by deployment policy." />
          ) : null}
          <label>
            <span className="label-with-help">
              AI model
              <HelpHint text="Auto lets the server choose the best configured model. Select a specific model to force this import to use it." />
            </span>
            <select value={modelSelection} onChange={(event) => setModelSelection(event.target.value)}>
              {modelOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label-with-help">
              Gift-card lines
              <HelpHint text="One card per line for rule-based analysis, or paste messy text and use AI analysis. AI analysis sends the pasted card text to the configured AI provider and still requires review before import." />
            </span>
            <textarea
              className="bulk-import-textarea mono"
              value={text}
              placeholder={sampleText}
              onChange={(event) => {
                setText(event.target.value);
                setSuccess('');
              }}
              rows={10}
            />
          </label>
          <label>
            <span className="label-with-help">
              CSV or TSV file
              <HelpHint text="A file can have headers like brand,value,code,pin,profile,source,notes or simple rows like DoorDash,50,abcd." />
            </span>
            <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain" onChange={updateFile} />
          </label>
          {fileName ? <p className="muted-text import-file-name">{fileName}</p> : null}
          {rows.length > 0 ? <p className="muted-text">{parsedSummary}</p> : null}
          <FieldError message={error} />
          {modelError ? <FieldError message={`AI model list unavailable: ${modelError}`} /> : null}
          {aiStatus ? (
            <p className="info-copy" role="status" aria-live="polite">
              {aiStatus}
            </p>
          ) : null}
          {success ? <p className="success-copy">{success}</p> : null}
          <div className="panel-actions">
            <button type="button" className="secondary-action" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="primary-action" onClick={analyzeWithAi} disabled={!canImport || !text.trim() || aiAnalyzing}>
              <FilePlus2 aria-hidden="true" size={17} />
              {aiAnalyzing ? 'Asking AI...' : 'Analyze with AI'}
            </button>
            <button type="button" className="secondary-action" onClick={analyze} disabled={!canImport || !text.trim()}>
              <Upload aria-hidden="true" size={17} />
              Fast parse (rules)
            </button>
          </div>
        </div>
      </section>
      {reviewOpen ? (
        <BulkImportReviewModal
          rows={rows}
          referenceValues={referenceValues}
          analysisSource={analysisSource}
          submitting={submitting}
          error={error}
          onRowsChange={setRows}
          onClose={() => setReviewOpen(false)}
          onConfirm={confirmImport}
        />
      ) : null}
    </div>
  );
}
