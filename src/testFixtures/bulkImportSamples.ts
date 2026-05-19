export const uberSpreadsheetContinuation = [
  'Uber\t50\t\tNAAD XYHD QR65 U8LY\t\t',
  '\t\t\tNAAD X373 WSR8 UBNH\t\t',
  '\t\t\tNAAD XBYA JWGS DTCB\t\t',
  '\t\t\tNAAD XY8E S59A 839G\t\t',
  '\t\t\tNAAD XM6R 48DQ 5TZA\t\t',
  '\t\t\tNAAD XDFP HDEN LH3Z\t\t',
  '\t\t\tNAAD XAX6 RZXM RXU8\t\t',
  '\t\t\tNAAD XUP5 8VDB ZV93\t\t',
].join('\n');

export const expectedUberContinuationRows = [
  'NAAD XYHD QR65 U8LY',
  'NAAD X373 WSR8 UBNH',
  'NAAD XBYA JWGS DTCB',
  'NAAD XY8E S59A 839G',
  'NAAD XM6R 48DQ 5TZA',
  'NAAD XDFP HDEN LH3Z',
  'NAAD XAX6 RZXM RXU8',
  'NAAD XUP5 8VDB ZV93',
].map((primaryCode) => ({
  brand: 'Uber',
  faceValue: '50',
  credentialProfile: 'claim_code',
  primaryCode,
  secondaryCode: '',
}));

export const mixedAiImportText = [
  'Lowes\t250\t\t6006491727039277301\t7640\t05/02/2026',
  'Uber\t50\t\tNAAD XYHD QR65 U8LY',
].join('\n');
