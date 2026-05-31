import { describe, expect, it } from 'vitest';
import {
  analyzeBulkImportText,
  bulkImportMissingFields,
  bulkImportRowsToDealPayload,
  bulkImportRowToDealPayload,
  canUppercaseBulkImportPrimaryCode,
} from './bulkImport';
import { defaultReferenceValues } from './referenceValues';
import {
  expectedUberContinuationRows,
  uberSpreadsheetContinuation,
} from './testFixtures/bulkImportSamples';

function firstRow(text: string) {
  const row = analyzeBulkImportText(text, defaultReferenceValues).rows[0];
  if (!row) {
    throw new Error('Expected one parsed row.');
  }
  return row;
}

describe('bulk gift-card import parser', () => {
  it('parses brand value and single code from loose text', () => {
    const row = firstRow('Doordash 50 abcd');

    expect(row).toMatchObject({
      brand: 'DoorDash',
      faceValue: '50',
      credentialProfile: 'claim_code',
      primaryCode: 'abcd',
    });
    expect(bulkImportMissingFields(row)).toEqual([]);
  });

  it('parses merchant number plus PIN from loose text', () => {
    const row = firstRow('Bestbuy $50 abcd ef');

    expect(row).toMatchObject({
      brand: 'Best Buy',
      faceValue: '50',
      credentialProfile: 'merchant_number_pin',
      primaryCode: 'abcd',
      secondaryCode: 'ef',
    });
    expect(bulkImportMissingFields(row)).toEqual([]);
  });

  it('parses tab-separated spreadsheet rows', () => {
    const row = firstRow('Doordash\t50\tabcd');

    expect(row).toMatchObject({
      brand: 'DoorDash',
      faceValue: '50',
      primaryCode: 'abcd',
    });
  });

  it('inherits brand and value for tab-indented code-only continuation rows', () => {
    const rows = analyzeBulkImportText(uberSpreadsheetContinuation, defaultReferenceValues).rows;

    expect(rows).toHaveLength(8);
    expect(rows.map((row) => ({
      brand: row.brand,
      faceValue: row.faceValue,
      credentialProfile: row.credentialProfile,
      primaryCode: row.primaryCode,
      secondaryCode: row.secondaryCode,
    }))).toEqual(expectedUberContinuationRows);
    expect(rows.flatMap((row) => bulkImportMissingFields(row))).toEqual([]);
  });

  it('keeps missing brand and value editable for code plus password rows', () => {
    const row = firstRow('abcd ef');

    expect(row).toMatchObject({
      brand: '',
      faceValue: '',
      credentialProfile: 'merchant_number_pin',
      primaryCode: 'abcd',
      secondaryCode: 'ef',
    });
    expect(bulkImportMissingFields(row)).toEqual(['brand', 'face value']);
  });

  it('keeps missing value editable for brand plus code rows', () => {
    const row = firstRow('Doordash abcd');

    expect(row).toMatchObject({
      brand: 'DoorDash',
      faceValue: '',
      credentialProfile: 'claim_code',
      primaryCode: 'abcd',
    });
    expect(bulkImportMissingFields(row)).toEqual(['face value']);
  });

  it('treats unknown loose brand value code rows as brand value code', () => {
    const row = firstRow('sdfdasf 33 323');

    expect(row).toMatchObject({
      brand: 'sdfdasf',
      faceValue: '33',
      credentialProfile: 'claim_code',
      primaryCode: '323',
      secondaryCode: '',
    });
    expect(bulkImportMissingFields(row)).toEqual([]);
  });

  it('parses header CSV and builds an insert payload', () => {
    const payload = bulkImportRowToDealPayload(firstRow('brand,value,code,pin\nBest Buy,50,abcd,ef'));

    expect(payload).toMatchObject({
      cards: [
        {
          brand: 'Best Buy',
          credentialProfile: 'merchant_number_pin',
          cardNumber: 'abcd',
          pin: 'ef',
          faceValueCents: 5000,
        },
      ],
    });
  });

  it('recognizes card_brand CSV headers', () => {
    const row = firstRow('card_brand,face_value,redemption_code\nDoorDash,25,DD-25');

    expect(row).toMatchObject({
      brand: 'DoorDash',
      faceValue: '25',
      credentialProfile: 'claim_code',
      primaryCode: 'DD-25',
    });
  });

  it('builds one atomic multi-card deal payload for a batch', () => {
    const rows = analyzeBulkImportText('Doordash 50 abcd\nBestbuy $50 card pin', defaultReferenceValues).rows;
    const payload = bulkImportRowsToDealPayload(rows);

    expect(payload).toMatchObject({
      name: 'Bulk import',
      cards: [
        {
          brand: 'DoorDash',
          credentialProfile: 'claim_code',
          redemptionCode: 'abcd',
          faceValueCents: 5000,
        },
        {
          brand: 'Best Buy',
          credentialProfile: 'merchant_number_pin',
          cardNumber: 'card',
          pin: 'pin',
          faceValueCents: 5000,
        },
      ],
    });
  });

  it('parses barcode CSV rows with source and notes', () => {
    const payload = bulkImportRowToDealPayload(firstRow(
      'brand,value,profile,barcode,barcode_format,source,notes\nStarbucks,15,barcode,123456789012,qr,Promo,Mobile wallet',
    ));

    expect(payload).toMatchObject({
      cards: [
        {
          brand: 'Starbucks',
          credentialProfile: 'barcode',
          barcodeValue: '123456789012',
          barcodeFormat: 'qr',
          source: 'Promo',
          notes: 'Mobile wallet',
          credentials: {
            fields: [
              expect.objectContaining({
                fieldKind: 'barcode_value',
                barcodeFormat: 'qr',
              }),
            ],
          },
        },
      ],
    });
  });

  it('parses claim-link CSV rows and keeps URL casing untouched', () => {
    const claimLink = 'https://claims.example.com/Claim/AbCdEf?token=xYz-123';
    const row = firstRow(`brand,value,profile,claim_link\nExample Store,50,claim_link,${claimLink}`);
    const payload = bulkImportRowToDealPayload(row);

    expect(row).toMatchObject({
      brand: 'Example Store',
      faceValue: '50',
      credentialProfile: 'claim_link',
      primaryCode: claimLink,
    });
    expect(bulkImportMissingFields(row)).toEqual([]);
    expect(payload).toMatchObject({
      cards: [
        {
          brand: 'Example Store',
          credentialProfile: 'claim_link',
          primaryCode: claimLink,
          claimLink,
          credentials: {
            profile: 'claim_link',
            fields: [
              expect.objectContaining({
                fieldKey: 'claim_link',
                label: 'Claim link',
                fieldKind: 'primary_code',
                value: claimLink,
              }),
            ],
          },
        },
      ],
    });
  });

  it('offers uppercase correction only for mixed-case non-URL codes', () => {
    expect(canUppercaseBulkImportPrimaryCode(firstRow('Doordash 50 AbCd-12'))).toBe(true);
    expect(canUppercaseBulkImportPrimaryCode(firstRow('Doordash 50 ABCD-12'))).toBe(false);

    const claimLink = firstRow('brand,value,profile,claim_link\nExample Store,50,https://claims.example.com/Claim/AbCd');
    expect(canUppercaseBulkImportPrimaryCode(claimLink)).toBe(false);
  });

  it('parses network prepaid CSV rows with expiration, security code, and billing ZIP', () => {
    const payload = bulkImportRowToDealPayload(firstRow(
      'brand,value,profile,card_number,exp_month,exp_year,cvv,zip\nVisa,100,network_prepaid,4111111111111111,08,2028,123,94105',
    ));

    expect(payload).toMatchObject({
      cards: [
        {
          brand: 'Visa',
          cardType: 'prepaid',
          credentialProfile: 'network_prepaid',
          network: 'visa',
          cardNumber: '4111111111111111',
          networkSecurityCode: '123',
          billingZip: '94105',
          credentials: {
            fields: expect.arrayContaining([
              expect.objectContaining({ fieldKind: 'card_number', value: '4111111111111111' }),
              expect.objectContaining({ fieldKind: 'expiration_month', value: '08' }),
              expect.objectContaining({ fieldKind: 'expiration_year', value: '2028' }),
              expect.objectContaining({ fieldKind: 'network_security_code', value: '123' }),
              expect.objectContaining({ fieldKind: 'billing_postal_code', value: '94105' }),
            ]),
          },
          faceValueCents: 10000,
        },
      ],
    });
  });
});
