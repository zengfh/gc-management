import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');

interface MigrationRow {
  id: string;
}

export function ensureMigrationTable(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      appliedAt TEXT NOT NULL
    )
  `);
}

export function listMigrationFiles(directory = migrationsDir): string[] {
  return fs
    .readdirSync(directory)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
}

interface MigrationOptions {
  directory?: string;
}

export function runMigrations(db: Database.Database, options: MigrationOptions = {}) {
  const directory = options.directory || migrationsDir;
  ensureMigrationTable(db);

  const applied = new Set(
    (db.prepare('SELECT id FROM schema_migrations').all() as MigrationRow[]).map((row) => row.id),
  );

  const files = listMigrationFiles(directory);
  const insertMigrationRecord = db.prepare(
    'INSERT INTO schema_migrations (id, appliedAt) VALUES (?, ?)',
  );
  const applyMigration = db.transaction((file: string, sql: string) => {
    db.exec(sql);
    insertMigrationRecord.run(file, new Date().toISOString());
  });

  for (const file of files) {
    if (!applied.has(file)) {
      const sql = fs.readFileSync(path.join(directory, file), 'utf8');
      if (sql.includes('@disable-foreign-keys')) {
        db.pragma('foreign_keys = OFF');
        try {
          applyMigration(file, sql);
        } finally {
          db.pragma('foreign_keys = ON');
        }
      } else {
        applyMigration(file, sql);
      }
    }
  }

  return files;
}
