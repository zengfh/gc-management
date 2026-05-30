import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  Bot,
  CheckCircle2,
  FilePlus2,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  Trash2,
  WandSparkles,
  X,
} from 'lucide-react';
import type { FeatureFlags, ReferenceValue, ReferenceValueState } from '../shared/domain';
import type { AiImportAnalyzePayload, AiImportAnalyzeResult, ApiPayload, AsyncApiHandler } from './appTypes';
import { aiImportErrorMessage, formatElapsedTime } from './aiImportUi';
import {
  bulkImportMissingFields,
  bulkImportRowsToDealPayload,
  refreshBulkImportWarnings,
  type BulkImportDraft,
  type BulkImportProfile,
} from './bulkImport';
import { credentialProfileOptions } from './credentialHelpers';
import { defaultFeatureFlags } from './defaults';
import { errorMessage } from './display';
import { FieldError, HelpHint } from './formUi';
import { hasIndexedReferenceValue, referenceValueTypes } from './referenceValues';

const aiImportSample = [
  'Lowes\t250\t\t6006491727039277301\t7640\t05/02/2026',
  'Uber\t50\t\tNAAD XYHD QR65 U8LY',
  '\t\t\tNAAD X373 WSR8 UBNH',
  'DoorDash $100 NAAWG5G8YUEDZ2ES',
  'Instacart $100 NAAFSYC5FE2VFGF4',
].join('\n');

type AgentEventKind = 'user' | 'agent' | 'system';
type AgentEventStatus = 'idle' | 'running' | 'success' | 'warning' | 'error';

interface AgentEvent {
  id: string;
  kind: AgentEventKind;
  status: AgentEventStatus;
  title: string;
  detail: string;
  time: string;
}

interface AiAnalysisMeta {
  provider: string;
  model: string;
  source: string;
  elapsed: string;
  diagnostics?: AiImportAnalyzeResult['diagnostics'];
  iteration: number;
}

function eventTime(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function textLineCount(value: string): number {
  return value.split(/\r?\n/).filter((line) => line.trim()).length;
}

function indexedBrandValues(referenceValues: ReferenceValueState): string[] {
  return (referenceValues?.[referenceValueTypes.cardBrand] || []).map((row) => row.value).filter(Boolean);
}

function indexedSourceValues(referenceValues: ReferenceValueState): string[] {
  return (referenceValues?.[referenceValueTypes.source] || []).map((row) => row.value).filter(Boolean);
}

function newBrandValues(rows: BulkImportDraft[], referenceValues: ReferenceValueState): string[] {
  return rows
    .map((row) => row.brand.trim())
    .filter((brand, index, all) =>
      brand
        && all.findIndex((candidate) => candidate.toLowerCase() === brand.toLowerCase()) === index
        && !hasIndexedReferenceValue(referenceValues?.[referenceValueTypes.cardBrand] || [], brand),
    );
}

function eventIcon(event: AgentEvent) {
  if (event.status === 'running') {
    return <LoaderCircle aria-hidden="true" size={16} className="spin-icon" />;
  }
  if (event.status === 'success') {
    return <CheckCircle2 aria-hidden="true" size={16} />;
  }
  if (event.kind === 'user') {
    return <WandSparkles aria-hidden="true" size={16} />;
  }
  return <Bot aria-hidden="true" size={16} />;
}

export function AIImportWorkspace({
  onCreateDeal,
  onAnalyzeAiImport,
  referenceValues,
  onLoadReferenceValues,
  onUpsertReferenceValues,
  features = defaultFeatureFlags,
  onImportComplete,
}: {
  onCreateDeal: AsyncApiHandler<ApiPayload, unknown>;
  onAnalyzeAiImport: AsyncApiHandler<AiImportAnalyzePayload, { data: AiImportAnalyzeResult }>;
  referenceValues: ReferenceValueState;
  onLoadReferenceValues: () => Promise<ReferenceValueState>;
  onUpsertReferenceValues: (values?: ReferenceValue[]) => Promise<ReferenceValue[]>;
  features?: FeatureFlags;
  onImportComplete?: () => void;
}) {
  const [sourceText, setSourceText] = useState('');
  const [instruction, setInstruction] = useState('');
  const [rows, setRows] = useState<BulkImportDraft[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([
    {
      id: 'initial',
      kind: 'system',
      status: 'idle',
      title: 'AI import agent ready',
      detail: 'Paste raw gift-card text, then review the normalized draft before anything is saved.',
      time: eventTime(),
    },
  ]);
  const [analysisMeta, setAnalysisMeta] = useState<AiAnalysisMeta | null>(null);
  const [analysisCount, setAnalysisCount] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const canImport = features.csvImport;
  const brandOptions = indexedBrandValues(referenceValues);
  const sourceOptions = indexedSourceValues(referenceValues);
  const invalidRows = useMemo(() => rows.filter((row) => bulkImportMissingFields(row).length > 0), [rows]);
  const readyRows = rows.length - invalidRows.length;
  const newBrands = useMemo(() => newBrandValues(rows, referenceValues), [referenceValues, rows]);

  useEffect(() => {
    let canceled = false;
    onLoadReferenceValues().catch((caught) => {
      if (!canceled) {
        setError(errorMessage(caught));
      }
    });
    return () => {
      canceled = true;
    };
  }, [onLoadReferenceValues]);

  function appendEvent(event: Omit<AgentEvent, 'id' | 'time'>): string {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setEvents((current) => [
      ...current,
      {
        ...event,
        id,
        time: eventTime(),
      },
    ].slice(-10));
    return id;
  }

  function updateEvent(eventId: string, patch: Partial<AgentEvent>) {
    setEvents((current) => current.map((event) => (
      event.id === eventId ? { ...event, ...patch, time: eventTime() } : event
    )));
  }

  function updateRow(rowId: string, patch: Partial<BulkImportDraft>) {
    setRows((current) => current.map((row) => (
      row.id === rowId ? refreshBulkImportWarnings({ ...row, ...patch }) : row
    )));
  }

  function removeRow(rowId: string) {
    setRows((current) => current.filter((row) => row.id !== rowId));
    setSuccess('');
  }

  function discardAnalysis() {
    setRows([]);
    setAnalysisMeta(null);
    setInstruction('');
    setError('');
    setSuccess('');
    appendEvent({
      kind: 'system',
      status: 'warning',
      title: 'Draft discarded',
      detail: 'No gift-card records were saved.',
    });
  }

  async function runAiAnalysis(withInstruction = false) {
    setError('');
    setSuccess('');
    if (!sourceText.trim()) {
      setError('Paste gift-card text before running AI analysis.');
      return;
    }
    if (!canImport) {
      setError('AI import is disabled by deployment policy.');
      return;
    }

    const currentInstruction = withInstruction ? instruction.trim() : '';
    const lineCount = textLineCount(sourceText);
    const startedAt = Date.now();
    const nextIteration = analysisCount + 1;
    setAnalyzing(true);
    setStatusText(currentInstruction ? 'Sending correction and current draft to the AI provider.' : 'Sending raw gift-card text to the AI provider.');
    appendEvent({
      kind: currentInstruction ? 'user' : 'system',
      status: 'idle',
      title: currentInstruction ? 'Correction submitted' : 'Raw text submitted',
      detail: currentInstruction || `${lineCount} non-empty lines, ${sourceText.length} characters.`,
    });
    const runningEventId = appendEvent({
      kind: 'agent',
      status: 'running',
      title: 'Asking configured AI provider',
      detail: 'Waiting for the server to choose a configured model and return structured card candidates.',
    });

    try {
      const payload: AiImportAnalyzePayload = {
        text: sourceText,
        ...(currentInstruction ? { instruction: currentInstruction } : {}),
        ...(rows.length > 0 ? { previousRows: rows } : {}),
      };
      const response = await onAnalyzeAiImport(payload);
      const analysis = response.data;
      const elapsed = formatElapsedTime(Date.now() - startedAt);
      const source = `${analysis.provider || 'AI'}${analysis.model ? `/${analysis.model}` : ''}`;
      if (analysis.rows.length === 0) {
        setRows([]);
        setAnalysisMeta({
          provider: analysis.provider || 'AI',
          model: analysis.model || 'unknown',
          source,
          elapsed,
          diagnostics: analysis.diagnostics,
          iteration: nextIteration,
        });
        updateEvent(runningEventId, {
          status: 'warning',
          title: 'AI returned no importable cards',
          detail: 'The provider response did not produce any review rows.',
        });
        setError('AI did not find any gift cards to review.');
        return;
      }
      const analysisInvalidRows = analysis.rows.filter((row) => bulkImportMissingFields(row).length > 0);
      setRows(analysis.rows);
      setAnalysisMeta({
        provider: analysis.provider || 'AI',
        model: analysis.model || 'unknown',
        source,
        elapsed,
        diagnostics: analysis.diagnostics,
        iteration: nextIteration,
      });
      setAnalysisCount(nextIteration);
      setInstruction('');
      updateEvent(runningEventId, {
        status: 'success',
        title: 'AI response normalized',
        detail: `${analysis.rows.length} review rows from ${source} in ${elapsed}.`,
      });
      appendEvent({
        kind: 'system',
        status: analysisInvalidRows.length > 0 ? 'warning' : 'success',
        title: 'System validation ready',
        detail: `${analysis.rows.length} parsed rows are editable below; ${analysis.rows.length - analysisInvalidRows.length} are ready.`,
      });
      setSuccess(`AI parsed ${analysis.rows.length} cards with ${source} in ${elapsed}. Review and edit before import.`);
    } catch (caught) {
      const message = aiImportErrorMessage(caught, Date.now() - startedAt);
      updateEvent(runningEventId, {
        status: 'error',
        title: 'AI analysis failed',
        detail: message,
      });
      setError(message);
    } finally {
      setStatusText('');
      setAnalyzing(false);
    }
  }

  async function confirmImport() {
    setError('');
    setSuccess('');
    const blockedRows = rows.filter((row) => bulkImportMissingFields(row).length > 0);
    if (blockedRows.length > 0) {
      setError('Complete all required fields before importing.');
      return;
    }
    setSubmitting(true);
    try {
      const newBrandRows = newBrands.map((brand) => ({ type: referenceValueTypes.cardBrand, value: brand }));
      if (newBrandRows.length > 0) {
        await onUpsertReferenceValues(newBrandRows);
      }
      await onCreateDeal(bulkImportRowsToDealPayload(rows));
      const importedCount = rows.length;
      setRows([]);
      setSourceText('');
      setInstruction('');
      setAnalysisMeta(null);
      setAnalysisCount(0);
      setSuccess(`Imported ${importedCount} ${importedCount === 1 ? 'card' : 'cards'}.`);
      appendEvent({
        kind: 'system',
        status: 'success',
        title: 'Import saved',
        detail: `${importedCount} ${importedCount === 1 ? 'card was' : 'cards were'} inserted into the database.`,
      });
      onImportComplete?.();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="ai-import-workspace">
      <div className="ai-import-console">
        <div className="ai-agent-header">
          <div className="ai-agent-avatar">
            <Bot aria-hidden="true" size={22} />
          </div>
          <div>
            <p className="eyebrow">AI import</p>
            <h2>Agent workspace</h2>
          </div>
          <span className={analyzing ? 'status-badge status-in_use' : 'status-badge status-available'}>
            {analyzing ? 'Analyzing' : 'Ready'}
          </span>
        </div>

        <div className="ai-message-list" aria-label="AI import activity">
          {events.map((event) => (
            <article key={event.id} className={`ai-message ai-message-${event.kind} ai-message-${event.status}`}>
              <div className="ai-message-icon">{eventIcon(event)}</div>
              <div>
                <div className="ai-message-heading">
                  <strong>{event.title}</strong>
                  <span>{event.time}</span>
                </div>
                <p>{event.detail}</p>
              </div>
            </article>
          ))}
        </div>

        <div className="ai-composer">
          {!canImport ? <FieldError message="AI import is disabled by deployment policy." /> : null}
          <label>
            <span className="label-with-help">
              Raw gift-card text
              <HelpHint text="Paste spreadsheet rows, email snippets, or natural language. The server sends this text to the configured AI provider and returns structured cards for review." />
            </span>
            <textarea
              className="ai-import-textarea mono"
              value={sourceText}
              placeholder={aiImportSample}
              rows={12}
              onChange={(event) => {
                setSourceText(event.target.value);
                setSuccess('');
              }}
            />
          </label>
          <label>
            <span className="label-with-help">
              Correction for another pass
              <HelpHint text="Optional. Add a targeted correction such as 'The Uber rows inherit value 50 and have no PIN', then run another pass." />
            </span>
            <textarea
              className="ai-instruction-textarea"
              value={instruction}
              placeholder="Optional correction for the next AI pass"
              rows={3}
              onChange={(event) => setInstruction(event.target.value)}
            />
          </label>
          <FieldError message={error} />
          {statusText ? (
            <p className="info-copy" role="status" aria-live="polite">
              {statusText}
            </p>
          ) : null}
          {success ? <p className="success-copy">{success}</p> : null}
          <div className="ai-composer-actions">
            <button
              type="button"
              className="primary-action"
              onClick={() => void runAiAnalysis(false)}
              disabled={!canImport || !sourceText.trim() || analyzing}
              title="Send the raw text to the configured AI import provider."
            >
              <Sparkles aria-hidden="true" size={17} />
              {analyzing ? 'Analyzing...' : 'Analyze with AI'}
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={() => void runAiAnalysis(true)}
              disabled={!canImport || !sourceText.trim() || rows.length === 0 || analyzing}
              title="Send the raw text, current draft, and correction text for another AI pass."
            >
              <RefreshCw aria-hidden="true" size={17} />
              Run another pass
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={discardAnalysis}
              disabled={analyzing || (rows.length === 0 && !analysisMeta)}
              title="Discard the current AI draft without saving cards."
            >
              <Trash2 aria-hidden="true" size={17} />
              Discard draft
            </button>
          </div>
        </div>
      </div>

      <aside className="ai-import-inspector" aria-label="AI import processing">
        <section className="ai-inspector-card">
          <div className="ai-inspector-heading">
            <Sparkles aria-hidden="true" size={17} />
            <h3>AI response</h3>
          </div>
          <dl className="ai-import-stats">
            <div>
              <dt>Provider</dt>
              <dd>{analysisMeta?.provider || 'Not run'}</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{analysisMeta?.model || 'Not run'}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{analysisMeta?.elapsed || '-'}</dd>
            </div>
            <div>
              <dt>Candidate cards</dt>
              <dd>{analysisMeta?.diagnostics?.candidatesReturned ?? rows.length}</dd>
            </div>
          </dl>
        </section>
        <section className="ai-inspector-card">
          <div className="ai-inspector-heading">
            <CheckCircle2 aria-hidden="true" size={17} />
            <h3>System processing</h3>
          </div>
          <dl className="ai-import-stats">
            <div>
              <dt>Ready</dt>
              <dd>{readyRows}</dd>
            </div>
            <div>
              <dt>Need edits</dt>
              <dd>{invalidRows.length}</dd>
            </div>
            <div>
              <dt>Filtered</dt>
              <dd>{analysisMeta?.diagnostics?.rowsDiscarded ?? 0}</dd>
            </div>
            <div>
              <dt>New brands</dt>
              <dd>{newBrands.length}</dd>
            </div>
          </dl>
          {newBrands.length > 0 ? (
            <p className="muted-text">New brands will be indexed on import: {newBrands.join(', ')}.</p>
          ) : null}
        </section>
      </aside>

      <section className="ai-review-section">
        <div className="section-heading">
          <div>
            <h2>Review import draft</h2>
            <span>{rows.length} parsed · {readyRows} ready · {invalidRows.length} need edits</span>
          </div>
          <button
            type="button"
            className="primary-action compact"
            disabled={submitting || invalidRows.length > 0 || rows.length === 0}
            onClick={() => void confirmImport()}
          >
            <FilePlus2 aria-hidden="true" size={17} />
            {submitting ? 'Importing...' : `Import ${rows.length} cards`}
          </button>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">
            <WandSparkles aria-hidden="true" size={24} />
            <p>No AI draft yet.</p>
          </div>
        ) : (
          <div className="table-wrap bulk-review-wrap ai-review-wrap" tabIndex={0}>
            <table className="bulk-review-table ai-review-table">
              <colgroup>
                <col className="bulk-col-action" />
                <col className="bulk-col-line" />
                <col className="bulk-col-status" />
                <col className="bulk-col-brand" />
                <col className="bulk-col-value" />
                <col className="bulk-col-type" />
                <col className="bulk-col-code" />
                <col className="bulk-col-pin" />
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
                  <th>Code / number</th>
                  <th>PIN</th>
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
                            list="ai-import-brand-options"
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
                        <td data-label="Code / number">
                          <input
                            className="mono"
                            autoComplete="off"
                            value={row.primaryCode}
                            aria-label={`Line ${row.lineNumber} code or card number`}
                            onChange={(event) => updateRow(row.id, { primaryCode: event.target.value })}
                          />
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
                        <td data-label="Source">
                          <input
                            list="ai-import-source-options"
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
                          <td colSpan={9} data-label="Warnings">
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
            <datalist id="ai-import-brand-options">
              {brandOptions.map((brand) => (
                <option key={brand} value={brand} />
              ))}
            </datalist>
            <datalist id="ai-import-source-options">
              {sourceOptions.map((source) => (
                <option key={source} value={source} />
              ))}
            </datalist>
          </div>
        )}
      </section>
    </section>
  );
}
