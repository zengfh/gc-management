import { describe, expect, it } from 'vitest';
import {
  analyzeBulkImportText,
  bulkImportMissingFields,
  bulkImportRowsToDealPayload,
  bulkImportRowToDealPayload,
} from './bulkImport';
import { defaultReferenceValues } from './referenceValues';

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
});
