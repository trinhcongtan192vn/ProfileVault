import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMigrations, currentMigrationVersion, listMigrationFiles, MIGRATIONS_DIR, MigrationNewerThanCodeError, openDatabase } from '../src/index.js';

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(os.tmpdir(), 'pv-mig-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('migration (SPEC-00 §8)', () => {
  it('liệt kê file có số thứ tự', () => {
    const files = listMigrationFiles(MIGRATIONS_DIR);
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files[0]).toMatchObject({ seq: 1, name: 'init' });
  });

  it('mở lần hai không chạy lại; dữ liệu giữ nguyên', () => {
    const file = path.join(tmp(), 'a.db');
    const first = openDatabase({ file });
    expect(first.migration?.applied).toEqual(['0001_init']);
    first.sqlite.prepare("INSERT INTO settings (key, value_json, updated_at) VALUES ('k','1','t')").run();
    first.close();
    const second = openDatabase({ file });
    expect(second.migration?.applied).toEqual([]);
    expect(second.migration?.current).toBe(1);
    expect(second.sqlite.prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 1 });
    second.close();
  });

  it('CSDL mới hơn mã → MigrationNewerThanCodeError, file không đổi', () => {
    const file = path.join(tmp(), 'b.db');
    const db = openDatabase({ file });
    db.sqlite.prepare("INSERT INTO pv_migrations (seq, name, applied_at) VALUES (999, 'future', 't')").run();
    db.close();
    expect(() => openDatabase({ file })).toThrow(MigrationNewerThanCodeError);
    const raw = new BetterSqlite3(file);
    expect(currentMigrationVersion(raw)).toBe(999);
    raw.close();
  });

  it('migration lỗi giữa chừng → giao dịch hoàn tác, phiên bản không tăng', () => {
    const migDir = tmp();
    writeFileSync(path.join(migDir, '0001_ok.sql'), 'CREATE TABLE a (x INTEGER);\n');
    writeFileSync(path.join(migDir, '0002_bad.sql'), 'CREATE TABLE b (y INTEGER);\nINSERT INTO nope VALUES (1);\n');
    const sqlite = new BetterSqlite3(':memory:');
    expect(() => applyMigrations(sqlite, migDir)).toThrow();
    expect(currentMigrationVersion(sqlite)).toBe(1);
    const tables = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name);
    expect(tables).toContain('a');
    expect(tables).not.toContain('b');
    sqlite.close();
  });

  it('hai file cùng số thứ tự → lỗi', () => {
    const migDir = tmp();
    writeFileSync(path.join(migDir, '0001_a.sql'), 'SELECT 1;');
    writeFileSync(path.join(migDir, '0001_b.sql'), 'SELECT 1;');
    expect(() => listMigrationFiles(migDir)).toThrow(/cùng số thứ tự/);
  });
});
