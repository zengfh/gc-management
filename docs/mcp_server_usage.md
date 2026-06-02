# MCP Server Usage

The app exposes a private Model Context Protocol server at:

```text
https://gc.hankzeng.com/api/mcp
```

For local development, replace the origin with the local server origin, for example:

```text
http://127.0.0.1:3001/api/mcp
```

The MCP server uses stateless Streamable HTTP. It does not use browser cookies or CSRF tokens. Every MCP request must include an MCP bearer token:

```http
Authorization: Bearer gc_mcp_...
```

## Create a Token

1. Unlock the web app.
2. Open `Settings`.
3. Open `MCP Agent Access`.
4. Click `Show MCP tokens`.
5. Choose a permission preset or custom scopes.
6. Enter your unlock secret and create the token.
7. Copy the token immediately. The full token is shown once.

The database stores only a hash of the token. The vault data encryption key is wrapped with a key derived from the token, so a revoked or missing token cannot be recovered from the database.

## Scope Presets

`Read only`

Allows inventory/deal/reference reads. Does not reveal card codes.

`Read + reveal`

Allows reads plus full card credential reveal. Use this for agents that need to provide codes to you.

`Inventory operator`

Allows card creation, updates, lifecycle actions, reveal, deal writes, and reference hint writes. Does not allow card deletion.

`Full vault agent`

Allows all MCP v1 scopes, including card deletion. Deletion is still restricted to never-touched available cards.

## Scopes

`cards:read`: search cards, get details, read inventory summary.

`cards:create`: create cards.

`cards:update`: update card metadata and balances. Stored secret credential values are not edited by MCP v1.

`cards:delete`: delete never-touched available cards.

`cards:lifecycle`: reserve, unreserve, use, undo usage, sell, undo sale, and void.

`cards:reveal`: reveal full stored card credentials.

`deals:read`: list and read deal details.

`deals:write`: create, update, archive, and unarchive deals.

`reference:read`: read brand/source/deal hint values.

`reference:write`: upsert brand/source/deal hint values.

## Tools

The MCP server registers these tools:

```text
giftcards.search_cards
giftcards.get_card
giftcards.reveal_card_credentials
giftcards.create_cards
giftcards.update_card
giftcards.delete_card
giftcards.reserve_card
giftcards.unreserve_card
giftcards.use_card
giftcards.undo_usage
giftcards.sell_card
giftcards.undo_sale
giftcards.void_card
giftcards.list_deals
giftcards.get_deal
giftcards.create_deal
giftcards.update_deal
giftcards.archive_deal
giftcards.unarchive_deal
giftcards.list_reference_values
giftcards.upsert_reference_values
```

All write tools require `idempotencyKey`. Use a unique value per intended operation, for example `codex-20260602-target-001`. Retrying the same operation with the same key returns the original result and prevents double-use or double-sale.

## Resources

```text
giftcards://inventory/summary
giftcards://cards/schema
giftcards://deals/schema
giftcards://security/scopes
```

## Codex Example

Use your client’s HTTP MCP configuration with an authorization header:

```json
{
  "mcpServers": {
    "giftcard-vault": {
      "type": "streamable-http",
      "url": "https://gc.hankzeng.com/api/mcp",
      "headers": {
        "Authorization": "Bearer gc_mcp_REPLACE_WITH_TOKEN"
      }
    }
  }
}
```

Some MCP clients call the transport `http` instead of `streamable-http`. Keep the URL and authorization header the same.

## Hermes Example

Configure an HTTP MCP server:

```json
{
  "servers": {
    "giftcard-vault": {
      "transport": "streamable-http",
      "endpoint": "https://gc.hankzeng.com/api/mcp",
      "headers": {
        "Authorization": "Bearer gc_mcp_REPLACE_WITH_TOKEN"
      }
    }
  }
}
```

If your Hermes build expects a different field name, map the same endpoint and header into its MCP HTTP server settings.

## Security Rules

Keep MCP tokens out of git, shell history, logs, and screenshots.

Create separate tokens per agent and revoke tokens when no longer needed.

Prefer the narrowest preset. Only grant `cards:reveal` when the agent must see full card codes.

MCP v1 intentionally excludes backup export/import, admin settings, users, passkeys, recovery, notification settings, and raw database access.

All credential reveal and write operations are audited.
