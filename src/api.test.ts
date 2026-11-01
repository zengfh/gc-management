import { afterEach, expect, it, vi } from 'vitest';
import { apiDownload } from './api';

afterEach(() => vi.restoreAllMocks());

it.each([
  'attachment; filename="gift-card-export.sqlite"',
  'attachment; filename=gift-card-export.sqlite',
])('keeps the backup filename for Content-Disposition %s', async (header) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('synthetic backup', { headers: { 'Content-Disposition': header } }));
  const result = await apiDownload('/api/backup/db-file');
  expect(result.filename).toBe('gift-card-export.sqlite');
  expect(await result.blob.text()).toBe('synthetic backup');
});
