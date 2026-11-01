// Opt-in live evaluation. Uses only synthetic data and the configured custom provider.
import assert from 'node:assert/strict';
import { analyzeGiftCardsWithAi } from '../server/aiImport.js';

const model = process.argv[2] || process.env.GC_AI_CUSTOM_MODEL;
if (!model || !process.env.GC_AI_CUSTOM_API_KEY || !process.env.GC_AI_CUSTOM_BASE_URL) {
  throw new Error('Configure the custom AI provider before running this opt-in live evaluation.');
}

const cases = [
  {
    name: 'mixed credentials',
    text: [
      'Synthetic test data only. Preserve every credential exactly.',
      'Amazon $25 claim code AbC-00xy-Z9',
      'Target $50 card number 0000123456789012 PIN 0042',
      'Visa prepaid $100 card number 4111111111111111 expiration 09/2029 CVV 007 billing ZIP 00123',
      'DoorDash $30 claim link https://example.com/redeem?token=AbC123&x=09',
    ].join('\n'),
    expected: [
      { primaryCode: 'AbC-00xy-Z9', faceValue: '25' },
      { primaryCode: '0000123456789012', secondaryCode: '0042', faceValue: '50' },
      { primaryCode: '4111111111111111', networkSecurityCode: '007', expirationMonth: '09', expirationYear: '2029', billingZip: '00123' },
      { primaryCode: 'https://example.com/redeem?token=AbC123&x=09', credentialProfile: 'claim_link' },
    ],
  },
  {
    name: 'spreadsheet continuations',
    text: [
      'Synthetic test data only. Empty brand cells continue the previous brand.',
      'Brand\tValue\tCode\tPIN',
      'Uber\t25\tMixEd Aa00 bB11\t',
      '\t25\t0000 Zz99 AbCd\t',
      'Target\t50\t0000987654321012\t0009',
    ].join('\n'),
    expected: [
      { brand: 'Uber', primaryCode: 'MixEd Aa00 bB11', faceValue: '25' },
      { brand: 'Uber', primaryCode: '0000 Zz99 AbCd', faceValue: '25' },
      { brand: 'Target', primaryCode: '0000987654321012', secondaryCode: '0009', faceValue: '50' },
    ],
  },
];

for (const sample of cases) {
  const started = Date.now();
  const result = await analyzeGiftCardsWithAi(sample.text, { modelSelection: `custom:${encodeURIComponent(model)}` });
  assert.equal(result.rows.length, sample.expected.length, `${sample.name}: row count`);
  for (const expected of sample.expected) {
    const row = result.rows.find(value => value.primaryCode === expected.primaryCode);
    assert.ok(row, `${sample.name}: missing credential`);
    for (const [field, value] of Object.entries(expected)) {
      assert.equal(row[field as keyof typeof row], value, `${sample.name}: ${field}`);
    }
  }
  console.log(JSON.stringify({ case: sample.name, model: result.model, rows: result.rows.length, elapsedMs: Date.now() - started, passed: true }));
}
