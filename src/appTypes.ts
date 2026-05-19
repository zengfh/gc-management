import type {
  AuditCriteria,
  AuditEvent,
  ApiResponse,
  AuthState,
  AuthUser,
  BackupSettings,
  Card,
  CardDetail,
  CardSearchCriteria,
  CredentialFieldKind,
  CredentialProfile,
  DataPolicy,
  Deal,
  DealDetail,
  FeatureFlags,
  Page,
  ReferenceValue,
  ReferenceValueState,
  RevealedCredentials,
  SupportPolicy,
  UserInvite,
} from '../shared/domain';
import type { BulkImportAnalysis } from './bulkImport';

export type ViewId = 'dashboard' | 'cards' | 'deals' | 'backup' | 'audit' | 'settings';

export interface CountSummary {
  cards?: number;
  deals?: number;
  auditLog?: number;
  idempotencyKeys?: number;
}

export interface PortableExportPayload {
  exportedAt?: string;
  cards?: Card[];
  counts?: CountSummary;
}

export interface ImportSummary {
  mode: string;
  cardCount: number;
  dealCount: number;
}

export interface CsvImportResult {
  cards: Card[];
}

export interface CsvPreviewRow {
  rowNumber: number;
  valid: boolean;
  parsed?: {
    brand?: string;
    cardType?: string;
    faceValueCents?: number;
    purchaseCostCents?: number;
    credentialHint?: string;
    credentialLabel?: string;
    hasPin?: boolean;
    hasBillingZip?: boolean;
  };
  errors?: Array<{ field: string; code: string; message: string }>;
}

export interface CsvPreviewPayload {
  summary: {
    validCount: number;
    invalidCount: number;
    rowCount: number;
  };
  rows: CsvPreviewRow[];
}

export interface DealMutationResult {
  deal: Deal;
  cards: Card[];
}

export interface CardMutationResult {
  card: Card;
}

export interface AddDealCustomField {
  id: string;
  label: string;
  fieldKind: CredentialFieldKind;
  value: string;
}

export interface AddDealFormState {
  name: string;
  source: string;
  totalCost: string;
  cardBrand: string;
  faceValue: string;
  credentialProfile: CredentialProfile;
  profileTouched: boolean;
  cardNumber: string;
  redemptionCode: string;
  pin: string;
  accessCode: string;
  barcodeValue: string;
  barcodeFormat: string;
  expirationMonth: string;
  expirationYear: string;
  networkSecurityCode: string;
  saveNetworkSecurityCode: boolean;
  billingZip: string;
  cardholderName: string;
  billingAddress: string;
  customFields: AddDealCustomField[];
}

export interface CardDetailState {
  card: Card;
  data?: CardDetail | null;
  error?: string;
  loading: boolean;
}

export interface DealDetailState {
  deal: Deal;
  data?: DealDetail | null;
  error?: string;
  loading: boolean;
}

export type ApiPayload = Record<string, unknown>;
export type AsyncApiHandler<TPayload = ApiPayload, TResult = unknown> = (payload: TPayload) => Promise<TResult>;
export type VoidHandler = () => void;

export interface CardSalePayload extends ApiPayload {
  salePriceCents: number;
}

export interface WorkSurfaceProps {
  auth: AuthState;
  cards: Card[];
  cardsPage: Page;
  deals: Deal[];
  auditEvents: AuditEvent[];
  auditLoading: boolean;
  auditError: string;
  backupSettings: BackupSettings;
  backupSettingsLoading: boolean;
  backupSettingsLoaded: boolean;
  backupSettingsError: string;
  users: AuthUser[];
  userInvites: UserInvite[];
  usersLoading: boolean;
  usersLoaded: boolean;
  usersError: string;
  supportPolicy: SupportPolicy;
  supportPolicyLoading: boolean;
  supportPolicyLoaded: boolean;
  supportPolicyError: string;
  dataPolicy: DataPolicy;
  dataPolicyLoading: boolean;
  dataPolicyLoaded: boolean;
  dataPolicyError: string;
  features?: FeatureFlags;
  referenceValues: ReferenceValueState;
  loading: boolean;
  onRefresh: () => Promise<unknown>;
  onLogout: () => Promise<unknown>;
  onLoadAudit: (criteria?: AuditCriteria) => Promise<unknown>;
  onLoadBackupSettings: () => Promise<unknown>;
  onLoadUsers: () => Promise<unknown>;
  onLoadSupportPolicy: () => Promise<unknown>;
  onLoadDataPolicy: () => Promise<unknown>;
  onCreateInvite: AsyncApiHandler<ApiPayload, UserInvite>;
  onRevokeInvite: (inviteId: string) => Promise<UserInvite>;
  onUpdateUser: (userId: string, payload: ApiPayload) => Promise<AuthUser>;
  onUpdateSupportPolicy: AsyncApiHandler<ApiPayload, ApiResponse<SupportPolicy>>;
  onUpdateDataPolicy: AsyncApiHandler<ApiPayload, ApiResponse<DataPolicy>>;
  onExportAccountData: AsyncApiHandler<ApiPayload, ApiResponse<PortableExportPayload>>;
  onRunRetention: AsyncApiHandler<ApiPayload, ApiResponse<{ counts?: CountSummary }>>;
  onDeleteAccountData: AsyncApiHandler<ApiPayload, ApiResponse<{ counts?: CountSummary }>>;
  onUpdateBackupSettings: AsyncApiHandler<ApiPayload, ApiResponse<BackupSettings>>;
  onExportPlaintext: AsyncApiHandler<ApiPayload, ApiResponse<PortableExportPayload>>;
  onExportEncrypted: AsyncApiHandler<ApiPayload, ApiResponse<PortableExportPayload>>;
  onExportRawDatabase: AsyncApiHandler<ApiPayload, { blob: Blob; filename: string | null }>;
  onPreviewCsv: AsyncApiHandler<{ csv: string }, ApiResponse<CsvPreviewPayload>>;
  onConfirmCsv: AsyncApiHandler<{ csv: string }, ApiResponse<CsvImportResult>>;
  onAnalyzeAiImport: AsyncApiHandler<{ text: string }, ApiResponse<BulkImportAnalysis & { provider?: string; model?: string }>>;
  onImportBackup: AsyncApiHandler<ApiPayload, ApiResponse<{ summary: ImportSummary }>>;
  onChangeUnlockSecret: AsyncApiHandler<ApiPayload, ApiResponse<unknown>>;
  onGenerateRecoveryCodes: AsyncApiHandler<{ currentUnlockSecret: string }, { codes: string[]; activeCount: number }>;
  onLoadReferenceValues: () => Promise<ReferenceValueState>;
  onUpsertReferenceValues: (values?: ReferenceValue[]) => Promise<ReferenceValue[]>;
  onCreateDeal: AsyncApiHandler<ApiPayload, unknown>;
  onLoadDeals: (includeArchived: boolean) => Promise<unknown>;
  onEditDeal: (dealId: string, payload: ApiPayload) => Promise<unknown>;
  onArchiveDeal: (deal: Deal, includeArchived: boolean) => Promise<unknown>;
  onUnarchiveDeal: (deal: Deal, includeArchived: boolean) => Promise<unknown>;
  onSearchCards: (criteria?: CardSearchCriteria) => Promise<unknown>;
  onLoadCardDetail: (cardId: string) => Promise<ApiResponse<CardDetail>>;
  onLoadDealDetail: (dealId: string) => Promise<ApiResponse<DealDetail>>;
  onRevealCardCredentials: (cardId: string) => Promise<ApiResponse<RevealedCredentials>>;
  onUseCard: (cardId: string, payload: ApiPayload) => Promise<unknown>;
  onUndoUsage: (cardId: string, payload: ApiPayload) => Promise<ApiResponse<CardMutationResult>>;
  onEditCard: (cardId: string, payload: ApiPayload) => Promise<unknown>;
  onDeleteCard: (cardId: string) => Promise<unknown>;
  onSellCard: (cardId: string, payload: CardSalePayload) => Promise<unknown>;
  onUndoSale: (cardId: string, payload: ApiPayload) => Promise<unknown>;
  onVoidCard: (cardId: string, payload: ApiPayload) => Promise<unknown>;
  onReserveCard: (cardId: string, payload: ApiPayload) => Promise<unknown>;
  onUnreserveCard: (card: Card) => Promise<unknown>;
}
