import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { clearUnlockedSession } from '../auth/unlockStore.js';
import { openDatabase } from '../db/index.js';

describe('auth routes', () => {
  const appOrigin = 'http://localhost:5173';
  const defaultFeatures = {
    plaintextJsonExport: true,
    rawDatabaseExport: true,
    csvImport: true,
    referenceValueHints: true,
    networkSecurityCodeStorage: false,
  };
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
        features: defaultFeatures,
      },
    });
  });

  it('reports public feature flags from deployment configuration', async () => {
    const originalCsvImport = process.env.GC_FEATURE_CSV_IMPORT;
    process.env.GC_FEATURE_CSV_IMPORT = 'false';
    try {
      const response = await agent.get('/api/auth/status');

      expect(response.status).toBe(200);
      expect(response.body.data.features).toMatchObject({
        ...defaultFeatures,
        csvImport: false,
      });
    } finally {
      if (originalCsvImport === undefined) {
        delete process.env.GC_FEATURE_CSV_IMPORT;
      } else {
        process.env.GC_FEATURE_CSV_IMPORT = originalCsvImport;
      }
    }
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
      features: defaultFeatures,
    });
  }, 30_000);

  it('exposes passkey registration options after unlock and rejects passkey login before registration', async () => {
    const setupResponse = await setupOwner();
    const csrfToken = setupResponse.body.data.csrfToken;

    const listResponse = await agent.get('/api/auth/passkeys');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.data).toEqual([]);

    const optionsResponse = await postWithCsrf('/api/auth/passkeys/register/options', csrfToken).send({});
    expect(optionsResponse.status).toBe(200);
    expect(optionsResponse.body.data.options).toMatchObject({
      rp: expect.objectContaining({ name: 'Gift Card Manager' }),
      challenge: expect.any(String),
    });

    await postWithCsrf('/api/auth/logout', csrfToken);
    const loginOptions = await agent.post('/api/auth/passkeys/login/options').send({});
    expect(loginOptions.status).toBe(401);
    expect(loginOptions.body.error.code).toBe('PASSKEY_NOT_CONFIGURED');
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

  it('generates one-time recovery codes and resets a forgotten unlock secret', async () => {
    const setupResponse = await agent.post('/api/auth/setup').send({
      email: 'owner@example.com',
      displayName: 'Owner',
      unlockSecret: 'a strong unlock phrase',
    });
    expect(setupResponse.status).toBe(201);

    const recoveryCodes = await postWithCsrf(
      '/api/auth/recovery-codes',
      setupResponse.body.data.csrfToken,
    ).send({
      currentUnlockSecret: 'a strong unlock phrase',
    });
    expect(recoveryCodes.status).toBe(201);
    expect(recoveryCodes.body.data.codes).toHaveLength(10);
    expect(recoveryCodes.body.data.codes[0]).toMatch(/^GC-REC-/);
    expect(recoveryCodes.body.data.activeCount).toBe(10);

    const audit = db.prepare("SELECT metadata FROM audit_log WHERE action = 'auth.recovery_codes_generate'").get();
    expect(JSON.stringify(audit)).not.toContain(recoveryCodes.body.data.codes[0]);

    await postWithCsrf('/api/auth/logout', setupResponse.body.data.csrfToken);

    const badRecovery = await request(app).post('/api/auth/recover').send({
      email: 'owner@example.com',
      recoveryCode: 'GC-REC-WRONG-CODE',
      newUnlockSecret: 'a recovered strong unlock phrase',
    });
    expect(badRecovery.status).toBe(401);
    expect(badRecovery.body.error.code).toBe('INVALID_RECOVERY_CODE');

    const recovery = await request(app).post('/api/auth/recover').send({
      email: 'owner@example.com',
      recoveryCode: recoveryCodes.body.data.codes[0],
      newUnlockSecret: 'a recovered strong unlock phrase',
    });
    expect(recovery.status).toBe(200);
    expect(recovery.body).toEqual({ data: { reset: true } });

    const oldLogin = await request(app).post('/api/auth/login').send({
      email: 'owner@example.com',
      unlockSecret: 'a strong unlock phrase',
    });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app).post('/api/auth/login').send({
      email: 'owner@example.com',
      unlockSecret: 'a recovered strong unlock phrase',
    });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.data.dekLoaded).toBe(true);

    const reuseRecovery = await request(app).post('/api/auth/recover').send({
      email: 'owner@example.com',
      recoveryCode: recoveryCodes.body.data.codes[0],
      newUnlockSecret: 'another recovered strong unlock phrase',
    });
    expect(reuseRecovery.status).toBe(401);
    expect(reuseRecovery.body.error.code).toBe('INVALID_RECOVERY_CODE');
  }, 90_000);

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

  it('persists session metadata across app instances while requiring key reload', async () => {
    const setupResponse = await setupOwner();
    const cookie = setupResponse.headers['set-cookie'];
    const sessionRow = db.prepare('SELECT sid FROM web_sessions').get();
    expect(sessionRow).toEqual({ sid: expect.any(String) });

    clearUnlockedSession(sessionRow.sid);
    const restartedApp = createApp({ db });

    const statusResponse = await request(restartedApp).get('/api/auth/status').set('Cookie', cookie);
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.data).toMatchObject({
      setupComplete: true,
      sessionValid: true,
      dekLoaded: false,
      csrfToken: setupResponse.body.data.csrfToken,
    });

    const lockedResponse = await request(restartedApp).get('/api/cards').set('Cookie', cookie);
    expect(lockedResponse.status).toBe(401);
    expect(lockedResponse.body.error.code).toBe('LOCKED');
  }, 45_000);

  it('persists failed login attempts across app instances', async () => {
    await setupOwner();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await request(app).post('/api/auth/login').send({
        unlockSecret: `wrong unlock phrase ${attempt}`,
      });
      expect(response.status).toBe(401);
    }

    const restartedApp = createApp({ db });
    for (let attempt = 3; attempt < 5; attempt += 1) {
      const response = await request(restartedApp).post('/api/auth/login').send({
        unlockSecret: `wrong unlock phrase ${attempt}`,
      });
      expect(response.status).toBe(401);
    }

    const attemptRow = db.prepare('SELECT failures FROM auth_login_attempts').get();
    expect(attemptRow).toEqual({ failures: 5 });

    const blockedResponse = await request(restartedApp).post('/api/auth/login').send({
      unlockSecret: 'wrong unlock phrase final',
    });
    expect(blockedResponse.status).toBe(429);
    expect(blockedResponse.body.error.code).toBe('LOGIN_RATE_LIMITED');
  }, 45_000);
});
