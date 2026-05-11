import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');

export function ensureMigrationTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      appliedAt TEXT NOT NULL
    )
  `);
}

export function listMigrationFiles(directory = migrationsDir) {
  return fs
    .readdirSync(directory)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
}

export function runMigrations(db, options = {}) {
  const directory = options.directory || migrationsDir;
  ensureMigrationTable(db);

  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map((row) => row.id),
  );

  const files = listMigrationFiles(directory);
  const applyMigration = db.transaction((file) => {
    const sql = fs.readFileSync(path.join(directory, file), 'utf8');
    db.exec(sql);
    db.prepare(
      'INSERT INTO schema_migrations (id, appliedAt) VALUES (?, ?)',
    ).run(file, new Date().toISOString());
  });

  for (const file of files) {
    if (!applied.has(file)) {
      applyMigration(file);
    }
  }

  return files;
}
