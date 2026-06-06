# Reserve Cards Summary Design

Date: 2026-06-06
Status: Approved
Branch: `feat/reserve-cards-summary`

## Goal

After a user selects multiple cards in the Cards tab, clicks **Reserve**, and submits the bulk reserve request, the app should show a table containing all available information for the cards that were successfully reserved. The table should include a **Copy all info** button that copies the same data as tab-separated text, with one card per row and tabs between fields.

## User Flow

1. User opens the Cards tab in an unlocked session.
2. User selects multiple cards.
3. User chooses the bulk **Reserve** action.
4. User enters optional reservation fields: reserved for, reserved until, and reservation notes.
5. User submits the bulk reserve form.
6. The app reserves eligible selected cards.
7. The app displays a **Reserved cards summary** panel for the cards that were actually updated.
8. The user can inspect the summary table in the browser.
9. The user can click **Copy all info** to copy the summary as TSV:
   - one card per row
   - fields separated by tab characters
   - include a header row

## Scope

In scope:

- Bulk reserve only.
- Cards tab only.
- Show a post-submit summary for successfully reserved cards.
- Copy all summary data as TSV.
- Include all available card information, including sensitive revealed credentials when available.
- Include custom credential fields dynamically.
- Avoid saving the copied summary permanently.

Out of scope:

- Single-card reserve summary.
- Bulk use/sell/void summaries.
- Server-side export endpoints.
- Long-term persistence of reserve summary snapshots.
- Cross-device access to a prior reserve summary.

## Data and Security Behavior

The summary is intentionally session-scoped UI state. It should not be written to the database or logs.

Because the requested summary includes all available information, it may contain sensitive values such as card number, code, PIN, access code, network security code, billing ZIP, claim link, barcode value, and custom credential fields. The app should include these values only when they are available in the current unlocked frontend state. If a credential field is not currently revealed or cannot be loaded, the displayed/copied cell should be blank or show a clear unavailable marker.

The first implementation should reuse the existing client-side credential reveal path. If credentials are already visible for the Cards tab, the summary should include the revealed credential details. If they are not already visible, the bulk reserve summary should attempt to reveal credentials for the successfully reserved cards through the existing `onRevealCardCredentials` handler, subject to the current user's permission and unlock state. Failures for one card should not discard the whole summary; the affected card should remain in the summary with unavailable credential fields.

## Summary Columns

The fixed base columns should be:

1. Brand
2. Status
3. Face value
4. Remaining balance
5. Expiration
6. Source
7. Card type
8. Network
9. Credential profile
10. Card number last 4
11. Reserved for
12. Reserved until
13. Reservation notes
14. Card notes
15. Card ID
16. Deal ID

Credential columns should be dynamic. The summary should inspect revealed credential data for all reserved cards and append columns for every credential label/kind that appears. Examples:

- Card number
- Code
- PIN
- Access code
- Network security code
- Billing ZIP
- Claim link
- Barcode value
- Cardholder name
- Custom fields

When multiple cards expose the same credential label/kind, they should share the same column. When a card lacks that field, the cell should be empty.

## UI Design

Use an inline panel below the bulk action panel in the Cards tab.

Panel content:

- Heading: **Reserved cards summary**
- Description explaining that the table contains the cards reserved by the last bulk reserve action.
- **Copy all info** button.
- Copy status message such as **Copied 3 cards.** or an error message if clipboard access fails.
- Responsive table using existing table-wrap styling.
- Dismiss/clear button so the user can hide the summary.

The panel should remain visible after selection is cleared. It should be replaced by the next successful bulk reserve summary.

## Copy Format

Copy format is TSV.

Rules:

- Header row first.
- One card per subsequent row.
- Columns separated by literal tab characters (`\t`).
- Rows separated by newline characters (`\n`).
- Cell values should be normalized to single-line text by replacing tabs/newlines with spaces.
- Empty or missing values should be copied as empty cells.
- Money should match the app's current display formatting, e.g. `$25.00`.

## Error Handling

- If no selected cards are eligible, preserve the existing bulk error and do not show a new summary.
- If reservation succeeds but credential reveal fails for some cards, show the summary for reserved cards and mark unavailable credentials clearly.
- If clipboard write fails, keep the summary visible and show a copy error message.
- If a user dismisses the summary, it should clear only the summary UI, not card data.

## Testing Strategy

Add React tests around the Cards tab bulk reserve workflow:

1. Selecting multiple available cards, submitting Reserve, and receiving updated reserved card responses shows **Reserved cards summary**.
2. The summary table includes fixed card metadata plus revealed credential fields.
3. **Copy all info** calls `navigator.clipboard.writeText` with TSV containing a header row and one row per reserved card, separated by tabs.
4. If one credential reveal request fails, the summary still appears for all successfully reserved cards and marks that card's credentials unavailable.
5. Existing single-card reserve and bulk action tests continue to pass.

## Deployment

After implementation, verify with:

- `npm test`
- `npm run typecheck`
- `npm run build`
- browser smoke on the deployed site after restart

Then merge to `main`, push to GitHub, restart the production user-level `gc-management.service`, and verify `https://gc.hankzeng.com/api/health` plus the Cards tab UI.
