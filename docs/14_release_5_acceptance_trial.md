# Release 5 Acceptance Trial Data

Date: 2026-05-13
Status: synthetic dataset and automated acceptance test added

## Purpose

Release 5 replaced the old card-number-only model with credential profiles. This trial data gives us a safe way to exercise the mainstream shapes without importing real spendable credentials.

The CSV fixture is `test-data/release5_acceptance_cards.csv`.

All values in the fixture are synthetic and non-redeemable. Do not replace them with real card numbers, PINs, claim codes, security codes, billing addresses, or personal data in git.

## Source Research Summary

The fixture is based on public issuer/help documentation about required credential shapes:

| Scenario | Source basis | App profile |
|---|---|---|
| Uber-style app gift card | Uber says to enter a gift code as it appears, without spaces. | `claim_code` |
| Best Buy-style merchant card | Best Buy online checkout requires both card number and 4-digit PIN. | `merchant_number_pin` |
| Target-style merchant card | Target balance lookup uses a 15-digit card number plus Access Number or PIN. | `merchant_number_pin` with `accessCode` |
| Starbucks-style displayed/scannable card | Starbucks eGifts have a unique Starbucks Card number and can be printed or registered for app use. | `barcode` |
| Vanilla Visa-style prepaid card | Vanilla Visa activation/balance/online-use docs require card number, valid-through date, security code, and name/address; default app policy omits security-code storage. | `network_prepaid` |
| Odd/local issuer | Real local issuers may use arbitrary member IDs, security phrases, or order IDs. | `custom` |

Source links:

- Uber Help, gift card redemption: https://help.uber.com/riders/article/gift-card-uber?nodeId=1b81d67a-e312-41ce-b28a-4588bae7d4c5
- Best Buy Gift Card FAQ: https://www.bestbuy.com/site/gift-card-help/gift-card-faq/pcmcat1526048189330.c?id=pcmcat1526048189330
- Target GiftCard balance help: https://help.target.com/help/subcategoryarticle?childcat=Target+GiftCard+balance&parentcat=Gift+Cards&searchQuery=search+help
- Starbucks Card terms: https://www.starbucks.com/terms/manage-gift-cards/
- Vanilla Gift Card FAQ: https://www.vanillagift.com/help
- Vanilla Visa Gift Cards help: https://www.vanillagift.com/visa-gift-cards

## How To Run

Automated check:

```bash
npm run test:release5-acceptance
```

Browser acceptance check:

```bash
npm run test:e2e:release5
```

If your normal dev server is already using ports 5173 and 3001, the Release 5 e2e script uses ports 5174 and 3002. The full browser suite can also run on alternate ports:

```bash
E2E_CLIENT_PORT=5174 E2E_API_PORT=3002 npm run test:e2e
```

Manual UI check:

1. Start the app with `npm run dev`.
2. Open the app and unlock the vault.
3. Go to Backup.
4. Import `test-data/release5_acceptance_cards.csv`.
5. Preview should show 6 valid rows and 0 invalid rows.
6. Confirm the import.
7. Search exact credentials for `UBERTEST202605A`, `9900000000001001`, `7788899900012345678`, and `GCMEMBER-12345`.
8. Open Starbucks and reveal credentials; the barcode should render after reveal.
9. Open Vanilla Visa and reveal credentials; no network security code should be present by default.
10. Export an encrypted JSON backup with a separate backup passphrase.
11. Import that encrypted backup in replace mode and confirm the imported credentials still search and reveal correctly.

## Current Result

The backend acceptance test imports all six rows, confirms expected profiles, verifies exact credential search across indexed credential kinds, confirms CSV barcode format persistence, and confirms default network-prepaid security-code omission.

The browser acceptance test imports the fixture through the UI, confirms profile-aware masked import preview rows, verifies exact credential search, renders the Starbucks barcode after reveal, confirms the Vanilla Visa security-code field is not shown by default, exports an encrypted portable backup, restores it with replace import, and rechecks exact search after restore.
