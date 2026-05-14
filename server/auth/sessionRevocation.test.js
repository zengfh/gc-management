import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/index.js';
import { clearUserSessions } from './sessionRevocation.js';

describe('session revocation', () => {
  let db;

  beforeEach(() => {
    db = openDatabase({ filename: ':memory:' });
  });

  afterEach(() => {
    db.close();
  });

  it('only deletes sessions for the exact user id', () => {
    const insertSession = db.prepare(
      `INSERT INTO web_sessions (sid, sessionJson, expiresAt, updatedAt)
       VALUES (?, ?, ?, ?)`,
    );
    insertSession.run('user-1', JSON.stringify({ userId: 1, accountId: 1 }), Date.now() + 60_000, '2026-05-14T00:00:00.000Z');
    insertSession.run(
      'user-12',
      JSON.stringify({ userId: 12, accountId: 1 }),
      Date.now() + 60_000,
      '2026-05-14T00:00:00.000Z',
    );

    clearUserSessions(db, 1);

    expect(db.prepare("SELECT sid FROM web_sessions WHERE sid = 'user-1'").get()).toBeUndefined();
    expect(db.prepare("SELECT sid FROM web_sessions WHERE sid = 'user-12'").get()).toEqual({ sid: 'user-12' });
  });
});
