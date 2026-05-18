import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';

function fetchMock() {
  return vi.mocked(globalThis.fetch);
}

function createObjectUrlMock() {
  return vi.mocked(globalThis.URL.createObjectURL);
}

function jsonResponse(body: unknown, status = 200): Response {
  if (status === 204 || status === 205 || status === 304) {
    return new Response(null, { status });
  }
  return new Response(JSON.stringify(body), { status });
}

function blobResponse(body: BlobPart, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(new Blob([body]), { status, headers });
}

function supportPolicyResponse(overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    data: {
      supportAccessEnabled: false,
      supportContact: '',
      supportPolicyUrl: '',
      supportNotes: '',
      supportUpdatedAt: null,
      supportUpdatedByUserId: null,
      ...overrides,
    },
  });
}

function dataPolicyResponse(overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    data: {
      auditRetentionDays: 365,
      idempotencyRetentionDays: 7,
      sessionRetentionDays: 7,
      loginAttemptRetentionDays: 30,
      ...overrides,
    },
  });
}

describe('App', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders setup and initializes the vault', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: false,
            sessionValid: false,
            dekLoaded: false,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              setupComplete: true,
              sessionValid: true,
              dekLoaded: true,
              csrfToken: 'csrf_setup',
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }));

    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('heading', { name: /create unlock secret/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^owner email$/i), 'owner@example.com');
    await user.clear(screen.getByLabelText(/^display name$/i));
    await user.type(screen.getByLabelText(/^display name$/i), 'Owner');
    await user.type(screen.getByLabelText(/^unlock secret$/i), 'a strong unlock phrase');
    await user.type(screen.getByLabelText(/confirm unlock secret/i), 'a strong unlock phrase');
    await user.click(screen.getByRole('checkbox', { name: /required to unlock encrypted card data/i }));
    await user.click(screen.getByRole('button', { name: /create secure vault/i }));

    await screen.findByRole('heading', { name: /dashboard/i });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/auth/setup',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'owner@example.com',
          displayName: 'Owner',
          unlockSecret: 'a strong unlock phrase',
        }),
      }),
    );
  });

  it('renders unlock when setup exists but session is locked', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: false,
            dekLoaded: false,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_login',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }));

    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByRole('heading', { name: /unlock card data/i })).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^unlock secret$/i), 'a strong unlock phrase');
    await user.click(screen.getByRole('button', { name: /^unlock$/i }));

    await screen.findByRole('heading', { name: /dashboard/i });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ unlockSecret: 'a strong unlock phrase' }),
      }),
    );
  });

  it('accepts an invite from the locked screen', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: false,
            dekLoaded: false,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              setupComplete: true,
              sessionValid: true,
              dekLoaded: true,
              csrfToken: 'csrf_invited',
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }));

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /unlock card data/i });
    await user.click(screen.getByRole('button', { name: /^show invite form$/i }));
    await user.type(screen.getByLabelText(/^email$/i), 'viewer@example.com');
    await user.type(screen.getByLabelText(/^invite code$/i), 'GC-INV-ABCD-EFGH-IJKL-MNOP-QRST-UVWX');
    await user.type(screen.getByLabelText(/^new unlock secret$/i), 'viewer strong unlock phrase');
    await user.type(screen.getByLabelText(/^confirm unlock secret$/i), 'viewer strong unlock phrase');
    await user.click(screen.getByRole('button', { name: /^accept invite$/i }));

    await screen.findByRole('heading', { name: /dashboard/i });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/auth/accept-invite',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'viewer@example.com',
          inviteCode: 'GC-INV-ABCD-EFGH-IJKL-MNOP-QRST-UVWX',
          unlockSecret: 'viewer strong unlock phrase',
        }),
      }),
    );
  });

  it('resets an unlock secret with a recovery code from the locked screen', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: false,
            dekLoaded: false,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { reset: true } }));

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /unlock card data/i });
    await user.click(screen.getByRole('button', { name: /^show recovery form$/i }));
    await user.type(screen.getByLabelText(/^email$/i), 'owner@example.com');
    await user.type(screen.getByLabelText(/^recovery code$/i), 'GC-REC-ABCD-EFGH-IJKL-MNOP-QRST-UVWX');
    await user.type(screen.getByLabelText(/^new unlock secret$/i), 'recovered strong unlock phrase');
    await user.type(screen.getByLabelText(/^confirm unlock secret$/i), 'recovered strong unlock phrase');
    await user.click(screen.getByRole('button', { name: /^reset unlock secret$/i }));

    expect(await screen.findByText(/unlock secret reset/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/auth/recover',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'owner@example.com',
          recoveryCode: 'GC-REC-ABCD-EFGH-IJKL-MNOP-QRST-UVWX',
          newUnlockSecret: 'recovered strong unlock phrase',
        }),
      }),
    );
  });

  it('shows server request IDs in API error states', async () => {
    fetchMock().mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Unexpected server error.',
            requestId: 'req_visible123',
          },
        },
        500,
      ),
    );

    render(<App />);

    expect(await screen.findByText(/unexpected server error/i)).toBeInTheDocument();
    expect(screen.getByText(/req_visible123/i)).toBeInTheDocument();
  });

  it('renders the authenticated work surface with cards and deals', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Target',
              status: 'available',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
              updatedAt: '2026-05-11T10:00:00.000Z',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 2,
              name: 'Staples promo',
              source: 'Staples',
              inputTotalCostCents: 10000,
              rowVersion: 1,
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      );

    render(<App />);

    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /primary/i })).toBeInTheDocument();
    expect(screen.getByText(/target/i)).toBeInTheDocument();
    expect(screen.getByText(/staples promo/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/cards', expect.any(Object));
      expect(globalThis.fetch).toHaveBeenCalledWith('/api/deals', expect.any(Object));
    });
  });

  it('renders dashboard P&L and risk metrics from card data', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Target',
              status: 'available',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
              expirationDate: '2026-06-01',
            },
            {
              id: 2,
              brand: 'Amazon',
              status: 'reserved',
              faceValueCents: 2500,
              remainingBalanceCents: 2500,
              purchaseCostCents: 2000,
              cardNumberLast4: '2222',
              reservedFor: 'Dealer A',
              reservedUntil: '2026-05-01',
            },
            {
              id: 3,
              brand: 'Best Buy',
              status: 'in_use',
              faceValueCents: 10000,
              remainingBalanceCents: 6000,
              purchaseCostCents: 8000,
              cardNumberLast4: '3333',
            },
            {
              id: 4,
              brand: 'Visa',
              status: 'sold',
              faceValueCents: 10000,
              remainingBalanceCents: 0,
              purchaseCostCents: 9000,
              latestSalePriceCents: 9500,
              cardNumberLast4: '4444',
            },
          ],
          page: { total: 4, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }));

    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    expect(screen.getByText(/^Active remaining$/i).closest('article')).toHaveTextContent('$135.00');
    expect(screen.getByText(/^Active cost basis$/i).closest('article')).toHaveTextContent('$145.00');
    expect(screen.getByText(/^Active gross margin$/i).closest('article')).toHaveTextContent('-$10.00');
    expect(screen.getByText(/^Sold proceeds$/i).closest('article')).toHaveTextContent('$95.00');
    expect(screen.getByText(/^Realized P&L$/i).closest('article')).toHaveTextContent('$5.00');
    expect(screen.getByText(/^Stale reservations$/i).closest('article')).toHaveTextContent('1');
  });

  it('loads the audit log from primary navigation', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 15,
              entityType: 'card',
              entityId: 1,
              action: 'card.reserve',
              timestamp: '2026-05-11T16:00:00.000Z',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^audit log$/i }));

    expect(await screen.findByRole('heading', { name: /audit log/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/card.reserve/i)).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /card 1 card.reserve/i })).toBeInTheDocument();
    expect(screen.getByText(/2026/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/audit',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('filters the audit log from the audit view', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 15,
              entityType: 'card',
              entityId: 1,
              action: 'card.reserve',
              timestamp: '2026-05-11T16:00:00.000Z',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 16,
              entityType: 'deal',
              entityId: 2,
              action: 'deal.create',
              timestamp: '2026-05-10T15:00:00.000Z',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^audit log$/i }));
    await screen.findByText(/card.reserve/i);

    await user.selectOptions(screen.getByLabelText(/^entity type$/i), 'deal');
    await user.type(screen.getByLabelText(/^action$/i), 'deal.create');
    await user.type(screen.getByLabelText(/^from$/i), '2026-05-01');
    await user.type(screen.getByLabelText(/^to$/i), '2026-05-12');
    await user.click(screen.getByRole('button', { name: /^filter audit$/i }));

    expect(await screen.findByText(/deal.create/i)).toBeInTheDocument();
    expect(screen.queryByText(/card.reserve/i)).not.toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/audit?entityType=deal&action=deal.create&from=2026-05-01&to=2026-05-12',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('exports plaintext JSON from the backup view with confirmation controls', async () => {
    const originalCreateObjectURL = globalThis.URL.createObjectURL;
    const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
    Object.defineProperty(globalThis.URL, 'createObjectURL', { configurable: true, writable: true, value: undefined });
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', { configurable: true, writable: true, value: undefined });
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            schemaVersion: 1,
            exportType: 'plaintext_json',
            exportedAt: '2026-05-11T17:30:00.000Z',
            warning: 'This plaintext export contains spendable credentials.',
            cards: [],
            deals: [] as unknown[],
            transactions: [] as unknown[],
            usages: [] as unknown[],
          },
        }),
      );

    try {
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole('heading', { name: /dashboard/i });
      await user.click(screen.getByRole('button', { name: /^backup$/i }));
      await user.type(screen.getByLabelText(/^fresh unlock secret$/i), 'a strong unlock phrase');
      await user.type(screen.getByLabelText(/^type EXPORT to confirm$/i), 'EXPORT');
      await user.click(screen.getByRole('checkbox', { name: /contains spendable credentials/i }));
      await user.click(screen.getByRole('button', { name: /^export plaintext json$/i }));

      expect(await screen.findByText(/plaintext export prepared/i)).toBeInTheDocument();
      expect(globalThis.fetch).toHaveBeenLastCalledWith(
        '/api/backup/export',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            unlockSecret: 'a strong unlock phrase',
            confirmation: 'EXPORT',
            acknowledgePlaintext: true,
          }),
          headers: expect.objectContaining({
            'X-CSRF-Token': 'csrf_ready',
          }),
        }),
      );
    } finally {
      globalThis.URL.createObjectURL = originalCreateObjectURL;
      globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it('exports encrypted JSON from the backup view with a separate passphrase', async () => {
    const originalCreateObjectURL = globalThis.URL.createObjectURL;
    const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
    Object.defineProperty(globalThis.URL, 'createObjectURL', { configurable: true, writable: true, value: undefined });
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', { configurable: true, writable: true, value: undefined });
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            schemaVersion: 1,
            exportType: 'encrypted_portable_json',
            payloadSchemaVersion: 1,
            appVersion: '0.1.0',
            exportedAt: '2026-05-11T17:30:00.000Z',
            encryptedAt: '2026-05-11T17:30:00.000Z',
            kdf: {
              name: 'scrypt',
              salt: 'salt',
              N: 131072,
              r: 8,
              p: 1,
              keyLength: 32,
            },
            cipher: {
              name: 'aes-256-gcm',
              iv: 'iv',
              authTag: 'tag',
              ciphertext: 'ciphertext',
            },
          },
        }),
      );

    try {
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole('heading', { name: /dashboard/i });
      await user.click(screen.getByRole('button', { name: /^backup$/i }));
      await user.type(screen.getByLabelText(/^encrypted export unlock secret$/i), 'a strong unlock phrase');
      await user.type(screen.getByLabelText(/^backup passphrase$/i), 'portable backup passphrase');
      await user.type(screen.getByLabelText(/^repeat backup passphrase$/i), 'portable backup passphrase');
      await user.type(screen.getByLabelText(/^type ENCRYPT to confirm$/i), 'ENCRYPT');
      await user.click(screen.getByRole('button', { name: /^export encrypted json$/i }));

      expect(await screen.findByText(/encrypted export prepared/i)).toBeInTheDocument();
      expect(globalThis.fetch).toHaveBeenLastCalledWith(
        '/api/backup/export-encrypted',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            unlockSecret: 'a strong unlock phrase',
            backupPassphrase: 'portable backup passphrase',
            backupPassphraseConfirmation: 'portable backup passphrase',
            confirmation: 'ENCRYPT',
          }),
          headers: expect.objectContaining({
            'X-CSRF-Token': 'csrf_ready',
          }),
        }),
      );
    } finally {
      globalThis.URL.createObjectURL = originalCreateObjectURL;
      globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it('exports the raw database file from the backup view', async () => {
    const originalCreateObjectURL = globalThis.URL.createObjectURL;
    const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
    Object.defineProperty(globalThis.URL, 'createObjectURL', { configurable: true, writable: true, value: undefined });
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', { configurable: true, writable: true, value: undefined });
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        blobResponse('SQLite format 3', 200, {
          'content-disposition': 'attachment; filename="gift-card-raw-db-export-2026-05-11.sqlite"',
        }),
      );

    try {
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole('heading', { name: /dashboard/i });
      await user.click(screen.getByRole('button', { name: /^backup$/i }));
      await user.type(screen.getByLabelText(/^raw database unlock secret$/i), 'a strong unlock phrase');
      await user.click(screen.getByRole('button', { name: /^export raw db$/i }));

      expect(await screen.findByText(/raw database export prepared/i)).toBeInTheDocument();
      expect(globalThis.fetch).toHaveBeenLastCalledWith(
        '/api/backup/db-file',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            unlockSecret: 'a strong unlock phrase',
          }),
          headers: expect.objectContaining({
            'X-CSRF-Token': 'csrf_ready',
          }),
        }),
      );
    } finally {
      globalThis.URL.createObjectURL = originalCreateObjectURL;
      globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  it('previews a CSV import from the backup view without exposing full credentials', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            importType: 'csv',
            summary: {
              rowCount: 2,
              validCount: 1,
              invalidCount: 1,
            },
            rows: [
              {
                rowNumber: 2,
                valid: true,
                parsed: {
                  brand: 'Target',
                  cardType: 'merchant',
                  faceValueCents: 5000,
                  purchaseCostCents: 4500,
                  cardNumberLast4: '1111',
                  hasPin: true,
                  hasBillingZip: true,
                },
                errors: [],
              },
              {
                rowNumber: 3,
                valid: false,
                parsed: {
                  brand: null,
                  cardType: 'merchant',
                  faceValueCents: null,
                  purchaseCostCents: 0,
                  cardNumberLast4: null,
                  hasPin: false,
                  hasBillingZip: false,
                },
                errors: [
                  { field: 'brand', code: 'required', message: 'Brand is required.' },
                  { field: 'faceValue', code: 'invalid_money', message: 'faceValue must be greater than zero.' },
                ],
              },
            ],
          },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^backup$/i }));
    await user.upload(
      screen.getByLabelText(/^csv file$/i),
      new File(['brand,cardType,faceValue,cardNumber,pin\nTarget,merchant,50,4111111111111111,1234'], 'cards.csv', {
        type: 'text/csv',
      }),
    );
    await user.click(screen.getByRole('button', { name: /^preview csv$/i }));

    expect(await screen.findByText(/1 valid/i)).toBeInTheDocument();
    expect(screen.getByText(/1 invalid/i)).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /2 valid target merchant/i })).toBeInTheDocument();
    expect(screen.getByText(/brand: Brand is required/i)).toBeInTheDocument();
    expect(screen.queryByText(/4111111111111111/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/1234/i)).not.toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/cards/import-csv',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          csv: 'brand,cardType,faceValue,cardNumber,pin\nTarget,merchant,50,4111111111111111,1234',
        }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('downloads CSV import templates from the backup view', async () => {
    const originalCreateObjectURL = globalThis.URL.createObjectURL;
    const originalRevokeObjectURL = globalThis.URL.revokeObjectURL;
    const originalAnchorClick = globalThis.HTMLAnchorElement.prototype.click;
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:csv-template');
    globalThis.URL.revokeObjectURL = vi.fn();
    globalThis.HTMLAnchorElement.prototype.click = vi.fn();
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }));

    try {
      const user = userEvent.setup();
      render(<App />);

      await screen.findByRole('heading', { name: /dashboard/i });
      await user.click(screen.getByRole('button', { name: /^backup$/i }));
      await user.selectOptions(screen.getByLabelText(/^csv template$/i), 'marketplace');
      await user.click(screen.getByRole('button', { name: /^download template$/i }));

      expect(globalThis.URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
      const [templateBlob] = createObjectUrlMock().mock.calls[0] ?? [];
      expect(templateBlob).toBeInstanceOf(Blob);
      expect((templateBlob as Blob).type).toBe('text/csv');
      expect(globalThis.URL.revokeObjectURL).toHaveBeenCalledWith('blob:csv-template');
    } finally {
      globalThis.URL.createObjectURL = originalCreateObjectURL;
      globalThis.URL.revokeObjectURL = originalRevokeObjectURL;
      globalThis.HTMLAnchorElement.prototype.click = originalAnchorClick;
    }
  });

  it('hides backup workflows disabled by feature flags', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
            features: {
              plaintextJsonExport: false,
              rawDatabaseExport: false,
              csvImport: false,
              referenceValueHints: false,
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }));

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^backup$/i }));

    expect(screen.queryByRole('heading', { name: /csv import preview/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /plaintext json export/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /raw encrypted database export/i })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /encrypted json export/i })).toBeInTheDocument();
  });

  it('confirms a valid CSV import from the backup view', async () => {
    const csv = 'brand,cardType,faceValue,cardNumber\nTarget,merchant,50,4111111111111111';
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            importType: 'csv',
            summary: {
              rowCount: 1,
              validCount: 1,
              invalidCount: 0,
            },
            rows: [
              {
                rowNumber: 2,
                valid: true,
                parsed: {
                  brand: 'Target',
                  cardType: 'merchant',
                  faceValueCents: 5000,
                  purchaseCostCents: 0,
                  cardNumberLast4: '1111',
                  hasPin: false,
                  hasBillingZip: false,
                },
                errors: [],
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              summary: {
                rowCount: 1,
                validCount: 1,
                invalidCount: 0,
              },
              importJob: {
                id: 8,
                type: 'csv',
                status: 'confirmed',
                rowCount: 1,
                validCount: 1,
                invalidCount: 0,
              },
              cards: [
                {
                  id: 9,
                  brand: 'Target',
                  cardType: 'merchant',
                  faceValueCents: 5000,
                  remainingBalanceCents: 5000,
                  purchaseCostCents: 0,
                  cardNumberLast4: '1111',
                  status: 'available',
                },
              ],
            },
          },
          201,
        ),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^backup$/i }));
    await user.upload(
      screen.getByLabelText(/^csv file$/i),
      new File([csv], 'cards.csv', {
        type: 'text/csv',
      }),
    );
    await user.click(screen.getByRole('button', { name: /^preview csv$/i }));
    await user.click(await screen.findByRole('button', { name: /^confirm csv import$/i }));

    expect(await screen.findByText(/imported 1 card/i)).toBeInTheDocument();
    expect(screen.getByText(/1 cards tracked/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/cards/import-csv/confirm',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ csv }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('imports a plaintext JSON backup from the backup view without rendering secrets', async () => {
    const payload = {
      schemaVersion: 1,
      exportType: 'plaintext_json',
      appSettings: [] as unknown[],
      deals: [] as unknown[],
      cards: [
        {
          id: 1,
          brand: 'Target',
          cardType: 'merchant',
          faceValueCents: 5000,
          remainingBalanceCents: 5000,
          purchaseCostCents: 4500,
          cardNumber: '4111111111111111',
          pin: '1234',
          billingZip: '94105',
          status: 'available',
        },
      ],
      transactions: [] as unknown[],
      usages: [] as unknown[],
    };

    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              summary: {
                mode: 'merge',
                backupCreated: false,
                dealCount: 0,
                cardCount: 1,
                transactionCount: 0,
                usageCount: 0,
                settingCount: 0,
              },
              importJob: {
                id: 5,
                type: 'json_merge',
                status: 'confirmed',
                rowCount: 1,
                validCount: 1,
                invalidCount: 0,
              },
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 8,
              brand: 'Target',
              cardType: 'merchant',
              status: 'available',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }));

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^backup$/i }));
    await user.upload(
      screen.getByLabelText(/^plaintext json backup file$/i),
      new File([JSON.stringify(payload)], 'gift-card-plaintext-export-2026-05-11.json', {
        type: 'application/json',
      }),
    );
    await user.type(screen.getByLabelText(/^json import unlock secret$/i), 'a strong unlock phrase');
    await user.click(screen.getByRole('button', { name: /^import json backup$/i }));

    expect(await screen.findByText(/json merge import completed: 1 card, 0 deals/i)).toBeInTheDocument();
    expect(screen.getByText(/1 cards tracked/i)).toBeInTheDocument();
    expect(screen.queryByText(/4111111111111111/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/1234/i)).not.toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      '/api/backup/import',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          unlockSecret: 'a strong unlock phrase',
          mode: 'merge',
          confirmation: '',
          payload,
        }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('imports an encrypted JSON backup from the backup view', async () => {
    const payload = {
      schemaVersion: 1,
      exportType: 'encrypted_portable_json',
      payloadSchemaVersion: 1,
      appVersion: '0.1.0',
      exportedAt: '2026-05-11T17:30:00.000Z',
      encryptedAt: '2026-05-11T17:30:00.000Z',
      kdf: {
        name: 'scrypt',
        salt: 'salt',
        N: 131072,
        r: 8,
        p: 1,
        keyLength: 32,
      },
      cipher: {
        name: 'aes-256-gcm',
        iv: 'iv',
        authTag: 'tag',
        ciphertext: 'ciphertext',
      },
    };

    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              summary: {
                mode: 'merge',
                backupCreated: false,
                dealCount: 1,
                cardCount: 1,
                transactionCount: 0,
                usageCount: 0,
                settingCount: 0,
              },
              importJob: {
                id: 6,
                type: 'json_merge',
                status: 'confirmed',
                rowCount: 2,
                validCount: 2,
                invalidCount: 0,
              },
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 8,
              brand: 'Target',
              cardType: 'merchant',
              status: 'available',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }));

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^backup$/i }));
    await user.upload(
      screen.getByLabelText(/^encrypted json backup file$/i),
      new File([JSON.stringify(payload)], 'gift-card-encrypted-export-2026-05-11.json', {
        type: 'application/json',
      }),
    );
    await user.type(screen.getByLabelText(/^encrypted import unlock secret$/i), 'a strong unlock phrase');
    await user.type(screen.getByLabelText(/^encrypted import backup passphrase$/i), 'portable backup passphrase');
    await user.click(screen.getByRole('button', { name: /^import encrypted json backup$/i }));

    expect(await screen.findByText(/encrypted json merge import completed: 1 card, 1 deal/i)).toBeInTheDocument();
    expect(screen.getByText(/1 cards tracked/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      '/api/backup/import',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          unlockSecret: 'a strong unlock phrase',
          backupPassphrase: 'portable backup passphrase',
          mode: 'merge',
          confirmation: '',
          payload,
        }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('changes the unlock secret from settings', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            allowPlaintextExport: true,
            backupReminderDays: 30,
            backupReminderDue: true,
            lastBackupAt: null,
            nextBackupDueAt: null,
            lastPlaintextExportAt: null,
            lastEncryptedExportAt: null,
            lastRawDatabaseExportAt: null,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(supportPolicyResponse())
      .mockResolvedValueOnce(dataPolicyResponse())
      .mockResolvedValueOnce(jsonResponse({ data: { changed: true } }));

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^settings$/i }));
    await user.type(screen.getByLabelText(/^current unlock secret$/i), 'a strong unlock phrase');
    await user.type(screen.getByLabelText(/^new unlock secret$/i), 'a better unlock phrase');
    await user.type(screen.getByLabelText(/^confirm new unlock secret$/i), 'a better unlock phrase');
    await user.click(screen.getByRole('button', { name: /^change unlock secret$/i }));

    expect(await screen.findByText(/unlock secret changed/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/auth/change-unlock-secret',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          oldUnlockSecret: 'a strong unlock phrase',
          newUnlockSecret: 'a better unlock phrase',
        }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('updates backup settings from settings', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            allowPlaintextExport: true,
            backupReminderDays: 30,
            backupReminderDue: true,
            lastBackupAt: null,
            nextBackupDueAt: null,
            lastPlaintextExportAt: null,
            lastEncryptedExportAt: null,
            lastRawDatabaseExportAt: null,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(supportPolicyResponse())
      .mockResolvedValueOnce(dataPolicyResponse())
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            allowPlaintextExport: false,
            backupReminderDays: 14,
            backupReminderDue: true,
            lastBackupAt: null,
            nextBackupDueAt: null,
            lastPlaintextExportAt: null,
            lastEncryptedExportAt: null,
            lastRawDatabaseExportAt: null,
          },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^settings$/i }));
    await screen.findByText(/^last backup$/i);
    await user.click(screen.getByRole('checkbox', { name: /^allow plaintext json export$/i }));
    await user.clear(screen.getByLabelText(/^backup reminder days$/i));
    await user.type(screen.getByLabelText(/^backup reminder days$/i), '14');
    await user.type(screen.getByLabelText(/^settings unlock secret$/i), 'a strong unlock phrase');
    await user.click(screen.getByRole('button', { name: /^save backup settings$/i }));

    expect(await screen.findByText(/backup settings saved/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/settings/backup',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          unlockSecret: 'a strong unlock phrase',
          allowPlaintextExport: false,
          backupReminderDays: 14,
        }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('shows plaintext export as policy locked in settings', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            allowPlaintextExport: false,
            plaintextExportPolicyLocked: true,
            backupReminderDays: 30,
            backupReminderDue: true,
            lastBackupAt: null,
            nextBackupDueAt: null,
            lastPlaintextExportAt: null,
            lastEncryptedExportAt: null,
            lastRawDatabaseExportAt: null,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(supportPolicyResponse())
      .mockResolvedValueOnce(dataPolicyResponse());

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^settings$/i }));

    expect(await screen.findByText(/^policy locked$/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /^allow plaintext json export$/i })).toBeDisabled();
  });

  it('creates a user from security settings', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
            user: {
              id: 1,
              email: 'owner@example.com',
              displayName: 'Owner',
              role: 'owner',
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            allowPlaintextExport: true,
            backupReminderDays: 30,
            backupReminderDue: true,
            lastBackupAt: null,
            nextBackupDueAt: null,
            lastPlaintextExportAt: null,
            lastEncryptedExportAt: null,
            lastRawDatabaseExportAt: null,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              email: 'owner@example.com',
              displayName: 'Owner',
              role: 'owner',
              disabledAt: null,
              lastLoginAt: null,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(supportPolicyResponse())
      .mockResolvedValueOnce(dataPolicyResponse())
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              id: 2,
              email: 'viewer@example.com',
              displayName: 'Viewer A',
              role: 'viewer',
              inviteCode: 'GC-INV-ABCD-EFGH-IJKL-MNOP-QRST-UVWX',
              usedAt: null,
              revokedAt: null,
              expiresAt: '2026-05-21T00:00:00.000Z',
            },
          },
          201,
        ),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^settings$/i }));
    expect(await screen.findByText('owner@example.com')).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^user email$/i), 'viewer@example.com');
    await user.type(screen.getByLabelText(/^display name$/i), 'Viewer A');
    await user.selectOptions(screen.getByLabelText(/^role$/i), 'viewer');
    await user.type(screen.getByLabelText(/^your unlock secret$/i), 'owner unlock phrase');
    await user.click(screen.getByRole('button', { name: /^create invite$/i }));

    expect(await screen.findByText(/invite created for viewer a/i)).toBeInTheDocument();
    expect(screen.getByText('GC-INV-ABCD-EFGH-IJKL-MNOP-QRST-UVWX')).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/users/invites',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          currentUnlockSecret: 'owner unlock phrase',
          email: 'viewer@example.com',
          displayName: 'Viewer A',
          role: 'viewer',
        }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('updates support and data policies from settings', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
            user: {
              id: 1,
              email: 'owner@example.com',
              displayName: 'Owner',
              role: 'owner',
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            allowPlaintextExport: true,
            backupReminderDays: 30,
            backupReminderDue: true,
            lastBackupAt: null,
            nextBackupDueAt: null,
            lastPlaintextExportAt: null,
            lastEncryptedExportAt: null,
            lastRawDatabaseExportAt: null,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(supportPolicyResponse())
      .mockResolvedValueOnce(dataPolicyResponse())
      .mockResolvedValueOnce(
        supportPolicyResponse({
          supportAccessEnabled: true,
          supportContact: 'ops@example.com',
          supportPolicyUrl: 'https://example.com/support',
          supportNotes: 'Owner approval required.',
          supportUpdatedAt: '2026-05-12T08:00:00.000Z',
          supportUpdatedByUserId: 1,
        }),
      )
      .mockResolvedValueOnce(
        dataPolicyResponse({
          auditRetentionDays: 180,
          idempotencyRetentionDays: 14,
          sessionRetentionDays: 3,
          loginAttemptRetentionDays: 30,
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^settings$/i }));

    await user.click(await screen.findByRole('checkbox', { name: /^support access enabled$/i }));
    await user.type(screen.getByLabelText(/^support contact$/i), 'ops@example.com');
    await user.type(screen.getByLabelText(/^support policy url$/i), 'https://example.com/support');
    await user.type(screen.getByLabelText(/^support notes$/i), 'Owner approval required.');
    await user.type(screen.getByLabelText(/^support policy unlock secret$/i), 'a strong unlock phrase');
    await user.click(screen.getByRole('button', { name: /^save support policy$/i }));

    expect(await screen.findByText(/support policy saved/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/admin/support-policy',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          unlockSecret: 'a strong unlock phrase',
          supportAccessEnabled: true,
          supportContact: 'ops@example.com',
          supportPolicyUrl: 'https://example.com/support',
          supportNotes: 'Owner approval required.',
        }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );

    await user.clear(screen.getByLabelText(/^audit retention days$/i));
    await user.type(screen.getByLabelText(/^audit retention days$/i), '180');
    await user.clear(screen.getByLabelText(/^idempotency retention days$/i));
    await user.type(screen.getByLabelText(/^idempotency retention days$/i), '14');
    await user.clear(screen.getByLabelText(/^session retention days$/i));
    await user.type(screen.getByLabelText(/^session retention days$/i), '3');
    await user.type(screen.getByLabelText(/^data policy unlock secret$/i), 'a strong unlock phrase');
    await user.click(screen.getByRole('button', { name: /^save data policy$/i }));

    expect(await screen.findByText(/data policy saved/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/admin/data-policy',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          unlockSecret: 'a strong unlock phrase',
          auditRetentionDays: 180,
          idempotencyRetentionDays: 14,
          sessionRetentionDays: 3,
          loginAttemptRetentionDays: 30,
        }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('renders viewer sessions as read-only', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_viewer',
            user: {
              id: 3,
              email: 'viewer@example.com',
              displayName: 'Viewer A',
              role: 'viewer',
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }));

    render(<App />);

    expect(await screen.findByRole('heading', { name: /dashboard/i })).toBeInTheDocument();
    expect(screen.getByText(/viewer a/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^settings$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^backup$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^import$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add deal/i })).not.toBeInTheDocument();
  });

  it('reveals and copies card credentials from card detail without putting secrets in status text', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Target',
              cardType: 'merchant',
              status: 'available',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            card: {
              id: 1,
              brand: 'Target',
              cardType: 'merchant',
              status: 'available',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
            transactions: [] as unknown[],
            usages: [] as unknown[],
            audit: [],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            cardNumber: '4111111111111111',
            cardNumberLast4: '1111',
            pin: '1234',
            billingZip: '94105',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            cardNumber: '4111111111111111',
            cardNumberLast4: '1111',
            pin: '1234',
            billingZip: '94105',
          },
        }),
      );

    const user = userEvent.setup();
    const writeText = vi.spyOn(window.navigator.clipboard, 'writeText');
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /open target details/i }));
    await screen.findByRole('heading', { name: /card details/i });
    await user.click(screen.getByRole('button', { name: /^reveal credentials$/i }));

    expect(await screen.findByText('4111111111111111')).toBeInTheDocument();
    expect(screen.getByText('1234')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^copy card number$/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('4111111111111111');
    });
    expect(await screen.findByText(/card number copied/i)).toBeInTheDocument();
    expect(screen.queryByText(/4111111111111111 copied/i)).not.toBeInTheDocument();
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => {
      expect(screen.queryByText('4111111111111111')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('1234')).not.toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/cards/1/reveal',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({}),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('renders a scannable barcode after credential reveal', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Starbucks',
              cardType: 'merchant',
              credentialProfile: 'barcode',
              credentialSummary: {
                profile: 'barcode',
                primaryLabel: 'Barcode',
                primaryHint: '**** 9012',
                primaryLast4: '9012',
                hasBarcode: true,
              },
              status: 'available',
              faceValueCents: 2500,
              remainingBalanceCents: 2500,
              purchaseCostCents: 2000,
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            card: {
              id: 1,
              brand: 'Starbucks',
              cardType: 'merchant',
              credentialProfile: 'barcode',
              credentialSummary: {
                profile: 'barcode',
                primaryLabel: 'Barcode',
                primaryHint: '**** 9012',
                primaryLast4: '9012',
                hasBarcode: true,
              },
              status: 'available',
              faceValueCents: 2500,
              remainingBalanceCents: 2500,
              purchaseCostCents: 2000,
            },
            transactions: [] as unknown[],
            usages: [] as unknown[],
            audit: [],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            credentials: {
              profile: 'barcode',
              fields: [
                {
                  fieldKey: 'barcode_value',
                  label: 'Barcode',
                  fieldKind: 'barcode_value',
                  value: '123456789012',
                  barcodeFormat: 'code128',
                  copyable: true,
                },
              ],
            },
          },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /open starbucks details/i }));
    await user.click(await screen.findByRole('button', { name: /^reveal credentials$/i }));

    expect(await screen.findByAltText(/scannable barcode/i)).toBeInTheDocument();
    expect(screen.getByText('123456789012')).toBeInTheDocument();
  });

  it('creates a deal with a starter card from the dashboard without a deal name', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            deal_name: [],
            source: [{ id: 1, type: 'source', value: 'Staples', usageCount: 4 }],
            card_brand: [{ id: 2, type: 'card_brand', value: 'Target', usageCount: 3 }],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: 1, type: 'source', value: 'Staples', usageCount: 5 },
            { id: 2, type: 'card_brand', value: 'Target', usageCount: 4 },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
              data: {
                deal: {
                  id: 10,
                  name: 'Staples',
                  source: 'Staples',
                  inputTotalCostCents: 4500,
                  rowVersion: 1,
                },
              cards: [
                {
                  id: 11,
                  dealId: 10,
                  brand: 'Target',
                  status: 'available',
                  faceValueCents: 5000,
                  remainingBalanceCents: 5000,
                  purchaseCostCents: 4500,
                  cardNumberLast4: '1111',
                },
              ],
            },
          },
          201,
        ),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /add deal/i }));

    expect(screen.getByRole('heading', { name: /^add deal$/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^source$/i), 'Staples');
    await user.type(screen.getByLabelText(/^total cost$/i), '45.00');
    await user.type(screen.getByLabelText(/^card brand$/i), 'Target');
    await user.type(screen.getByLabelText(/^face value$/i), '50.00');
    await user.type(screen.getByLabelText(/^card number$/i), '4111 1111 1111 1111');
    await user.click(screen.getByRole('button', { name: /^create deal$/i }));

    await screen.findByRole('button', { name: /open staples details/i });
    expect(screen.getByText(/target/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/deals',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          source: 'Staples',
          totalCostCents: 4500,
          cards: [
            {
              brand: 'Target',
              cardType: 'merchant',
              credentialProfile: 'merchant_number_pin',
              credentials: {
                profile: 'merchant_number_pin',
                fields: [
                  {
                    fieldKey: 'card_number',
                    label: 'Card number',
                    fieldKind: 'card_number',
                    value: '4111 1111 1111 1111',
                  },
                ],
              },
              cardNumber: '4111 1111 1111 1111',
              faceValueCents: 5000,
            },
          ],
        }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('analyzes and confirms loose bulk gift-card import rows', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            deal_name: [],
            source: [],
            card_brand: [
              { id: 1, type: 'card_brand', value: 'DoorDash', usageCount: 2 },
              { id: 2, type: 'card_brand', value: 'Best Buy', usageCount: 2 },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              deal: { id: 40, name: 'DoorDash', source: null, inputTotalCostCents: null, rowVersion: 1 },
              cards: [
                {
                  id: 41,
                  dealId: 40,
                  brand: 'DoorDash',
                  credentialProfile: 'claim_code',
                  status: 'available',
                  faceValueCents: 5000,
                  remainingBalanceCents: 5000,
                  purchaseCostCents: 0,
                },
              ],
            },
          },
          201,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              deal: { id: 42, name: 'Best Buy', source: null, inputTotalCostCents: null, rowVersion: 1 },
              cards: [
                {
                  id: 43,
                  dealId: 42,
                  brand: 'Best Buy',
                  credentialProfile: 'merchant_number_pin',
                  status: 'available',
                  faceValueCents: 5000,
                  remainingBalanceCents: 5000,
                  purchaseCostCents: 0,
                },
              ],
            },
          },
          201,
        ),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^bulk import$/i }));
    await user.type(screen.getByLabelText(/^gift-card lines$/i), 'Doordash 50 DD-CODE\nBestbuy $50 BB-CARD BB-PIN');
    await user.click(screen.getByRole('button', { name: /^analyze cards$/i }));

    const review = await screen.findByRole('dialog', { name: /^review parsed cards$/i });
    expect(within(review).getByLabelText(/^line 1 brand$/i)).toHaveValue('DoorDash');
    expect(within(review).getByLabelText(/^line 2 PIN or access code$/i)).toHaveValue('BB-PIN');
    await user.click(within(review).getByRole('button', { name: /^import 2 cards$/i }));

    await waitFor(() => {
      const dealBodies = fetchMock().mock.calls
        .filter(([url, init]) => url === '/api/deals' && (init as RequestInit | undefined)?.method === 'POST')
        .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
      expect(dealBodies).toEqual([
        expect.objectContaining({
          cards: [
            expect.objectContaining({
              brand: 'DoorDash',
              credentialProfile: 'claim_code',
              redemptionCode: 'DD-CODE',
              faceValueCents: 5000,
            }),
          ],
        }),
        expect.objectContaining({
          cards: [
            expect.objectContaining({
              brand: 'Best Buy',
              credentialProfile: 'merchant_number_pin',
              cardNumber: 'BB-CARD',
              pin: 'BB-PIN',
              faceValueCents: 5000,
            }),
          ],
        }),
      ]);
    });
  });

  it('creates a custom credential deal from Add Deal', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            deal_name: [],
            source: [{ id: 1, type: 'source', value: 'Direct', usageCount: 1 }],
            card_brand: [{ id: 2, type: 'card_brand', value: 'Local Spa', usageCount: 1 }],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: 1, type: 'source', value: 'Direct', usageCount: 2 },
            { id: 2, type: 'card_brand', value: 'Local Spa', usageCount: 2 },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              deal: {
                id: 20,
                name: 'Direct',
                source: 'Direct',
                inputTotalCostCents: null,
                rowVersion: 1,
              },
              cards: [
                {
                  id: 21,
                  dealId: 20,
                  brand: 'Local Spa',
                  credentialProfile: 'custom',
                  status: 'available',
                  faceValueCents: 12000,
                  remainingBalanceCents: 12000,
                  purchaseCostCents: 0,
                },
              ],
            },
          },
          201,
        ),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /add deal/i }));
    await user.type(screen.getByLabelText(/^source$/i), 'Direct');
    await user.type(screen.getByLabelText(/^card brand$/i), 'Local Spa');
    await user.type(screen.getByLabelText(/^face value$/i), '120.00');
    await user.selectOptions(screen.getByLabelText(/^credential type$/i), 'custom');
    await user.type(screen.getByLabelText(/^label$/i), 'Member ID');
    await user.type(screen.getByLabelText(/^value$/i), 'MEMBER-2345');
    await user.click(screen.getByRole('button', { name: /^create deal$/i }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenLastCalledWith(
        '/api/deals',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            source: 'Direct',
            cards: [
              {
                brand: 'Local Spa',
                cardType: 'merchant',
                credentialProfile: 'custom',
                credentials: {
                  profile: 'custom',
                  fields: [
                    {
                      fieldKey: 'Member ID',
                      label: 'Member ID',
                      fieldKind: 'primary_code',
                      value: 'MEMBER-2345',
                      sortOrder: 10,
                    },
                  ],
                },
                faceValueCents: 12000,
              },
            ],
          }),
        }),
      );
    });
  });

  it('uses a single primary field for claim-code cards in Add Deal', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            deal_name: [],
            source: [{ id: 1, type: 'source', value: 'Direct', usageCount: 1 }],
            card_brand: [{ id: 2, type: 'card_brand', value: 'DoorDash', usageCount: 1 }],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: 1, type: 'source', value: 'Direct', usageCount: 2 },
            { id: 2, type: 'card_brand', value: 'DoorDash', usageCount: 2 },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              deal: { id: 30, name: 'Direct', source: 'Direct', inputTotalCostCents: null, rowVersion: 1 },
              cards: [
                {
                  id: 31,
                  dealId: 30,
                  brand: 'DoorDash',
                  credentialProfile: 'claim_code',
                  status: 'available',
                  faceValueCents: 2500,
                  remainingBalanceCents: 2500,
                  purchaseCostCents: 0,
                },
              ],
            },
          },
          201,
        ),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /add deal/i }));
    await user.type(screen.getByLabelText(/^source$/i), 'Direct');
    await user.type(screen.getByLabelText(/^card brand$/i), 'DoorDash');
    await user.type(screen.getByLabelText(/^face value$/i), '25.00');
    expect(screen.getByLabelText(/^credential type$/i)).toHaveValue('claim_code');
    expect(screen.queryByLabelText(/^PIN$/i)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/^code \/ pin \/ claim code$/i), 'DDTESTCODE11');
    await user.click(screen.getByRole('button', { name: /^create deal$/i }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenLastCalledWith(
        '/api/deals',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            source: 'Direct',
            cards: [
              {
                brand: 'DoorDash',
                cardType: 'merchant',
                credentialProfile: 'claim_code',
                credentials: {
                  profile: 'claim_code',
                  fields: [
                    {
                      fieldKey: 'primary_code',
                      label: 'Code / PIN / Claim code',
                      fieldKind: 'primary_code',
                      value: 'DDTESTCODE11',
                    },
                  ],
                },
                faceValueCents: 2500,
              },
            ],
          }),
        }),
      );
    });
  });

  it('uses card number plus access code for Target-style Add Deal entry', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            deal_name: [],
            source: [{ id: 1, type: 'source', value: 'Direct', usageCount: 1 }],
            card_brand: [{ id: 2, type: 'card_brand', value: 'Target', usageCount: 1 }],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: 1, type: 'source', value: 'Direct', usageCount: 2 },
            { id: 2, type: 'card_brand', value: 'Target', usageCount: 2 },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              deal: { id: 32, name: 'Direct', source: 'Direct', inputTotalCostCents: null, rowVersion: 1 },
              cards: [
                {
                  id: 33,
                  dealId: 32,
                  brand: 'Target',
                  credentialProfile: 'merchant_number_pin',
                  status: 'available',
                  faceValueCents: 5000,
                  remainingBalanceCents: 5000,
                  purchaseCostCents: 0,
                },
              ],
            },
          },
          201,
        ),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /add deal/i }));
    await user.type(screen.getByLabelText(/^source$/i), 'Direct');
    await user.type(screen.getByLabelText(/^card brand$/i), 'Target');
    await user.type(screen.getByLabelText(/^face value$/i), '50.00');
    expect(screen.getByLabelText(/^credential type$/i)).toHaveValue('merchant_number_access');
    expect(screen.queryByLabelText(/^PIN$/i)).not.toBeInTheDocument();
    await user.type(screen.getByLabelText(/^card number$/i), '990000000000502');
    await user.type(screen.getByLabelText(/^access code$/i), '05512345');
    await user.click(screen.getByRole('button', { name: /^create deal$/i }));

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenLastCalledWith(
        '/api/deals',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            source: 'Direct',
            cards: [
              {
                brand: 'Target',
                cardType: 'merchant',
                credentialProfile: 'merchant_number_pin',
                credentials: {
                  profile: 'merchant_number_pin',
                  fields: [
                    {
                      fieldKey: 'card_number',
                      label: 'Card number',
                      fieldKind: 'card_number',
                      value: '990000000000502',
                    },
                    {
                      fieldKey: 'access_code',
                      label: 'Access code',
                      fieldKind: 'access_code',
                      value: '05512345',
                    },
                  ],
                },
                cardNumber: '990000000000502',
                faceValueCents: 5000,
              },
            ],
          }),
        }),
      );
    });
  });

  it('suggests indexed card brands when an add-deal value looks mistyped', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            deal_name: [],
            source: [{ id: 1, type: 'source', value: 'Staples', usageCount: 2 }],
            card_brand: [{ id: 2, type: 'card_brand', value: 'Amazon', usageCount: 7 }],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: 1, type: 'source', value: 'Staples', usageCount: 3 },
            { id: 2, type: 'card_brand', value: 'Amazon', usageCount: 8 },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            data: {
              deal: {
                id: 12,
                name: 'Staples',
                source: 'Staples',
                inputTotalCostCents: null,
                rowVersion: 1,
              },
              cards: [
                {
                  id: 13,
                  dealId: 12,
                  brand: 'Amazon',
                  status: 'available',
                  faceValueCents: 5000,
                  remainingBalanceCents: 5000,
                  purchaseCostCents: 0,
                },
              ],
            },
          },
          201,
        ),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /add deal/i }));
    await user.type(screen.getByLabelText(/^source$/i), 'Staples');
    await user.type(screen.getByLabelText(/^card brand$/i), 'Amazin');
    await user.type(screen.getByLabelText(/^face value$/i), '50.00');
    await user.click(screen.getByRole('button', { name: /^create deal$/i }));

    expect(await screen.findByRole('heading', { name: /review new entries/i })).toBeInTheDocument();
    expect(screen.getByText(/possible typo/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /use amazon/i }));
    expect(screen.getByLabelText(/^card brand$/i)).toHaveValue('Amazon');

    await user.click(screen.getByRole('button', { name: /^create deal$/i }));

    await screen.findByRole('button', { name: /open staples details/i });
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      5,
      '/api/reference-values',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          values: [
            { type: 'source', value: 'Staples' },
            { type: 'card_brand', value: 'Amazon' },
          ],
        }),
      }),
    );
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/deals',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          source: 'Staples',
          cards: [
            {
              brand: 'Amazon',
              cardType: 'merchant',
              credentialProfile: 'claim_code',
              credentials: {
                profile: 'claim_code',
                fields: [],
              },
              faceValueCents: 5000,
            },
          ],
        }),
      }),
    );
  });

  it('archives and restores deals from the deals view', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 10,
              name: 'Staples promo',
              source: 'Staples',
              inputTotalCostCents: 4500,
              archivedAt: null,
              rowVersion: 1,
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            deal: {
              id: 10,
              name: 'Staples promo',
              source: 'Staples',
              inputTotalCostCents: 4500,
              archivedAt: '2026-05-11T16:00:00.000Z',
              rowVersion: 2,
            },
            cards: [],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 10,
              name: 'Staples promo',
              source: 'Staples',
              inputTotalCostCents: 4500,
              archivedAt: '2026-05-11T16:00:00.000Z',
              rowVersion: 2,
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            deal: {
              id: 10,
              name: 'Staples promo',
              source: 'Staples',
              inputTotalCostCents: 4500,
              archivedAt: null,
              rowVersion: 3,
            },
            cards: [],
          },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^deals$/i }));
    await user.click(screen.getByRole('button', { name: /archive staples promo/i }));

    expect(await screen.findByText(/no deals yet/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      '/api/deals/10/archive',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );

    await user.click(screen.getByRole('checkbox', { name: /show archived/i }));

    expect(await screen.findByText(/^archived$/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /unarchive staples promo/i }));

    expect(await screen.findByText(/^active$/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/deals/10/unarchive',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('edits deal metadata from the deals view', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 10,
              name: 'Staples promo',
              source: 'Staples',
              purchaseDate: '2026-05-01',
              inputTotalCostCents: 4500,
              notes: 'Original notes',
              archivedAt: null,
              rowVersion: 1,
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            deal: {
              id: 10,
              name: 'Costco promo',
              source: 'Costco',
              purchaseDate: '2026-05-11',
              inputTotalCostCents: 4500,
              notes: 'Updated notes',
              archivedAt: null,
              rowVersion: 2,
            },
            cards: [],
          },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^deals$/i }));
    await user.click(screen.getByRole('button', { name: /edit staples promo/i }));

    const dialog = await screen.findByRole('dialog', { name: /edit deal/i });
    await user.clear(within(dialog).getByLabelText(/^deal name$/i));
    await user.type(within(dialog).getByLabelText(/^deal name$/i), 'Costco promo');
    await user.clear(within(dialog).getByLabelText(/^source$/i));
    await user.type(within(dialog).getByLabelText(/^source$/i), 'Costco');
    await user.clear(within(dialog).getByLabelText(/^purchase date$/i));
    await user.type(within(dialog).getByLabelText(/^purchase date$/i), '2026-05-11');
    await user.clear(within(dialog).getByLabelText(/^notes$/i));
    await user.type(within(dialog).getByLabelText(/^notes$/i), 'Updated notes');
    await user.click(within(dialog).getByRole('button', { name: /^save changes$/i }));

    expect(await screen.findByText(/^costco promo$/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /edit deal/i })).not.toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/deals/10',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          rowVersion: 1,
          name: 'Costco promo',
          source: 'Costco',
          purchaseDate: '2026-05-11',
          notes: 'Updated notes',
        }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('opens deal detail with cards and totals from the deals view', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 10,
              name: 'Staples promo',
              source: 'Staples',
              purchaseDate: '2026-05-01',
              inputTotalCostCents: 9000,
              notes: 'May promo batch',
              archivedAt: null,
              rowVersion: 1,
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            deal: {
              id: 10,
              name: 'Staples promo',
              source: 'Staples',
              purchaseDate: '2026-05-01',
              inputTotalCostCents: 9000,
              notes: 'May promo batch',
              archivedAt: null,
              rowVersion: 1,
            },
            cards: [
              {
                id: 11,
                brand: 'Target',
                status: 'available',
                faceValueCents: 5000,
                remainingBalanceCents: 5000,
                purchaseCostCents: 4500,
                cardNumberLast4: '1111',
              },
              {
                id: 12,
                brand: 'Amazon',
                status: 'in_use',
                faceValueCents: 5000,
                remainingBalanceCents: 2500,
                purchaseCostCents: 4500,
                cardNumberLast4: '2222',
              },
            ],
          },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^deals$/i }));
    await user.click(screen.getByRole('button', { name: /open staples promo details/i }));

    const dialog = await screen.findByRole('dialog', { name: /deal details/i });
    expect(within(dialog).getByText(/^staples$/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/2026-05-01/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/may promo batch/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/2 cards/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/\$100\.00/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/\$75\.00/i)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/\$90\.00/i).length).toBeGreaterThan(0);
    expect(within(dialog).getByRole('row', { name: /available target/i })).toBeInTheDocument();
    expect(within(dialog).getByRole('row', { name: /in use amazon/i })).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/deals/10',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('records card usage from the card table action', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Target',
              status: 'available',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            card: {
              id: 1,
              brand: 'Target',
              status: 'in_use',
              faceValueCents: 5000,
              remainingBalanceCents: 3750,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
              cardType: 'merchant',
              source: 'Staples',
              expirationDate: '2028-01-31',
              format: 'digital',
              notes: 'Promo notes',
              rowVersion: 2,
            },
            transactions: [] as unknown[],
            usages: [{ id: 7, amountCents: 1250, merchant: 'Target' }],
            audit: [],
          },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^cards$/i }));
    await user.click(screen.getByRole('button', { name: /use target/i }));

    expect(screen.getByRole('heading', { name: /record usage/i })).toBeInTheDocument();
    await user.type(screen.getByLabelText(/^amount$/i), '12.50');
    await user.type(screen.getByLabelText(/^merchant$/i), 'Target');
    await user.click(screen.getByRole('button', { name: /^record usage$/i }));

    expect(await screen.findByText(/\$37\.50/)).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /in use target/i })).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/cards/1/use',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          amountCents: 1250,
          merchant: 'Target',
        }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('opens card detail with transactions usages and audit summary', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Target',
              status: 'in_use',
              faceValueCents: 5000,
              remainingBalanceCents: 3750,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            card: {
              id: 1,
              brand: 'Target',
              status: 'in_use',
              faceValueCents: 5000,
              remainingBalanceCents: 3750,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
              cardType: 'merchant',
              source: 'Staples',
              expirationDate: '2028-01-31',
              format: 'digital',
              notes: 'Promo notes',
              rowVersion: 2,
            },
            transactions: [{ id: 8, type: 'sale', salePriceCents: 3800, buyerName: 'Dealer A' }],
            usages: [{ id: 7, amountCents: 1250, merchant: 'Target' }],
            audit: [{ id: 12, action: 'card.use', timestamp: '2026-05-11T16:00:00.000Z' }],
          },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^cards$/i }));
    await user.click(screen.getByRole('button', { name: /open target details/i }));

    const dialog = await screen.findByRole('dialog', { name: /card details/i });
    expect(within(dialog).getAllByText(/^target$/i).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/\*\*\*\* 1111/i).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/merchant/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/staples/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/2028-01-31/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/digital/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/promo notes/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/dealer a/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/card.use/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/2026/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/cards/1',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('undoes a usage from the card detail panel', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Target',
              status: 'in_use',
              faceValueCents: 5000,
              remainingBalanceCents: 3750,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            card: {
              id: 1,
              brand: 'Target',
              status: 'in_use',
              faceValueCents: 5000,
              remainingBalanceCents: 3750,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
              rowVersion: 2,
            },
            transactions: [] as unknown[],
            usages: [{ id: 7, amountCents: 1250, merchant: 'Target', usageDate: '2026-05-11' }],
            audit: [{ id: 12, action: 'card.use', timestamp: '2026-05-11T16:00:00.000Z' }],
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            card: {
              id: 1,
              brand: 'Target',
              status: 'available',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
              rowVersion: 3,
            },
            transactions: [] as unknown[],
            usages: [
              {
                id: 7,
                amountCents: 1250,
                merchant: 'Target',
                usageDate: '2026-05-11',
                isReversed: 1,
                reversalReason: 'Mistyped amount',
              },
            ],
            audit: [
              { id: 13, action: 'card.undo_usage', timestamp: '2026-05-11T16:05:00.000Z' },
              { id: 12, action: 'card.use', timestamp: '2026-05-11T16:00:00.000Z' },
            ],
          },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^cards$/i }));
    await user.click(screen.getByRole('button', { name: /open target details/i }));

    const dialog = await screen.findByRole('dialog', { name: /card details/i });
    await user.click(within(dialog).getByRole('button', { name: /undo target usage/i }));
    await user.type(within(dialog).getByLabelText(/^reason$/i), 'Mistyped amount');
    await user.click(within(dialog).getByRole('button', { name: /^undo usage$/i }));

    expect(await within(dialog).findByText(/available/i)).toBeInTheDocument();
    expect(within(dialog).getAllByText(/\$50\.00/i).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/reversed/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/mistyped amount/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/card.undo_usage/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/cards/1/undo-usage',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          usageId: 7,
          reason: 'Mistyped amount',
        }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('sells a card from the card table action', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Target',
              status: 'in_use',
              faceValueCents: 5000,
              remainingBalanceCents: 3750,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            card: {
              id: 1,
              brand: 'Target',
              status: 'sold',
              faceValueCents: 5000,
              remainingBalanceCents: 0,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
              rowVersion: 3,
            },
            transactions: [{ id: 8, type: 'sale', salePriceCents: 3800, buyerName: 'Dealer A' }],
            usages: [] as unknown[],
            audit: [],
          },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^cards$/i }));
    await user.click(screen.getByRole('button', { name: /sell target/i }));

    const dialog = screen.getByRole('dialog', { name: /sell card/i });
    expect(within(dialog).getByText(/\$37\.50/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^sale price$/i), '38.00');
    await user.type(within(dialog).getByLabelText(/^buyer$/i), 'Dealer A');
    await user.selectOptions(within(dialog).getByLabelText(/^buyer type$/i), 'dealer');
    await user.click(within(dialog).getByRole('button', { name: /^record sale$/i }));

    expect(await screen.findByRole('row', { name: /sold target/i })).toBeInTheDocument();
    expect(screen.getByText(/\$0\.00/)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/cards/1/sell',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          salePriceCents: 3800,
          buyerName: 'Dealer A',
          buyerType: 'dealer',
        }),
        headers: expect.objectContaining({
          'Idempotency-Key': expect.stringMatching(/^ui_/),
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('undoes a sold card sale from the card table action', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Target',
              status: 'sold',
              faceValueCents: 5000,
              remainingBalanceCents: 0,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            card: {
              id: 1,
              brand: 'Target',
              status: 'in_use',
              faceValueCents: 5000,
              remainingBalanceCents: 3750,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
              rowVersion: 4,
            },
            transactions: [
              { id: 9, type: 'sale_reversal', reason: 'Buyer canceled' },
              { id: 8, type: 'sale', salePriceCents: 3800 },
            ],
            usages: [] as unknown[],
            audit: [],
          },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^cards$/i }));
    await user.click(screen.getByRole('button', { name: /undo sale target/i }));

    const dialog = screen.getByRole('dialog', { name: /undo sale/i });
    await user.type(within(dialog).getByLabelText(/^reason$/i), 'Buyer canceled');
    await user.click(within(dialog).getByRole('button', { name: /^undo sale$/i }));

    expect(await screen.findByRole('row', { name: /in use target/i })).toBeInTheDocument();
    expect(screen.getByText(/\$37\.50/)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/cards/1/undo-sale',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          reason: 'Buyer canceled',
        }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('voids an active card from the card table action', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Target',
              status: 'in_use',
              faceValueCents: 5000,
              remainingBalanceCents: 3750,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            card: {
              id: 1,
              brand: 'Target',
              status: 'void',
              faceValueCents: 5000,
              remainingBalanceCents: 0,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
              rowVersion: 5,
            },
            transactions: [] as unknown[],
            usages: [{ id: 11, amountCents: 3750, merchant: 'Write-off (Voided)', isWriteOff: 1 }],
            audit: [],
          },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^cards$/i }));
    await user.click(screen.getByRole('button', { name: /void target/i }));

    const dialog = screen.getByRole('dialog', { name: /void card/i });
    expect(within(dialog).getByText(/\$37\.50/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText(/^reason$/i), 'Card no longer valid');
    await user.click(within(dialog).getByRole('button', { name: /^void card$/i }));

    expect(await screen.findByRole('row', { name: /void target/i })).toBeInTheDocument();
    expect(screen.getByText(/\$0\.00/)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/cards/1/void',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          reason: 'Card no longer valid',
        }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('searches cards by exact card number from the cards view', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Target',
              status: 'available',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
            {
              id: 2,
              brand: 'Amazon',
              status: 'available',
              faceValueCents: 2500,
              remainingBalanceCents: 2500,
              purchaseCostCents: 2200,
              cardNumberLast4: '2222',
            },
          ],
          page: { total: 2, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Target',
              status: 'available',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^cards$/i }));
    expect(screen.getByText(/amazon/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^exact credential$/i), '4111 1111 1111 1111');
    await user.click(screen.getByRole('button', { name: /^search cards$/i }));

    expect(await screen.findByText(/target/i)).toBeInTheDocument();
    expect(screen.queryByText(/amazon/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/4111 1111 1111 1111/i)).not.toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/cards?credential=4111+1111+1111+1111',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('filters cards by status and brand from the cards view', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Target',
              status: 'reserved',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
            {
              id: 2,
              brand: 'Amazon',
              status: 'available',
              faceValueCents: 2500,
              remainingBalanceCents: 2500,
              purchaseCostCents: 2200,
              cardNumberLast4: '2222',
            },
          ],
          page: { total: 2, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Target',
              status: 'reserved',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^cards$/i }));
    expect(screen.getByText(/amazon/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/^status$/i), 'reserved');
    await user.type(screen.getByLabelText(/^brand$/i), 'Target');
    await user.click(screen.getByRole('button', { name: /^search cards$/i }));

    expect(await screen.findByText(/target/i)).toBeInTheDocument();
    expect(screen.queryByText(/amazon/i)).not.toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/cards?status=reserved&brand=Target',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('filters cards by source deal expiration text and sort from the cards view', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              dealId: 10,
              brand: 'Target',
              status: 'available',
              source: 'Staples',
              expirationDate: '2026-05-30',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
            {
              id: 2,
              dealId: 11,
              brand: 'Amazon',
              status: 'available',
              source: 'Costco',
              expirationDate: '2028-01-31',
              faceValueCents: 2500,
              remainingBalanceCents: 2500,
              purchaseCostCents: 2200,
              cardNumberLast4: '2222',
            },
          ],
          page: { total: 2, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 10,
              name: 'Staples May promo',
              source: 'Staples',
              inputTotalCostCents: 4500,
              rowVersion: 1,
            },
            {
              id: 11,
              name: 'Costco promo',
              source: 'Costco',
              inputTotalCostCents: 2200,
              rowVersion: 1,
            },
          ],
          page: { total: 2, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              dealId: 10,
              brand: 'Target',
              status: 'available',
              source: 'Staples',
              expirationDate: '2026-05-30',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^cards$/i }));
    expect(screen.getByText(/amazon/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/^source$/i), 'Staples');
    await user.selectOptions(screen.getByLabelText(/^deal$/i), '10');
    await user.type(screen.getByLabelText(/^expiring by$/i), '2026-06-01');
    await user.type(screen.getByLabelText(/^text$/i), 'holiday');
    await user.selectOptions(screen.getByLabelText(/^sort$/i), 'expirationDate:asc');
    await user.click(screen.getByRole('button', { name: /^search cards$/i }));

    expect(await screen.findByText(/target/i)).toBeInTheDocument();
    expect(screen.queryByText(/amazon/i)).not.toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/cards?source=Staples&dealId=10&expiresBefore=2026-06-01&text=holiday&sortBy=expirationDate&sortDir=asc',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('paginates cards from the cards view', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Target',
              status: 'available',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
          ],
          page: { total: 2, limit: 1, offset: 0, hasMore: true },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 2,
              brand: 'Amazon',
              status: 'available',
              faceValueCents: 2500,
              remainingBalanceCents: 2500,
              purchaseCostCents: 2200,
              cardNumberLast4: '2222',
            },
          ],
          page: { total: 2, limit: 1, offset: 1, hasMore: false },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^cards$/i }));

    expect(screen.getByText(/target/i)).toBeInTheDocument();
    expect(screen.getByText(/1-1 of 2/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /next page/i }));

    expect(await screen.findByText(/amazon/i)).toBeInTheDocument();
    expect(screen.queryByText(/target/i)).not.toBeInTheDocument();
    expect(screen.getByText(/2-2 of 2/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/cards?limit=1&offset=1',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('edits allowed card fields from the cards view', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Target',
              status: 'available',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
              expirationDate: '2027-01-31',
              notes: '',
              rowVersion: 3,
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: 1,
            brand: 'Amazon',
            status: 'available',
            faceValueCents: 5000,
            remainingBalanceCents: 5000,
            purchaseCostCents: 4500,
            cardNumberLast4: '1111',
            expirationDate: '2028-01-31',
            notes: 'Updated notes',
            rowVersion: 4,
          },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^cards$/i }));
    await user.click(screen.getByRole('button', { name: /edit target/i }));

    const dialog = await screen.findByRole('dialog', { name: /edit card/i });
    await user.clear(within(dialog).getByLabelText(/^brand$/i));
    await user.type(within(dialog).getByLabelText(/^brand$/i), 'Amazon');
    await user.clear(within(dialog).getByLabelText(/^expiration date$/i));
    await user.type(within(dialog).getByLabelText(/^expiration date$/i), '2028-01-31');
    await user.type(within(dialog).getByLabelText(/^notes$/i), 'Updated notes');
    await user.click(within(dialog).getByRole('button', { name: /^save changes$/i }));

    expect(await screen.findByText(/amazon/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/cards/1',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          rowVersion: 3,
          brand: 'Amazon',
          expirationDate: '2028-01-31',
          notes: 'Updated notes',
        }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('deletes an untouched available card from the cards view', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Target',
              status: 'available',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(jsonResponse({}, 204));

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^cards$/i }));
    await user.click(screen.getByRole('button', { name: /delete target/i }));

    const dialog = await screen.findByRole('dialog', { name: /delete card/i });
    expect(within(dialog).getByText(/\*\*\*\* 1111/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: /^delete card$/i }));

    expect(await screen.findByText(/no cards yet/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/cards/1',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('reserves and unreserves a card from row actions', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Target',
              status: 'available',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }))
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: 1,
            brand: 'Target',
            status: 'reserved',
            reservedFor: 'Dealer A',
            reservedUntil: '2026-06-01',
            reservedNotes: 'Awaiting payment',
            faceValueCents: 5000,
            remainingBalanceCents: 5000,
            purchaseCostCents: 4500,
            cardNumberLast4: '1111',
            rowVersion: 2,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            id: 1,
            brand: 'Target',
            status: 'available',
            faceValueCents: 5000,
            remainingBalanceCents: 5000,
            purchaseCostCents: 4500,
            cardNumberLast4: '1111',
            rowVersion: 3,
          },
        }),
      );

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^cards$/i }));
    await user.click(screen.getByRole('button', { name: /reserve target/i }));
    const reserveDialog = await screen.findByRole('dialog', { name: /reserve card/i });
    await waitFor(() => expect(within(reserveDialog).getByLabelText(/^reserved for$/i)).toHaveFocus());
    await user.type(within(reserveDialog).getByLabelText(/^reserved for$/i), 'Dealer A');
    await user.type(within(reserveDialog).getByLabelText(/^reserved until$/i), '2026-06-01');
    await user.type(within(reserveDialog).getByLabelText(/^reservation notes$/i), 'Awaiting payment');
    await user.click(within(reserveDialog).getByRole('button', { name: /^reserve card$/i }));

    expect(await screen.findByRole('row', { name: /reserved target dealer a/i })).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      '/api/cards/1/reserve',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          reservedFor: 'Dealer A',
          reservedUntil: '2026-06-01',
          reservedNotes: 'Awaiting payment',
        }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );

    await user.click(screen.getByRole('button', { name: /unreserve target/i }));

    expect(await screen.findByRole('row', { name: /available target/i })).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/cards/1/unreserve',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({}),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('closes reserve dialog with Escape and restores focus', async () => {
    fetchMock()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            setupComplete: true,
            sessionValid: true,
            dekLoaded: true,
            csrfToken: 'csrf_ready',
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 1,
              brand: 'Target',
              status: 'available',
              faceValueCents: 5000,
              remainingBalanceCents: 5000,
              purchaseCostCents: 4500,
              cardNumberLast4: '1111',
            },
          ],
          page: { total: 1, limit: 50, offset: 0, hasMore: false },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: [], page: { total: 0, limit: 50, offset: 0, hasMore: false } }));

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole('heading', { name: /dashboard/i });
    await user.click(screen.getByRole('button', { name: /^cards$/i }));
    const reserveButton = screen.getByRole('button', { name: /reserve target/i });
    await user.click(reserveButton);
    const reserveDialog = await screen.findByRole('dialog', { name: /reserve card/i });
    await waitFor(() => expect(within(reserveDialog).getByLabelText(/^reserved for$/i)).toHaveFocus());

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /reserve card/i })).not.toBeInTheDocument());
    expect(reserveButton).toHaveFocus();
  });
});
