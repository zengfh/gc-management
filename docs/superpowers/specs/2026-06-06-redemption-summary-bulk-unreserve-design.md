# Redemption Summary and Bulk Unreserve Design

Date: 2026-06-06
Status: Approved
Branch: `fix/redemption-summary-bulk-unreserve`

## Goal

Fix the bulk reserve summary so it no longer exposes all card information. After bulk reserve, the summary and copy output must include only:

1. Brand
2. Remaining balance
3. Credential fields required to redeem/use the selected card

Also add a bulk **Unreserve** action for selected reserved cards.

## Requirements

### Redemption-only reserve summary

The reserve summary must not include operational metadata such as status, face value, source, expiration, notes, card ID, deal ID, card type, network, reservation notes, or unrelated stored credential fields.

Examples:

- DoorDash: Brand, Remaining balance, Redemption code
- Best Buy: Brand, Remaining balance, Card number or code, PIN
- Claim-link card: Brand, Remaining balance, Claim link
- Barcode card: Brand, Remaining balance, Barcode, PIN if required
- Network prepaid card: Brand, Remaining balance, Card number, Exp. month/year, security code and/or billing ZIP only when marked required for redemption

### Required redemption metadata

The app should store which credential fields are required to redeem the card. To minimize schema churn, use each credential field's existing `copyable` flag as the reserve-summary inclusion flag:

- `copyable: true` means include this field in reserve summary/copy.
- `copyable: false` means do not include it in reserve summary/copy.

For legacy/manual cards that do not have explicit AI metadata, use a safe profile-based default:

- `claim_code`: primary code, plus PIN if present
- `claim_link`: claim link
- `merchant_number_pin`: card number/primary code plus PIN/access code
- `barcode`: barcode plus PIN if present
- `network_prepaid`: card number; include expiration/security/ZIP only if the field is explicitly copyable
- `custom`: copyable spendable credential fields only

### AI import changes

The AI import prompt should ask the provider to identify required redemption fields and output a `requiredRedemptionFields` list per card. The server should parse and normalize that list, return it to the UI, and the UI should persist it by setting credential field `copyable` values when creating the cards.

If AI omits the list, fall back to profile defaults.

### Bulk unreserve

When selected cards include reserved cards, the Cards bulk action panel should offer **Unreserve**. Submitting should call the existing unreserve transition for every eligible selected reserved card. It should not show a reserve summary. It should clear selection and show a success message.

## Testing

Add tests for:

- Reserve summary excludes non-redemption fields and copies only Brand, Remaining balance, and required redemption fields.
- Network prepaid summary excludes non-copyable security/ZIP fields.
- AI import returns and persists required redemption fields as credential field `copyable` flags.
- Bulk unreserve selected reserved cards calls `/unreserve` for each reserved card.

## Deployment

After implementation:

- `npm test`
- `npm run typecheck`
- `npm run build`
- merge to main
- push
- restart `gc-management.service`
- verify public health and live asset markers
