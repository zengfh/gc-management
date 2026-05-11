import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDatabase } from '../db/index.js';

describe('auth routes', () => {
  const appOrigin = 'http://localhost:5173';
  let app;
  let db;
  let agent;

  beforeEach(() => {
    db = openDatabase({ filename: ':memory:' });
    app = createApp({ db });
    agent = request.agent(app);

    return () => {
      db.close();
    };
  });

  async function setupOwner(unlockSecret = 'a strong unlock phrase') {
    return agent.post('/api/auth/setup').send({ unlockSecret });
  }

  function postWithCsrf(path, csrfToken) {
    return agent.post(path).set('Origin', appOrigin).set('X-CSRF-Token', csrfToken);
  }

  it('reports setup status before the owner has initialized the vault', async () => {
    const response = await agent.get('/api/auth/status');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        setupComplete: false,
        sessionValid: false,
        dekLoaded: false,
      },
    });
  });

  it('sets up the owner once and rejects weak or repeated setup attempts', async () => {
    const weakResponse = await agent.post('/api/auth/setup').send({
      unlockSecret: '12345678',
    });
    expect(weakResponse.status).toBe(400);
    expect(weakResponse.body.error.code).toBe('WEAK_UNLOCK_SECRET');

    const setupResponse = await agent.post('/api/auth/setup').send({
      unlockSecret: 'a strong unlock phrase',
      displayName: 'Owner',
    });
    expect(setupResponse.status).toBe(201);
    expect(setupResponse.body.data).toMatchObject({
      setupComplete: true,
      sessionValid: true,
      dekLoaded: true,
    });
    expect(setupResponse.body.data.csrfToken).toMatch(/^csrf_/);

    const repeatResponse = await agent.post('/api/auth/setup').send({
      unlockSecret: 'another strong unlock phrase',
    });
    expect(repeatResponse.status).toBe(409);
    expect(repeatResponse.body.error.code).toBe('SETUP_EXISTS');
  }, 30_000);

  it('logs in with the unlock secret and clears loaded key material on logout', async () => {
    const setupResponse = await setupOwner();
    await postWithCsrf('/api/auth/logout', setupResponse.body.data.csrfToken);

    const badLogin = await agent.post('/api/auth/login').send({
      unlockSecret: 'wrong unlock phrase',
    });
    expect(badLogin.status).toBe(401);
    expect(badLogin.body.error.code).toBe('INVALID_UNLOCK_SECRET');

    const loginResponse = await agent.post('/api/auth/login').send({
      unlockSecret: 'a strong unlock phrase',
    });
    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.data).toMatchObject({
      setupComplete: true,
      sessionValid: true,
      dekLoaded: true,
    });

    const logoutResponse = await postWithCsrf('/api/auth/logout', loginResponse.body.data.csrfToken);
    expect(logoutResponse.status).toBe(200);
    expect(logoutResponse.body.data).toEqual({
      setupComplete: true,
      sessionValid: false,
      dekLoaded: false,
    });
  }, 30_000);

  it('changes the unlock secret without rotating the data encryption key', async () => {
    const setupResponse = await setupOwner();

    const badChange = await postWithCsrf(
      '/api/auth/change-unlock-secret',
      setupResponse.body.data.csrfToken,
    ).send({
      oldUnlockSecret: 'wrong unlock phrase',
      newUnlockSecret: 'a different strong unlock phrase',
    });
    expect(badChange.status).toBe(401);
    expect(badChange.body.error.code).toBe('INVALID_UNLOCK_SECRET');

    const changeResponse = await postWithCsrf(
      '/api/auth/change-unlock-secret',
      setupResponse.body.data.csrfToken,
    ).send({
      oldUnlockSecret: 'a strong unlock phrase',
      newUnlockSecret: 'a different strong unlock phrase',
    });
    expect(changeResponse.status).toBe(200);
    expect(changeResponse.body).toEqual({ data: { changed: true } });

    await postWithCsrf('/api/auth/logout', setupResponse.body.data.csrfToken);

    const oldLogin = await agent.post('/api/auth/login').send({
      unlockSecret: 'a strong unlock phrase',
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await agent.post('/api/auth/login').send({
      unlockSecret: 'a different strong unlock phrase',
    });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.data.dekLoaded).toBe(true);
  }, 45_000);

  it('rejects authenticated state changes without a valid CSRF token and trusted origin', async () => {
    const setupResponse = await setupOwner();

    const missingToken = await agent.post('/api/auth/change-unlock-secret').send({
      oldUnlockSecret: 'a strong unlock phrase',
      newUnlockSecret: 'a different strong unlock phrase',
    });
    expect(missingToken.status).toBe(403);
    expect(missingToken.body.error.code).toBe('CSRF_FAILED');

    const untrustedOrigin = await agent
      .post('/api/auth/change-unlock-secret')
      .set('Origin', 'https://attacker.example')
      .set('X-CSRF-Token', setupResponse.body.data.csrfToken)
      .send({
        oldUnlockSecret: 'a strong unlock phrase',
        newUnlockSecret: 'a different strong unlock phrase',
      });
    expect(untrustedOrigin.status).toBe(403);
    expect(untrustedOrigin.body.error.code).toBe('ORIGIN_FAILED');

    const loginWithOldSecret = await agent.post('/api/auth/login').send({
      unlockSecret: 'a strong unlock phrase',
    });
    expect(loginWithOldSecret.status).toBe(200);
  }, 45_000);

  it('rate-limits repeated failed login attempts', async () => {
    await setupOwner();
    const csrfToken = (await agent.get('/api/auth/status')).body.data.csrfToken;
    await postWithCsrf('/api/auth/logout', csrfToken);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await agent.post('/api/auth/login').send({
        unlockSecret: `wrong unlock phrase ${attempt}`,
      });
      expect(response.status).toBe(401);
    }

    const blockedResponse = await agent.post('/api/auth/login').send({
      unlockSecret: 'wrong unlock phrase final',
    });
    expect(blockedResponse.status).toBe(429);
    expect(blockedResponse.body.error.code).toBe('LOGIN_RATE_LIMITED');
  }, 45_000);
});
