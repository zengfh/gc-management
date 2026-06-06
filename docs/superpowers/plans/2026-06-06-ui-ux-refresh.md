# UI/UX Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first high-impact UI/UX refresh pass: calmer visual system, accessible controls, clearer dashboard hierarchy, and a less cluttered cards inventory experience.

**Architecture:** Keep the existing React/Vite architecture and component boundaries. Use targeted changes in `src/styles.css`, `src/WorkSurface.tsx`, `src/tableComponents.tsx`, `src/ThemeSwitcher.tsx`, and focused tests in `src/App.test.tsx` / `src/display.test.ts` where behavior changes are visible.

**Tech Stack:** React, TypeScript, Vite, Vitest, Testing Library, custom CSS.

---

## Files and Responsibilities

- `docs/superpowers/specs/2026-06-06-ui-ux-refresh-roadmap.md`: Saved audit roadmap and checkpoint sequence.
- `docs/superpowers/plans/2026-06-06-ui-ux-refresh.md`: Implementation plan and checkpoint log.
- `src/styles.css`: Visual tokens, surface treatment, dashboard metric hierarchy, table/mobile/card responsive styling, focus/reduced-motion/accessibility CSS.
- `src/ThemeSwitcher.tsx`: Theme switcher accessible pressed state and clearer auto label behavior.
- `src/WorkSurface.tsx`: Header action hierarchy, nav active state, dashboard metric grouping/empty state, optional import menu state.
- `src/tableComponents.tsx`: Cards table row action simplification, overflow action menu, mobile row/card behavior, table labels.
- `src/App.test.tsx`: Regression coverage for dashboard empty state/header actions/cards row action behavior.

## Checkpoint 0 — Save Roadmap and Baseline

- [ ] Save roadmap document.
- [ ] Save implementation plan.
- [ ] Run baseline verification:
  - `npm run typecheck`
  - `npm run build`
  - targeted current UI tests if feasible
- [ ] Commit docs checkpoint.

## Checkpoint 1 — Visual Foundation and Accessibility

- [ ] Add failing tests for theme/nav accessible state where practical.
- [ ] Implement missing tokens and calmer surfaces in `src/styles.css`.
- [ ] Add `prefers-reduced-motion` block.
- [ ] Add table wrapper focus-visible styling.
- [ ] Add `aria-current` to active nav items and `aria-pressed` to theme buttons.
- [ ] Verify targeted tests, typecheck, and build.
- [ ] Browser-capture dashboard/cards screenshots.
- [ ] Commit checkpoint.

## Checkpoint 2 — Dashboard Hierarchy and Empty State

- [ ] Add failing test for empty dashboard guided state.
- [ ] Refactor dashboard metrics into primary and secondary visual groups without changing metric calculations.
- [ ] Add guided empty state when no tracked cards exist.
- [ ] Verify targeted tests, typecheck, and build.
- [ ] Browser-capture empty and populated dashboard screenshots.
- [ ] Commit checkpoint.

## Checkpoint 3 — Cards Inventory Action Density and Mobile Layout

- [ ] Add failing tests that row actions are simplified and secondary actions remain available.
- [ ] Add an overflow action menu for secondary/destructive card row actions.
- [ ] Keep Details and the most common lifecycle action visible.
- [ ] Add table labels/captions and select-all aria label.
- [ ] Add mobile card/list styling for card inventory rows.
- [ ] Verify targeted tests, typecheck, and build.
- [ ] Browser-capture desktop and mobile cards screenshots.
- [ ] Commit checkpoint.

## Deferred Checkpoints

These are intentionally deferred unless the first three checkpoints complete cleanly and there is enough time:

- Import/Export hub and AI import staged privacy UX.
- Dirty-form confirmation.
- Safer table-level credential reveal timeout.
- Bulk action preview/confirmation.
- Settings subnavigation and backup IA overhaul.

## Completion Verification

Before final handoff:

- `npm run typecheck`
- `npm run build`
- relevant targeted Vitest tests
- browser screenshot smoke with Playwright fallback because `agent-browser` is unavailable in this environment
- `git status --short --branch`
