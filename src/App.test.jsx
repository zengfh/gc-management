import { render, screen, waitFor } from '@testing-library/react';
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
});
