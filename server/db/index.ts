import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { runMigrations } from './migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(__dirname, '..', 'data');
const defaultDbPath = path.join(defaultDataDir, 'gcmanager.db');

export function getDatabasePath() {
  return process.env.GC_DB_PATH || defaultDbPath;
}

interface OpenDatabaseOptions {
  filename?: string;
  migrate?: boolean;
  directory?: string;
}

export function openDatabase(options: OpenDatabaseOptions = {}) {
  const filename = options.filename || getDatabasePath();
  if (filename !== ':memory:') {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }

  const db = new Database(filename);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  if (filename !== ':memory:') {
    db.pragma('journal_mode = WAL');
  }

  if (options.migrate !== false) {
    runMigrations(db, options);
  }

  return db;
}

export function verifyDatabase(db) {
  const foreignKeyIssues = db.pragma('foreign_key_check');
  if (foreignKeyIssues.length > 0) {
    return { ok: false, foreignKeyIssues };
  }

  return { ok: true, foreignKeyIssues: [] };
}
