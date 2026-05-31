import type { Card } from '../shared/domain';

export const credentialProfileOptions = [
  { value: 'claim_code', label: 'Single code / PIN' },
  { value: 'claim_link', label: 'Claim link / URL' },
  { value: 'merchant_number_pin', label: 'Card number + PIN' },
  { value: 'barcode', label: 'Barcode / QR' },
  { value: 'network_prepaid', label: 'Network prepaid card' },
  { value: 'custom', label: 'Custom' },
];

export const customCredentialFieldKinds = [
  { value: 'primary_code', label: 'Secret code' },
  { value: 'card_number', label: 'Card number' },
  { value: 'pin', label: 'PIN' },
  { value: 'barcode_value', label: 'Barcode' },
  { value: 'billing_postal_code', label: 'Billing ZIP' },
  { value: 'cardholder_name', label: 'Name' },
  { value: 'billing_address', label: 'Address' },
  { value: 'metadata', label: 'Note' },
];

const networkBrandPattern = /\b(visa|mastercard|master card|amex|american express|discover|vanilla|serve)\b/i;
const claimCodeBrandPattern = /\b(amazon|apple|doordash|door dash|uber|ubereats|steam|google play|playstation|xbox)\b/i;
const barcodeBrandPattern = /\b(starbucks|dunkin|chipotle|mcdonald|panera)\b/i;

export function inferCredentialProfileForBrand(brand: string): string {
  if (networkBrandPattern.test(brand)) {
    return 'network_prepaid';
  }
  if (barcodeBrandPattern.test(brand)) {
    return 'barcode';
  }
  if (claimCodeBrandPattern.test(brand)) {
    return 'claim_code';
  }
  return 'merchant_number_pin';
}

export function inferNetworkFromBrand(brand: string): string {
  const normalized = String(brand || '').toLowerCase();
  if (normalized.includes('master')) {
    return 'mastercard';
  }
  if (normalized.includes('amex') || normalized.includes('american express')) {
    return 'amex';
  }
  if (normalized.includes('discover')) {
    return 'discover';
  }
  if (normalized.includes('visa') || normalized.includes('vanilla')) {
    return 'visa';
  }
  return 'other';
}

export function credentialSummaryText(card: Pick<Card, 'credentialSummary' | 'cardNumberLast4'> | null | undefined): string {
  const summary = card?.credentialSummary;
  if (summary?.primaryHint) {
    return summary.primaryLabel ? `${summary.primaryLabel}: ${summary.primaryHint}` : summary.primaryHint;
  }
  if (summary?.primaryLast4) {
    return summary.primaryLabel ? `${summary.primaryLabel}: **** ${summary.primaryLast4}` : `**** ${summary.primaryLast4}`;
  }
  if (card?.cardNumberLast4) {
    return `Card number: **** ${card.cardNumberLast4}`;
  }
  return 'Hidden';
}

const barcodeFormatToBcid: Record<string, string> = {
  code128: 'code128',
  qr: 'qrcode',
  ean13: 'ean13',
  upca: 'upca',
  pdf417: 'pdf417',
  aztec: 'azteccode',
  data_matrix: 'datamatrix',
  other: 'code128',
};

export function barcodeSvgDataUri(
  value: string,
  format: string | null | undefined,
  toSvg: (options: Record<string, unknown>) => string,
): string {
  const bcid = barcodeFormatToBcid[format || ''] || barcodeFormatToBcid.other;
  const svg = toSvg({
    bcid,
    text: String(value || ''),
    scale: bcid === 'qrcode' ? 4 : 3,
    height: bcid === 'qrcode' ? undefined : 16,
    paddingwidth: 10,
    paddingheight: 10,
    includetext: false,
  });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
