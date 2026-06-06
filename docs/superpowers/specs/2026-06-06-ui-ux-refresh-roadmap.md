# UI/UX Refresh Roadmap

**Date:** 2026-06-06
**Source:** Multi-agent UI/UX audit plus local Playwright screenshot review.

## Goal

Make Gift Card Manager feel calmer, more professional, and easier to operate without weakening existing card-management functionality or security safeguards.

## Design Direction

Move away from the current heavy glass/neon aesthetic toward an operations-dashboard style:

- calmer opaque surfaces
- fewer glows/blur effects
- clearer visual hierarchy
- fewer always-visible actions
- better mobile card/list layouts
- stronger accessibility defaults
- safer reveal/import/bulk-action workflows

## Priority Roadmap

### Checkpoint 1 — Visual Foundation and Accessibility Polish

- Define missing design tokens such as inverse text and large shadow tokens.
- Reduce overused blur/glow/neon surfaces.
- Make typography hierarchy more deliberate.
- Add reduced-motion support.
- Add focus styles for scrollable table wrappers.
- Improve contrast for primary actions and status badges.
- Add accessible active state to nav/theme controls.

### Checkpoint 2 — Dashboard Hierarchy and First-Use State

- Make 3–4 important KPIs prominent and secondary metrics quieter.
- Reduce visual loudness of zero-value metrics.
- Add a guided empty/first-run dashboard state with Add Deal, Bulk Import, and Backup guidance.

### Checkpoint 3 — Cards Inventory Redesign

- Reduce inline row action clutter.
- Keep Details and one primary action visible.
- Move secondary/destructive actions into an overflow menu.
- Improve desktop table clipping by reducing action width and prioritizing columns.
- Add mobile card/list layout for card inventory instead of forcing a wide table.

### Checkpoint 4 — Import and Safety UX

- Consolidate import entry points into a clearer Import/Export hub or menu.
- Make AI import staged and privacy-aware.
- Add dirty-state protection for long forms and import workflows.
- Add safer credential reveal behavior for table-level reveal.
- Add bulk action previews/confirmations.

### Checkpoint 5 — Settings and Backup IA

- Split Settings into task groups.
- Put recommended encrypted backup/export first.
- Strengthen raw export/import confirmations and preview counts.

## Implementation Strategy

Implement in small checkpoints. Each checkpoint should preserve existing functionality, add or update tests first, then verify with targeted tests, typecheck, build, and browser screenshots where possible.

For this first implementation pass, prioritize Checkpoints 1–3 because they address the “ugly” design feedback fastest while minimizing backend risk.
