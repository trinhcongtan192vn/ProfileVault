import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openTestDatabase, SPEC_TABLE_NAMES, type TestDatabase } from '../src/index.js';

interface TableInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}
interface IndexInfo {
  name: string;
  unique: number;
  origin: string;
  partial: number;
}
interface FkInfo {
  table: string;
  from: string;
  to: string;
}

let t: TestDatabase;
beforeAll(() => {
  t = openTestDatabase();
});
afterAll(() => t.cleanup());

function tableInfo(name: string): TableInfo[] {
  return t.database.sqlite.pragma(`table_info(${name})`) as TableInfo[];
}
function col(name: string, c: string): TableInfo {
  const found = tableInfo(name).find((x) => x.name === c);
  if (!found) throw new Error(`thiếu cột ${name}.${c}`);
  return found;
}

describe('schema SPEC-00 §8', () => {
  it('đủ 21 bảng nghiệp vụ + pv_migrations', () => {
    const rows = t.database.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
      .all() as { name: string }[];
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual([...SPEC_TABLE_NAMES, 'pv_migrations'].sort());
    expect(SPEC_TABLE_NAMES).toHaveLength(21);
  });

  it('PRAGMA đúng: WAL, foreign_keys', () => {
    expect(t.database.sqlite.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(t.database.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('bindings: cột, NOT NULL, mặc định, CHECK level, UNIQUE', () => {
    expect(col('bindings', 'id').pk).toBe(1);
    expect(col('bindings', 'fury_profile_id').notnull).toBe(1);
    expect(col('bindings', 'pack_config_json').dflt_value).toBe("'{}'");
    expect(col('bindings', 'allowed_roots_json').dflt_value).toBe("'[]'");
    expect(col('bindings', 'level').dflt_value).toBe('0');
    expect(col('bindings', 'archived_at').notnull).toBe(0);
    const idx = t.database.sqlite.pragma('index_list(bindings)') as IndexInfo[];
    expect(idx.filter((i) => i.unique === 1 && i.origin === 'u')).toHaveLength(2); // fury_profile_id, (platform, account_id)
    const sql = (
      t.database.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'bindings'").get() as { sql: string }
    ).sql;
    expect(sql).toMatch(/CHECK \(level BETWEEN 0 AND 3\)/);
    expect(() =>
      t.database.sqlite
        .prepare(
          "INSERT INTO bindings (id, platform, account_id, display_name, fury_profile_id, market_country, level, level_since, created_at, updated_at) VALUES ('ab_x','youtube','UC1','n','p1','DE',4,'t','t','t')",
        )
        .run(),
    ).toThrow(/CHECK/);
  });

  it('binding_pauses: chỉ mục một phần ix_pauses_open; khóa ngoại bật', () => {
    const idx = t.database.sqlite.pragma('index_list(binding_pauses)') as IndexInfo[];
    const open = idx.find((i) => i.name === 'ix_pauses_open');
    expect(open).toBeDefined();
    expect(open?.partial).toBe(1);
    const fks = t.database.sqlite.pragma('foreign_key_list(binding_pauses)') as FkInfo[];
    expect(fks).toEqual([expect.objectContaining({ table: 'bindings', from: 'binding_id', to: 'id' })]);
    expect(() =>
      t.database.sqlite
        .prepare("INSERT INTO binding_pauses (id, binding_id, reason, created_at) VALUES ('bp_x','ab_missing','manual','t')")
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it('health_events: binding_id NULL được, chỉ mục ix_events_binding_time', () => {
    expect(col('health_events', 'binding_id').notnull).toBe(0);
    const idx = t.database.sqlite.pragma('index_list(health_events)') as IndexInfo[];
    expect(idx.map((i) => i.name)).toContain('ix_events_binding_time');
  });

  it('level_changes CHECK kind; probe_results CHECK source', () => {
    const lc = (t.database.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'level_changes'").get() as { sql: string })
      .sql;
    expect(lc).toMatch(/CHECK \(kind IN \('promote','demote'\)\)/);
    const pr = (t.database.sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'probe_results'").get() as { sql: string })
      .sql;
    expect(pr).toMatch(/CHECK \(source IN \('manual_import','flow'\)\)/);
  });

  it('jobs UNIQUE (client_id, idempotency_key); clients token_prefix UNIQUE', () => {
    const jobsIdx = t.database.sqlite.pragma('index_list(jobs)') as IndexInfo[];
    expect(jobsIdx.some((i) => i.unique === 1)).toBe(true);
    const clientsIdx = t.database.sqlite.pragma('index_list(clients)') as IndexInfo[];
    expect(clientsIdx.some((i) => i.unique === 1)).toBe(true);
    expect(col('clients', 'rate_limit_per_min').dflt_value).toBe('120');
    expect(col('clients', 'flow_filter_json').dflt_value).toBe(`'["*"]'`);
  });

  it('khóa chính ghép: consistency_results, run_steps', () => {
    const cr = tableInfo('consistency_results').filter((c) => c.pk > 0).map((c) => c.name);
    expect(cr).toEqual(['run_id', 'binding_id', 'rule_id']);
    const rs = tableInfo('run_steps').filter((c) => c.pk > 0).map((c) => c.name);
    expect(rs).toEqual(['run_id', 'seq']);
  });

  it('runs: attempt mặc định 1, launched_by_run mặc định 0; schedules enabled 1; consistency_rules enabled 1', () => {
    expect(col('runs', 'attempt').dflt_value).toBe('1');
    expect(col('runs', 'launched_by_run').dflt_value).toBe('0');
    expect(col('schedules', 'enabled').dflt_value).toBe('1');
    expect(col('consistency_rules', 'enabled').dflt_value).toBe('1');
    expect(col('account_checklists', 'binding_id').pk).toBe(1);
    expect(col('asn_attestations', 'asn').pk).toBe(1);
  });

  it('số cột từng bảng khớp SPEC-00 §8', () => {
    const expected: Record<string, number> = {
      settings: 3,
      settings_history: 6,
      bindings: 13,
      binding_pauses: 7,
      level_changes: 9,
      health_events: 8,
      proxy_checks: 13,
      asn_attestations: 4,
      probe_results: 8,
      detect_suite_results: 6,
      account_checklists: 12,
      host_snapshots: 7,
      consistency_rules: 6,
      consistency_runs: 4,
      consistency_results: 8,
      jobs: 13,
      runs: 17,
      run_steps: 8,
      schedules: 11,
      clients: 11,
      audit_events: 8,
    };
    for (const [name, n] of Object.entries(expected)) {
      expect(tableInfo(name), name).toHaveLength(n);
    }
  });
});
