# Product-Use Readiness Status

Date: 2026-05-14
Status: Identity lifecycle hardening implemented; commercial SaaS blockers remain

## Research Inputs

This hardening pass used current security guidance as guardrails:

- OWASP recommends password-recovery flows avoid account enumeration, use one-time tokens, store reset material securely, and avoid automatically logging users in after reset.
- OWASP authentication guidance emphasizes strong password storage, session protections, and MFA as a major next step for stronger account security.
- CISA Secure by Design guidance emphasizes secure defaults, MFA availability, and useful audit logging as baseline product expectations.

References:

- https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html
- https://www.cisa.gov/securebydesign

## Completed

- Added owner email and display name to first-run setup.
- Added admin-created one-time user invites.
- Removed the UX requirement for an admin to create another user's unlock secret.
- Removed the direct user-create API that accepted another user's unlock secret.
- Added invite acceptance from the locked screen.
- Added pending invite listing and revocation in Settings.
- Added one-time recovery codes for forgotten unlock secrets.
- Added recovery-code reset from the locked screen.
- Recovery reset does not auto-login; the user signs in with the new unlock secret after reset.
- Added database tables for invite and recovery lifecycle state.
- Added audit events for invite creation, invite revocation, invite acceptance, recovery-code generation, and recovery reset.
- Kept invite and recovery codes out of list APIs, audit metadata, and logs.
- Added API tests and UI tests for invite and recovery flows.
- Updated OpenAPI for invite and recovery endpoints.

## Current Product Shape

This is now safer for a trusted small team on one account:

- Owner/admin users can invite admins, operators, and viewers.
- Each invited user chooses their own unlock secret.
- Each user can generate personal recovery codes while unlocked.
- A recovery code can rewrap the same vault key under a new unlock secret.
- Existing encrypted card credentials remain under the same account data encryption key.

## Still Not Commercial SaaS Ready

Do not market this as a general multi-tenant product until these are done:

- Formal MFA policy beyond the private-use passkey convenience unlock.
- Email delivery for invites and security notifications.
- Email verification before account recovery or sensitive account changes.
- True multi-tenant account isolation and tenant lifecycle.
- Postgres or another server database for multi-instance operation.
- External shared session/rate-limit stores for multi-instance operation.
- Billing/subscription/account closure workflows.
- Formal privacy policy, terms, data processing posture, and legal review.
- Independent security assessment or penetration test.
- Production monitoring/alert installation and tested incident response.
- Automated hosted backups with restore drills on a separate environment.

## Verification Completed

Completed on 2026-05-14:

- `npm run lint`
- `npm test -- server/auth/sessionRevocation.test.ts server/routes/users.test.ts server/routes/auth.test.ts`
- `npm test`
- `npm run build`
- `E2E_CLIENT_PORT=5174 E2E_API_PORT=3002 npm run test:e2e`
- `npm audit --audit-level=high`
- `git diff --check`
- OpenAPI YAML parse
- Hosted smoke test on `https://gc.hankzeng.com`: health, auth status, and app shell
