# Release 5 Private Trial and Release 5.1 Backlog

Date: 2026-05-13
Status: Release 5 deployed for private trial; Release 5.1 polish backlog opened

## Tagged Runtime

Release tag: `v0.5.0-release5`

VPS runtime paths:

- Public HTTPS UI and API: `https://gc.hankzeng.com`
- Local app listener behind Caddy: `http://127.0.0.1:5180`
- Runtime database: `/home/opc/gc-management-data/release5/gcmanager.db`
- Runtime logs: `journalctl --user -u gc-management.service`
- Runtime environment: `/home/opc/gc-management-data/release5/prod.env`
- Process supervisor: user-level systemd service `gc-management.service`
- Future encrypted backup directory: `/home/opc/gc-management-data/release5/backups/`
- Restore-drill workspace: `/home/opc/gc-management-data/release5/restore-drills/`

Laptop access:

- Preferred: open `https://gc.hankzeng.com`.
- SSH tunnel fallback, useful only if the HTTPS edge is unavailable:

```bash
ssh -L 5180:127.0.0.1:5180 <user>@<vps-host>
```

Then open `http://localhost:5180`. Login cookies are configured for HTTPS in the hosted setup, so normal browser use should use the public HTTPS URL.

Private data rule: real gift-card credentials, backup files, database files, runtime logs, and passphrases must stay outside git.

## Real Personal Trial Checklist

The app is ready for the owner to enter real private data through the running UI. Do not paste real card credentials into docs, issues, git commits, or chat transcripts.

Trial cards to add manually:

- Code-only card, such as an app gift code.
- Merchant number-plus-PIN card.
- Merchant number-plus-PIN card if available, such as Target-style cards.
- Barcode/QR card.
- Network prepaid card without storing security code by default.
- Custom odd-issuer card with at least two custom fields.

Trial actions:

- Search by exact credential for each indexed primary credential.
- Reveal and copy credentials.
- Confirm barcode renders after reveal.
- Record partial usage and undo it.
- Reserve and unreserve one card.
- Sell and undo sale for one test card if safe.
- Void only a disposable/test card, because void is destructive to inventory state.

## Backup Discipline

Preferred backup format: encrypted portable JSON.

Passphrase policy:

- Store the backup passphrase in the owner's password manager.
- Do not store the backup passphrase on the VPS.
- Do not store the backup passphrase in git, docs, shell history, process manager config, or chat transcripts.
- Use a passphrase that is different from the unlock secret.

Backup storage policy:

- Download encrypted backup files from the app UI.
- Keep one local copy and one off-host copy.
- Treat `/home/opc/gc-management-data/release5/backups/` as a staging directory only if a backup needs to be temporarily held on the VPS.
- Remove stale backup files from the VPS after confirming off-host storage.

Restore drill:

- Use `/home/opc/gc-management-data/release5/restore-drills/` or another fresh database path.
- Start the app against the fresh database.
- Create a temporary vault.
- Import the encrypted portable backup in replace mode.
- Verify card count, masked credential summaries, exact credential search, reveal/decrypt, barcode rendering, and balances.
- Delete the restore-drill database after the drill.

Automated Release 5 restore coverage:

- `npm run test:e2e:release5` imports synthetic data, exports encrypted JSON, restores with replace import, and rechecks exact credential search.

## Release 5.1 Polish Backlog

These are polish items discovered or confirmed during Release 5 acceptance hardening:

Completed 2026-05-14:

- Corrected Add Deal credential entry so one-code cards use one field, merchant cards use number-plus-PIN, barcode cards do not show a default PIN field, and network prepaid billing fields remain separate from merchant gift-card fields.
- Verification passed with unit/integration tests, full browser e2e, focused Release 5 browser acceptance, lint, build, and whitespace checks.
- Added a first-class production static-server/reverse-proxy deployment path so private hosted use no longer depends on the Vite dev server.
- Added systemd, Nginx, and environment templates under `deploy/`.
- Updated the hosted private-beta runbook and Release 5.1 hosting status doc.
- Configured `gc.hankzeng.com` through Caddy with automatic Let's Encrypt TLS.
- Bound the Node app to `127.0.0.1:5180` behind Caddy and enabled HTTPS-safe cookie/proxy settings.
- Added product-use identity lifecycle hardening: first-run owner email, one-time user invites, invite acceptance, recovery-code generation, and recovery-code reset.

1. Add a small UI checklist or runbook link for first-time private backup setup after vault creation.
2. Expand brand-specific credential templates after the owner tests real cards, while keeping the secondary merchant-card secret stored and displayed as PIN.
3. Improve mobile/tablet card table behavior for dense credential summaries and action buttons.
4. Add camera/image barcode scanning as a future optional enhancement.
5. Add import-preview filters for valid/invalid rows if larger CSV imports become common.
6. Add a backup reminder prompt after the first real card is added.
7. Consider a safer "test mode" or sample-data workspace so users can rehearse sale/use/void flows without touching real inventory.
