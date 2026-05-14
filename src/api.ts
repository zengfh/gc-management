import type { ApiErrorPayload } from '../shared/domain';

export interface ApiOptions {
  method?: string;
  body?: unknown;
  csrfToken?: string | null;
}

export class ApiError extends Error {
  code?: string;
  fieldErrors: unknown[];
  requestId?: string | null;
  status?: number;

  constructor(message: string, payload: ApiErrorPayload = {}, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = payload.code;
    this.fieldErrors = payload.fieldErrors || [];
    this.requestId = payload.requestId;
    this.status = status;
  }
}

interface JsonEnvelope {
  error?: ApiErrorPayload;
}

export function createUiIdempotencyKey(): string {
  if (globalThis.crypto?.randomUUID) {
    return `ui_${globalThis.crypto.randomUUID()}`;
  }
  return `ui_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function requestInit(method: string, body: unknown, csrfToken: string | null | undefined, accept: string): RequestInit {
  const options: RequestInit & { headers: Record<string, string> } = {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: accept,
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

  return options;
}

function errorFromResponse(response: Response, payload: JsonEnvelope): ApiError {
  const requestId = payload.error?.requestId || response.headers.get('x-request-id');
  const message = payload.error?.message || 'Request failed.';
  return new ApiError(requestId ? `${message} Request ID: ${requestId}` : message, {
    ...payload.error,
    requestId,
  }, response.status);
}

export async function apiFetch<T = unknown>(
  path: string,
  { method = 'GET', body, csrfToken }: ApiOptions = {},
): Promise<T> {
  const response = await fetch(path, requestInit(method, body, csrfToken, 'application/json'));
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw errorFromResponse(response, payload);
  }

  return payload as T;
}

export async function apiDownload(
  path: string,
  { method = 'GET', body, csrfToken }: ApiOptions = {},
): Promise<{ blob: Blob; filename: string | null }> {
  const response = await fetch(path, requestInit(method, body, csrfToken, 'application/octet-stream'));
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw errorFromResponse(response, payload);
  }

  return {
    blob: await response.blob(),
    filename: filenameFromContentDisposition(response.headers.get('content-disposition')),
  };
}

function filenameFromContentDisposition(header: string | null): string | null {
  if (!header) {
    return null;
  }

  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1] || null;
}
