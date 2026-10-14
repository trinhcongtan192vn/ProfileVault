import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FakeClock } from '@sctech/profilevault-contract';
import { AuditRepo, pruneAppendOnly, SettingsRepo, type TestDatabase, openTestDatabase } from '../src/index.js';

let t: TestDatabase;
let clock: FakeClock;
beforeEach(() => {
  clock = new FakeClock('2026-10-14T00:00:00.000Z');
  t = openTestDatabase({ now: () => clock.nowIso() });
});
afterEach(() => t.cleanup());

describe('SettingsRepo', () => {
  it('set ghi settings + settings_history với actor; get trả giá trị', () => {
    const repo = new SettingsRepo(t.database.db, clock);
    expect(repo.get('thresholds')).toBeUndefined();
    repo.set('thresholds', { a: 1 }, 'system');
    clock.advance(1000);
    repo.set('thresholds', { a: 2 }, 'user');
    expect(repo.get('thresholds')).toEqual({ a: 2 });
    const h = repo.history('thresholds');
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ oldJson: '{"a":1}', newJson: '{"a":2}', actor: 'user' });
    expect(h[1]).toMatchObject({ oldJson: null, newJson: '{"a":1}', actor: 'system' });
  });

  it('set cùng giá trị không ghi lịch sử', () => {
    const repo = new SettingsRepo(t.database.db, clock);
    repo.set('x', 1, 'system');
    repo.set('x', 1, 'system');
    expect(repo.history('x')).toHaveLength(1);
  });

  it('get với schema sai → PvError INTERNAL', () => {
    const repo = new SettingsRepo(t.database.db, clock);
    repo.set('x', 'text', 'system');
    expect(() => repo.get('x', z.number())).toThrow(/không khớp schema/);
  });
});

describe('AuditRepo', () => {
  it('append + list; chỉ có thêm và đọc', () => {
    const repo = new AuditRepo(t.database.db, clock);
    repo.append({ actorType: 'system', action: 'system.first_run', detail: { v: '0.1.0' } });
    clock.advance(10);
    repo.append({ actorType: 'user', action: 'binding.create', targetType: 'binding', targetId: 'ab_1' });
    const all = repo.list();
    expect(all).toHaveLength(2);
    expect(all[0]?.action).toBe('binding.create');
    expect(repo.list({ action: 'system.first_run' })).toHaveLength(1);
    expect(all[0]?.id.startsWith('au_')).toBe(true);
    const proto = Object.getOwnPropertyNames(AuditRepo.prototype);
    expect(proto.some((n) => /update|delete|remove/i.test(n))).toBe(false);
  });
});

describe('pruneAppendOnly', () => {
  it('xóa dòng cũ hơn retention trên 4 bảng chỉ thêm', () => {
    const audit = new AuditRepo(t.database.db, clock);
    audit.append({ actorType: 'system', action: 'old' });
    clock.advanceDays(400);
    audit.append({ actorType: 'system', action: 'new' });
    const r = pruneAppendOnly(t.database.db, { retentionMonths: 12, now: clock.now() });
    expect(r.deleted.audit_events).toBe(1);
    expect(audit.list().map((a) => a.action)).toEqual(['new']);
  });
});
