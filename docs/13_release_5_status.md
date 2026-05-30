# Release 5 Credential Profiles Status

Date: 2026-05-12
Status: Release 5 complete

## Completed

- Added credential profile storage with migration `005_credential_profiles.sql`.
- Added `card_credential_fields` for encrypted per-field credentials, blind indexes, display hints, and safe summaries.
- Backfilled existing card number, PIN, and billing ZIP data into credential fields without decrypting existing values.
- Added shared backend credential handling for card creation, deal creation, CSV confirm, backup export/import, reveal, exact search, and duplicate detection.
- Added supported profiles: `claim_code`, `merchant_number_pin`, `barcode`, `network_prepaid`, and `custom`.
- Added Add Deal credential profile picker and profile-specific inputs.
- Updated card tables, deal detail, delete preview, search, and card detail reveal/copy UX to use credential summaries and structured credential fields.
- Added scannable barcode/QR rendering after explicit credential reveal.
- Added custom credential field authoring in Add Deal.
- Added CSV templates for code-only, barcode, and custom credential formats.
- Added network security-code storage policy gate: `GC_FEATURE_NETWORK_SECURITY_CODE_STORAGE=false` by default.
- Added local-only warning and explicit checkbox before storing network prepaid security codes when the flag is enabled.
- Plaintext JSON exports now omit `network_security_code` fields and state the omission in the warning; encrypted portable backups keep stored fields.
- Updated OpenAPI docs for credential profiles and exact credential search.
- Added a synthetic Release 5 acceptance CSV and automated import/search/reveal test covering claim-code, number-plus-PIN, barcode, network-prepaid, and custom credential profiles.
- Fixed CSV barcode imports so the requested `barcodeFormat` is persisted and used by reveal/render flows.
- Added a browser-level Release 5 acceptance test that imports the synthetic CSV through the UI, verifies exact credential search, reveals a scannable barcode, confirms network-prepaid security codes are omitted by default, exports an encrypted backup, and restores it through replace import.
- Updated CSV import preview to show a profile-aware masked credential summary and PIN status instead of implying code-only credentials have a PIN.
- Made Playwright ports configurable so browser tests can run on alternate ports without disturbing a local dev server.
- Added a standalone AI Import workspace with agent-style live status, provider/model diagnostics, system normalization counts, editable review rows, discard, confirm import, and another-pass correction.
- Extended AI import analysis so a correction pass can send the original pasted text plus the current draft context back to the provider for a corrected full card list.
- Fixed AI Import for network prepaid text that omits an explicit brand but includes card number, balance, expiration, and CVV/CVC labels. The parser now accepts common aliases, infers the card network when safe, maps security codes to the explicit local-only Security code review field, and persists it only when `GC_FEATURE_NETWORK_SECURITY_CODE_STORAGE` is enabled.
- Improved AI Import failure messages with safe provider-level failure reasons instead of only saying every provider failed.

## Verification

- `npm test` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `npm run test:release5-acceptance` passed.
- `npm run test:e2e:release5` passed.
- `E2E_CLIENT_PORT=5174 E2E_API_PORT=3002 npm run test:e2e` passed.

## AI Import Rework Verification

Completed on 2026-05-30:

- `npm run typecheck -- --pretty false`
- `npm run lint`
- `npm run build`
- `npm test`
- `npm test -- src/App.test.tsx server/routes/aiImport.test.ts src/bulkImport.test.ts`
- `npm run test:e2e`

Completed on 2026-05-30 for AI prepaid parsing diagnostics:

- `npm run typecheck -- --pretty false`
- `npm test -- server/routes/aiImport.test.ts src/App.test.tsx`
- `npm run lint`
- `npm run build`
- `npm test`
- `npm run test:e2e:release5`

## Follow-Up Opportunities

- Barcode scanning from camera/image import remains a future enhancement.
- Brand-specific field label templates can be expanded as real usage identifies more issuer quirks.
