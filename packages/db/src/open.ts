import { mkdirSync } from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { applyMigrations, MIGRATIONS_DIR, type MigrateResult } from './migrate.js';

export type DrizzleDb = BetterSQLite3Database<typeof schema>;

export interface Database {
  sqlite: SqliteDatabase;
  db: DrizzleDb;
  file: string;
  migration: MigrateResult | null;
  close(): void;
}

export interface OpenOptions {
  /** Đường dẫn file, hoặc `:memory:`. */
  file: string;
  /** Mặc định true. */
  migrate?: boolean;
  migrationsDir?: string;
  now?: () => string;
}

/** Mở CSDL với `journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`, rồi áp migration (SPEC-00 §8). */
export function openDatabase(opts: OpenOptions): Database {
  if (opts.file !== ':memory:') mkdirSync(path.dirname(opts.file), { recursive: true });
  const sqlite = new BetterSqlite3(opts.file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');

  let migration: MigrateResult | null = null;
  if (opts.migrate !== false) {
    try {
      migration = applyMigrations(sqlite, opts.migrationsDir ?? MIGRATIONS_DIR, opts.now);
    } catch (err) {
      sqlite.close();
      throw err;
    }
  }
  const db = drizzle(sqlite, { schema });
  return {
    sqlite,
    db,
    file: opts.file,
    migration,
    close() {
      if (sqlite.open) sqlite.close();
    },
  };
}
