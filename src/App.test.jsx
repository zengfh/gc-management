import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';

function jsonResponse(body, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
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
    globalThis.fetch
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
        body: JSON.stringify({ unlockSecret: 'a strong unlock phrase' }),
      }),
    );
  });

  it('renders unlock when setup exists but session is locked', async () => {
    globalThis.fetch
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
    await user.click(screen.getByRole('button', { name: /unlock/i }));

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

  it('renders the authenticated work surface with cards and deals', async () => {
    globalThis.fetch
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

  it('creates a deal with a starter card from the dashboard', async () => {
    globalThis.fetch
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
              deal: {
                id: 10,
                name: 'Staples promo',
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
    await user.type(screen.getByLabelText(/^deal name$/i), 'Staples promo');
    await user.type(screen.getByLabelText(/^source$/i), 'Staples');
    await user.type(screen.getByLabelText(/^total cost$/i), '45.00');
    await user.type(screen.getByLabelText(/^card brand$/i), 'Target');
    await user.type(screen.getByLabelText(/^face value$/i), '50.00');
    await user.type(screen.getByLabelText(/^card number$/i), '4111 1111 1111 1111');
    await user.click(screen.getByRole('button', { name: /^create deal$/i }));

    await screen.findByText(/staples promo/i);
    expect(screen.getByText(/target/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/deals',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          name: 'Staples promo',
          source: 'Staples',
          totalCostCents: 4500,
          cards: [
            {
              brand: 'Target',
              cardType: 'merchant',
              faceValueCents: 5000,
              cardNumber: '4111 1111 1111 1111',
            },
          ],
        }),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('archives and restores deals from the deals view', async () => {
    globalThis.fetch
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

  it('records card usage from the card table action', async () => {
    globalThis.fetch
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
              rowVersion: 2,
            },
            transactions: [],
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
    expect(screen.getByText(/in use/i)).toBeInTheDocument();
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
    globalThis.fetch
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
    expect(within(dialog).getByText(/\*\*\*\* 1111/i)).toBeInTheDocument();
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
    globalThis.fetch
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
            transactions: [],
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
            transactions: [],
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
    expect(within(dialog).getByText(/\$50\.00/i)).toBeInTheDocument();
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
    globalThis.fetch
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
            usages: [],
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

    expect(await screen.findByText(/sold/i)).toBeInTheDocument();
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
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );
  });

  it('undoes a sold card sale from the card table action', async () => {
    globalThis.fetch
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
            usages: [],
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

    expect(await screen.findByText(/in use/i)).toBeInTheDocument();
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
    globalThis.fetch
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
            transactions: [],
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

    expect(await screen.findByText(/^void$/i)).toBeInTheDocument();
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
    globalThis.fetch
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

    await user.type(screen.getByLabelText(/^exact card number$/i), '4111 1111 1111 1111');
    await user.click(screen.getByRole('button', { name: /^search cards$/i }));

    expect(await screen.findByText(/target/i)).toBeInTheDocument();
    expect(screen.queryByText(/amazon/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/4111 1111 1111 1111/i)).not.toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenLastCalledWith(
      '/api/cards?cardNumber=4111+1111+1111+1111',
      expect.objectContaining({
        method: 'GET',
      }),
    );
  });

  it('edits allowed card fields from the cards view', async () => {
    globalThis.fetch
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
    globalThis.fetch
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
    globalThis.fetch
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

    expect(await screen.findByText(/reserved/i)).toBeInTheDocument();
    expect(globalThis.fetch).toHaveBeenNthCalledWith(
      4,
      '/api/cards/1/reserve',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({}),
        headers: expect.objectContaining({
          'X-CSRF-Token': 'csrf_ready',
        }),
      }),
    );

    await user.click(screen.getByRole('button', { name: /unreserve target/i }));

    expect(await screen.findByText(/available/i)).toBeInTheDocument();
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
});
