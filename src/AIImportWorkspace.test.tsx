import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { AIImportWorkspace } from './AIImportWorkspace';
import type { AiImportAnalyzeHandler } from './appTypes';
import type { ReferenceValueState } from '../shared/domain';

it('lets the user cancel provider work and retry with the pasted text intact', async () => {
  const referenceValues: ReferenceValueState = { card_brand: [], deal_name: [], source: [] };
  let signal: AbortSignal | undefined;
  const analyze = vi.fn<AiImportAnalyzeHandler>().mockImplementation(async (_payload, requestSignal) => {
    signal = requestSignal;
    return new Promise((_resolve, reject) => requestSignal?.addEventListener('abort', () => reject(requestSignal.reason), { once: true }));
  });
  render(<AIImportWorkspace
    onCreateDeal={vi.fn()}
    onAnalyzeAiImport={analyze}
    onLoadAiImportModels={async () => ({ data: { defaultSelection: 'auto', options: [{ id: 'auto', label: 'Auto', provider: 'Auto', model: 'Auto', auto: true }] } })}
    referenceValues={referenceValues}
    onLoadReferenceValues={async () => referenceValues}
    onUpsertReferenceValues={async () => []}
  />);
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^raw gift-card text$/i), 'Amazon $25 Synthetic-Code');
  await user.click(screen.getByRole('button', { name: /^analyze with ai$/i }));
  await user.click(await screen.findByRole('button', { name: /^cancel analysis$/i }));
  await screen.findByText('AI analysis cancelled');
  expect(signal?.aborted).toBe(true);
  expect(screen.getByLabelText(/^raw gift-card text$/i)).toHaveValue('Amazon $25 Synthetic-Code');
  await waitFor(() => expect(screen.getByRole('button', { name: /^analyze with ai$/i })).toBeEnabled());
  expect(analyze).toHaveBeenCalledTimes(1);
});
