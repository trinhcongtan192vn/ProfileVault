import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newId, type Binding, type NormalizedProbe } from '@sctech/profilevault-contract';
import { AsnAttestationsRepo, BindingsRepo, ChecklistsRepo, ConsistencyRulesRepo, ConsistencyRunsRepo, HostSnapshotsRepo, ProbeResultsRepo, openTestDatabase, type TestDatabase } from '../src/index.js';

let t: TestDatabase;
let b: Binding;
beforeEach(() => {
  t = openTestDatabase();
  const now = '2026-10-14T00:00:00.000Z';
  b = { id: newId('binding'), platform: 'youtube', accountId: 'UC1', displayName: 'A', furyProfileId: 'p1', marketCountry: 'DE', packConfig: {}, allowedRoots: [], level: 0, levelSince: now, createdAt: now, updatedAt: now, archivedAt: null };
  new BindingsRepo(t.database.db).insert(b);
});
afterEach(() => t.cleanup());

const probe: NormalizedProbe = {
  furyVersion: '0.2.23',
  capturedAt: '2026-10-14T00:00:00.000Z',
  userAgent: 'UA',
  navigator: { platform: 'Win32', languages: ['de'], webdriver: false },
  screen: { width: 1, height: 1, availWidth: 1, availHeight: 1, colorDepth: 24, dpr: 1 },
  timezone: 'Europe/Berlin',
  hashes: {},
  voices: [],
  fonts: [],
  webrtc: { candidateIps: [] },
};

describe('repository nhất quán', () => {
  it('probe_results latestTwo theo captured_at', () => {
    const repo = new ProbeResultsRepo(t.database.db);
    repo.insert({ id: newId('probe'), bindingId: b.id, furyVersion: '0.2.23', source: 'manual_import', capturedAt: '2026-10-01T00:00:00.000Z', data: probe, rawPath: 'a', createdAt: 'x' });
    repo.insert({ id: newId('probe'), bindingId: b.id, furyVersion: '0.2.24', source: 'flow', capturedAt: '2026-10-05T00:00:00.000Z', data: { ...probe, furyVersion: '0.2.24' }, rawPath: 'b', createdAt: 'x' });
    const [latest, prev] = repo.latestTwo(b.id);
    expect(latest?.furyVersion).toBe('0.2.24');
    expect(prev?.furyVersion).toBe('0.2.23');
    expect(repo.list(b.id)).toHaveLength(2);
  });

  it('checklists upsert/get/expiringBetween', () => {
    const repo = new ChecklistsRepo(t.database.db);
    repo.upsert({ bindingId: b.id, updatedAt: 'x', accountRegion: 'DE' });
    repo.upsert({ bindingId: b.id, updatedAt: 'y', twofaEnabled: true, expiresAt: '2026-10-20T00:00:00.000Z' });
    expect(repo.get(b.id)).toMatchObject({ accountRegion: 'DE', twofaEnabled: true, updatedAt: 'y' });
    expect(repo.expiringBetween('2026-10-14T00:00:00.000Z', '2026-10-21T00:00:00.000Z')).toHaveLength(1);
    expect(repo.expiringBetween('2026-10-21T00:00:00.000Z', '2026-10-30T00:00:00.000Z')).toHaveLength(0);
  });

  it('host_snapshots, consistency_rules, runs/results, asn_attestations', () => {
    const hosts = new HostSnapshotsRepo(t.database.db);
    hosts.insert({ os: 'windows', osVersion: '10', gpus: [{ name: 'g' }], displays: [{ width: 1, height: 2 }], ramMb: 1, capturedAt: '2026-10-01T00:00:00.000Z' });
    hosts.insert({ os: 'windows', osVersion: '11', gpus: [], displays: [], ramMb: 2, capturedAt: '2026-10-02T00:00:00.000Z' });
    expect(hosts.latest()?.osVersion).toBe('11');

    const rules = new ConsistencyRulesRepo(t.database.db);
    expect(rules.count()).toBe(0);
    rules.upsert({ id: 'A1.exit_country_matches_market', layer: 'A', severity: 'block', enabled: true, params: {}, updatedAt: 'x' });
    rules.upsert({ id: 'A1.exit_country_matches_market', layer: 'A', severity: 'warn', enabled: false, params: { a: 1 }, updatedAt: 'y' });
    expect(rules.get('A1.exit_country_matches_market')).toMatchObject({ severity: 'warn', enabled: false, params: { a: 1 } });
    expect(rules.list()).toHaveLength(1);

    const runs = new ConsistencyRunsRepo(t.database.db);
    const id1 = newId('consistencyRun');
    runs.start(id1, 'manual', '2026-10-01T00:00:00.000Z');
    runs.addResults([{ runId: id1, bindingId: b.id, ruleId: 'A1.exit_country_matches_market', status: 'pass', severity: 'block', hint: null }]);
    runs.finish(id1, '2026-10-01T00:00:01.000Z');
    const id2 = newId('consistencyRun');
    runs.start(id2, 'periodic', '2026-10-02T00:00:00.000Z');
    runs.addResults([{ runId: id2, bindingId: b.id, ruleId: 'A1.exit_country_matches_market', status: 'fail', severity: 'block', actual: 'FR', expected: 'DE', hint: 'x' }]);
    runs.finish(id2, '2026-10-02T00:00:01.000Z');
    const latest = runs.latestForBinding(b.id)!;
    expect(latest.run.id).toBe(id2);
    expect(latest.results[0]).toMatchObject({ status: 'fail', actual: 'FR', expected: 'DE' });
    expect(runs.results(id1)).toHaveLength(1);
    expect(runs.listRuns()[0]?.id).toBe(id2);

    const att = new AsnAttestationsRepo(t.database.db);
    att.upsert({ asn: 1, asnType: 'isp', note: null, createdAt: 'x' });
    att.upsert({ asn: 1, asnType: 'hosting', note: 'đổi', createdAt: 'y' });
    expect(att.get(1)).toMatchObject({ asnType: 'hosting', note: 'đổi' });
    expect(att.list()).toHaveLength(1);
  });
});
