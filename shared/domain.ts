export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type UnknownRecord = Record<string, unknown>;

export interface Page {
  limit: number;
  offset: number;
  total: number;
  hasMore: boolean;
}

export type UserRole = 'owner' | 'admin' | 'operator' | 'viewer';

export interface FeatureFlags {
  plaintextJsonExport: boolean;
  rawDatabaseExport: boolean;
  csvImport: boolean;
  referenceValueHints: boolean;
  networkSecurityCodeStorage: boolean;
}

export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string;
  role: UserRole;
  disabledAt?: string | null;
  lastLoginAt?: string | null;
}

export interface AuthState {
  setupRequired?: boolean;
  setupComplete?: boolean;
  authenticated?: boolean;
  locked?: boolean;
  sessionValid?: boolean;
  dekLoaded?: boolean;
  csrfToken?: string | null;
  user?: AuthUser | null;
  features?: Partial<FeatureFlags>;
  recoveryCodes?: {
    activeCount?: number;
  };
  passkeys?: {
    count?: number;
  };
}

export interface PasskeyCredential {
  id: string;
  name?: string | null;
  createdAt?: string | null;
  lastUsedAt?: string | null;
  transports?: string[];
  deviceType?: string | null;
  backedUp?: boolean;
}

export type McpScope =
  | 'cards:read'
  | 'cards:create'
  | 'cards:update'
  | 'cards:delete'
  | 'cards:lifecycle'
  | 'cards:reveal'
  | 'deals:read'
  | 'deals:write'
  | 'reference:read'
  | 'reference:write';

export interface McpToken {
  id: string;
  name: string;
  tokenHint: string;
  scopes: McpScope[];
  expiresAt?: string | null;
  revokedAt?: string | null;
  lastUsedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  token?: string;
}

export interface McpTokenSettings {
  tokens: McpToken[];
  scopes: McpScope[];
  presets: Record<string, McpScope[]>;
}

export interface UserInvite {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
  expiresAt?: string | null;
  inviteCode?: string;
}

export interface BackupSettings {
  allowPlaintextExport: boolean;
  plaintextExportPolicyLocked: boolean;
  backupReminderDays: number;
  backupReminderDue: boolean;
  lastBackupAt: string | null;
  nextBackupDueAt: string | null;
  lastPlaintextExportAt: string | null;
  lastEncryptedExportAt: string | null;
  lastRawDatabaseExportAt: string | null;
}

export interface SupportPolicy {
  supportAccessEnabled: boolean;
  supportContact: string;
  supportPolicyUrl: string;
  supportNotes: string;
  supportUpdatedAt: string | null;
  supportUpdatedByUserId: string | null;
}

export interface DataPolicy {
  auditRetentionDays: number;
  idempotencyRetentionDays: number;
  sessionRetentionDays: number;
  loginAttemptRetentionDays: number;
}

export type CardStatus = 'available' | 'reserved' | 'in_use' | 'sold' | 'used_up' | 'void';
export type CardType = 'merchant' | 'prepaid' | 'custom';
export type CredentialProfile =
  | 'claim_code'
  | 'claim_link'
  | 'merchant_number_pin'
  | 'barcode'
  | 'network_prepaid'
  | 'custom';
export type BarcodeFormat = 'code128' | 'qr' | 'ean13' | 'upca' | 'pdf417' | 'aztec' | 'data_matrix' | 'other';
export type CredentialFieldKind =
  | 'primary_code'
  | 'card_number'
  | 'pin'
  | 'access_code'
  | 'barcode_value'
  | 'expiration_month'
  | 'expiration_year'
  | 'network_security_code'
  | 'billing_postal_code'
  | 'cardholder_name'
  | 'billing_address'
  | 'metadata';

export interface CredentialField {
  fieldKey: string;
  label: string;
  fieldKind: CredentialFieldKind;
  value?: string | null;
  copyable?: boolean;
  barcodeFormat?: BarcodeFormat | string | null;
  sortOrder?: number;
}

export interface CredentialSummary {
  primaryLabel?: string | null;
  primaryHint?: string | null;
  primaryLast4?: string | null;
}

export interface RevealedCredentials {
  cardNumber?: string | null;
  pin?: string | null;
  billingZip?: string | null;
  credentials?: {
    profile?: CredentialProfile | string;
    fields?: CredentialField[];
  };
}

export interface Usage {
  id: string;
  merchant?: string | null;
  amountCents: number;
  usageDate?: string | null;
  isWriteOff?: boolean;
  isReversed?: boolean;
  reversedAt?: string | null;
  reversalReason?: string | null;
}

export interface Transaction {
  id: string;
  type: string;
  buyerName?: string | null;
  platform?: string | null;
  salePriceCents?: number | null;
}

export interface AuditEvent {
  id: string;
  timestamp?: string | null;
  createdAt?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  action: string;
  requestId?: string | null;
  metadataSummary?: string | null;
}

export interface Card {
  id: string;
  brand: string;
  status: CardStatus;
  cardType: CardType | string;
  network?: string | null;
  credentialProfile?: CredentialProfile | string | null;
  credentialSummary?: CredentialSummary | null;
  cardNumberLast4?: string | null;
  source?: string | null;
  expirationDate?: string | null;
  format?: string | null;
  notes?: string | null;
  rowVersion: number;
  faceValueCents: number;
  remainingBalanceCents: number;
  purchaseCostCents: number;
  updatedAt?: string | null;
  latestSalePriceCents?: number | null;
  reservedFor?: string | null;
  reservedUntil?: string | null;
  reservedNotes?: string | null;
}

export interface CardDetail {
  card: Card;
  transactions?: Transaction[];
  usages?: Usage[];
  audit?: AuditEvent[];
}

export interface Deal {
  id: string;
  name: string;
  source?: string | null;
  purchaseDate?: string | null;
  inputTotalCostCents?: number | null;
  archivedAt?: string | null;
  notes?: string | null;
  rowVersion?: number;
}

export interface DealDetail {
  deal: Deal;
  cards?: Card[];
}

export interface CardInventorySummary {
  activeRemainingCents: number;
  activeCostBasisCents: number;
  activeGrossMarginCents: number;
  availableFaceCents: number;
  reservedRemainingCents: number;
  inUseRemainingCents: number;
  soldProceedsCents: number;
  soldCostBasisCents: number;
  realizedProfitCents: number;
  expiringSoonRemainingCents: number;
  prepaidRemainingCents: number;
  staleReservationCount: number;
  trackedCards: number;
  activeCards: number;
  availableCards: number;
  reservedCards: number;
  inUseCards: number;
  soldCards: number;
  usedUpCards: number;
  voidCards: number;
  updatedAt?: string;
}

export interface ReferenceValue {
  id?: string | number;
  type: ReferenceValueType;
  value: string;
  usageCount?: number;
  lastUsedAt?: string | null;
}

export type ReferenceValueType = 'deal_name' | 'source' | 'card_brand';

export type ReferenceValueState = Record<ReferenceValueType, ReferenceValue[]>;

export interface ReferenceReviewItem {
  key: string;
  field: 'name' | 'source' | 'cardBrand';
  type: ReferenceValueType;
  label: string;
  value: string;
  suggestions: ReferenceValue[];
}

export interface CardSearchCriteria {
  cardNumber?: string;
  status?: string;
  cardType?: string;
  activeOnly?: string | boolean;
  brand?: string;
  source?: string;
  dealId?: string;
  dealName?: string;
  expiresBefore?: string;
  text?: string;
  sortBy?: string;
  sortDir?: string;
  limit?: number | string;
  offset?: number;
}

export interface AuditCriteria {
  entityType?: string;
  action?: string;
  from?: string;
  to?: string;
}

export interface ApiErrorPayload {
  code?: string;
  message?: string;
  requestId?: string | null;
  fieldErrors?: UnknownRecord[];
  details?: unknown;
}

export interface ApiResponse<T = unknown> {
  data: T;
  page?: Page;
  error?: ApiErrorPayload;
}
