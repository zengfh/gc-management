import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/index.js';

describe('AI import routes', () => {
  const appOrigin = 'http://localhost:5173';
  let db;
  let agent;
  let originalGoogleKey;

  beforeEach(() => {
    db = openDatabase({ filename: ':memory:' });
    agent = request.agent(createApp({ db }));
    originalGoogleKey = process.env.GC_AI_GOOGLE_API_KEY;
  });

  afterEach(() => {
    db.close();
    if (originalGoogleKey == null) {
      delete process.env.GC_AI_GOOGLE_API_KEY;
    } else {
      process.env.GC_AI_GOOGLE_API_KEY = originalGoogleKey;
    }
    vi.restoreAllMocks();
  });

  async function setupOwner() {
    const response = await agent.post('/api/auth/setup').send({
      unlockSecret: 'a strong unlock phrase',
    });
    return response.body.data.csrfToken;
  }

  function postWithCsrf(path, csrfToken) {
    return agent.post(path).set('Origin', appOrigin).set('X-CSRF-Token', csrfToken);
  }

  it('analyzes pasted gift card text with a configured AI provider without auditing secrets', async () => {
    process.env.GC_AI_GOOGLE_API_KEY = 'test-google-key';
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        models: [
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
        ],
      })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    cards: [
                      {
                        brand: 'Lowes',
                        faceValue: '250',
                        credentialProfile: 'merchant_number_pin',
                        primaryCode: '6006491727039277301',
                        secondaryCode: '7640',
                        notes: 'Memo: 05/02/2026',
                        confidence: 0.95,
                      },
                      {
                        brand: 'Uber',
                        faceValue: '50',
                        credentialProfile: 'claim_code',
                        primaryCode: 'NAADXYHDQR65U8LY',
                        confidence: 0.9,
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      })));
    const csrfToken = await setupOwner();

    const response = await postWithCsrf('/api/ai-import/analyze', csrfToken).send({
      text: 'Lowes\t250\t\t6006491727039277301\t7640\t05/02/2026\nUber\t50\t\tNAAD XYHD QR65 U8LY',
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      provider: 'google',
      model: 'gemini-2.5-flash',
      rows: [
        {
          brand: 'Lowes',
          faceValue: '250',
          credentialProfile: 'merchant_number_pin',
          primaryCode: '6006491727039277301',
          secondaryCode: '7640',
          notes: 'Memo: 05/02/2026',
        },
        {
          brand: 'Uber',
          faceValue: '50',
          credentialProfile: 'claim_code',
          primaryCode: 'NAADXYHDQR65U8LY',
        },
      ],
    });
    const auditRows = db.prepare("SELECT * FROM audit_log WHERE action = 'ai_import.analyze'").all();
    expect(auditRows).toHaveLength(1);
    expect(JSON.stringify(auditRows)).not.toContain('6006491727039277301');
    expect(JSON.stringify(auditRows)).not.toContain('NAAD');
  });

  it('returns a clear error when no AI provider key is configured', async () => {
    delete process.env.GC_AI_GOOGLE_API_KEY;
    const csrfToken = await setupOwner();

    const response = await postWithCsrf('/api/ai-import/analyze', csrfToken).send({
      text: 'DoorDash 100 ABCD',
    });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('AI_IMPORT_NOT_CONFIGURED');
  });
});
