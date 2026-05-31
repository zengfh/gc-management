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
  credentialProfile: 'claim_code' | 'claim_link' | 'merchant_number_pin' | 'barcode' | 'network_prepaid' | 'custom';
  primaryCode: string;
  secondaryCode?: string;
  expirationMonth?: string;
  expirationYear?: string;
  billingZip?: string;
  networkSecurityCode?: string;
  barcodeFormat?: string;
  source?: string;
  notes?: string;
  rawLine?: string;
  securityCodePresent?: boolean;
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
  networkSecurityCode: string;
  barcodeFormat: string;
  source: string;
  notes: string;
  warnings: string[];
}

export interface AiImportAnalysis {
  provider: AiProviderName;
  model: string;
  rows: AiImportRow[];
  diagnostics: {
    candidatesReturned: number;
    rowsAccepted: number;
    rowsDiscarded: number;
  };
}

export interface AiImportPromptOptions {
  instruction?: string;
  previousRows?: unknown[];
}

interface TextPrepaidDetail {
  last4: string;
  faceValue: string;
  expirationMonth: string;
  expirationYear: string;
  networkSecurityCode: string;
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

const looseString = z.union([z.string(), z.number(), z.null()]).optional()
  .transform((value) => (value == null ? '' : String(value).trim()));

function moneyText(value: string): string {
  return value.replace(/^\$/, '').replace(/,/g, '').trim();
}

function firstPresent(...values: string[]): string {
  return values.find((value) => value.trim())?.trim() || '';
}

function splitExpiration(value: string): { expirationMonth: string; expirationYear: string } {
  const match = value.trim().match(/\b(0?[1-9]|1[0-2])\s*[/-]\s*(\d{2}|\d{4})\b/);
  if (!match) {
    return { expirationMonth: '', expirationYear: '' };
  }
  const monthPart = match[1] || '';
  const yearPart = match[2] || '';
  const month = monthPart.padStart(2, '0');
  const year = yearPart.length === 2 ? `20${yearPart}` : yearPart;
  return { expirationMonth: month, expirationYear: year };
}

function primaryCodeDigits(value: string): string {
  return value.replace(/\D/g, '');
}

function splitTextBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (/^\s*card\s+\d+\b/i.test(line) && current.some((row) => row.trim())) {
      blocks.push(current.join('\n'));
      current = [];
    }
    current.push(line);
  }
  if (current.some((row) => row.trim())) {
    blocks.push(current.join('\n'));
  }
  return blocks.flatMap((block) => block.split(/\n\s*\n/g).map((row) => row.trim()).filter(Boolean));
}

function extractPrepaidDetailsFromText(text: string): TextPrepaidDetail[] {
  return splitTextBlocks(text).flatMap((block) => {
    const number = block.match(/\b(?:number|card\s*number|pan)\s*:\s*([0-9][0-9\s-]{11,30}[0-9])\b/i)?.[1]
      || block.match(/\b((?:\d[ -]*){13,19})\b/)?.[1]
      || '';
    const digits = primaryCodeDigits(number);
    if (digits.length < 13) {
      return [];
    }
    const expiration = splitExpiration(
      block.match(/\b(?:exp|expiration|valid\s*through)\s*:\s*([0-9]{1,2}\s*[/-]\s*[0-9]{2,4})\b/i)?.[1] || '',
    );
    return [{
      last4: digits.slice(-4),
      faceValue: moneyText(block.match(/\b(?:balance|value|amount)\s*:\s*\$?\s*([0-9][0-9,]*(?:\.\d{1,2})?)\b/i)?.[1] || ''),
      expirationMonth: expiration.expirationMonth,
      expirationYear: expiration.expirationYear,
      networkSecurityCode: block.match(/\b(?:cvv|cvc|cid|security\s*code)\s*:\s*([0-9]{3,4})\b/i)?.[1] || '',
    }];
  });
}

const aiCardSchema = z.object({
  brand: looseString,
  faceValue: looseString,
  value: looseString,
  amount: looseString,
  balance: looseString,
  credentialProfile: z.enum(['claim_code', 'claim_link', 'merchant_number_pin', 'barcode', 'network_prepaid', 'custom']).optional().default('claim_code'),
  primaryCode: looseString,
  code: looseString,
  cardNumber: looseString,
  number: looseString,
  pan: looseString,
  secondaryCode: looseString,
  pin: looseString,
  password: looseString,
  accessCode: looseString,
  expirationMonth: looseString,
  expirationYear: looseString,
  expiration: looseString,
  exp: looseString,
  validThrough: looseString,
  billingZip: looseString,
  zip: looseString,
  postalCode: looseString,
  barcodeFormat: looseString,
  source: looseString,
  notes: looseString,
  rawLine: looseString,
  cvv: looseString,
  cvc: looseString,
  cid: looseString,
  securityCode: looseString,
  confidence: z.number().min(0).max(1).optional(),
}).transform((row): AiParsedCard => {
  const expiration = splitExpiration(firstPresent(row.expiration, row.exp, row.validThrough));
  const primaryCode = firstPresent(row.primaryCode, row.cardNumber, row.number, row.pan, row.code);
  const secondaryCode = firstPresent(row.secondaryCode, row.pin, row.password, row.accessCode);
  const networkSecurityCode = firstPresent(row.cvv, row.cvc, row.cid, row.securityCode);
  const securityCodePresent = Boolean(networkSecurityCode);
  const credentialProfile = (
    row.credentialProfile === 'claim_code'
      && (securityCodePresent || firstPresent(row.expirationMonth, expiration.expirationMonth) || firstPresent(row.expirationYear, expiration.expirationYear))
  )
    ? 'network_prepaid'
    : row.credentialProfile;

  return {
    brand: row.brand,
    faceValue: moneyText(firstPresent(row.faceValue, row.value, row.amount, row.balance)),
    credentialProfile,
    primaryCode,
    secondaryCode,
    expirationMonth: firstPresent(row.expirationMonth, expiration.expirationMonth),
    expirationYear: firstPresent(row.expirationYear, expiration.expirationYear),
    billingZip: firstPresent(row.billingZip, row.zip, row.postalCode),
    networkSecurityCode,
    barcodeFormat: row.barcodeFormat || 'code128',
    source: row.source,
    notes: row.notes,
    rawLine: row.rawLine,
    securityCodePresent,
    confidence: row.confidence,
  };
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
const networkBrandPattern = /\b(visa|mastercard|master card|amex|american express|discover)\b/i;

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

function safePreviousRows(previousRows: unknown[] | undefined): unknown[] {
  if (!previousRows?.length) {
    return [];
  }
  return previousRows.slice(0, 100).map((row) => {
    const draft = row as Partial<AiImportRow>;
    return {
      brand: draft.brand || '',
      faceValue: draft.faceValue || '',
      credentialProfile: draft.credentialProfile || '',
      primaryCode: draft.primaryCode || '',
      secondaryCode: draft.secondaryCode || '',
      notes: draft.notes || '',
      rawLine: draft.rawLine || '',
    };
  });
}

function aiPrompt(text: string, options: AiImportPromptOptions = {}): string {
  const lines = [
    'Extract gift card inventory from the user text.',
    'Return ONLY strict JSON with this shape: {"cards":[{"brand":"","faceValue":"","credentialProfile":"claim_code|claim_link|merchant_number_pin|barcode|network_prepaid|custom","primaryCode":"","secondaryCode":"","notes":"","source":"","rawLine":"","confidence":0.0}]}',
    'Rules:',
    '- Do not invent missing values. Leave uncertain optional fields empty and mention uncertainty in notes.',
    '- If the merchant/brand is missing but the card is clearly network prepaid, infer only the card network when obvious from the number: Visa starts with 4, Mastercard commonly starts with 51-55 or 2221-2720, Amex starts with 34 or 37, Discover commonly starts with 6011/65/644-649.',
    '- Ignore table header rows, separator rows, blank rows, labels, and other non-gift-card text. Do not return them as cards.',
    '- For one-code cards such as Uber, DoorDash, Instacart, Amazon, and Apple, use credentialProfile "claim_code", primaryCode as the redeemable code, and no secondaryCode.',
    '- For claim-link cards, use credentialProfile "claim_link" and put the full HTTP/HTTPS URL exactly as written in primaryCode. Never alter URL casing.',
    '- For merchant cards with a number plus a secondary PIN, use credentialProfile "merchant_number_pin", primaryCode as card number, secondaryCode as PIN.',
    '- Treat issuer terms such as access number, passcode, or password as PIN and put them in secondaryCode.',
    '- If a brand and value header applies to multiple following code-only rows, inherit that brand and value for each row until a new brand/value row or table header appears.',
    '- A row like "Card Code/PIN" is a header, not a gift card.',
    '- If a trailing date is not clearly an expiration field supported by the app, keep it in notes as memo text.',
    '- For rows with labels like Number, Card Number, Balance, Exp, CVV, CVC, or Security Code, map Number/Card Number to primaryCode, Balance to faceValue, Exp to expirationMonth/expirationYear, and set credentialProfile to network_prepaid.',
    '- Do not put CVV/CVC/CID/security-code values in notes, source, rawLine, primaryCode, or secondaryCode. Put the value only in networkSecurityCode.',
    '- Face values should be numeric strings without a dollar sign.',
    '- Preserve human-readable code grouping such as spaces or hyphens in primaryCode. Preserve letter casing exactly; do not uppercase codes.',
    '- Preserve each extracted card as one item. The database write will happen only after human review.',
    '',
    'Continuation example:',
    'Input rows: "Uber<TAB>50<TAB><TAB>NAAD XYHD QR65 U8LY" followed by "<TAB><TAB><TAB>NAAD X373 WSR8 UBNH".',
    'Output two Uber cards, both faceValue "50", both credentialProfile "claim_code", with the full grouped code in primaryCode and empty secondaryCode.',
  ];

  if (options.instruction?.trim()) {
    lines.push(
      '',
      'User correction for this iteration:',
      options.instruction.trim(),
      'Apply the correction while preserving valid cards from the original text.',
    );
  }

  const previousRows = safePreviousRows(options.previousRows);
  if (previousRows.length > 0) {
    lines.push(
      '',
      'Current draft rows shown to the user:',
      JSON.stringify(previousRows),
      'Use these only as context for the correction. Return the full corrected card list.',
    );
  }

  lines.push('', 'User text:', text);
  return lines.join('\n');
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
  return value.trim().replace(/\s+/g, ' ');
}

function looksLikeClaimLink(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function hasMixedLetterCase(value: string): boolean {
  return /[a-z]/.test(value) && /[A-Z]/.test(value);
}

function inferNetworkBrandFromNumber(value: string): string {
  const digits = primaryCodeDigits(value);
  if (/^4\d{12,18}$/.test(digits)) {
    return 'Visa';
  }
  if (/^(5[1-5]\d{14}|2(?:2[2-9]|[3-6]\d|7[01]|720)\d{12})$/.test(digits)) {
    return 'Mastercard';
  }
  if (/^3[47]\d{13}$/.test(digits)) {
    return 'American Express';
  }
  if (/^(6011|65|64[4-9]|622)\d{12,15}$/.test(digits)) {
    return 'Discover';
  }
  return '';
}

function looksLikeNetworkPrepaid(card: AiParsedCard): boolean {
  if (card.credentialProfile === 'network_prepaid') {
    return true;
  }
  if (networkBrandPattern.test(card.brand)) {
    return true;
  }
  if (inferNetworkBrandFromNumber(card.primaryCode) && (card.expirationMonth || card.expirationYear || card.securityCodePresent)) {
    return true;
  }
  return false;
}

function isHeaderLikeCard(card: AiParsedCard): boolean {
  const brand = card.brand.trim();
  const primaryCode = card.primaryCode.trim();
  const raw = card.rawLine?.trim() || '';
  if (!primaryCode) {
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

  if (looksLikeClaimLink(next.primaryCode)) {
    next.credentialProfile = 'claim_link';
  }

  if (looksLikeNetworkPrepaid(next)) {
    next.credentialProfile = 'network_prepaid';
    if (!next.brand.trim()) {
      next.brand = inferNetworkBrandFromNumber(next.primaryCode);
    }
  }

  if (next.credentialProfile !== 'claim_link' && oneCodeBrandPattern.test(next.brand)) {
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

function removeExpirationOnlyNote(notes: string | undefined): string {
  const value = notes?.trim() || '';
  if (!value) {
    return '';
  }
  return value
    .replace(/\b(?:exp|expiration|valid\s*through)\s*:\s*[0-9]{1,2}\s*[/-]\s*[0-9]{2,4}\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function enrichCardFromText(card: AiParsedCard, details: TextPrepaidDetail[]): AiParsedCard {
  const last4 = primaryCodeDigits(card.primaryCode).slice(-4);
  const detail = last4 ? details.find((candidate) => candidate.last4 === last4) : null;
  if (!detail) {
    return card;
  }
  const next = { ...card };
  let enriched = false;
  if (!next.faceValue && detail.faceValue) {
    next.faceValue = detail.faceValue;
    enriched = true;
  }
  if (!next.expirationMonth && detail.expirationMonth) {
    next.expirationMonth = detail.expirationMonth;
    enriched = true;
  }
  if (!next.expirationYear && detail.expirationYear) {
    next.expirationYear = detail.expirationYear;
    enriched = true;
  }
  if (!next.networkSecurityCode && detail.networkSecurityCode) {
    next.networkSecurityCode = detail.networkSecurityCode;
    next.securityCodePresent = true;
    enriched = true;
  }
  if (next.expirationMonth && next.expirationYear) {
    next.notes = removeExpirationOnlyNote(next.notes);
  }
  if (enriched) {
    next.credentialProfile = 'network_prepaid';
  }
  return next;
}

async function callGoogle(
  text: string,
  selection: AiModelSelection,
  apiKey: string,
  options: AiImportPromptOptions,
): Promise<unknown> {
  const payload = await fetchJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selection.model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: aiPrompt(text, options) }] }],
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
  options: AiImportPromptOptions,
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
          content: aiPrompt(text, options),
        },
      ],
    }),
  });
  return extractJsonObject(textFromOpenAiPayload(payload));
}

function toRows(cards: AiParsedCard[], provider: AiProviderName, model: string, sourceText: string): Pick<AiImportAnalysis, 'rows' | 'diagnostics'> {
  const textDetails = extractPrepaidDetailsFromText(sourceText);
  const normalizedCards = cards.flatMap((card) => {
    const normalized = normalizeAiCard(enrichCardFromText(card, textDetails));
    return normalized ? [normalized] : [];
  });
  const rows = normalizedCards.map((card, index) => ({
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
    networkSecurityCode: card.networkSecurityCode || '',
    barcodeFormat: card.barcodeFormat || 'code128',
    source: card.source || '',
    notes: card.notes || '',
    warnings: [
      `AI parsed with ${provider}/${model}; verify before import.`,
      ...(card.securityCodePresent ? ['Security code was parsed for local encrypted storage. Verify before import.'] : []),
      ...(hasMixedLetterCase(card.primaryCode) && !looksLikeClaimLink(card.primaryCode)
        ? ['Code contains mixed uppercase/lowercase characters and was preserved as entered. Verify casing before import.']
        : []),
      ...(typeof card.confidence === 'number' && card.confidence < 0.8 ? ['Low AI confidence.'] : []),
    ],
  }));
  return {
    rows,
    diagnostics: {
      candidatesReturned: cards.length,
      rowsAccepted: rows.length,
      rowsDiscarded: cards.length - rows.length,
    },
  };
}

function safeFailureReason(provider: AiProviderName, caught: unknown): string {
  if (caught instanceof z.ZodError) {
    const paths = caught.issues
      .slice(0, 4)
      .map((issue) => issue.path.join('.') || issue.code)
      .filter(Boolean)
      .join(', ');
    return `${provider}: provider response did not match the expected card schema${paths ? ` (${paths})` : ''}`;
  }
  const error = caught as Error & { status?: number };
  if (error.status) {
    return `${provider}: provider request failed with HTTP ${error.status}`;
  }
  if (/json/i.test(error.message || '')) {
    return `${provider}: provider did not return valid JSON`;
  }
  return `${provider}: ${error.message || 'unknown provider failure'}`;
}

export async function analyzeGiftCardsWithAi(
  text: string,
  options: AiImportPromptOptions = {},
): Promise<AiImportAnalysis> {
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
        ? await callGoogle(text, selection, apiKey, options)
        : await callOpenAiCompatible(provider, text, selection, apiKey, options);
      const parsed = aiResponseSchema.parse(raw);
      const { rows, diagnostics } = toRows(parsed.cards, provider, selection.model, text);
      return {
        provider,
        model: selection.model,
        rows,
        diagnostics,
      };
    } catch (caught) {
      const error = caught as Error & { retryable?: boolean };
      failures.push(safeFailureReason(provider, caught));
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
    { details: { providersTried: providers, providerFailures: failures } },
  );
}
