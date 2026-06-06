# Redemption Summary and Bulk Unreserve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the all-info bulk reserve summary with a redemption-only summary and add bulk unreserve.

**Architecture:** Use existing credential-field `copyable` metadata as the durable inclusion flag for reserve summaries. Extend AI import rows with `requiredRedemptionFields`, map those fields into credential payload `copyable` flags, update the reserve summary formatter to include Brand/Remaining plus required fields only, and add `unreserve` to the existing bulk action panel.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, Express, SQLite migrations already supporting credential fields.

---

## File Structure

- Modify `shared/domain.ts`: add optional `sensitivityClass` and `displayHint` to `CredentialField` for UI filtering flexibility.
- Modify `src/bulkImport.ts`: add `requiredRedemptionFields` to drafts; parse header/AI values; set `copyable` in generated credential fields.
- Modify `server/aiImport.ts`: prompt/parse/normalize `requiredRedemptionFields`.
- Modify `src/reserveSummary.ts`: produce Brand + Remaining balance + required credential fields only.
- Modify `src/WorkSurface.tsx`: add `unreserve` bulk action and no reserve summary for unreserve.
- Modify `src/App.test.tsx`, `src/bulkImport.test.ts`, `server/routes/aiImport.test.ts`: add failing tests first, then implementation.
- Modify `src/styles.css`: minor copy text updates only if needed.

## Tasks

### Task 1: Tests for redemption-only reserve summary

- Add/replace App tests so reserve summary expects only Brand, Remaining balance, and required credential fields.
- Verify RED with `npm test -- src/App.test.tsx -t "reserved cards summary"`.
- Update `src/reserveSummary.ts` to pass.
- Verify GREEN and commit.

### Task 2: AI/import required redemption fields

- Add `requiredRedemptionFields: string[]` to `BulkImportDraft`.
- Add parser support for headers like `requiredRedemptionFields`/`required_fields`.
- Add AI schema support and prompt rules.
- Map required fields to credential field `copyable` values.
- Add tests in `src/bulkImport.test.ts` and `server/routes/aiImport.test.ts`.
- Verify targeted tests and commit.

### Task 3: Bulk unreserve

- Add `unreserve` to bulk action types.
- Show Unreserve button when cards are selected.
- Eligible cards: `status === 'reserved'`.
- On submit, call `onUnreserveCard(card)` for each eligible card.
- Add App test for selecting two reserved cards and bulk unreserving them.
- Verify targeted tests and commit.

### Task 4: Full verification and deploy

Run:

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

Merge fast-forward to main, push, restart service, verify health and live assets.
