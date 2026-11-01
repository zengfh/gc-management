# Gift Card Manager

A private gift-card inventory app with encrypted credentials, deal tracking, reservations, sales, usage, bulk imports, and encrypted backups. It uses React, Express, and SQLite and is designed for a single running server.

## Local development

Use Node.js 22.12 or later and npm. Install dependencies with `npm ci`, then run `npm run dev`. Open the address shown by the client and create the vault owner on first use. Development data lives in `server/data`; set `GC_DB_PATH` to use a different database.

Run `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build` to check a change. `npm run test:e2e` starts its own local servers and test database and requires Chromium (`npx playwright install chromium`). Browser scenarios reset their inventory independently and retain traces on failure.

## AI imports

AI analysis sends pasted text and any correction draft to the configured provider. Review the returned rows before saving. Rules-based bulk import remains available without an AI provider.

Use [.env.example](.env.example) as a configuration reference. Supply variables through your shell or service manager; the app does not automatically read `.env` files. For a custom OpenAI-compatible gateway, configure:

```dotenv
GC_AI_CUSTOM_PROVIDER_NAME=Custom gateway
GC_AI_CUSTOM_BASE_URL=https://your-gateway.example/v1
GC_AI_CUSTOM_API_KEY=your-private-key
GC_AI_CUSTOM_MODEL=gpt-5.6-terra
GC_AI_CUSTOM_WIRE_API=responses
GC_AI_CUSTOM_MODEL_REASONING_EFFORT=low
GC_AI_CUSTOM_STRUCTURED_OUTPUTS=true
```

Check model availability with your provider before changing the default. Strict JSON Schema output is opt-in because some compatible gateways support only JSON mode. `GC_AI_CUSTOM_MODELS` accepts additional comma-separated model IDs for the selector; the default is always included. Restart the server after changing its environment.

Analysis has a 60-second total deadline, an 8,192-token output ceiling, one active request per user, and ten requests per user per minute. The Cancel analysis button and browser disconnects abort the upstream request. Override the limits with `GC_AI_REQUEST_TIMEOUT_MS` (maximum 180,000), `GC_AI_MAX_OUTPUT_TOKENS` (maximum 32,768), and `GC_AI_REQUESTS_PER_MINUTE` (maximum 60). Provider billing rules still apply to work already performed.

With custom-provider variables available, run `npm run eval:ai-import -- MODEL_ID` before switching models. This opt-in live check uses synthetic mixed credentials and spreadsheet continuations, checks exact field preservation, and reports timings. It incurs provider usage. The target must be in the configured model allowlist.

## Production and maintenance

Build with `npm run build`, then run `npm run start:prod` with a persistent database and `SESSION_SECRET`. Follow the [private beta runbook](docs/runbooks/hosted_private_beta_runbook.md) for HTTPS, cookies, backups, and deployment settings. Check `/api/health` after a release.

GitHub Actions runs lint, type checking, tests, a production build, dependency audit, and browser checks on pull requests and pushes to main. Dependabot checks npm packages and GitHub Actions weekly. Both configurations take effect when pushed to GitHub. Audit currently retains moderate findings in ESLint's transitive development dependencies; avoid forcing an incompatible major-version override to silence them.

See the [project documentation](docs/README.md), [API specification](docs/openapi.yaml), and [MCP usage guide](docs/mcp_server_usage.md) for more detail.
