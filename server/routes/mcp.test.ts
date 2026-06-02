import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from '../app.js';
import { openDatabase } from '../db/index.js';

describe('MCP routes', () => {
  const appOrigin = 'http://localhost:5173';
  const unlockSecret = 'a strong unlock phrase';
  let db;
  let app;
  let agent;
  let listener: Server | null;

  beforeEach(() => {
    db = openDatabase({ filename: ':memory:' });
    app = createApp({ db });
    agent = request.agent(app);
    listener = null;
  });

  afterEach(async () => {
    if (listener) {
      await new Promise<void>((resolve, reject) => {
        listener?.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
      listener = null;
    }
    db.close();
  });

  async function setupOwner() {
    const response = await agent.post('/api/auth/setup').send({
      email: 'owner@example.com',
      displayName: 'Owner',
      unlockSecret,
    });
    expect(response.status).toBe(201);
    return response.body.data.csrfToken;
  }

  function postWithCsrf(path: string, csrfToken: string) {
    return agent.post(path).set('Origin', appOrigin).set('X-CSRF-Token', csrfToken);
  }

  async function createMcpToken(csrfToken: string, scopes: string[]) {
    const response = await postWithCsrf('/api/mcp/tokens', csrfToken).send({
      name: 'Test MCP token',
      scopes,
      currentUnlockSecret: unlockSecret,
    });
    expect(response.status).toBe(201);
    expect(response.body.data.token).toMatch(/^gc_mcp_/);
    return response.body.data.token as string;
  }

  async function mcpClient(token: string) {
    listener = app.listen(0);
    await new Promise<void>((resolve) => listener?.once('listening', resolve));
    const port = (listener.address() as AddressInfo).port;
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/api/mcp`),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    );
    const client = new Client({ name: 'vitest-mcp-client', version: '1.0.0' });
    await client.connect(transport);
    return client;
  }

  it('creates, lists, and revokes MCP tokens without storing plaintext token material', async () => {
    const csrfToken = await setupOwner();

    const missingCsrf = await agent.post('/api/mcp/tokens').send({
      name: 'Bad token',
      scopes: ['cards:read'],
      currentUnlockSecret: unlockSecret,
    });
    expect(missingCsrf.status).toBe(403);

    const badSecret = await postWithCsrf('/api/mcp/tokens', csrfToken).send({
      name: 'Bad token',
      scopes: ['cards:read'],
      currentUnlockSecret: 'wrong unlock phrase',
    });
    expect(badSecret.status).toBe(401);

    const createResponse = await postWithCsrf('/api/mcp/tokens', csrfToken).send({
      name: 'Codex read token',
      scopes: ['cards:read', 'cards:reveal'],
      currentUnlockSecret: unlockSecret,
    });
    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data).toMatchObject({
      name: 'Codex read token',
      scopes: ['cards:read', 'cards:reveal'],
      revokedAt: null,
    });
    const token = createResponse.body.data.token;
    expect(token).toMatch(/^gc_mcp_/);

    const stored = db.prepare('SELECT tokenHash, tokenHint FROM mcp_tokens WHERE id = ?').get(createResponse.body.data.id);
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);

    const listResponse = await agent.get('/api/mcp/tokens');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data.tokens).toEqual([
      expect.objectContaining({
        id: createResponse.body.data.id,
        name: 'Codex read token',
      }),
    ]);
    expect(listResponse.body.data.tokens[0]).not.toHaveProperty('token');
    expect(listResponse.body.data.presets.fullVaultAgent).toContain('cards:delete');

    const revokeResponse = await agent
      .delete(`/api/mcp/tokens/${createResponse.body.data.id}`)
      .set('Origin', appOrigin)
      .set('X-CSRF-Token', csrfToken);
    expect(revokeResponse.status).toBe(200);
    expect(revokeResponse.body.data).toEqual({
      revoked: true,
      tokenId: String(createResponse.body.data.id),
    });
    const revoked = db.prepare('SELECT revokedAt FROM mcp_tokens WHERE id = ?').get(createResponse.body.data.id);
    expect(revoked.revokedAt).toEqual(expect.any(String));
  }, 45_000);

  it('requires bearer auth and exposes scoped MCP card tools over Streamable HTTP', async () => {
    const csrfToken = await setupOwner();

    const unauthorized = await request(app).post('/api/mcp').send({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
    });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.body.error.code).toBe('MCP_TOKEN_REQUIRED');

    const token = await createMcpToken(csrfToken, [
      'cards:read',
      'cards:create',
      'cards:reveal',
      'cards:lifecycle',
      'deals:read',
      'reference:read',
    ]);
    const client = await mcpClient(token);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain('giftcards.create_cards');
      expect(tools.tools.map((tool) => tool.name)).toContain('giftcards.reveal_card_credentials');

      const createResult = await client.callTool({
        name: 'giftcards.create_cards',
        arguments: {
          idempotencyKey: 'mcp-create-target-1',
          cards: [
            {
              brand: 'Target',
              cardType: 'merchant',
              credentialProfile: 'merchant_number_pin',
              faceValueCents: 5000,
              purchaseCostCents: 4500,
              cardNumber: '4111 1111 1111 1111',
              pin: '1234',
              expirationDate: '2027-12-31',
            },
          ],
        },
      });
      expect(createResult.isError).not.toBe(true);
      const created = createResult.structuredContent as { data: Array<{ id: number; brand: string }> };
      expect(created.data[0]).toMatchObject({
        brand: 'Target',
      });

      const replayResult = await client.callTool({
        name: 'giftcards.create_cards',
        arguments: {
          idempotencyKey: 'mcp-create-target-1',
          cards: [
            {
              brand: 'Target',
              cardType: 'merchant',
              credentialProfile: 'merchant_number_pin',
              faceValueCents: 5000,
              purchaseCostCents: 4500,
              cardNumber: '4111 1111 1111 1111',
              pin: '1234',
              expirationDate: '2027-12-31',
            },
          ],
        },
      });
      expect(replayResult.isError).not.toBe(true);
      expect((replayResult.structuredContent as { data: Array<{ id: number }> }).data[0].id).toBe(created.data[0].id);
      expect(db.prepare('SELECT COUNT(*) AS count FROM cards').get().count).toBe(1);

      const searchResult = await client.callTool({
        name: 'giftcards.search_cards',
        arguments: {
          brand: 'target',
          credential: '4111111111111111',
        },
      });
      expect(searchResult.isError).not.toBe(true);
      expect((searchResult.structuredContent as { data: Array<{ id: number }> }).data[0].id).toBe(created.data[0].id);

      const revealResult = await client.callTool({
        name: 'giftcards.reveal_card_credentials',
        arguments: {
          cardId: created.data[0].id,
        },
      });
      expect(revealResult.isError).not.toBe(true);
      expect(revealResult.structuredContent).toMatchObject({
        cardNumber: '4111111111111111',
        pin: '1234',
      });
      const revealAudit = db.prepare("SELECT action, metadata FROM audit_log WHERE action = 'card.credentials_reveal'").get();
      expect(revealAudit.action).toBe('card.credentials_reveal');
      expect(revealAudit.metadata).toContain('"channel":"mcp"');
    } finally {
      await client.close();
    }
  }, 45_000);

  it('enforces token scopes for reveal tools', async () => {
    const csrfToken = await setupOwner();
    const createCard = await postWithCsrf('/api/cards', csrfToken).send({
      cards: [
        {
          brand: 'Target',
          cardType: 'merchant',
          faceValueCents: 5000,
          cardNumber: '4111111111111111',
        },
      ],
    });
    expect(createCard.status).toBe(201);

    const token = await createMcpToken(csrfToken, ['cards:read']);
    const client = await mcpClient(token);
    try {
      const revealResult = await client.callTool({
        name: 'giftcards.reveal_card_credentials',
        arguments: {
          cardId: createCard.body.data[0].id,
        },
      });
      expect(revealResult.isError).toBe(true);
      expect(revealResult.content[0].text).toContain('MCP_SCOPE_REQUIRED');
    } finally {
      await client.close();
    }
  }, 45_000);
});
