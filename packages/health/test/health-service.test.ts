import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PvError } from '@sctech/profilevault-contract';
import { addBinding, makeHarness, type Harness } from './helpers.js';

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(() => h.cleanup());

describe('binding (spec 003 US1)', () => {
  it('tạo ở L0 với _personaAtBind, audit; trùng profile/tài khoản → INPUT_INVALID', async () => {
    const b = await addBinding(h, 1);
    expect(b.level).toBe(0);
    expect(b.packConfig._personaAtBind).toBe('persona-1');
    expect(h.audit.list({ action: 'binding.create' })).toHaveLength(1);
    await expect(h.bundle.health.createBinding({ platform: 'youtube', accountId: 'UC9', displayName: 'x', furyProfileId: 'p1', marketCountry: 'DE' })).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      detail: { field: 'furyProfileId' },
    });
    h.fake.upsertProfile({ id: 'p9', name: 'x' });
    await expect(h.bundle.health.createBinding({ platform: 'youtube', accountId: 'UC1', displayName: 'x', furyProfileId: 'p9', marketCountry: 'DE' })).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      detail: { field: 'accountId' },
    });
    await expect(h.bundle.health.createBinding({ platform: 'youtube', accountId: 'UC8', displayName: 'x', furyProfileId: 'missing', marketCountry: 'DE' })).rejects.toMatchObject({
      code: 'INPUT_INVALID',
      detail: { field: 'furyProfileId' },
    });
    await expect(h.bundle.health.createBinding({ platform: 'youtube', accountId: 'UC8', displayName: 'x', furyProfileId: 'p9', marketCountry: 'de' })).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  });

  it('Fury offline → vẫn tạo được; update giữ _personaAtBind; archive ẩn khỏi danh sách', async () => {
    await h.fake.stop();
    const b = await h.bundle.health.createBinding({ platform: 'youtube', accountId: 'UC1', displayName: 'A', furyProfileId: 'p1', marketCountry: 'DE' });
    expect(b.packConfig._personaAtBind).toBeUndefined();
    const u = await h.bundle.health.updateBinding(b.id, { displayName: 'B', packConfig: { studioLanguage: 'en' }, allowedRoots: ['E:\\v'] });
    expect(u).toMatchObject({ displayName: 'B', packConfig: { studioLanguage: 'en' }, allowedRoots: ['E:\\v'] });
    await h.bundle.health.archiveBinding(b.id);
    expect(h.bundle.health.listBindings()).toHaveLength(0);
    expect(h.bundle.health.listBindings({ includeArchived: true })).toHaveLength(1);
    await expect(h.bundle.health.updateBinding(b.id, { displayName: 'C' })).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  });
});

describe('sự kiện (spec 003 US2)', () => {
  it('khai báo tay: lùi ≤ 7 ngày, note vào payload, tương lai bị từ chối', async () => {
    const b = await addBinding(h, 1);
    const sixDays = new Date(h.clock.nowMs() - 6 * 86_400_000).toISOString();
    const ev = await h.bundle.health.recordManualEvent(b.id, 'manual.note', sixDays, 'ghi chú');
    expect(ev).toMatchObject({ type: 'manual.note', severity: 'info', source: 'manual', occurredAt: sixDays, payload: { note: 'ghi chú' } });
    const eightDays = new Date(h.clock.nowMs() - 8 * 86_400_000).toISOString();
    await expect(h.bundle.health.recordManualEvent(b.id, 'manual.upload', eightDays)).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    const future = new Date(h.clock.nowMs() + 3_600_000).toISOString();
    await expect(h.bundle.health.recordManualEvent(b.id, 'manual.upload', future)).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(h.bundle.health.recordManualEvent(b.id, 'run.done' as never)).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    await expect(h.bundle.health.recordManualEvent('ab_missing', 'manual.upload')).rejects.toMatchObject({ code: 'ACCOUNT_NOT_BOUND' });
  });

  it('session-check: ngôn ngữ Studio sai → ok mức warn; challenge → run.challenge đỏ → R1; failed không hạ', async () => {
    const b = await addBinding(h, 1, { level: 1 });
    await h.bundle.health.recordSessionCheck(b.id, { state: 'logged_in', studioLanguage: 'vi', studioLanguageOk: false });
    const ok = h.bundle.health.listEvents(b.id, { types: ['session_check.ok'] })[0]!;
    expect(ok.severity).toBe('warn');
    expect(ok.payload).toMatchObject({ studioLanguage: 'vi', studioLanguageOk: false });
    await h.bundle.health.recordSessionCheck(b.id, { state: 'failed', error: 'timeout' });
    expect(h.bundle.health.getBinding(b.id)!.level).toBe(1);
    await h.bundle.health.recordSessionCheck(b.id, { state: 'challenge' });
    expect(h.bundle.health.listEvents(b.id, { types: ['run.challenge'] })).toHaveLength(1);
    expect(h.bundle.health.getBinding(b.id)!.level).toBe(0);
    expect(h.bundle.health.listPauses(b.id, { open: true }).map((p) => p.reason)).toEqual(['red_event']);
  });

  it('run outcome: done/failed/needs_user; CHALLENGE → R1', async () => {
    const b = await addBinding(h, 1, { level: 2 });
    const runId = 'rn_' + '0'.repeat(26);
    await h.bundle.health.recordRunOutcome({ bindingId: b.id, runId, flowId: 'youtube/session-check', status: 'done' });
    await h.bundle.health.recordRunOutcome({ bindingId: b.id, runId, flowId: 'youtube/upload', mode: 'L2', status: 'needs_user', step: 'review_before_final' });
    await h.bundle.health.recordRunOutcome({ bindingId: b.id, runId, flowId: 'youtube/upload', mode: 'L2', status: 'failed', errorCode: 'CHALLENGE', step: 'open-studio' });
    const types = h.bundle.health.listEvents(b.id).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(['run.done', 'run.needs_user', 'run.failed', 'run.challenge', 'level.demoted', 'binding.paused']));
    expect(h.bundle.health.getBinding(b.id)!.level).toBe(0);
  });

  it('poller: profile mở/đóng → fury.profile_opened/closed; profile không binding → bỏ qua', async () => {
    const b = await addBinding(h, 1);
    await h.bundle.health.recordFuryProfileStatus('p1', true, h.clock.nowIso());
    await h.bundle.health.recordFuryProfileStatus('p1', false, h.clock.nowIso());
    await h.bundle.health.recordFuryProfileStatus('p-none', true, h.clock.nowIso());
    expect(h.bundle.health.listEvents(b.id, { order: 'asc' }).map((e) => e.type)).toEqual(['fury.profile_opened', 'fury.profile_closed']);
    expect(h.bundle.health.listEvents(undefined)).toHaveLength(2);
  });

  it('kiểm proxy: ghi đủ trường; lỗi → proxy.check_failed warn; binding lạ → ACCOUNT_NOT_BOUND', async () => {
    const b = await addBinding(h, 1, { level: 1 });
    h.fake.setExit('p1', { ip: '5.6.7.8', country: 'DE', city: 'Frankfurt', timezone: 'Europe/Berlin', asn: 3320, asnOrg: 'DTAG', asnType: 'isp', latencyMs: 120 });
    const c = await h.bundle.health.runProxyCheckNow(b.id);
    expect(c).toMatchObject({ ok: true, exitIp: '5.6.7.8', country: 'DE', city: 'Frankfurt', asn: 3320, asnOrg: 'DTAG', asnType: 'isp', latencyMs: 120 });
    expect(h.bundle.health.listProxyChecks(b.id)).toHaveLength(1);
    h.fake.setExit('p1', { error: 'proxy down' });
    const f = await h.bundle.health.runProxyCheckNow(b.id);
    expect(f).toMatchObject({ ok: false, error: 'proxy down' });
    const ev = h.bundle.health.listEvents(b.id, { types: ['proxy.check_failed'] })[0]!;
    expect(ev.severity).toBe('warn');
    expect(h.bundle.health.getBinding(b.id)!.level).toBe(1);
    await expect(h.bundle.health.runProxyCheckNow('ab_nope')).rejects.toBeInstanceOf(PvError);
    // Fury offline → FURY_OFFLINE ghi dạng check_failed
    await h.fake.stop();
    const off = await h.bundle.health.runProxyCheckNow(b.id);
    expect(off).toMatchObject({ ok: false, error: 'FURY_OFFLINE' });
  });

  it('nghiệm thu §10: CAPTCHA ở L1 → L0 + pause trong ≤ 1 giây', async () => {
    const b = await addBinding(h, 1, { level: 1 });
    const t0 = Date.now();
    await h.bundle.health.recordManualEvent(b.id, 'manual.captcha');
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(h.bundle.health.getBinding(b.id)!.level).toBe(0);
    expect(h.bundle.health.listPauses(b.id, { open: true }).map((p) => p.reason)).toEqual(['red_event']);
  });
});
