import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeClock, newId, type Binding } from '@sctech/profilevault-contract';
import { BindingsRepo, DetectSuiteRepo, HealthEventsRepo, LevelChangesRepo, openTestDatabase, PausesRepo, ProxyChecksRepo, type TestDatabase } from '../src/index.js';

let t: TestDatabase;
const clock = new FakeClock('2026-10-14T00:00:00.000Z');
beforeEach(() => {
  t = openTestDatabase();
});
afterEach(() => t.cleanup());

function binding(n: number): Binding {
  const now = clock.nowIso();
  return {
    id: newId('binding'),
    platform: 'youtube',
    accountId: `UC${n}`,
    displayName: `K${n}`,
    furyProfileId: `p${n}`,
    marketCountry: 'DE',
    packConfig: {},
    allowedRoots: [],
    level: 0,
    levelSince: now,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
}

describe('repository health (SPEC-00 §8)', () => {
  it('bindings: insert/get/getByProfile/getByAccount/list/archive/setLevel', () => {
    const repo = new BindingsRepo(t.database.db);
    const b = binding(1);
    repo.insert(b);
    expect(repo.get(b.id)).toEqual(b);
    expect(repo.getByProfile('p1')?.id).toBe(b.id);
    expect(repo.getByAccount('youtube', 'UC1')?.id).toBe(b.id);
    repo.setLevel(b.id, 2, '2026-10-15T00:00:00.000Z');
    expect(repo.get(b.id)).toMatchObject({ level: 2, levelSince: '2026-10-15T00:00:00.000Z' });
    repo.archive(b.id, '2026-10-16T00:00:00.000Z');
    expect(repo.list()).toHaveLength(0);
    expect(repo.list({ includeArchived: true })).toHaveLength(1);
    expect(() => repo.insert({ ...binding(2), furyProfileId: 'p1' })).toThrow(/UNIQUE/);
  });

  it('health_events: append/list theo binding, null, types, since; order', () => {
    const b = binding(1);
    new BindingsRepo(t.database.db).insert(b);
    const repo = new HealthEventsRepo(t.database.db);
    const mk = (type: 'manual.upload' | 'fury.version_changed', bindingId: string | null, at: string) => ({
      id: newId('healthEvent'),
      bindingId,
      type,
      severity: 'info' as const,
      source: 'manual' as const,
      payload: {},
      occurredAt: at,
      recordedAt: at,
    });
    repo.append(mk('manual.upload', b.id, '2026-10-01T00:00:00.000Z'));
    repo.append(mk('manual.upload', b.id, '2026-10-05T00:00:00.000Z'));
    repo.append(mk('fury.version_changed', null, '2026-10-03T00:00:00.000Z'));
    expect(repo.list({ bindingId: b.id })).toHaveLength(2);
    expect(repo.list({ bindingId: null })).toHaveLength(1);
    expect(repo.list()).toHaveLength(3);
    expect(repo.list({ bindingId: b.id, since: '2026-10-02T00:00:00.000Z' })).toHaveLength(1);
    expect(repo.list({ order: 'asc' })[0]?.occurredAt).toBe('2026-10-01T00:00:00.000Z');
    expect(repo.count({ types: ['manual.upload'] })).toBe(2);
  });

  it('pauses/level_changes/proxy_checks/detect_suite', () => {
    const b1 = binding(1);
    const b2 = binding(2);
    const bindingsRepo = new BindingsRepo(t.database.db);
    bindingsRepo.insert(b1);
    bindingsRepo.insert(b2);

    const pauses = new PausesRepo(t.database.db);
    const p = pauses.open({ id: newId('pause'), bindingId: b1.id, reason: 'manual', detail: {}, createdAt: clock.nowIso() });
    expect(pauses.findOpen(b1.id, 'manual')?.id).toBe(p.id);
    expect(pauses.listOpen()).toHaveLength(1);
    pauses.clear(p.id, clock.nowIso(), 'user');
    expect(pauses.listOpen(b1.id)).toHaveLength(0);
    expect(pauses.list(b1.id)[0]).toMatchObject({ clearedBy: 'user' });

    const lc = new LevelChangesRepo(t.database.db);
    lc.append({ id: newId('levelChange'), bindingId: b1.id, fromLevel: 0, toLevel: 1, kind: 'promote', reason: 'x', detail: {}, actor: 'user', createdAt: clock.nowIso() });
    expect(lc.list(b1.id)).toHaveLength(1);

    const pc = new ProxyChecksRepo(t.database.db);
    const mk = (bindingId: string, ip: string, ok: boolean, at: string) => ({
      id: newId('proxyCheck'),
      bindingId,
      ok,
      exitIp: ip,
      country: 'DE',
      city: null,
      timezone: null,
      asn: 1,
      asnOrg: null,
      asnType: 'isp' as const,
      latencyMs: null,
      error: null,
      checkedAt: at,
    });
    pc.insert(mk(b1.id, '1.1.1.1', true, '2026-10-01T00:00:00.000Z'));
    pc.insert(mk(b1.id, '1.1.1.2', false, '2026-10-02T00:00:00.000Z'));
    pc.insert(mk(b2.id, '2.2.2.2', true, '2026-10-02T00:00:00.000Z'));
    expect(pc.latest(b1.id)?.exitIp).toBe('1.1.1.2');
    expect(pc.latestOk(b1.id)?.exitIp).toBe('1.1.1.1');
    expect(pc.latestOkPerBinding().map((c) => c.exitIp).sort()).toEqual(['1.1.1.1', '2.2.2.2']);
    bindingsRepo.archive(b2.id, clock.nowIso());
    expect(pc.latestOkPerBinding()).toHaveLength(1);

    const ds = new DetectSuiteRepo(t.database.db);
    ds.insert({ furyVersion: '0.2.23', bindingId: null, passed: false, summary: null, recordedAt: '2026-10-01T00:00:00.000Z' });
    expect(ds.hasPassed('0.2.23')).toBe(false);
    ds.insert({ furyVersion: '0.2.23', bindingId: null, passed: true, summary: null, recordedAt: '2026-10-02T00:00:00.000Z' });
    expect(ds.hasPassed('0.2.23')).toBe(true);
    expect(ds.hasPassed('0.2.23', b1.id)).toBe(true);
    ds.insert({ furyVersion: '0.2.23', bindingId: b1.id, passed: false, summary: 'x', recordedAt: '2026-10-03T00:00:00.000Z' });
    expect(ds.hasPassed('0.2.23', b1.id)).toBe(false);
    expect(ds.hasPassed('0.2.23')).toBe(true);
    expect(ds.hasPassed('0.9.9')).toBe(false);
  });
});
