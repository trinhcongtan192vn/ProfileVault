import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database as SqliteDatabase } from 'better-sqlite3';
import { PvError } from '@sctech/profilevault-contract';

/** Thư mục migration đi kèm package (cả khi chạy từ `dist/` lẫn `src/`). */
export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

const FILE_RE = /^(\d{4})_([a-z0-9_-]+)\.sql$/i;

export interface MigrationFile {
  seq: number;
  name: string;
  file: string;
}

/** CSDL ghi migration mới hơn mã → từ chối chạy (SPEC-00 §8). */
export class MigrationNewerThanCodeError extends PvError {
  constructor(dbVersion: number, codeVersion: number) {
    super(
      'INTERNAL',
      `CSDL ở phiên bản migration ${dbVersion}, mã chỉ biết tới ${codeVersion}. Hãy cập nhật ProfileVault hoặc dùng CSDL cũ.`,
      { reason: 'db_newer_than_code', dbVersion, codeVersion },
    );
    this.name = 'MigrationNewerThanCodeError';
  }
}

export function listMigrationFiles(dir: string = MIGRATIONS_DIR): MigrationFile[] {
  const files: MigrationFile[] = [];
  for (const entry of readdirSync(dir)) {
    const m = FILE_RE.exec(entry);
    if (!m) continue;
    files.push({ seq: Number(m[1]), name: m[2] ?? '', file: path.join(dir, entry) });
  }
  files.sort((a, b) => a.seq - b.seq);
  for (let i = 1; i < files.length; i++) {
    const prev = files[i - 1];
    const cur = files[i];
    if (prev && cur && prev.seq === cur.seq) {
      throw new PvError('INTERNAL', `Hai migration cùng số thứ tự ${cur.seq}`, { reason: 'duplicate_migration_seq' });
    }
  }
  return files;
}

function ensureTrackingTable(sqlite: SqliteDatabase): void {
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS pv_migrations (seq INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)',
  );
}

export function currentMigrationVersion(sqlite: SqliteDatabase): number {
  ensureTrackingTable(sqlite);
  const row = sqlite.prepare('SELECT COALESCE(MAX(seq), 0) AS v FROM pv_migrations').get() as { v: number };
  return row.v;
}

export interface MigrateResult {
  applied: string[];
  current: number;
}

/**
 * Áp các migration chưa chạy, mỗi file một giao dịch. CSDL mới hơn mã → ném `MigrationNewerThanCodeError`.
 * `now` cho phép test tiêm thời điểm.
 */
export function applyMigrations(
  sqlite: SqliteDatabase,
  dir: string = MIGRATIONS_DIR,
  now: () => string = () => new Date().toISOString(),
): MigrateResult {
  const files = listMigrationFiles(dir);
  const codeVersion = files.length > 0 ? (files[files.length - 1]?.seq ?? 0) : 0;
  const dbVersion = currentMigrationVersion(sqlite);
  if (dbVersion > codeVersion) throw new MigrationNewerThanCodeError(dbVersion, codeVersion);

  const applied: string[] = [];
  const insert = sqlite.prepare('INSERT INTO pv_migrations (seq, name, applied_at) VALUES (?, ?, ?)');
  for (const f of files) {
    if (f.seq <= dbVersion) continue;
    const sql = readFileSync(f.file, 'utf8');
    const run = sqlite.transaction(() => {
      sqlite.exec(sql);
      insert.run(f.seq, f.name, now());
    });
    run();
    applied.push(`${String(f.seq).padStart(4, '0')}_${f.name}`);
  }
  return { applied, current: currentMigrationVersion(sqlite) };
}
