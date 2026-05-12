# Release 5 Credential Profiles Status

Date: 2026-05-12
Status: Milestones 1-4 implemented; barcode rendering/custom-field polish remains

## Completed

- Added credential profile storage with migration `005_credential_profiles.sql`.
- Added `card_credential_fields` for encrypted per-field credentials, blind indexes, display hints, and safe summaries.
- Backfilled existing card number, PIN, and billing ZIP data into credential fields without decrypting existing values.
- Added shared backend credential handling for card creation, deal creation, CSV confirm, backup export/import, reveal, exact search, and duplicate detection.
- Added supported profiles: `claim_code`, `merchant_number_pin`, `barcode`, `network_prepaid`, and `custom`.
- Added Add Deal credential profile picker and profile-specific inputs.
- Updated card tables, deal detail, delete preview, search, and card detail reveal/copy UX to use credential summaries and structured credential fields.
- Added network security-code storage policy gate: `GC_FEATURE_NETWORK_SECURITY_CODE_STORAGE=false` by default.
- Updated OpenAPI docs for credential profiles and exact credential search.

## Verification

- `npm test` passed: 15 files, 130 tests.
- `npm run lint` passed.
- `npm run build` passed.

## Remaining Release 5 Polish

- Render scannable barcode/QR output after reveal for `barcode` profile.
- Add full custom-field UI for arbitrary issuer fields beyond the current backend support.
- Add more CSV templates for code-only, barcode, and custom credentials.
- Decide whether plaintext JSON export should omit `network_security_code` values even when local storage is enabled; current implementation exports credential fields according to stored data after explicit plaintext export confirmation.
- Add a visible local-only risk warning/confirmation before enabling network security-code input in deployments that set `GC_FEATURE_NETWORK_SECURITY_CODE_STORAGE=true`.
