# Reserve Cards Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a post-bulk-reserve table of all successfully reserved card information and copy it as tab-separated rows.

**Architecture:** Add a focused client-side summary utility for turning cards plus revealed credentials into columns, rows, and TSV. Wire it into `WorkSurface` bulk reserve success handling, fetch credentials through the existing reveal handler, render an inline summary panel, and cover the workflow with React tests.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, existing Express/Vite app.

---

## File Structure

- Create `src/reserveSummary.ts`: pure helper functions and types for summary columns, row values, credential flattening, TSV escaping, and copy text generation.
- Modify `src/WorkSurface.tsx`: maintain last reserve summary state, reveal credentials for successfully reserved cards, render the summary panel, and copy TSV through `navigator.clipboard.writeText`.
- Modify `src/App.test.tsx`: add workflow tests for bulk reserve summary rendering, TSV copy, and partial credential reveal failure.
- Modify `src/styles.css`: add small styles for the inline summary panel and copy status.

## Task 1: Pure summary utility

**Files:**
- Create: `src/reserveSummary.ts`
- Test: add inline coverage through `src/App.test.tsx` in later tasks; utility remains pure and small enough to exercise via UI workflow.

- [ ] **Step 1: Create `src/reserveSummary.ts` with the public API**

```ts
import type { Card, CredentialField, RevealedCredentials } from '../shared/domain';
import { formatMoney, statusLabels } from './display';

export interface ReserveSummaryColumn {
  key: string;
  label: string;
}

export interface ReserveSummaryRow {
  card: Card;
  values: Record<string, string>;
}

export interface ReserveSummary {
  columns: ReserveSummaryColumn[];
  rows: ReserveSummaryRow[];
  unavailableCredentialCardIds: Set<string>;
}

export type RevealedCredentialsByCardId = Record<string, RevealedCredentials | null | undefined>;

export const baseReserveSummaryColumns: ReserveSummaryColumn[] = [
  { key: 'brand', label: 'Brand' },
  { key: 'status', label: 'Status' },
  { key: 'faceValue', label: 'Face value' },
  { key: 'remainingBalance', label: 'Remaining balance' },
  { key: 'expiration', label: 'Expiration' },
  { key: 'source', label: 'Source' },
  { key: 'cardType', label: 'Card type' },
  { key: 'network', label: 'Network' },
  { key: 'credentialProfile', label: 'Credential profile' },
  { key: 'cardNumberLast4', label: 'Card number last 4' },
  { key: 'reservedFor', label: 'Reserved for' },
  { key: 'reservedUntil', label: 'Reserved until' },
  { key: 'reservedNotes', label: 'Reservation notes' },
  { key: 'notes', label: 'Card notes' },
  { key: 'cardId', label: 'Card ID' },
  { key: 'dealId', label: 'Deal ID' },
];

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function credentialColumnKey(field: Pick<CredentialField, 'label' | 'fieldKind' | 'fieldKey'>): string {
  const raw = `${field.label || field.fieldKind || field.fieldKey}`.trim().toLowerCase();
  const normalized = raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return `credential:${normalized || field.fieldKind || field.fieldKey}`;
}

function credentialColumnLabel(field: Pick<CredentialField, 'label' | 'fieldKind'>): string {
  if (field.fieldKind === 'pin' || field.fieldKind === 'access_code') return field.fieldKind === 'pin' ? 'PIN' : field.label || 'Access code';
  if (field.fieldKind === 'billing_postal_code') return field.label || 'Billing ZIP';
  if (field.fieldKind === 'network_security_code') return field.label || 'Security code';
  return field.label || field.fieldKind;
}

function credentialFields(credentials?: RevealedCredentials | null): CredentialField[] {
  const fields: CredentialField[] = [...(credentials?.credentials?.fields || [])];
  if (credentials?.cardNumber && !fields.some((field) => field.fieldKind === 'card_number')) {
    fields.push({ fieldKey: 'cardNumber', fieldKind: 'card_number', label: 'Card number', value: credentials.cardNumber, copyable: true });
  }
  if (credentials?.pin && !fields.some((field) => field.fieldKind === 'pin')) {
    fields.push({ fieldKey: 'pin', fieldKind: 'pin', label: 'PIN', value: credentials.pin, copyable: true });
  }
  if (credentials?.billingZip && !fields.some((field) => field.fieldKind === 'billing_postal_code')) {
    fields.push({ fieldKey: 'billingZip', fieldKind: 'billing_postal_code', label: 'Billing ZIP', value: credentials.billingZip, copyable: true });
  }
  return fields.filter((field) => field.value !== null && field.value !== undefined && String(field.value).length > 0);
}

export function buildReserveSummary(
  cards: Card[],
  revealedCredentialsByCardId: RevealedCredentialsByCardId = {},
  unavailableCredentialCardIds: Set<string> = new Set(),
): ReserveSummary {
  const credentialColumns = new Map<string, ReserveSummaryColumn>();
  const credentialValuesByCardId = new Map<string, Record<string, string>>();

  for (const card of cards) {
    const cardId = String(card.id);
    const values: Record<string, string> = {};
    for (const field of credentialFields(revealedCredentialsByCardId[cardId])) {
      const key = credentialColumnKey(field);
      if (!credentialColumns.has(key)) {
        credentialColumns.set(key, { key, label: credentialColumnLabel(field) });
      }
      values[key] = normalizeCell(field.value);
    }
    credentialValuesByCardId.set(cardId, values);
  }

  const columns = [...baseReserveSummaryColumns, ...credentialColumns.values()];
  const rows = cards.map((card) => {
    const values: Record<string, string> = {
      brand: normalizeCell(card.brand),
      status: normalizeCell(statusLabels[card.status] || card.status),
      faceValue: formatMoney(card.faceValueCents),
      remainingBalance: formatMoney(card.remainingBalanceCents),
      expiration: normalizeCell(card.expirationDate),
      source: normalizeCell(card.source),
      cardType: normalizeCell(card.cardType),
      network: normalizeCell(card.network),
      credentialProfile: normalizeCell(card.credentialProfile),
      cardNumberLast4: normalizeCell(card.cardNumberLast4),
      reservedFor: normalizeCell(card.reservedFor),
      reservedUntil: normalizeCell(card.reservedUntil),
      reservedNotes: normalizeCell(card.reservedNotes),
      notes: normalizeCell(card.notes),
      cardId: normalizeCell(card.id),
      dealId: normalizeCell((card as Card & { dealId?: string | number | null }).dealId),
      ...credentialValuesByCardId.get(String(card.id)),
    };
    if (unavailableCredentialCardIds.has(String(card.id))) {
      for (const column of columns) {
        if (column.key.startsWith('credential:') && !values[column.key]) {
          values[column.key] = 'Unavailable';
        }
      }
    }
    return { card, values };
  });

  return { columns, rows, unavailableCredentialCardIds };
}

export function reserveSummaryToTsv(summary: ReserveSummary): string {
  const header = summary.columns.map((column) => normalizeCell(column.label)).join('\t');
  const rows = summary.rows.map((row) => summary.columns.map((column) => normalizeCell(row.values[column.key])).join('\t'));
  return [header, ...rows].join('\n');
}
```

- [ ] **Step 2: Run typecheck for the new utility**

Run: `npm run typecheck`

Expected: TypeScript compiles or points to type issues in the new file.

- [ ] **Step 3: Commit utility**

```bash
git add src/reserveSummary.ts
git commit -m "feat: add reserve summary formatter"
```

## Task 2: Failing tests for bulk reserve summary

**Files:**
- Modify: `src/App.test.tsx`

- [ ] **Step 1: Add clipboard setup to the test**

Add tests near the existing card reserve tests. Each test should create a clipboard mock locally:

```ts
const writeText = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText },
});
```

- [ ] **Step 2: Add failing test for summary rendering and copy TSV**

Add a test that:

1. Authenticates unlocked.
2. Loads two available cards with full metadata.
3. Selects both cards in the Cards tab.
4. Clicks Reserve and submits fields.
5. Mocks reserve responses returning reserved card objects.
6. Mocks reveal responses returning credentials for both cards.
7. Expects a **Reserved cards summary** heading.
8. Expects the table to include brands, reserved fields, and credential values.
9. Clicks **Copy all info**.
10. Expects clipboard text to contain header labels and one tab-separated row per card.

Use accessible checkbox labels from the cards table, e.g. `/select target/i` and `/select amazon/i`; if exact labels differ, inspect rendered labels and adjust to the existing accessible names.

- [ ] **Step 3: Add failing test for partial credential reveal failure**

Add a test that:

1. Reserves two selected cards successfully.
2. Returns one reveal success and one reveal error response.
3. Expects the summary to still show both cards.
4. Expects unavailable credential text to be visible for the failed card.

- [ ] **Step 4: Verify RED**

Run: `npm test -- src/App.test.tsx -t "bulk reserve"`

Expected: New tests fail because the **Reserved cards summary** UI and copy behavior do not exist yet.

## Task 3: Implement WorkSurface state and reserve summary generation

**Files:**
- Modify: `src/WorkSurface.tsx`

- [ ] **Step 1: Import helpers and types**

Add imports:

```ts
import type { RevealedCredentials } from '../shared/domain';
import { buildReserveSummary, reserveSummaryToTsv, type ReserveSummary } from './reserveSummary';
```

If `RevealedCredentials` is already imported from `../shared/domain`, merge the type into that import instead of duplicating it.

- [ ] **Step 2: Add component state**

Inside `WorkSurface`, add:

```ts
const [reserveSummary, setReserveSummary] = useState<ReserveSummary | null>(null);
const [reserveSummaryCopyMessage, setReserveSummaryCopyMessage] = useState('');
const [reserveSummaryCopyError, setReserveSummaryCopyError] = useState('');
```

- [ ] **Step 3: Add credential collection helper**

Inside `WorkSurface`, add an async helper:

```ts
async function revealCredentialsForReserveSummary(cardsToReveal: Card[]) {
  const revealed: Record<string, RevealedCredentials | null> = {};
  const unavailable = new Set<string>();
  for (const card of cardsToReveal) {
    const cardId = String(card.id);
    if (revealedCredentialsByCardId[cardId]) {
      revealed[cardId] = revealedCredentialsByCardId[cardId];
      continue;
    }
    try {
      const response = await onRevealCardCredentials(cardId);
      revealed[cardId] = response.data;
    } catch {
      revealed[cardId] = null;
      unavailable.add(cardId);
    }
  }
  return { revealed, unavailable };
}
```

- [ ] **Step 4: Update bulk reserve success branch**

In `submitBulkAction`, collect updated reserved cards:

```ts
const updatedCards: Card[] = [];
```

When `bulkAction === 'reserve'`, push the returned card into `updatedCards`. Because `onReserveCard` currently returns `Promise<unknown>`, inspect the returned value safely:

```ts
const result = await onReserveCard(card.id, payload);
const maybeCard = (result as { data?: Card })?.data;
updatedCards.push(maybeCard || { ...card, status: 'reserved', ...payload } as Card);
```

After the loop, before clearing selection/action, add:

```ts
if (bulkAction === 'reserve' && updatedCards.length > 0) {
  const credentials = await revealCredentialsForReserveSummary(updatedCards);
  setReserveSummary(buildReserveSummary(updatedCards, credentials.revealed, credentials.unavailable));
  setReserveSummaryCopyMessage('');
  setReserveSummaryCopyError('');
} else {
  setReserveSummary(null);
}
```

- [ ] **Step 5: Add copy and clear handlers**

Inside `WorkSurface`, add:

```ts
async function copyReserveSummary() {
  if (!reserveSummary) return;
  setReserveSummaryCopyError('');
  setReserveSummaryCopyMessage('');
  try {
    await navigator.clipboard.writeText(reserveSummaryToTsv(reserveSummary));
    setReserveSummaryCopyMessage(`Copied ${reserveSummary.rows.length} card${reserveSummary.rows.length === 1 ? '' : 's'}.`);
  } catch (caught) {
    setReserveSummaryCopyError(errorMessage(caught));
  }
}
```

- [ ] **Step 6: Run targeted tests**

Run: `npm test -- src/App.test.tsx -t "bulk reserve"`

Expected: Tests still fail because the summary render component is not present.

## Task 4: Render summary panel and styles

**Files:**
- Modify: `src/WorkSurface.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add render helper component near `BulkCardActionPanel`**

Add:

```tsx
function ReservedCardsSummaryPanel({
  summary,
  copyMessage,
  copyError,
  onCopy,
  onClear,
}: {
  summary: ReserveSummary;
  copyMessage: string;
  copyError: string;
  onCopy: () => void;
  onClear: () => void;
}) {
  return (
    <section className="reserved-summary-panel" aria-labelledby="reserved-summary-title">
      <div className="reserved-summary-header">
        <div>
          <h3 id="reserved-summary-title">Reserved cards summary</h3>
          <p>These are the cards reserved by the last bulk reserve action. Copy uses one card per row with tabs between fields.</p>
        </div>
        <div className="reserved-summary-actions">
          <button type="button" className="primary-action" onClick={onCopy}>Copy all info</button>
          <button type="button" className="table-action" onClick={onClear}>Dismiss</button>
        </div>
      </div>
      {copyMessage ? <p className="success-copy">{copyMessage}</p> : null}
      {copyError ? <p className="error-copy">{copyError}</p> : null}
      <div className="table-wrap reserved-summary-wrap" tabIndex={0}>
        <table className="reserved-summary-table">
          <caption>Cards reserved in the last bulk reserve action</caption>
          <thead>
            <tr>
              {summary.columns.map((column) => <th key={column.key}>{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {summary.rows.map((row) => (
              <tr key={String(row.card.id)}>
                {summary.columns.map((column) => <td key={column.key}>{row.values[column.key] || ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Render panel below `BulkCardActionPanel` in Cards tab**

In the Cards tab JSX, immediately after `BulkCardActionPanel`, add:

```tsx
{reserveSummary ? (
  <ReservedCardsSummaryPanel
    summary={reserveSummary}
    copyMessage={reserveSummaryCopyMessage}
    copyError={reserveSummaryCopyError}
    onCopy={() => void copyReserveSummary()}
    onClear={() => setReserveSummary(null)}
  />
) : null}
```

- [ ] **Step 3: Add CSS**

Add to `src/styles.css`:

```css
.reserved-summary-panel {
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  box-shadow: var(--shadow-sm);
  padding: 1rem;
  display: grid;
  gap: 0.85rem;
}

.reserved-summary-header {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
}

.reserved-summary-header h3 {
  margin: 0 0 0.25rem;
}

.reserved-summary-header p {
  margin: 0;
  color: var(--color-text-muted);
}

.reserved-summary-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

.reserved-summary-wrap {
  max-height: 24rem;
}

.reserved-summary-table th,
.reserved-summary-table td {
  white-space: nowrap;
}

@media (max-width: 760px) {
  .reserved-summary-header {
    flex-direction: column;
  }
  .reserved-summary-actions {
    justify-content: flex-start;
  }
}
```

- [ ] **Step 4: Verify GREEN for targeted tests**

Run: `npm test -- src/App.test.tsx -t "bulk reserve"`

Expected: The new bulk reserve summary tests pass.

- [ ] **Step 5: Commit UI implementation**

```bash
git add src/WorkSurface.tsx src/styles.css src/App.test.tsx
git commit -m "feat: show bulk reserve card summary"
```

## Task 5: Full verification and finish branch

**Files:**
- None expected beyond prior tasks.

- [ ] **Step 1: Run full verification**

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Expected:

- 25+ test files pass.
- TypeScript passes.
- Production build passes.
- No whitespace errors.

- [ ] **Step 2: Inspect git status and commits**

```bash
git status --short --branch
git --no-pager log --oneline -5
```

Expected: clean feature branch with spec, utility, and UI commits.

- [ ] **Step 3: Merge and deploy after user/developer approval path**

If continuing with the established workflow:

```bash
cd /home/opc/dev/gc-management
git checkout main
git pull --ff-only
git merge --ff-only feat/reserve-cards-summary
npm test
npm run typecheck
npm run build
git push origin main
systemctl --user restart gc-management.service
curl -fsS http://127.0.0.1:5180/api/health
curl -fsS https://gc.hankzeng.com/api/health
```

Expected: main fast-forwards, push succeeds, service restarts, both health checks return `{"data":{"status":"ok","database":"ok"}}`.
