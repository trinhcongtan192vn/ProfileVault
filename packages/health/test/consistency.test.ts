import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PvError } from '@sctech/profilevault-contract';
import { addBinding, makeHarness, type Harness } from './helpers.js';

const probesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'probes');
const probeFile = (n: string) => path.join(probesDir, `${n}.json`);

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
  await h.bundle.hostService.captureAndStore();
});
afterEach(() => h.cleanup());

const FULL_CHECKLIST = { accountRegion: 'DE', channelCountry: 'DE', accountLanguage: 'de-DE', recoveryEmail: ' A.B@Example.com ', recoveryPhone: '+49 151 234 5678', twofaEnabled: true, exclusiveLoginConfirmed: true, studioLanguageSet: true };

async function fullSetup(n = 1) {
  const b = await addBinding(h, n);
  h.fake.upsertProfile({ id: `p${n}`, name: `Kênh ${n}`, personaId: `persona-${n}`, os: 'windows', timezone: 'Europe/Berlin', languages: ['de-DE'], geolocation: { mode: 'off' }, seed: `seed-${n}` });
  // probe fixture có WebRTC candidate 5.6.7.8 → binding 1 dùng đúng IP đó để A6 pass
  h.fake.setExit(`p${n}`, { ip: n === 1 ? '5.6.7.8' : `5.6.7.${n}`, country: 'DE', city: 'Frankfurt', timezone: 'Europe/Berlin', asn: 3320 + n, asnOrg: 'DTAG', asnType: 'isp' });
  await h.bundle.health.runProxyCheckNow(b.id);
  await h.bundle.health.upsertChecklist(b.id, { ...FULL_CHECKLIST, recoveryEmail: `k${n}@example.com`, recoveryPhone: `+4915123456${String(n).padStart(2, '0')}` });
  await h.bundle.health.confirmChecklist(b.id, 'user');
  await h.bundle.health.importProbe(b.id, { filePath: probeFile('base') }, 'manual_import');
  return b;
}

describe('nhập probe + kiểm tra nhất quán (spec 004 US1)', () => {
  it('importProbe: lưu file gốc, probe_results, sự kiện, audit, kiểm với trigger probe_imported; thiếu trường → INPUT_INVALID', async () => {
    const b = await addBinding(h, 1);
    const pr = await h.bundle.health.importProbe(b.id, { filePath: probeFile('base') }, 'manual_import');
    expect(pr).toMatchObject({ bindingId: b.id, furyVersion: '0.2.23', source: 'manual_import' });
    expect(existsSync(pr.rawPath)).toBe(true);
    expect(JSON.parse(readFileSync(pr.rawPath, 'utf8'))).toMatchObject({ furyVersion: '0.2.23' });
    expect(h.bundle.health.listProbes(b.id)).toHaveLength(1);
    expect(h.bundle.health.listEvents(b.id, { types: ['probe.imported'] })).toHaveLength(1);
    expect(h.audit.list({ action: 'probe.import' })).toHaveLength(1);
    const latest = h.bundle.health.getConsistency(b.id);
    expect(latest?.trigger).toBe('probe_imported');
    expect(latest?.results).toHaveLength(22);
    let caught: unknown;
    try {
      await h.bundle.health.importProbe(b.id, { filePath: probeFile('missing-fields') }, 'manual_import');
    } catch (err) {
      caught = err;
    }
    expect((caught as PvError).code).toBe('INPUT_INVALID');
    expect((caught as PvError).detail?.missing).toEqual(['navigator.languages', 'timezone']);
    expect(h.bundle.health.listProbes(b.id)).toHaveLength(1);
    await expect(h.bundle.health.importProbe(b.id, { filePath: 'E:/khong/co.json' }, 'manual_import')).rejects.toMatchObject({ code: 'FILE_NOT_FOUND' });
  });

  it('bộ đầy đủ → mọi luật block pass trừ các luật thiếu dữ liệu; điểm; consistency_clear đạt', async () => {
    const b = await fullSetup(1);
    const c = h.bundle.health.getConsistency(b.id)!;
    const byId = Object.fromEntries(c.results.map((r) => [r.ruleId, r]));
    expect(byId['A1.exit_country_matches_market']?.status).toBe('pass');
    expect(byId['A2.timezone_matches_exit']?.status).toBe('pass');
    expect(byId['A5.asn_residential']?.status).toBe('pass');
    expect(byId['A6.no_leaks']?.status).toBe('pass');
    expect(byId['B1.os_matches_host']?.status).toBe('pass');
    expect(byId['C1.account_geo_aligned']?.status).toBe('pass');
    expect(byId['C3.checklist_complete']?.status).toBe('pass');
    expect(byId['D1.unique_exit_ip']?.status).toBe('pass');
    expect(byId['E4.persona_unchanged']?.status).toBe('pass');
    expect(byId['E2.noise_hash_stable']?.status).toBe('unknown'); // mới một probe
    expect(byId['C2.studio_language_info']?.status).toBe('info');
    expect(c.score.blockFailing).toBe(0);
    expect(c.score.total).toBe(21); // 22 − info
    // E2/E3 unknown chặn consistency_clear → nhập probe lần hai cùng phiên bản
    expect(h.bundle.engine.isClear(b.id, 24).clear).toBe(false);
    h.clock.advance(60_000);
    await h.bundle.health.importProbe(b.id, { filePath: probeFile('base') }, 'manual_import');
    const c2 = h.bundle.health.getConsistency(b.id)!;
    const e2 = c2.results.find((r) => r.ruleId === 'E2.noise_hash_stable');
    expect(e2?.status).toBe('pass');
    expect(c2.results.find((r) => r.ruleId === 'E3.only_version_changed')?.status).toBe('skipped');
    expect(h.bundle.engine.isClear(b.id, 24)).toMatchObject({ clear: true });
    expect(h.bundle.health.listPauses(b.id, { open: true })).toHaveLength(0);
    const cmp = h.bundle.health.compareLatestProbes(b.id);
    expect(cmp?.changes).toEqual([]);
  });

  it('§10: múi giờ lệch exit → A2 fail với gợi ý, R4 pause consistency_block, promote bị từ chối; sửa → tự gỡ', async () => {
    const b = await fullSetup(1);
    await h.bundle.health.recordDetectSuite({ furyVersion: '0.2.23', passed: true }, 'user');
    h.clock.advance(60_000);
    await h.bundle.health.importProbe(b.id, { filePath: probeFile('timezone-off') }, 'manual_import');
    const c = h.bundle.health.getConsistency(b.id)!;
    const a2 = c.results.find((r) => r.ruleId === 'A2.timezone_matches_exit')!;
    expect(a2.status).toBe('fail');
    expect(a2.hint).toContain('Europe/Berlin');
    expect(c.score.blockFailing).toBeGreaterThanOrEqual(1);
    expect(h.bundle.health.listPauses(b.id, { open: true }).map((p) => p.reason)).toEqual(['consistency_block']);
    h.bundle.health.setThresholds({ L0_to_L1: [{ kind: 'consistency_clear', maxAgeHours: 24 }, { kind: 'checklist_valid' }], L1_to_L2: [], L2_to_L3: [] }, 'user');
    const r = await h.bundle.health.evaluateReadiness(b.id, { fresh: true });
    expect(r.canPromote).toBe(false);
    expect(r.conditions.find((x) => x.condition.kind === 'consistency_clear')?.met).toBe(false);
    expect(r.conditions.find((x) => x.condition.kind === 'checklist_valid')?.met).toBe(true);
    await expect(h.bundle.health.promote(b.id, 'user')).rejects.toMatchObject({ code: 'BINDING_PAUSED' });
    // sửa: probe đúng múi giờ (cùng phiên bản → E2 so với timezone-off: hash giống nhau)
    h.clock.advance(60_000);
    await h.bundle.health.importProbe(b.id, { filePath: probeFile('base') }, 'manual_import');
    expect(h.bundle.health.listPauses(b.id, { open: true })).toHaveLength(0);
    expect((await h.bundle.health.evaluateReadiness(b.id, { fresh: true })).canPromote).toBe(true);
    const change = await h.bundle.health.promote(b.id, 'user');
    expect(change.toLevel).toBe(1);
    expect(h.bundle.repos.runs.listRuns().some((r) => r.trigger === 'before_promote')).toBe(true);
  });

  it('E3: nâng Fury chỉ đổi phiên bản → pass; đổi GPU → fail', async () => {
    const b = await fullSetup(1);
    h.clock.advance(60_000);
    await h.bundle.health.importProbe(b.id, { filePath: probeFile('upgraded-ok') }, 'manual_import');
    const c = h.bundle.health.getConsistency(b.id)!;
    expect(c.results.find((r) => r.ruleId === 'E3.only_version_changed')?.status).toBe('pass');
    expect(c.results.find((r) => r.ruleId === 'E2.noise_hash_stable')?.status).toBe('skipped');
    expect(h.bundle.health.listPauses(b.id, { open: true })).toHaveLength(0);

    const b2 = await fullSetup(2); // probe base (0.2.23) → upgraded-gpu-changed (0.2.24)
    h.clock.advance(60_000);
    await h.bundle.health.importProbe(b2.id, { filePath: probeFile('upgraded-gpu-changed') }, 'manual_import');
    const c2 = h.bundle.health.getConsistency(b2.id)!;
    const e3 = c2.results.find((r) => r.ruleId === 'E3.only_version_changed')!;
    expect(e3.status).toBe('fail');
    expect(e3.hint).toContain('webgl.renderer');
    expect(h.bundle.health.listPauses(b2.id, { open: true }).map((p) => p.reason)).toContain('consistency_block');
    const cmp = h.bundle.health.compareLatestProbes(b2.id)!;
    expect(cmp.changes.map((x) => x.path)).toContain('webgl.renderer');
  });

  it('luật tắt → skipped; severity hạ xuống warn không chặn; lịch sử + audit', async () => {
    const b = await fullSetup(1);
    const rule = h.bundle.health.setRule('A2.timezone_matches_exit', { severity: 'warn' }, 'user');
    expect(rule.severity).toBe('warn');
    expect(h.settings.history('consistency_rule:A2.timezone_matches_exit')).toHaveLength(1);
    expect(h.audit.list({ action: 'consistency.rule.update' })).toHaveLength(1);
    h.clock.advance(60_000);
    await h.bundle.health.importProbe(b.id, { filePath: probeFile('timezone-off') }, 'manual_import');
    let c = h.bundle.health.getConsistency(b.id)!;
    expect(c.results.find((r) => r.ruleId === 'A2.timezone_matches_exit')).toMatchObject({ status: 'fail', severity: 'warn' });
    expect(h.bundle.health.listPauses(b.id, { open: true })).toHaveLength(0);
    h.bundle.health.setRule('A2.timezone_matches_exit', { enabled: false }, 'user');
    await h.bundle.health.runConsistency({ bindingId: b.id }, 'manual');
    c = h.bundle.health.getConsistency(b.id)!;
    expect(c.results.find((r) => r.ruleId === 'A2.timezone_matches_exit')?.status).toBe('skipped');
    expect(h.bundle.health.getRules()).toHaveLength(22);
    expect(h.audit.list({ action: 'consistency.run' })).toHaveLength(1);
    expect(() => h.bundle.health.setRule('Z9.nope', { enabled: false }, 'user')).toThrow(/Không có luật/);
  });

  it('D5 + ma trận chéo: hai kênh cùng email khôi phục → fail cả hai; cùng exit IP → cell đỏ', async () => {
    const a = await fullSetup(1);
    const b = await fullSetup(2);
    await h.bundle.health.upsertChecklist(b.id, { recoveryEmail: 'k1@example.com' });
    const cb = h.bundle.health.getConsistency(b.id)!;
    const d5 = cb.results.find((r) => r.ruleId === 'D5.unique_recovery')!;
    expect(d5.status).toBe('fail');
    expect(d5.hint).toContain('Kênh 1');
    h.fake.setExit('p2', { ip: '5.6.7.8', country: 'DE', city: 'Frankfurt', timezone: 'Europe/Berlin', asn: 3321, asnType: 'isp' });
    await h.bundle.health.runProxyCheckNow(b.id);
    const m = await h.bundle.health.getCrossMatrix();
    expect(m.bindingIds).toEqual([a.id, b.id]);
    expect(m.cells).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'exit_ip', level: 'red' }), expect.objectContaining({ kind: 'recovery', level: 'red' })]));
  });

  it('hiệu năng: 10 binding ≤ 30 s (thực tế ≪)', async () => {
    for (let i = 1; i <= 10; i++) await fullSetup(i);
    const t0 = Date.now();
    const s = await h.bundle.health.runConsistency({}, 'periodic');
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(s.bindings).toHaveLength(10);
    expect(s.bindings.every((x) => x.results.length === 22)).toBe(true);
  });

  it('Fury offline → luật cần furyProfile unknown, lần kiểm vẫn ghi', async () => {
    const b = await fullSetup(1);
    await h.fake.stop();
    const s = await h.bundle.health.runConsistency({ bindingId: b.id }, 'manual');
    const e4 = s.bindings[0]!.results.find((r) => r.ruleId === 'E4.persona_unchanged')!;
    expect(e4.status).toBe('unknown');
    expect(e4.hint).toContain('FURY_OFFLINE');
  });
});

describe('checklist (spec 004 US2)', () => {
  it('HMAC email/số chuẩn hóa; không lộ giá trị gốc; xác nhận 90 ngày; thiếu → từ chối; hết hạn', async () => {
    const b = await addBinding(h, 1, { withChecklist: false });
    const s = await h.bundle.health.upsertChecklist(b.id, FULL_CHECKLIST);
    expect(s).toMatchObject({ hasRecoveryEmail: true, hasRecoveryPhone: true, complete: true, expired: true, missing: [] });
    expect(JSON.stringify(s)).not.toMatch(/example\.com|1512345678/);
    const row = h.bundle.repos.checklists.get(b.id)!;
    const key = (await h.secrets.get('hmac.key'))!;
    const { hmacHex } = await import('../src/index.js');
    expect(row.recoveryEmailHmac).toBe(hmacHex(key, 'a.b@example.com'));
    expect(row.recoveryPhoneHmac).toBe(hmacHex(key, '+491512345678'));
    const dump = h.t.database.sqlite.prepare('SELECT * FROM account_checklists').all();
    expect(JSON.stringify(dump)).not.toMatch(/example\.com|1512345678/);
    expect(JSON.stringify(h.audit.list())).not.toMatch(/example\.com|1512345678/);

    const confirmed = await h.bundle.health.confirmChecklist(b.id, 'user');
    expect(confirmed.confirmedAt).toBe(h.clock.nowIso());
    expect(Date.parse(confirmed.expiresAt!) - h.clock.nowMs()).toBe(90 * 86_400_000);
    expect(h.bundle.checklist.isValid(b.id)).toBe(true);
    expect(h.bundle.health.listChecklistExpiring(7)).toHaveLength(0);
    h.clock.advanceDays(85);
    expect(h.bundle.health.listChecklistExpiring(7).map((x) => x.bindingId)).toEqual([b.id]);
    h.clock.advanceDays(6);
    expect(h.bundle.checklist.isValid(b.id)).toBe(false);
    expect(h.bundle.health.getChecklist(b.id).expired).toBe(true);

    const c = await addBinding(h, 2, { withChecklist: false });
    await h.bundle.health.upsertChecklist(c.id, { ...FULL_CHECKLIST, twofaEnabled: undefined });
    await expect(h.bundle.health.confirmChecklist(c.id, 'user')).rejects.toMatchObject({ code: 'INPUT_INVALID', detail: { missing: ['twofaEnabled'] } });
    await expect(h.bundle.health.upsertChecklist(c.id, { recoveryPhone: '0151 234' })).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(h.bundle.health.upsertChecklist(c.id, { recoveryEmail: 'not-an-email' })).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  });
});

describe('host + ASN + lịch (spec 004 US3/US4)', () => {
  it('attestAsn → A5 pass; host snapshot; lịch định kỳ, checklist 08:00, host 24h', async () => {
    const b = await addBinding(h, 1);
    h.fake.setExit('p1', { ip: '5.6.7.8', country: 'DE', city: 'Frankfurt', timezone: 'Europe/Berlin', asn: 64512, asnType: 'unknown' });
    await h.bundle.health.runProxyCheckNow(b.id);
    expect(h.bundle.health.getConsistency(b.id)!.results.find((r) => r.ruleId === 'A5.asn_residential')?.status).toBe('unknown');
    await h.bundle.health.attestAsn({ asn: 64512, asnType: 'isp', note: 'ISP địa phương' }, 'user');
    expect(h.bundle.health.listAsnAttestations()).toHaveLength(1);
    const c = h.bundle.health.getConsistency(b.id)!;
    expect(c.trigger).toBe('asn_attested');
    expect(c.results.find((r) => r.ruleId === 'A5.asn_residential')?.status).toBe('pass');
    expect(h.audit.list({ action: 'asn.attest' })).toHaveLength(1);

    expect(h.bundle.health.latestHost()).toMatchObject({ os: 'windows', gpus: [{ name: 'NVIDIA GeForce RTX 5060 Ti' }] });

    // lịch
    const sched = h.bundle.consistencySchedule;
    await sched.tick();
    const next = sched.nextPeriodicAt()!;
    expect(Date.parse(next) - h.clock.nowMs()).toBeGreaterThan(6 * 86_400_000);
    const runsBefore = h.bundle.repos.runs.listRuns().length;
    h.clock.set(next);
    h.clock.advance(60_000);
    await sched.tick();
    const runs = h.bundle.repos.runs.listRuns();
    expect(runs.length).toBe(runsBefore + 1);
    expect(runs[0]?.trigger).toBe('periodic');
    expect(Date.parse(sched.nextPeriodicAt()!)).toBeGreaterThan(h.clock.nowMs());
    // host 24h: lần tick đầu đã chụp, sau 24h chụp lại
    const hostsBefore = h.t.database.sqlite.prepare('SELECT COUNT(*) AS n FROM host_snapshots').get() as { n: number };
    h.clock.advance(25 * 3_600_000);
    await sched.tick();
    const hostsAfter = h.t.database.sqlite.prepare('SELECT COUNT(*) AS n FROM host_snapshots').get() as { n: number };
    expect(hostsAfter.n).toBe(hostsBefore.n + 1);
    h.bundle.health.start();
    expect(h.timers.intervals.filter((i) => i.active).map((i) => i.ms)).toEqual([60_000, 60_000]);
    h.bundle.health.stop();
  });

  it('trigger §6.6: tạo/sửa binding, kiểm proxy, đổi phiên bản Fury', async () => {
    const b = await addBinding(h, 1);
    const triggers = () => h.bundle.repos.runs.listRuns().map((r) => r.trigger);
    expect(triggers()).toContain('binding_created');
    await h.bundle.health.updateBinding(b.id, { displayName: 'Mới' });
    expect(triggers()).toContain('binding_updated');
    h.fake.setExit('p1', { ip: '1.1.1.1', country: 'DE', asn: 1 });
    await h.bundle.health.runProxyCheckNow(b.id);
    expect(triggers()).toContain('proxy_checked');
    await h.bundle.health.recordFuryVersionChanged('0.2.23', '0.2.24');
    expect(triggers()).toContain('fury_version_changed');
  });
});
