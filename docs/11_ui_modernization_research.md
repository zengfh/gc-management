# UI Modernization Research and Release Notes

Status: implemented
Date: 2026-05-12

## Research Inputs

Reviewed current guidance from:

- Material Design 3 / Android Developers: color roles, reduced type scale, tonal surface hierarchy, shape, elevation, and responsive navigation patterns.
- IBM Carbon Design System: data-table placement, table title/content guidance, dense data layout, and filtering patterns.
- Shopify Polaris: index-table guidance for long resource lists, filtering, sorting, pagination, and action-oriented rows.
- Atlassian Design System: cohesive product language and restrained primitives for work-focused tools.

## Decisions Applied

- Kept the app operational rather than marketing-like: no hero treatment, no decorative art, and no extra onboarding copy on the main workspace.
- Reworked the visual foundation around neutral canvas/surface tokens with teal primary actions, blue informational accents, amber reserved states, purple sold states, and red destructive states.
- Made tables feel more like first-class inventory tools with stronger sticky headers, row hover states, clearer borders, and full-width search/filter bands near the data.
- Updated buttons, inputs, status badges, panels, combobox menus, warnings, and settings summaries to share a consistent surface, border, focus, and hover language.
- Enlarged slide panels slightly so add/edit/detail flows have more usable width without taking over the whole screen.
- Preserved the existing flows, copy, keyboard behavior, and accessible labels. This release is a design modernization only, not a workflow rewrite.

## Remaining UI Opportunities

- Add saved views for card inventory once users need repeated filter sets.
- Add optional column density controls if large portfolios become common.
- Add bulk actions only after real workflows justify multi-row operations.
