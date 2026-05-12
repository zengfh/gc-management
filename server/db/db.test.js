import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, verifyDatabase } from './index.js';

const tempDirs = [];

function openTempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gc-db-'));
  tempDirs.push(dir);
  return openDatabase({ filename: path.join(dir, 'test.db') });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('database migrations', () => {
  it('creates the initial schema and records migrations', () => {
    const db = openTempDb();

    const migrations = db.prepare('SELECT id FROM schema_migrations').all();
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
      )
      .all()
      .map((row) => row.name);

    expect(migrations.map((row) => row.id)).toContain('001_init.sql');
    expect(migrations.map((row) => row.id)).toContain('002_hosted_hardening.sql');
    expect(migrations.map((row) => row.id)).toContain('004_reference_values.sql');
    expect(tables).toContain('accounts');
    expect(tables).toContain('cards');
    expect(tables).toContain('reference_values');
    expect(tables).toContain('audit_log');
    expect(tables).toContain('web_sessions');
    expect(tables).toContain('auth_login_attempts');
    expect(verifyDatabase(db)).toEqual({ ok: true, foreignKeyIssues: [] });

    db.close();
  });

  it('enforces money and enum constraints on cards', () => {
    const db = openTempDb();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO accounts (id, name, mode, createdAt, updatedAt) VALUES (1, ?, ?, ?, ?)',
    ).run('Personal', 'local', now, now);

    expect(() => {
      db.prepare(
        `INSERT INTO cards (
          accountId, brand, cardType, faceValueCents, remainingBalanceCents,
          purchaseCostCents, status, createdAt, updatedAt
        ) VALUES (1, 'Test', 'merchant', 0, 0, 0, 'available', ?, ?)`,
      ).run(now, now);
    }).toThrow(/CHECK constraint failed/);

    expect(() => {
      db.prepare(
        `INSERT INTO cards (
          accountId, brand, cardType, faceValueCents, remainingBalanceCents,
          purchaseCostCents, status, createdAt, updatedAt
        ) VALUES (1, 'Test', 'invalid', 1000, 1000, 0, 'available', ?, ?)`,
      ).run(now, now);
    }).toThrow(/CHECK constraint failed/);

    db.close();
  });

  it('hard-blocks active duplicate card number hashes for the same brand', () => {
    const db = openTempDb();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO accounts (id, name, mode, createdAt, updatedAt) VALUES (1, ?, ?, ?, ?)',
    ).run('Personal', 'local', now, now);

    const insert = db.prepare(
      `INSERT INTO cards (
        accountId, brand, cardType, faceValueCents, remainingBalanceCents,
        purchaseCostCents, cardNumberHash, status, createdAt, updatedAt
      ) VALUES (1, 'Target', 'merchant', 1000, 1000, 900, 'same-hash', ?, ?, ?)`,
    );

    insert.run('available', now, now);
    expect(() => insert.run('reserved', now, now)).toThrow(
      /UNIQUE constraint failed/,
    );

    db.close();
  });
});
