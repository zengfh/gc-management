import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/index.js';

describe('user admin and RBAC routes', () => {
  const appOrigin = 'http://localhost:5173';
  const ownerSecret = 'a strong unlock phrase';
  let db;
  let app;
  let ownerAgent;

  beforeEach(() => {
    db = openDatabase({ filename: ':memory:' });
    app = createApp({ db });
    ownerAgent = request.agent(app);

    return () => {
      db.close();
    };
  });

  async function setupOwner() {
    const response = await ownerAgent.post('/api/auth/setup').send({
      email: 'owner@example.com',
      displayName: 'Owner',
      unlockSecret: ownerSecret,
    });
    expect(response.status).toBe(201);
    return response.body.data.csrfToken;
  }

  function withCsrf(requestBuilder, csrfToken) {
    return requestBuilder.set('Origin', appOrigin).set('X-CSRF-Token', csrfToken);
  }

  async function createUser(csrfToken, overrides = {}) {
    const email = overrides.email || 'operator@example.com';
    const unlockSecret = overrides.unlockSecret || 'operator strong unlock phrase';
    const inviteResponse = await withCsrf(ownerAgent.post('/api/users/invites'), csrfToken).send({
      currentUnlockSecret: ownerSecret,
      email,
      displayName: overrides.displayName || 'Operator',
      role: overrides.role || 'operator',
    });
    expect(inviteResponse.status).toBe(201);

    const invitedAgent = request.agent(app);
    const acceptResponse = await invitedAgent.post('/api/auth/accept-invite').send({
      email,
      inviteCode: inviteResponse.body.data.inviteCode,
      unlockSecret,
    });
    expect(acceptResponse.status).toBe(201);

    const usersResponse = await ownerAgent.get('/api/users');
    expect(usersResponse.status).toBe(200);
    const created = usersResponse.body.data.find((user) => user.email === email);
    expect(created).toBeTruthy();
    return created;
  }

  it('allows owner/admin users to invite and list users without exposing secret material', async () => {
    const csrfToken = await setupOwner();
    const created = await createUser(csrfToken);

    expect(created).toMatchObject({
      email: 'operator@example.com',
      displayName: 'Operator',
      role: 'operator',
      disabledAt: null,
    });
    expect(created).not.toHaveProperty('unlockSecretHash');
    expect(created).not.toHaveProperty('encryptedDEK');

    const listResponse = await ownerAgent.get('/api/users');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toEqual([
      expect.objectContaining({ email: 'owner@example.com', role: 'owner' }),
      expect.objectContaining({ email: 'operator@example.com', role: 'operator' }),
    ]);

    const audit = db
      .prepare("SELECT metadata FROM audit_log WHERE action IN ('user.invite_create', 'user.invite_accept')")
      .all();
    expect(JSON.stringify(audit)).not.toContain('operator strong unlock phrase');
    expect(JSON.stringify(audit)).not.toContain('encryptedDEK');
  }, 45_000);

  it('creates one-time invites that users accept with their own unlock secret', async () => {
    const csrfToken = await setupOwner();

    const inviteResponse = await withCsrf(ownerAgent.post('/api/users/invites'), csrfToken).send({
      currentUnlockSecret: ownerSecret,
      email: 'invited@example.com',
      displayName: 'Invited User',
      role: 'viewer',
    });
    expect(inviteResponse.status).toBe(201);
    expect(inviteResponse.body.data).toMatchObject({
      email: 'invited@example.com',
      displayName: 'Invited User',
      role: 'viewer',
      usedAt: null,
      revokedAt: null,
    });
    expect(inviteResponse.body.data.inviteCode).toMatch(/^GC-INV-/);

    const listInvites = await ownerAgent.get('/api/users/invites');
    expect(listInvites.status).toBe(200);
    expect(listInvites.body.data).toEqual([
      expect.objectContaining({
        email: 'invited@example.com',
        role: 'viewer',
      }),
    ]);
    expect(JSON.stringify(listInvites.body)).not.toContain(inviteResponse.body.data.inviteCode);

    const invitedAgent = request.agent(app);
    const acceptResponse = await invitedAgent.post('/api/auth/accept-invite').send({
      email: 'invited@example.com',
      inviteCode: inviteResponse.body.data.inviteCode,
      unlockSecret: 'invited user strong unlock phrase',
    });
    expect(acceptResponse.status).toBe(201);
    expect(acceptResponse.body.data).toMatchObject({
      sessionValid: true,
      dekLoaded: true,
      user: {
        email: 'invited@example.com',
        role: 'viewer',
      },
    });

    const users = await ownerAgent.get('/api/users');
    expect(users.body.data).toEqual([
      expect.objectContaining({ email: 'owner@example.com', role: 'owner' }),
      expect.objectContaining({ email: 'invited@example.com', role: 'viewer' }),
    ]);

    const reuseResponse = await request(app).post('/api/auth/accept-invite').send({
      email: 'invited@example.com',
      inviteCode: inviteResponse.body.data.inviteCode,
      unlockSecret: 'another strong unlock phrase',
    });
    expect(reuseResponse.status).toBe(401);
    expect(reuseResponse.body.error.code).toBe('INVALID_INVITE');

    const audit = db.prepare("SELECT metadata FROM audit_log WHERE action = 'user.invite_create'").get();
    expect(JSON.stringify(audit)).not.toContain(inviteResponse.body.data.inviteCode);
  }, 60_000);

  it('revokes active invites', async () => {
    const csrfToken = await setupOwner();
    const inviteResponse = await withCsrf(ownerAgent.post('/api/users/invites'), csrfToken).send({
      currentUnlockSecret: ownerSecret,
      email: 'revoked@example.com',
      displayName: 'Revoked User',
      role: 'operator',
    });
    expect(inviteResponse.status).toBe(201);

    const revokeResponse = await withCsrf(
      ownerAgent.delete(`/api/users/invites/${inviteResponse.body.data.id}`),
      csrfToken,
    ).send({});
    expect(revokeResponse.status).toBe(200);
    expect(revokeResponse.body.data.revokedAt).toEqual(expect.any(String));

    const acceptResponse = await request(app).post('/api/auth/accept-invite').send({
      email: 'revoked@example.com',
      inviteCode: inviteResponse.body.data.inviteCode,
      unlockSecret: 'revoked user strong unlock phrase',
    });
    expect(acceptResponse.status).toBe(401);
    expect(acceptResponse.body.error.code).toBe('INVALID_INVITE');
  }, 60_000);

  it('lets operators mutate inventory but blocks admin settings', async () => {
    const csrfToken = await setupOwner();
    await createUser(csrfToken);
    const operatorAgent = request.agent(app);

    const login = await operatorAgent.post('/api/auth/login').send({
      email: 'operator@example.com',
      unlockSecret: 'operator strong unlock phrase',
    });
    expect(login.status).toBe(200);
    expect(login.body.data.user).toMatchObject({
      email: 'operator@example.com',
      role: 'operator',
    });

    const createCard = await withCsrf(operatorAgent.post('/api/cards'), login.body.data.csrfToken).send({
      cards: [
        {
          brand: 'Target',
          cardType: 'merchant',
          faceValueCents: 5000,
          purchaseCostCents: 4500,
        },
      ],
    });
    expect(createCard.status).toBe(201);

    const settings = await operatorAgent.get('/api/settings/backup');
    expect(settings.status).toBe(403);
    expect(settings.body.error.code).toBe('INSUFFICIENT_ROLE');
  }, 45_000);

  it('allows viewers to read inventory while blocking mutations and credential reveal', async () => {
    const csrfToken = await setupOwner();
    const cardResponse = await withCsrf(ownerAgent.post('/api/cards'), csrfToken).send({
      cards: [
        {
          brand: 'Target',
          cardType: 'merchant',
          faceValueCents: 5000,
          cardNumber: '4111111111111111',
        },
      ],
    });
    expect(cardResponse.status).toBe(201);
    const cardId = cardResponse.body.data[0].id;
    await createUser(csrfToken, {
      email: 'viewer@example.com',
      displayName: 'Viewer',
      role: 'viewer',
      unlockSecret: 'viewer strong unlock phrase',
    });

    const viewerAgent = request.agent(app);
    const login = await viewerAgent.post('/api/auth/login').send({
      email: 'viewer@example.com',
      unlockSecret: 'viewer strong unlock phrase',
    });
    expect(login.status).toBe(200);

    const cards = await viewerAgent.get('/api/cards');
    expect(cards.status).toBe(200);
    expect(cards.body.data).toEqual([expect.objectContaining({ brand: 'Target' })]);

    const createCard = await withCsrf(viewerAgent.post('/api/cards'), login.body.data.csrfToken).send({
      cards: [{ brand: 'Amazon', cardType: 'merchant', faceValueCents: 2500 }],
    });
    expect(createCard.status).toBe(403);

    const reveal = await withCsrf(viewerAgent.post(`/api/cards/${cardId}/reveal`), login.body.data.csrfToken).send({});
    expect(reveal.status).toBe(403);
    expect(reveal.body.error.code).toBe('INSUFFICIENT_ROLE');
  }, 45_000);

  it('requires email login once multiple active users exist and blocks disabled users', async () => {
    const csrfToken = await setupOwner();
    const operator = await createUser(csrfToken);

    const missingEmail = await request(app).post('/api/auth/login').send({
      unlockSecret: 'operator strong unlock phrase',
    });
    expect(missingEmail.status).toBe(400);
    expect(missingEmail.body.error.code).toBe('EMAIL_REQUIRED');

    const disable = await withCsrf(ownerAgent.put(`/api/users/${operator.id}`), csrfToken).send({
      disabled: true,
    });
    expect(disable.status).toBe(200);
    expect(disable.body.data.disabledAt).toEqual(expect.any(String));

    const disabledLogin = await request(app).post('/api/auth/login').send({
      email: 'operator@example.com',
      unlockSecret: 'operator strong unlock phrase',
    });
    expect(disabledLogin.status).toBe(401);
    expect(disabledLogin.body.error.code).toBe('INVALID_UNLOCK_SECRET');
  }, 45_000);
});
