import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/index.js';

describe('AI import routes', () => {
  const appOrigin = 'http://localhost:5173';
  let db;
  let agent;
  let originalAiEnv;

  beforeEach(() => {
    db = openDatabase({ filename: ':memory:' });
    agent = request.agent(createApp({ db }));
    originalAiEnv = {
      GC_AI_GOOGLE_API_KEY: process.env.GC_AI_GOOGLE_API_KEY,
      GC_AI_GOOGLE_MODEL: process.env.GC_AI_GOOGLE_MODEL,
      GC_AI_OPENROUTER_API_KEY: process.env.GC_AI_OPENROUTER_API_KEY,
      GC_AI_OPENROUTER_MODEL: process.env.GC_AI_OPENROUTER_MODEL,
      GC_AI_GROQ_API_KEY: process.env.GC_AI_GROQ_API_KEY,
      GC_AI_GROQ_MODEL: process.env.GC_AI_GROQ_MODEL,
    };
  });

  afterEach(() => {
    db.close();
    for (const [key, value] of Object.entries(originalAiEnv)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
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
                        brand: 'Card',
                        faceValue: '',
                        credentialProfile: 'merchant_number_pin',
                        primaryCode: 'Code/PIN',
                        confidence: 0.4,
                      },
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
                        brand: 'Instacart',
                        faceValue: '100',
                        credentialProfile: 'merchant_number_pin',
                        primaryCode: 'NAAFSYC5FE2VFGF4',
                        secondaryCode: 'wrong-pin',
                        confidence: 0.8,
                      },
                      {
                        brand: 'Uber',
                        faceValue: '50',
                        credentialProfile: 'claim_code',
                        primaryCode: 'NAAD XYHD QR65 U8LY',
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
      diagnostics: {
        candidatesReturned: 4,
        rowsAccepted: 3,
        rowsDiscarded: 1,
      },
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
          brand: 'Instacart',
          faceValue: '100',
          credentialProfile: 'claim_code',
          primaryCode: 'NAAFSYC5FE2VFGF4',
          secondaryCode: '',
        },
        {
          brand: 'Uber',
          faceValue: '50',
          credentialProfile: 'claim_code',
          primaryCode: 'NAAD XYHD QR65 U8LY',
        },
      ],
    });
    const auditRows = db.prepare("SELECT * FROM audit_log WHERE action = 'ai_import.analyze'").all();
    expect(auditRows).toHaveLength(1);
    const metadata = JSON.parse(auditRows[0].metadata);
    expect(metadata).toMatchObject({
      outcome: 'success',
      provider: 'google',
      model: 'gemini-2.5-flash',
      rowCount: 3,
      candidatesReturned: 4,
      rowsDiscarded: 1,
      textLength: expect.any(Number),
      instructionLength: 0,
      previousRowCount: 0,
      elapsedMs: expect.any(Number),
    });
    expect(JSON.stringify(auditRows)).not.toContain('6006491727039277301');
    expect(JSON.stringify(auditRows)).not.toContain('NAAD');

    const auditResponse = await agent.get('/api/audit').query({
      entityType: 'import',
      action: 'ai_import.analyze',
    });
    expect(auditResponse.status).toBe(200);
    expect(auditResponse.body.data[0].metadataSummary).toMatch(/success via google\/gemini-2\.5-flash.*3 rows/);
    expect(JSON.stringify(auditResponse.body)).not.toContain('6006491727039277301');
    expect(JSON.stringify(auditResponse.body)).not.toContain('NAAD');
  });

  it('returns a clear error when no AI provider key is configured', async () => {
    delete process.env.GC_AI_GOOGLE_API_KEY;
    delete process.env.GC_AI_OPENROUTER_API_KEY;
    delete process.env.GC_AI_GROQ_API_KEY;
    const csrfToken = await setupOwner();

    const response = await postWithCsrf('/api/ai-import/analyze', csrfToken).send({
      text: 'DoorDash 100 ABCD',
    });

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('AI_IMPORT_NOT_CONFIGURED');
    const auditRows = db.prepare("SELECT * FROM audit_log WHERE action = 'ai_import.analyze'").all();
    expect(auditRows).toHaveLength(1);
    const metadata = JSON.parse(auditRows[0].metadata);
    expect(metadata).toMatchObject({
      outcome: 'failure',
      errorCode: 'AI_IMPORT_NOT_CONFIGURED',
      errorStatus: 503,
      textLength: expect.any(Number),
      elapsedMs: expect.any(Number),
    });
    expect(JSON.stringify(auditRows)).not.toContain('ABCD');
  });

  it('accepts network prepaid AI rows with missing brand and security-code aliases without storing the security code', async () => {
    process.env.GC_AI_GOOGLE_API_KEY = 'test-google-key';
    process.env.GC_AI_GOOGLE_MODEL = 'gemini-2.5-flash';
    delete process.env.GC_AI_OPENROUTER_API_KEY;
    delete process.env.GC_AI_GROQ_API_KEY;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  cards: [
                    {
                      brand: '',
                      balance: '$800.00',
                      number: '5274 8000 0000 1425',
                      exp: '11/2026',
                      cvv: '123',
                      confidence: 0.92,
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
      text: [
        'Card 1 (ending 1425)',
        '- Number: 5274 8000 0000 1425',
        '- CVV: 123',
        '- Exp: 11/2026',
        '- Balance: $800.00',
      ].join('\n'),
    });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      provider: 'google',
      model: 'gemini-2.5-flash',
      diagnostics: {
        candidatesReturned: 1,
        rowsAccepted: 1,
        rowsDiscarded: 0,
      },
      rows: [
        {
          brand: 'Mastercard',
          faceValue: '800.00',
          credentialProfile: 'network_prepaid',
          primaryCode: '5274 8000 0000 1425',
          secondaryCode: '',
          expirationMonth: '11',
          expirationYear: '2026',
          networkSecurityCode: '123',
        },
      ],
    });
    expect(response.body.data.rows[0].warnings.join(' ')).toMatch(/Security code was parsed for local encrypted storage/i);
    const auditRows = db.prepare("SELECT * FROM audit_log WHERE action = 'ai_import.analyze' ORDER BY id DESC LIMIT 1").all();
    expect(JSON.stringify(auditRows)).not.toContain('123');
  });

  it('enriches network prepaid rows from labeled pasted text when the AI omits CVV and expiration fields', async () => {
    process.env.GC_AI_GOOGLE_API_KEY = 'test-google-key';
    process.env.GC_AI_GOOGLE_MODEL = 'gemini-2.5-flash';
    delete process.env.GC_AI_OPENROUTER_API_KEY;
    delete process.env.GC_AI_GROQ_API_KEY;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  cards: [
                    {
                      brand: '',
                      balance: '$800.00',
                      number: '5274 8000 0000 1425',
                      notes: 'Expiration: 11/2026',
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
      text: [
        'Card 1 (ending 1425)',
        '- Number: 5274 8000 0000 1425',
        '- CVV: 987',
        '- Exp: 11/2026',
        '- Balance: $800.00',
      ].join('\n'),
    });

    expect(response.status).toBe(200);
    expect(response.body.data.rows).toEqual([
      expect.objectContaining({
        brand: 'Mastercard',
        faceValue: '800.00',
        credentialProfile: 'network_prepaid',
        primaryCode: '5274 8000 0000 1425',
        expirationMonth: '11',
        expirationYear: '2026',
        networkSecurityCode: '987',
        notes: '',
      }),
    ]);
    expect(response.body.data.rows[0].warnings.join(' ')).toMatch(/Security code was parsed for local encrypted storage/i);
    const auditRows = db.prepare("SELECT * FROM audit_log WHERE action = 'ai_import.analyze' ORDER BY id DESC LIMIT 1").all();
    expect(JSON.stringify(auditRows)).not.toContain('987');
  });

  it('preserves mixed-case AI codes and detects claim-link URLs', async () => {
    process.env.GC_AI_GOOGLE_API_KEY = 'test-google-key';
    process.env.GC_AI_GOOGLE_MODEL = 'gemini-2.5-flash';
    delete process.env.GC_AI_OPENROUTER_API_KEY;
    delete process.env.GC_AI_GROQ_API_KEY;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  cards: [
                    {
                      brand: 'Mixed Store',
                      faceValue: '25',
                      credentialProfile: 'claim_code',
                      primaryCode: 'AbCd ef-12',
                      confidence: 0.92,
                    },
                    {
                      brand: 'Link Store',
                      faceValue: '50',
                      credentialProfile: 'claim_code',
                      primaryCode: 'https://claims.example.com/Claim/AbCdEf?token=xYz',
                      confidence: 0.92,
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
      text: 'Mixed Store 25 AbCd ef-12\nLink Store 50 https://claims.example.com/Claim/AbCdEf?token=xYz',
    });

    expect(response.status).toBe(200);
    expect(response.body.data.rows).toEqual([
      expect.objectContaining({
        brand: 'Mixed Store',
        credentialProfile: 'claim_code',
        primaryCode: 'AbCd ef-12',
      }),
      expect.objectContaining({
        brand: 'Link Store',
        credentialProfile: 'claim_link',
        primaryCode: 'https://claims.example.com/Claim/AbCdEf?token=xYz',
      }),
    ]);
    expect(response.body.data.rows[0].warnings.join(' ')).toMatch(/mixed uppercase\/lowercase/i);
    expect(response.body.data.rows[1].warnings.join(' ')).not.toMatch(/mixed uppercase\/lowercase/i);
  });

  it('returns safe provider failure details when every AI response is unusable', async () => {
    process.env.GC_AI_GOOGLE_API_KEY = 'test-google-key';
    process.env.GC_AI_GOOGLE_MODEL = 'gemini-2.5-flash';
    delete process.env.GC_AI_OPENROUTER_API_KEY;
    delete process.env.GC_AI_GROQ_API_KEY;
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify({ cards: [] }) }],
          },
        },
      ],
    })));
    const csrfToken = await setupOwner();

    const response = await postWithCsrf('/api/ai-import/analyze', csrfToken).send({
      text: 'Card without a usable code',
    });

    expect(response.status).toBe(503);
    expect(response.body.error).toMatchObject({
      code: 'AI_IMPORT_FAILED',
      details: {
        providersTried: ['google'],
        providerFailures: [
          expect.stringMatching(/google: provider response did not match the expected card schema/i),
        ],
      },
    });
  });
});
