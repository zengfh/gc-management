import { errorMessage } from './display';

export interface AiImportAnalyzePayload {
  text: string;
  instruction?: string;
  previousRows?: unknown[];
}

export interface AiImportDiagnostics {
  candidatesReturned?: number;
  rowsAccepted?: number;
  rowsDiscarded?: number;
}

export function formatElapsedTime(milliseconds: number): string {
  if (milliseconds < 1000) {
    return `${Math.max(1, Math.round(milliseconds))}ms`;
  }
  return `${(milliseconds / 1000).toFixed(1)}s`;
}

export function aiImportErrorMessage(caught: unknown, elapsedMs: number): string {
  const error = caught as Error & { code?: string; status?: number };
  const baseMessage = errorMessage(caught);
  const elapsed = formatElapsedTime(elapsedMs);
  if (error.code === 'AI_IMPORT_QUOTA_EXHAUSTED' || error.status === 429) {
    return `AI import failed after ${elapsed}: all configured AI providers are out of quota or rate-limited. You can retry later or use Fast parse (rules). ${baseMessage}`;
  }
  if (error.code === 'AI_IMPORT_NOT_CONFIGURED') {
    return `AI import is not configured on this server. Set a GC_AI_* provider key, then retry. ${baseMessage}`;
  }
  if (error.code === 'AI_IMPORT_FAILED' || error.status === 503) {
    return `AI import failed after ${elapsed}: the configured providers did not return a usable parse. You can retry or use Fast parse (rules). ${baseMessage}`;
  }
  return `AI import failed after ${elapsed}. ${baseMessage}`;
}
