import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PvError } from '@sctech/profilevault-contract';
import { addBinding, makeHarness, type Harness } from './helpers.js';

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(() => h.cleanup());

describe('LevelPolicy R1–R7 (SPEC-02 §4)', () => {
  it('R1: sự kiện đỏ → L0 + pause red_event trong cùng giao dịch; bus phát sau commit', async () => {
    const b = await addBinding(h, 1, { level: 1 });
    h.busLog.length = 0;
    const ev = await h.bundle.health.recordManualEvent(b.id, 'manual.captcha');
    expect(ev.severity).toBe('red');
    const after = h.bundle.health.getBinding(b.id)!;
    expect(after.level).toBe(0);
    expect(after.levelSince).toBe(h.clock.nowIso());
    const pauses = h.bundle.health.listPauses(b.id, { open: true });
    expect(pauses.map((p) => p.reason)).toEqual(['red_event']);
    const changes = h.bundle.health.listLevelChanges(b.id);
    expect(changes[0]).toMatchObject({ fromLevel: 1, toLevel: 0, kind: 'demote', reason: 'red_event', actor: 'system' });
    expect(h.busLog.map((e) => e.name)).toEqual(
      expect.arrayContaining(['health.event_recorded', 'binding.level_changed', 'binding.pause_changed']),
    );
    const types = h.bundle.health.listEvents(b.id).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['manual.captcha', 'level.demoted', 'binding.paused']));
    expect(h.audit.list({ action: 'binding.level.demote' })).toHaveLength(1);
    // sự kiện đỏ thứ hai: không mở pause thứ hai cùng lý do
    await h.bundle.health.recordManualEvent(b.id, 'manual.logged_out');
    expect(h.bundle.health.listPauses(b.id, { open: true })).toHaveLength(1);
  });

  it('R1 trên binding đã archive: ghi sự kiện, không đổi mức/pause', async () => {
    const b = await addBinding(h, 1, { level: 2 });
    await h.bundle.health.archiveBinding(b.id);
    await h.bundle.health.recordSessionCheck(b.id, { state: 'logged_out' });
    expect(h.bundle.health.getBinding(b.id)!.level).toBe(2);
    expect(h.bundle.health.listPauses(b.id, { open: true })).toHaveLength(0);
  });

  it('R2: đổi quốc gia → hạ một mức (L2→L1), L0 giữ L0; IP đổi cùng quốc gia+ASN không sự kiện', async () => {
    const b = await addBinding(h, 1, { level: 2 });
    h.fake.setExit('p1', { ip: '1.1.1.1', country: 'DE', asn: 100, asnType: 'isp' });
    await h.bundle.health.runProxyCheckNow(b.id);
    h.fake.setExit('p1', { ip: '1.1.1.2', country: 'DE', asn: 100, asnType: 'isp' });
    await h.bundle.health.runProxyCheckNow(b.id);
    expect(h.bundle.health.listEvents(b.id, { types: ['proxy.country_changed', 'proxy.asn_changed'] })).toHaveLength(0);
    h.fake.setExit('p1', { ip: '2.2.2.2', country: 'FR', asn: 100, asnType: 'isp' });
    await h.bundle.health.runProxyCheckNow(b.id);
    expect(h.bundle.health.getBinding(b.id)!.level).toBe(1);
    expect(h.bundle.health.listPauses(b.id, { open: true }).map((p) => p.reason)).toEqual(['proxy_changed']);
    expect(h.bundle.health.listEvents(b.id, { types: ['proxy.country_changed'] })[0]?.payload).toMatchObject({ from: 'DE', to: 'FR' });

    const c = await addBinding(h, 2);
    h.fake.setExit('p2', { ip: '3.3.3.3', country: 'DE', asn: 100 });
    await h.bundle.health.runProxyCheckNow(c.id);
    h.fake.setExit('p2', { ip: '3.3.3.3', country: 'DE', asn: 200 });
    await h.bundle.health.runProxyCheckNow(c.id);
    expect(h.bundle.health.getBinding(c.id)!.level).toBe(0);
    expect(h.bundle.health.listPauses(c.id, { open: true }).map((p) => p.reason)).toEqual(['proxy_changed']);
    expect(h.bundle.health.listEvents(c.id, { types: ['proxy.asn_changed'] })).toHaveLength(1);
  });

  it('R3: trùng exit IP → cả hai L0 + duplicate_exit_ip; hết trùng → tự gỡ', async () => {
    const a = await addBinding(h, 1, { level: 1 });
    const b = await addBinding(h, 2, { level: 2 });
    h.fake.setExit('p1', { ip: '9.9.9.9', country: 'DE', asn: 1 });
    h.fake.setExit('p2', { ip: '8.8.8.8', country: 'DE', asn: 1 });
    await h.bundle.health.runProxyCheckNow(a.id);
    await h.bundle.health.runProxyCheckNow(b.id);
    h.fake.setExit('p2', { ip: '9.9.9.9', country: 'DE', asn: 1 });
    await h.bundle.health.runProxyCheckNow(b.id);
    expect(h.bundle.health.getBinding(a.id)!.level).toBe(0);
    expect(h.bundle.health.getBinding(b.id)!.level).toBe(0);
    expect(h.bundle.health.listPauses(a.id, { open: true }).map((p) => p.reason)).toEqual(['duplicate_exit_ip']);
    expect(h.bundle.health.listPauses(b.id, { open: true }).map((p) => p.reason)).toEqual(['duplicate_exit_ip']);
    h.fake.setExit('p2', { ip: '7.7.7.7', country: 'DE', asn: 1 });
    await h.bundle.health.runProxyCheckNow(b.id);
    expect(h.bundle.health.listPauses(a.id, { open: true })).toHaveLength(0);
    expect(h.bundle.health.listPauses(b.id, { open: true })).toHaveLength(0);
    expect(h.bundle.health.listPauses(a.id)[0]).toMatchObject({ reason: 'duplicate_exit_ip', clearedBy: 'system' });
    expect(h.bundle.health.listEvents(a.id, { types: ['binding.resumed'] })).toHaveLength(1);
    expect(h.bundle.health.getBinding(a.id)!.level).toBe(0);
  });

  it('R4: luật block trượt → consistency_block giữ mức; hết trượt → tự gỡ; người không gỡ được', async () => {
    const b = await addBinding(h, 1, { level: 2 });
    h.bundle.policy.transact(() => h.bundle.policy.applyConsistencyBlock(h.bundle.health.getBinding(b.id)!, ['A2.timezone_matches_exit']));
    expect(h.bundle.health.getBinding(b.id)!.level).toBe(2);
    const p = h.bundle.health.listPauses(b.id, { open: true })[0]!;
    expect(p).toMatchObject({ reason: 'consistency_block', detail: { ruleIds: ['A2.timezone_matches_exit'] } });
    await expect(h.bundle.health.clearPause(p.id, 'user')).rejects.toMatchObject({ code: 'FORBIDDEN_ACTION' });
    h.bundle.policy.transact(() => h.bundle.policy.applyConsistencyBlock(h.bundle.health.getBinding(b.id)!, []));
    expect(h.bundle.health.listPauses(b.id, { open: true })).toHaveLength(0);
  });

  it('R5: detect-suite trượt cho phiên bản hiện tại → detect_suite_failed mọi binding; đạt → gỡ; theo binding riêng', async () => {
    const a = await addBinding(h, 1, { level: 1 });
    const b = await addBinding(h, 2);
    await h.bundle.health.recordDetectSuite({ furyVersion: '0.2.23', passed: false, summary: 'canvas lệch' }, 'user');
    expect(h.bundle.health.listPauses(a.id, { open: true }).map((p) => p.reason)).toEqual(['detect_suite_failed']);
    expect(h.bundle.health.listPauses(b.id, { open: true }).map((p) => p.reason)).toEqual(['detect_suite_failed']);
    expect(h.bundle.health.getBinding(a.id)!.level).toBe(1);
    expect(h.bundle.health.listEvents(null, { types: ['detect_suite.recorded'] })[0]?.severity).toBe('red');
    await h.bundle.health.recordDetectSuite({ furyVersion: '0.2.23', passed: true }, 'user');
    expect(h.bundle.health.listPauses(a.id, { open: true })).toHaveLength(0);
    expect(h.bundle.health.listPauses(b.id, { open: true })).toHaveLength(0);
    await h.bundle.health.recordDetectSuite({ furyVersion: '0.2.23', bindingId: b.id, passed: false }, 'user');
    expect(h.bundle.health.listPauses(a.id, { open: true })).toHaveLength(0);
    expect(h.bundle.health.listPauses(b.id, { open: true })).toHaveLength(1);
    // phiên bản khác hiện tại: chỉ ghi, không pause
    await h.bundle.health.recordDetectSuite({ furyVersion: '0.3.0', passed: false }, 'user');
    expect(h.bundle.health.listPauses(a.id, { open: true })).toHaveLength(0);
  });

  it('R5: Fury đổi phiên bản chưa có detect-suite → pause; đã có passed trước → không pause', async () => {
    const a = await addBinding(h, 1);
    const b = await addBinding(h, 2);
    await h.bundle.health.recordDetectSuite({ furyVersion: '0.2.24', bindingId: b.id, passed: true }, 'user');
    await h.bundle.health.recordFuryVersionChanged('0.2.23', '0.2.24');
    expect(h.bundle.health.currentFuryVersion()).toBe('0.2.24');
    expect(h.bundle.health.listPauses(a.id, { open: true }).map((p) => p.reason)).toEqual(['detect_suite_failed']);
    expect(h.bundle.health.listPauses(b.id, { open: true })).toHaveLength(0);
    const sys = h.bundle.health.listEvents(null, { types: ['fury.version_changed'] });
    expect(sys[0]?.payload).toEqual({ from: '0.2.23', to: '0.2.24' });
    await h.bundle.health.recordDetectSuite({ furyVersion: '0.2.24', passed: true }, 'user');
    expect(h.bundle.health.listPauses(a.id, { open: true })).toHaveLength(0);
  });

  it('R6: SITE_CHANGED 2 lần liên tiếp cùng flow ở L3 → L2; run.done xen giữa → không hạ', async () => {
    const b = await addBinding(h, 1, { level: 3 });
    const run = (n: number, errorCode?: 'SITE_CHANGED', status: 'done' | 'failed' = 'failed') =>
      h.bundle.health.recordRunOutcome({ bindingId: b.id, runId: `rn_${'0'.repeat(25)}${n}`, flowId: 'youtube/upload', mode: 'L3', status, ...(errorCode ? { errorCode } : {}) });
    await run(1, 'SITE_CHANGED');
    h.clock.advance(1000);
    await run(2, undefined, 'done');
    h.clock.advance(1000);
    await run(3, 'SITE_CHANGED');
    expect(h.bundle.health.getBinding(b.id)!.level).toBe(3);
    h.clock.advance(1000);
    await run(4, 'SITE_CHANGED');
    expect(h.bundle.health.getBinding(b.id)!.level).toBe(2);
    expect(h.bundle.health.listPauses(b.id, { open: true })).toHaveLength(0);
    expect(h.bundle.health.listLevelChanges(b.id)[0]).toMatchObject({ fromLevel: 3, toLevel: 2, reason: 'site_changed' });
    expect(h.bundle.health.listEvents(b.id, { types: ['flow.site_changed'] })).toHaveLength(3);
  });

  it('R7: tạm dừng tay và gỡ; gỡ red_event/proxy_changed cũng được', async () => {
    const b = await addBinding(h, 1, { level: 1 });
    const p = await h.bundle.health.pause(b.id, 'user', 'bảo trì');
    expect(p).toMatchObject({ reason: 'manual', detail: { note: 'bảo trì' } });
    expect(h.bundle.health.getBinding(b.id)!.level).toBe(1);
    await h.bundle.health.clearPause(p.id, 'user');
    expect(h.bundle.health.listPauses(b.id, { open: true })).toHaveLength(0);
    await h.bundle.health.recordManualEvent(b.id, 'manual.verification_request');
    const red = h.bundle.health.listPauses(b.id, { open: true })[0]!;
    await h.bundle.health.clearPause(red.id, 'user');
    expect(h.bundle.health.listPauses(b.id, { open: true })).toHaveLength(0);
    await expect(h.bundle.health.clearPause('bp_nope', 'user')).rejects.toBeInstanceOf(PvError);
  });
});
