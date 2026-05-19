import { z } from 'zod';
import { HttpError } from './http/errors.js';

type AiProviderName = 'google' | 'openrouter' | 'groq';

interface AiModelSelection {
  provider: AiProviderName;
  model: string;
  refreshedAt: number;
}

interface AiParsedCard {
  brand: string;
  faceValue: string;
  credentialProfile: 'claim_code' | 'merchant_number_pin' | 'barcode' | 'network_prepaid' | 'custom';
  primaryCode: string;
  secondaryCode?: string;
  expirationMonth?: string;
  expirationYear?: string;
  billingZip?: string;
  barcodeFormat?: string;
  source?: string;
  notes?: string;
  rawLine?: string;
  confidence?: number | undefined;
}

export interface AiImportRow {
  id: string;
  lineNumber: number;
  rawLine: string;
  brand: string;
  faceValue: string;
  credentialProfile: AiParsedCard['credentialProfile'];
  primaryCode: string;
  secondaryCode: string;
  expirationMonth: string;
  expirationYear: string;
  billingZip: string;
  barcodeFormat: string;
  source: string;
  notes: string;
  warnings: string[];
}

export interface AiImportAnalysis {
  provider: AiProviderName;
  model: string;
  rows: AiImportRow[];
}

class AiProviderError extends Error {
  status: number | undefined;
  retryable: boolean;

  constructor(message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(message);
    this.name = 'AiProviderError';
    this.status = options.status;
    this.retryable = options.retryable ?? true;
  }
}

const aiCardSchema = z.object({
  brand: z.string().trim().min(1),
  faceValue: z.union([z.string(), z.number()]).transform((value) => String(value).replace(/^\$/, '').trim()),
  credentialProfile: z.enum(['claim_code', 'merchant_number_pin', 'barcode', 'network_prepaid', 'custom']).default('claim_code'),
  primaryCode: z.string().trim().min(1),
  secondaryCode: z.string().trim().optional().default(''),
  expirationMonth: z.string().trim().optional().default(''),
  expirationYear: z.string().trim().optional().default(''),
  billingZip: z.string().trim().optional().default(''),
  barcodeFormat: z.string().trim().optional().default('code128'),
  source: z.string().trim().optional().default(''),
  notes: z.string().trim().optional().default(''),
  rawLine: z.string().trim().optional().default(''),
  confidence: z.number().min(0).max(1).optional(),
});

const aiResponseSchema = z.object({
  cards: z.array(aiCardSchema).min(1),
});

const modelCache = new Map<AiProviderName, AiModelSelection>();
const modelCacheTtlMs = 24 * 60 * 60 * 1000;

const openRouterFreePreference = [
  'openai/gpt-oss-120b:free',
  'qwen/qwen3-235b-a22b:free',
  'deepseek/deepseek-r1:free',
];
const groqPreference = [
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
];
const googlePreference = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
];
const oneCodeBrandPattern = /\b(uber|uber eats|ubereats|doordash|door dash|instacart|amazon|apple|steam|google play|playstation|xbox)\b/i;
const headerTokenPattern = /^(card|cards?|brand|merchant|value|amount|code|pin|code\/pin|number|notes?|memo|source)$/i;
const separatorPattern = /^[-_\s|]+$/;

function env(name: string): string {
  return process.env[name]?.trim() || '';
}

function configuredProviders(): AiProviderName[] {
  const providers: AiProviderName[] = [];
  if (env('GC_AI_GOOGLE_API_KEY')) {
    providers.push('google');
  }
  if (env('GC_AI_OPENROUTER_API_KEY')) {
    providers.push('openrouter');
  }
  if (env('GC_AI_GROQ_API_KEY')) {
    providers.push('groq');
  }
  return providers;
}

function providerKey(provider: AiProviderName): string {
  if (provider === 'google') {
    return env('GC_AI_GOOGLE_API_KEY');
  }
  if (provider === 'openrouter') {
    return env('GC_AI_OPENROUTER_API_KEY');
  }
  return env('GC_AI_GROQ_API_KEY');
}

function providerOverride(provider: AiProviderName): string {
  if (provider === 'google') {
    return env('GC_AI_GOOGLE_MODEL');
  }
  if (provider === 'openrouter') {
    return env('GC_AI_OPENROUTER_MODEL');
  }
  return env('GC_AI_GROQ_MODEL');
}

function cachedSelection(provider: AiProviderName): AiModelSelection | null {
  const override = providerOverride(provider);
  if (override) {
    return { provider, model: override, refreshedAt: Date.now() };
  }

  const cached = modelCache.get(provider);
  if (cached && Date.now() - cached.refreshedAt < modelCacheTtlMs) {
    return cached;
  }
  return null;
}

async function fetchJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new AiProviderError(`AI provider request failed with ${response.status}.`, {
      status: response.status,
      retryable: response.status === 429 || response.status >= 500,
    });
  }
  return payload as unknown;
}

function chooseByPreference(modelIds: string[], preferred: string[]): string | null {
  const normalized = new Set(modelIds.map((model) => model.toLowerCase()));
  return preferred.find((model) => normalized.has(model.toLowerCase())) || modelIds[0] || null;
}

async function selectGoogleModel(apiKey: string): Promise<AiModelSelection> {
  const cached = cachedSelection('google');
  if (cached) {
    return cached;
  }

  let model = googlePreference[0]!;
  try {
    const payload = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
    const models = Array.isArray((payload as { models?: unknown[] }).models)
      ? (payload as { models: Array<{ name?: string; supportedGenerationMethods?: string[] }> }).models
      : [];
    const ids = models
      .filter((row) => row.supportedGenerationMethods?.includes('generateContent'))
      .map((row) => String(row.name || '').replace(/^models\//, ''))
      .filter(Boolean);
    model = chooseByPreference(ids, googlePreference) || model;
  } catch {
    model = googlePreference[0]!;
  }

  const selection = { provider: 'google' as const, model, refreshedAt: Date.now() };
  modelCache.set('google', selection);
  return selection;
}

function openRouterDiscoveryKey(): string {
  return env('GC_AI_OPENROUTER_API_KEY') || env('GC_AI_OPENROUTER_DISCOVERY_API_KEY');
}

async function selectOpenRouterModel(): Promise<AiModelSelection> {
  const cached = cachedSelection('openrouter');
  if (cached) {
    return cached;
  }

  let model = openRouterFreePreference[0]!;
  const discoveryKey = openRouterDiscoveryKey();
  if (discoveryKey) {
    try {
      const payload = await fetchJson('https://openrouter.ai/api/v1/models', {
        headers: {
          Authorization: `Bearer ${discoveryKey}`,
          Accept: 'application/json',
        },
      });
      const models = Array.isArray((payload as { data?: unknown[] }).data)
        ? (payload as { data: Array<{ id?: string; pricing?: { prompt?: string; completion?: string } }> }).data
        : [];
      const freeIds = models
        .filter((row) => row.pricing?.prompt === '0' && row.pricing?.completion === '0')
        .map((row) => String(row.id || ''))
        .filter(Boolean);
      model = chooseByPreference(freeIds, openRouterFreePreference) || model;
    } catch {
      model = openRouterFreePreference[0]!;
    }
  }

  const selection = { provider: 'openrouter' as const, model, refreshedAt: Date.now() };
  modelCache.set('openrouter', selection);
  return selection;
}

async function selectGroqModel(apiKey: string): Promise<AiModelSelection> {
  const cached = cachedSelection('groq');
  if (cached) {
    return cached;
  }

  let model = groqPreference[0]!;
  try {
    const payload = await fetchJson('https://api.groq.com/openai/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });
    const ids = Array.isArray((payload as { data?: unknown[] }).data)
      ? (payload as { data: Array<{ id?: string }> }).data.map((row) => String(row.id || '')).filter(Boolean)
      : [];
    model = chooseByPreference(ids, groqPreference) || model;
  } catch {
    model = groqPreference[0]!;
  }

  const selection = { provider: 'groq' as const, model, refreshedAt: Date.now() };
  modelCache.set('groq', selection);
  return selection;
}

async function selectModel(provider: AiProviderName): Promise<AiModelSelection> {
  const apiKey = providerKey(provider);
  if (!apiKey) {
    throw new AiProviderError(`Missing ${provider} API key.`, { retryable: false });
  }
  if (provider === 'google') {
    return selectGoogleModel(apiKey);
  }
  if (provider === 'openrouter') {
    return selectOpenRouterModel();
  }
  return selectGroqModel(apiKey);
}

function aiPrompt(text: string): string {
  return [
    'Extract gift card inventory from the user text.',
    'Return ONLY strict JSON with this shape: {"cards":[{"brand":"","faceValue":"","credentialProfile":"claim_code|merchant_number_pin|barcode|network_prepaid|custom","primaryCode":"","secondaryCode":"","notes":"","source":"","rawLine":"","confidence":0.0}]}',
    'Rules:',
    '- Do not invent missing values. Leave uncertain optional fields empty and mention uncertainty in notes.',
    '- Ignore table header rows, separator rows, blank rows, labels, and other non-gift-card text. Do not return them as cards.',
    '- For one-code cards such as Uber, DoorDash, Instacart, Amazon, and Apple, use credentialProfile "claim_code", primaryCode as the redeemable code, and no secondaryCode.',
    '- For merchant cards with a number plus a secondary PIN, use credentialProfile "merchant_number_pin", primaryCode as card number, secondaryCode as PIN.',
    '- Treat issuer terms such as access number, passcode, or password as PIN and put them in secondaryCode.',
    '- If a brand and value header applies to multiple following code-only rows, inherit that brand and value for each row until a new brand/value row or table header appears.',
    '- A row like "Card Code/PIN" is a header, not a gift card.',
    '- If a trailing date is not clearly an expiration field supported by the app, keep it in notes as memo text.',
    '- Face values should be numeric strings without a dollar sign.',
    '- Preserve human-readable code grouping such as spaces or hyphens in primaryCode.',
    '- Preserve each extracted card as one item. The database write will happen only after human review.',
    '',
    'Continuation example:',
    'Input rows: "Uber<TAB>50<TAB><TAB>NAAD XYHD QR65 U8LY" followed by "<TAB><TAB><TAB>NAAD X373 WSR8 UBNH".',
    'Output two Uber cards, both faceValue "50", both credentialProfile "claim_code", with the full grouped code in primaryCode and empty secondaryCode.',
    '',
    'User text:',
    text,
  ].join('\n');
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
    if (fenced) {
      return JSON.parse(fenced);
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new AiProviderError('AI response was not valid JSON.', { retryable: true });
  }
}

function textFromOpenAiPayload(payload: unknown): string {
  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices || [];
  const content = choices[0]?.message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part?.text === 'string' ? part.text : '')
      .join('');
  }
  return '';
}

function textFromGooglePayload(payload: unknown): string {
  const candidates = (payload as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates || [];
  return candidates[0]?.content?.parts?.map((part) => part.text || '').join('') || '';
}

function compactText(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizePrimaryCode(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

function isHeaderLikeCard(card: AiParsedCard): boolean {
  const brand = card.brand.trim();
  const primaryCode = card.primaryCode.trim();
  const raw = card.rawLine?.trim() || '';
  if (!brand || !primaryCode) {
    return true;
  }
  if (separatorPattern.test(raw) || separatorPattern.test(brand) || separatorPattern.test(primaryCode)) {
    return true;
  }
  if (headerTokenPattern.test(brand) && headerTokenPattern.test(primaryCode)) {
    return true;
  }
  if (compactText(brand) === 'card' && ['code', 'codepin', 'pin'].includes(compactText(primaryCode))) {
    return true;
  }
  return false;
}

function normalizeAiCard(card: AiParsedCard): AiParsedCard | null {
  if (isHeaderLikeCard(card)) {
    return null;
  }

  const next: AiParsedCard = {
    ...card,
    primaryCode: normalizePrimaryCode(card.primaryCode),
    secondaryCode: card.secondaryCode?.trim() || '',
  };

  if (oneCodeBrandPattern.test(next.brand)) {
    const removedPin = next.secondaryCode;
    next.credentialProfile = 'claim_code';
    next.secondaryCode = '';
    if (removedPin) {
      next.notes = [next.notes, `AI supplied an extra PIN for ${next.brand}; removed because this brand is treated as code-only.`]
        .filter(Boolean)
        .join(' ');
    }
  }

  return next;
}

async function callGoogle(text: string, selection: AiModelSelection, apiKey: string): Promise<unknown> {
  const payload = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selection.model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: aiPrompt(text) }] }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
        },
      }),
    },
  );
  return extractJsonObject(textFromGooglePayload(payload));
}

async function callOpenAiCompatible(
  provider: 'openrouter' | 'groq',
  text: string,
  selection: AiModelSelection,
  apiKey: string,
): Promise<unknown> {
  const url = provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.groq.com/openai/v1/chat/completions';
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://gc-management.local';
    headers['X-Title'] = 'GC Management AI Import';
  }

  const payload = await fetchJson(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: selection.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You extract gift-card records and return only strict JSON.',
        },
        {
          role: 'user',
          content: aiPrompt(text),
        },
      ],
    }),
  });
  return extractJsonObject(textFromOpenAiPayload(payload));
}

function toRows(cards: AiParsedCard[], provider: AiProviderName, model: string): AiImportRow[] {
  return cards.flatMap((card) => {
    const normalized = normalizeAiCard(card);
    return normalized ? [normalized] : [];
  }).map((card, index) => ({
    id: `ai-${index + 1}`,
    lineNumber: index + 1,
    rawLine: card.rawLine || '',
    brand: card.brand,
    faceValue: card.faceValue,
    credentialProfile: card.credentialProfile,
    primaryCode: card.primaryCode,
    secondaryCode: card.secondaryCode || '',
    expirationMonth: card.expirationMonth || '',
    expirationYear: card.expirationYear || '',
    billingZip: card.billingZip || '',
    barcodeFormat: card.barcodeFormat || 'code128',
    source: card.source || '',
    notes: card.notes || '',
    warnings: [
      `AI parsed with ${provider}/${model}; verify before import.`,
      ...(typeof card.confidence === 'number' && card.confidence < 0.8 ? ['Low AI confidence.'] : []),
    ],
  }));
}

export async function analyzeGiftCardsWithAi(text: string): Promise<AiImportAnalysis> {
  const providers = configuredProviders();
  if (providers.length === 0) {
    throw new HttpError(503, 'AI_IMPORT_NOT_CONFIGURED', 'AI import is not configured. Set at least one GC_AI_* API key on the server.');
  }

  const failures: string[] = [];
  for (const provider of providers) {
    const apiKey = providerKey(provider);
    try {
      const selection = await selectModel(provider);
      const raw = provider === 'google'
        ? await callGoogle(text, selection, apiKey)
        : await callOpenAiCompatible(provider, text, selection, apiKey);
      const parsed = aiResponseSchema.parse(raw);
      return {
        provider,
        model: selection.model,
        rows: toRows(parsed.cards, provider, selection.model),
      };
    } catch (caught) {
      const error = caught as Error & { status?: number; retryable?: boolean };
      failures.push(`${provider}: ${error.message}`);
      if (error.retryable === false) {
        continue;
      }
    }
  }

  const quotaHit = failures.some((failure) => /\b429\b|quota|rate/i.test(failure));
  throw new HttpError(
    quotaHit ? 429 : 503,
    quotaHit ? 'AI_IMPORT_QUOTA_EXHAUSTED' : 'AI_IMPORT_FAILED',
    quotaHit
      ? 'No configured free AI provider has quota available right now.'
      : 'AI import failed for all configured providers.',
    { details: { providersTried: providers } },
  );
}
