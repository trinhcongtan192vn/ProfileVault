import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase, type Database, type OpenOptions } from './open.js';

export interface TestDatabase {
  database: Database;
  dir: string;
  file: string;
  cleanup(): void;
}

/** CSDL SQLite thật trong thư mục tạm cho integration test (SPEC-09 §2). */
export function openTestDatabase(opts: Partial<Omit<OpenOptions, 'file'>> = {}): TestDatabase {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pv-db-'));
  const file = path.join(dir, 'profilevault.db');
  const database = openDatabase({ file, ...opts });
  return {
    database,
    dir,
    file,
    cleanup() {
      database.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
