import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzeGiftCardsWithAi, listAiImportModelOptions } from './aiImport.js';

const card = {
  brand: 'Visa', faceValue: '100', credentialProfile: 'network_prepaid',
  primaryCode: '4111111111111111', networkSecurityCode: '007',
  expirationMonth: '09', expirationYear: '2029', billingZip: '00123',
};

function response(cards = [card]) {
  return new Response(JSON.stringify({ output_text: JSON.stringify({ cards }) }));
}

describe('bounded AI imports', () => {
  beforeEach(() => {
    for (const provider of ['GOOGLE', 'GROQ', 'OPENROUTER']) vi.stubEnv(`GC_AI_${provider}_API_KEY`, '');
    vi.stubEnv('GC_AI_CUSTOM_API_KEY', 'synthetic-key');
    vi.stubEnv('GC_AI_CUSTOM_BASE_URL', 'https://gateway.example/v1');
    vi.stubEnv('GC_AI_CUSTOM_MODEL', 'test-model');
    vi.stubEnv('GC_AI_CUSTOM_MODELS', 'test-model,alternate-model');
    vi.stubEnv('GC_AI_CUSTOM_WIRE_API', 'responses');
    vi.stubEnv('GC_AI_CUSTOM_STRUCTURED_OUTPUTS', 'true');
    vi.stubEnv('GC_AI_MAX_OUTPUT_TOKENS', '4096');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('preserves canonical network fields and sends a bounded strict schema without response storage', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    const result = await analyzeGiftCardsWithAi('Synthetic network card');
    expect(result.rows[0]).toMatchObject(card);
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({
      max_output_tokens: 4096, store: false,
      text: { format: { type: 'json_schema', strict: true, schema: { additionalProperties: false } } },
    });
    expect(fetch.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('offers the configured model allowlist and rejects selections outside it before calling the provider', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    const models = await listAiImportModelOptions();
    expect(models.options.map(model => model.id)).toContain('custom:alternate-model');
    await analyzeGiftCardsWithAi('Synthetic card', { modelSelection: 'custom:alternate-model' });
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).model).toBe('alternate-model');
    fetch.mockClear();
    await expect(analyzeGiftCardsWithAi('Synthetic card', { modelSelection: 'custom:%invalid' }))
      .rejects.toMatchObject({ status: 400, code: 'AI_IMPORT_MODEL_UNAVAILABLE' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts an empty result for non-card text without requiring fabricated credentials', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response([]));
    const result = await analyzeGiftCardsWithAi('This text contains no gift cards.');
    expect(result.rows).toEqual([]);
    expect(result.diagnostics).toEqual({ candidatesReturned: 0, rowsAccepted: 0, rowsDiscarded: 0 });
  });

  it.each(['timeout', 'cancel'] as const)('aborts a pending provider request on %s', async (mode) => {
    vi.stubEnv('GC_AI_REQUEST_TIMEOUT_MS', mode === 'timeout' ? '20' : '1000');
    let providerSignal: AbortSignal | null | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      providerSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        providerSignal?.addEventListener('abort', () => reject(providerSignal?.reason), { once: true });
      });
    });
    const controller = new AbortController();
    const pending = analyzeGiftCardsWithAi('Synthetic card', { signal: controller.signal });
    const check = expect(pending).rejects.toMatchObject({
      code: mode === 'timeout' ? 'AI_IMPORT_TIMEOUT' : 'AI_IMPORT_CANCELLED',
      status: mode === 'timeout' ? 504 : 499,
    });
    if (mode === 'cancel') {
      await vi.waitFor(() => expect(providerSignal).toBeDefined());
      controller.abort();
    }
    await check;
    expect(providerSignal?.aborted).toBe(true);
  });
});
