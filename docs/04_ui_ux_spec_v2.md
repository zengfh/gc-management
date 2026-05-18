# UI/UX Design Specification v2 - Secure Gift Card Manager

Status: Proposed UI/UX handoff
Review date: 2026-05-10
Primary audience: PM, designer, frontend, QA

## 1. Design Goals

1. Make high-volume inventory work fast and reliable.
2. Keep sensitive credentials hidden unless explicitly needed.
3. Make card state and money values easy to verify at a glance.
4. Prevent irreversible or risky actions through clear confirmations.
5. Support keyboard-driven workflows for power users.
6. Meet accessibility expectations for a future product.
7. Keep layouts simple enough for a small engineering team to maintain.

## 2. Design Principles

### Data dense, not cluttered

Tables should show many rows, but values must remain legible. Use compact spacing with clear alignment, sticky headers, and predictable columns.

### Security is part of UX

The UI should make safe behavior natural: masked credentials, explicit reveal/copy, warnings for plaintext export, and no accidental exposure in toasts or URLs.

### State is visible

Card status should always be clear through text, badge color, icon/shape, and row treatment. Do not rely on color alone.

### Every risky action explains impact

Void, undo sale, undo usage, plaintext export, raw DB export, and import replace require clear confirmation copy and a reason when applicable.

### Keyboard efficiency matters

Power users should be able to add cards, import, search, and navigate tables without constant mouse usage.

## 3. Information Architecture

Primary navigation:

1. Dashboard
2. Cards
3. Deals
4. Transactions
5. Usages
6. Audit Log
7. Import/Export
8. Settings

Optional future admin navigation:

- Users
- Roles
- Account
- Security
- Billing

## 4. App Shell

### Sidebar

- Persistent left navigation on desktop.
- Collapsible on smaller screens.
- Shows active route.
- Bottom area contains lock/logout and app version.

### Top Bar

- Global exact card-number search.
- Add Deal button.
- Add Card button if standalone card creation is allowed.
- Import button.
- Lock/logout control.
- Backup status or last backup timestamp if available.

### Main Content

- Page title.
- Primary actions aligned top-right.
- Filters beneath title for list pages.
- Content region with table, cards, or form.

## 5. Visual System

### Typography

- Primary font: Inter or system sans-serif.
- Monospace font: JetBrains Mono, Fira Code, or system monospace for card numbers, codes, and money where alignment helps.
- Numeric tabular figures enabled where possible.

### Color Tokens

Recommended token approach rather than hard-coded colors:

| Token | Purpose |
|---|---|
| bg.base | Page background |
| bg.surface | Cards, panels, tables |
| bg.elevated | Modals and slide-overs |
| text.primary | Main text |
| text.secondary | Muted text |
| border.subtle | Table borders and dividers |
| status.available | Available state |
| status.reserved | Reserved state |
| status.inUse | In-use state |
| status.sold | Sold state |
| status.usedUp | Used-up state |
| status.void | Void state |
| action.primary | Primary button |
| action.danger | Destructive action |
| focus.ring | Keyboard focus outline |

Accessibility requirements:

- Normal text meets WCAG AA contrast.
- Focus ring must be visible on dark background.
- Status is represented by text plus color and optional icon.

## 6. Core Components

### 6.1 Status Badge

Badge includes:

- Text label.
- Color token.
- Optional icon or shape.
- Tooltip for business meaning where helpful.

Labels:

- Available
- Reserved
- In Use
- Sold
- Used Up
- Void

### 6.2 Money Display

- Always show two decimals for dollar amounts.
- Align numbers right in tables.
- Never calculate display values using floating point in business logic.
- Use muted text for zero values unless zero is important.

### 6.3 Credential Field

Release 5 note: credential fields are profile-driven. The UI must support code-only, card-number-plus-PIN, card-number-plus-access-code, barcode/QR, network prepaid, and custom credential entry instead of always rendering "Card number".

Default state:

- Masked value such as **** 1234 or hidden placeholder.
- Reveal button.
- Copy button.

Reveal behavior:

- Reveals for short timeout, e.g. 5 seconds.
- Auto-hides on navigation, logout, lock, and page blur where practical.
- Does not automatically copy.

Copy behavior:

- User clicks explicit copy button.
- Toast says "Copied" or names the copied field, e.g. "Gift card number copied".
- Toast never includes the secret value.

### 6.4 Data Table

Required features:

- Sticky header.
- Sortable whitelisted columns.
- Column visibility settings in future.
- Pagination or virtual scroll.
- Row click opens detail.
- Actions menu per row.
- Keyboard navigation for row focus.
- Empty state and no-results state.

Avoid hover-only actions as the only access path. Hover actions are fine, but keyboard and touch users need visible or focusable controls.

### 6.5 Slide-over Form

Use slide-over for:

- Add/edit card.
- Add/edit deal.
- Sell card.
- Use card.
- Undo action reason.

Requirements:

- Esc closes only if no unsaved changes or after confirmation.
- Save button disabled while submitting.
- Server errors shown near relevant fields.
- Focus trapped inside panel while open.
- First invalid field receives focus after validation failure.

### 6.6 Confirm Dialog

Use for:

- Void card.
- Undo sale.
- Undo usage.
- Delete never-touched card.
- Plaintext export.
- Raw DB export.
- Import replace.

For high-risk actions, require type-to-confirm or reason input.

## 7. Page Specifications

### 7.1 Setup Page

Purpose: create first unlock secret and initialize encrypted storage.

Fields:

- Unlock secret.
- Confirm unlock secret.
- Optional recovery warning acknowledgement.

UX requirements:

- Explain that losing the unlock secret may make encrypted card data unrecoverable.
- Show strength feedback.
- Reject weak secrets.
- After setup, navigate to dashboard.

### 7.2 Login/Unlock Page

Purpose: unlock encrypted data.

States:

- Setup incomplete.
- Locked after restart.
- Invalid secret.
- Rate limited.
- Server unavailable.

UX requirements:

- Do not call it a short PIN.
- Show lockout countdown after rate limiting.
- Do not reveal whether a user/account exists beyond setup state needed for app.

### 7.3 Dashboard

Widgets:

- Total active remaining balance.
- Available face value.
- Reserved balance.
- In-use balance.
- Cost basis.
- Active gross margin.
- Sold proceeds and realized P&L when latest sale data exists.
- Expiring soon.
- Stale reservations.
- Recent activity.

Actions:

- Add Deal.
- Import CSV.
- Export Backup.

Empty state:

- "No cards yet. Start by adding a deal or importing CSV."

### 7.4 Cards List

Columns:

- Status
- Brand
- Reservation summary when reserved
- Last 4
- Type
- Format
- Face Value
- Remaining Balance
- Purchase Cost
- Deal
- Source
- Expiration
- Updated
- Actions

Filters:

- Status
- Brand
- Type
- Source
- Deal
- Expiration window
- Has remaining balance
- Search by exact full card number

Row actions:

- View
- Reserve/Unreserve; reserve opens a panel for reserved-for, reserved-until, and reservation notes
- Sell
- Use
- Edit
- Void

Rules:

- Only show valid actions for current status.
- Disabled actions should explain why if visible.

### 7.5 Card Detail

Sections:

1. Header: brand, status badge, remaining balance, face value.
2. Credential panel: masked/reveal/copy values.
3. Metadata: deal, source, purchase cost, expiration, format, notes.
4. Reservation metadata: reserved for, reserved until, reservation notes.
5. Actions: valid state actions.
6. Transactions table.
7. Usages table with reversed toggle.
8. Audit timeline.

Safety:

- Terminal status warning for sold/used-up/void.
- Unsaved edit confirmation.
- Sensitive values hidden by default.

### 7.6 Add Deal and Batch Cards

Recommended flow:

1. Deal details.
2. Cost allocation settings.
3. Batch card grid.
4. Validation review.
5. Create deal and cards.

Deal details:

- Deal name is optional.
- Source remains optional.
- Total cost is optional.
- Deal name, Source, and Brand use typeahead dropdowns backed by the local reference index.
- Typeahead matching is case-insensitive substring matching, so `Amazon` can be found with `A`, `Am`, `maz`, or `zon`.
- On create, new deal/source/brand values open an index review modal before submission.
- The review modal shows close typo matches, for example `Amazin` suggests `Amazon`, and lets the user either use the indexed value or add the new value.

Batch grid columns:

- Brand
- Card type
- Network if prepaid
- Face value
- Purchase cost override
- Credential profile
- Profile-specific credential fields, e.g. single code/PIN/claim code, card number plus PIN, card number plus access code, barcode value/format, valid-through date, cardholder name, billing ZIP/address.
- Merchant card entry should not show PIN, access code, and billing ZIP as one combined default form. Best Buy/Home Depot-style cards need card number plus PIN; Target-style cards need card number plus access code or PIN; DoorDash-style cards need one primary code only.
- Expiration
- Format
- Notes

Credential profile behavior:

- Selecting a known brand applies a default profile and field labels.
- The user can override the profile before submission.
- Network prepaid cards show CVV/CVC/CID policy copy and do not save security codes in product mode.
- Barcode profiles render a scannable barcode/QR after explicit reveal.

Keyboard behavior:

- Tab moves to next cell.
- Shift+Tab moves backward.
- Enter creates new row or moves down depending on mode.
- Paste supports multiple rows from spreadsheet.
- Invalid cells are highlighted with inline messages.

Cost allocation:

- User may enter total cost.
- User may set explicit cost per row.
- Remaining cost is allocated proportionally or evenly based on selected strategy.
- UI shows allocation summary and confirms total exactly matches cents.

### 7.7 Sell Card Modal

Fields:

- Buyer name.
- Buyer type.
- Sale price.
- Platform.
- Transaction date.
- Notes.

Display:

- Current status.
- Remaining balance snapshot.
- Purchase cost.
- Estimated profit/loss if available.

Confirmation:

- For in-use cards, explicitly state that only remaining balance is being sold and current remaining balance will be snapshotted.

### 7.8 Use Card Modal

Fields:

- Amount.
- Merchant.
- Usage date.
- Description.

Display:

- Current remaining balance.
- New remaining balance preview.
- Status result preview: in_use or used_up.

Validation:

- Amount > 0.
- Amount <= current remaining balance.
- Use cents safely.

### 7.9 Undo Sale and Undo Usage

Requirements:

- Show exactly what will change.
- Require reason.
- Confirm balance/status result.
- For undo usage, reject write-offs and show reason.

### 7.10 Void Card

Requirements:

- Explain void creates write-off usage for remaining balance.
- Show current balance and write-off amount.
- Require reason or confirmation.
- Warn that void is not the same as delete.

### 7.11 CSV Import

Loose bulk import:

- A Bulk Import action accepts many gift-card lines in one plain textarea.
- The parser is rule-based for now and must support common examples such as `Doordash 50 abcd`, `Bestbuy $50 abcd ef`, tab-separated spreadsheet rows, code/PIN-only rows, and brand/code rows with missing value.
- The parser can also read simple CSV/TSV files with headers such as `brand,value,code,pin,profile,source,notes` or rows without headers.
- Analysis opens one review dialog for the whole pasted/uploaded batch, not one popup per line.
- The review dialog shows one editable row per parsed card with line number, brand, face value, credential type, primary code/card number, secondary PIN/access code, and warnings.
- Missing brand, value, and required credential fields are editable in the review dialog before confirm.
- Confirm imports only when all rows are complete, then creates cards through the normal encrypted create-deal flow.
- New brands discovered during review are added to the local hint index on import.
- Future parsing may call an AI extraction API, but the MVP parser must remain deterministic and testable.

Flow:

1. Upload file.
2. Map columns if needed.
3. Preview rows.
4. Fix or download error report.
5. Confirm import.

Implemented Release 2 import templates:

- GC Manager template with canonical headers.
- Marketplace template with `Merchant`, `Value`, `Cost`, `Number`, `Claim Code`, `Postal Code`, `Expires`, `Delivery`, `Seller`, and `Memo` aliases.
- Prepaid template with `Issuer`, `Card Category`, `Payment Network`, `Face Amount`, `Cost Basis`, `Account Number`, `PIN`, `Billing Postal Code`, `Exp Date`, `Medium`, `Purchase Source`, and `Description` aliases.

Preview table:

- Row number.
- Parsed fields.
- Validation errors.
- Duplicate/conflict indicators.
- Cost allocation summary.

Safety:

- Confirm step revalidates.
- No data committed during preview.
- Large files show progress.

### 7.12 Backup and Export

Backup page sections:

- Raw encrypted database export.
- Plaintext JSON export.
- Encrypted portable export when implemented.
- Import replace.
- Import merge.

Plaintext export UX:

- Warning panel with critical language.
- Fresh unlock secret field.
- Type EXPORT to confirm.
- Checkbox acknowledging the file contains spendable credentials.
- Button styled as dangerous action.

Import replace UX:

- Warning that current data will be replaced.
- Automatic backup status before replace.
- Summary of imported counts.
- Confirmation phrase.

### 7.13 Audit Log

Filters:

- Entity type.
- Action.
- Date range.
- Actor.
- Entity ID.

List columns:

- Timestamp.
- Actor.
- Action.
- Entity.
- Summary.

Detail:

- Redacted before/after diff.
- Request ID.
- Related entity link.

### 7.14 Settings

Implemented Release 2 backup settings:

- Backup status summary: last backup, next due, and plaintext export status.
- Backup reminder interval in days; `0` disables reminder due state.
- Plaintext JSON export toggle.
- Current unlock secret required before saving backup settings.
- Backup history timestamps for encrypted JSON, plaintext JSON, and raw database exports.

Implemented Release 3 admin settings:

- User Access table with active/disabled status, role selectors, and add-user form.
- Support Policy form with support access enablement, contact, policy URL, notes, and last-updated summary.
- Data Policy form for audit, idempotency, session, and login-attempt retention days.
- Data Operations controls for sanitized export, retention purge, and inventory deletion with exact confirmation text.
- Read-only viewer sessions hide Settings, Backup, Import, Add Deal, and credential reveal actions.

Rules:

- Do not show the unlock secret or backup passphrase in settings status, toasts, or audit summaries.
- Do not show temporary user unlock secrets in success messages or audit summaries.
- If plaintext export is disabled, the backend must reject plaintext export even if a stale UI still shows the export button.
- Keep unlock-secret rotation in the same Settings area, but visually separated from backup settings.
- Destructive data operations must use danger styling, current unlock secret, exact confirmation text, and a result summary that does not include credential values.

## 8. Global States

### Loading

- Use skeleton rows for tables.
- Use button spinner for actions.
- Avoid blocking entire page unless required.

### Empty

Good empty states:

- Explain what the page is for.
- Provide primary action.
- Avoid blaming the user.

### Error

Error messages should:

- Say what happened.
- Say what the user can do.
- Include request ID for unexpected errors.
- Avoid exposing internal stack traces.

### Locked

When DEK is not loaded:

- Hide sensitive app content.
- Show unlock page.
- Preserve intended route after successful login if safe.

## 9. Accessibility Requirements

- All interactive controls are keyboard reachable.
- Focus order follows visual order.
- Modals trap focus, support Escape close, and restore focus on close. Implemented for slide panels in Release 2 milestone 5.
- Automated Playwright + axe checks cover Dashboard, Cards, Add Deal, Backup, and Settings with WCAG A/AA tags. Implemented in Release 2 milestone 8.
- Error messages are associated with fields.
- Status color is paired with text or icon.
- Text contrast meets WCAG AA.
- Touch targets are at least practical minimum size on mobile/tablet.
- Screen-reader labels exist for icon-only buttons.
- Reduced-motion preference is respected.

## 10. Responsive Behavior

Desktop first is acceptable for MVP, but avoid desktop-only assumptions.

Breakpoints:

- Desktop: full sidebar and tables.
- Tablet: collapsible sidebar, fewer default columns.
- Mobile: card-list view may replace wide table; critical actions remain accessible.

Minimum support recommendation:

- MVP: desktop and tablet web.
- Product: mobile-responsive read/actions for common flows.

## 11. UX Copy Guidelines

Use plain, direct language.

Examples:

- "This export contains full card numbers and PINs. Anyone with the file may be able to spend your cards."
- "This card is sold. Only notes can be edited. Undo the sale to make inventory changes."
- "This usage is a void write-off and cannot be undone."
- "The card changed since you opened it. Reload and try again."
- "Network-card security codes are not saved."

Avoid:

- Calling the unlock secret a PIN unless numeric-only strong-code mode is intentionally selected.
- Saying the clipboard will be cleared.
- Saying data is unrecoverable without explaining backup/unlock secret implications.

## 12. UI Definition of Done

A screen or flow is done when:

- It handles loading, empty, success, validation error, server error, and locked states.
- It is keyboard usable.
- Sensitive values are masked by default.
- Invalid actions are hidden or explained.
- Risky actions have confirmation and copy reviewed by PM/security.
- API errors map to user-friendly messages.
- E2E selectors exist for critical actions.
- Accessibility checks pass for the flow.
- No sensitive data appears in URLs, toasts, console logs, or analytics.
