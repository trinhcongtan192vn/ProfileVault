import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, PvError } from '@sctech/profilevault-contract';
import { addBinding, makeHarness, type Harness } from './helpers.js';

let h: Harness;
beforeEach(async () => {
  h = await makeHarness();
});
afterEach(() => h.cleanup());

function allowSixRules() {
  h.bundle.health.registerConditionEvaluator('consistency_clear', ({ condition }) => ({ condition, met: true, current: 'đạt', required: 'đạt' }));
  h.bundle.health.registerConditionEvaluator('checklist_valid', ({ condition }) => ({ condition, met: true, current: 'đạt', required: 'đạt' }));
}

describe('ngưỡng và lên mức (SPEC-02 §3)', () => {
  it('ngưỡng mặc định được seed; setThresholds ghi lịch sử', () => {
    expect(h.bundle.health.getThresholds()).toEqual(DEFAULT_THRESHOLDS);
    const t = { ...DEFAULT_THRESHOLDS, L0_to_L1: [{ kind: 'days_at_level' as const, min: 7 }] };
    h.bundle.health.setThresholds(t, 'user');
    expect(h.bundle.health.getThresholds().L0_to_L1).toEqual([{ kind: 'days_at_level', min: 7 }]);
    expect(h.settings.history('thresholds')).toHaveLength(2);
    expect(h.audit.list({ action: 'settings.thresholds' })).toHaveLength(1);
    expect(() => h.bundle.health.setThresholds({ L0_to_L1: [{ kind: 'nope' }] } as never, 'user')).toThrow(/Ngưỡng sai/);
  });

  it('tiến độ L0→L1: thiếu ngày/upload; đủ → canPromote; lên mức đặt lại level_since', async () => {
    const b = await addBinding(h, 1);
    await h.bundle.health.recordDetectSuite({ furyVersion: '0.2.23', passed: true }, 'user');
    h.fake.setExit('p1', { ip: '1.1.1.1', country: 'DE', asn: 1 });
    await h.bundle.health.runProxyCheckNow(b.id);
    for (let i = 0; i < 3; i++) {
      h.clock.advance(60_000);
      await h.bundle.health.recordManualEvent(b.id, 'manual.upload');
    }
    h.clock.advanceDays(10);
    let r = await h.bundle.health.evaluateReadiness(b.id);
    expect(r.nextLevel).toBe(1);
    const byKind = Object.fromEntries(r.conditions.map((c) => [c.condition.kind, c]));
    expect(byKind.days_at_level).toMatchObject({ met: false, current: 10, required: 14 });
    expect(byKind.event_count).toMatchObject({ met: false, current: 3, required: 5 });
    expect(byKind.no_red_events?.met).toBe(true);
    expect(byKind.proxy_stable?.met).toBe(true);
    expect(byKind.detect_suite_pass?.met).toBe(true);
    expect(byKind.consistency_clear).toMatchObject({ met: false, current: 'chưa có dữ liệu' });
    expect(r.progress).toBeCloseTo(3 / 7);
    expect(r.canPromote).toBe(false);
    let caught: unknown;
    try {
      await h.bundle.health.promote(b.id, 'user');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PvError);
    expect((caught as PvError).code).toBe('INPUT_INVALID');
    expect((caught as PvError).detail?.missing).toContain('days_at_level');

    for (let i = 0; i < 2; i++) await h.bundle.health.recordManualEvent(b.id, 'manual.upload');
    h.clock.advanceDays(4);
    allowSixRules();
    const reached: string[] = [];
    h.bundle.health.onReadinessReached((id, to) => void reached.push(`${id}:${to}`));
    r = await h.bundle.health.evaluateReadiness(b.id);
    expect(r.progress).toBe(1);
    expect(r.canPromote).toBe(true);
    await h.bundle.health.evaluateReadiness(b.id, { fresh: true });
    expect(reached).toEqual([`${b.id}:1`]);

    const change = await h.bundle.health.promote(b.id, 'user');
    expect(change).toMatchObject({ fromLevel: 0, toLevel: 1, kind: 'promote', actor: 'user' });
    const after = h.bundle.health.getBinding(b.id)!;
    expect(after.level).toBe(1);
    expect(after.levelSince).toBe(h.clock.nowIso());
    expect(h.busLog.some((e) => e.name === 'binding.level_changed')).toBe(true);
    expect(h.bundle.health.listEvents(b.id, { types: ['level.promoted'] })).toHaveLength(1);
    // cửa sổ mới: 0 ngày, sự kiện cũ không tính
    r = await h.bundle.health.evaluateReadiness(b.id);
    expect(r.nextLevel).toBe(2);
    expect(r.conditions.find((c) => c.condition.kind === 'days_at_level')).toMatchObject({ current: 0 });
  });

  it('sự kiện đỏ trước level_since không tính; pause mở chặn promote', async () => {
    const b = await addBinding(h, 1);
    await h.bundle.health.recordManualEvent(b.id, 'manual.captcha');
    const red = h.bundle.health.listPauses(b.id, { open: true })[0]!;
    h.clock.advance(1000);
    // đặt lại cửa sổ bằng cách giả lập đổi mức (level_since mới)
    h.bundle.repos.bindings.setLevel(b.id, 0, h.clock.nowIso());
    h.bundle.readiness.invalidate(b.id);
    let r = await h.bundle.health.evaluateReadiness(b.id);
    expect(r.conditions.find((c) => c.condition.kind === 'no_red_events')?.met).toBe(true);
    expect(r.openPauses).toHaveLength(1);
    expect(r.canPromote).toBe(false);
    h.bundle.health.setThresholds({ L0_to_L1: [{ kind: 'no_red_events' }], L1_to_L2: [], L2_to_L3: [] }, 'user');
    await expect(h.bundle.health.promote(b.id, 'user')).rejects.toMatchObject({ code: 'BINDING_PAUSED' });
    await h.bundle.health.clearPause(red.id, 'user');
    r = await h.bundle.health.evaluateReadiness(b.id);
    expect(r.canPromote).toBe(true);
    await h.bundle.health.promote(b.id, 'user');
    expect(h.bundle.health.getBinding(b.id)!.level).toBe(1);
  });

  it('session_check_rate: thiếu mẫu, đạt/không đạt', async () => {
    const b = await addBinding(h, 1, { level: 1 });
    h.bundle.health.setThresholds({ L0_to_L1: [], L1_to_L2: [{ kind: 'session_check_rate', min: 0.95, minSamples: 10 }], L2_to_L3: [] }, 'user');
    for (let i = 0; i < 9; i++) {
      h.clock.advance(1000);
      await h.bundle.health.recordSessionCheck(b.id, { state: 'logged_in', channelId: 'UC1', studioLanguageOk: true });
    }
    let r = await h.bundle.health.evaluateReadiness(b.id, { fresh: true });
    expect(r.conditions[0]).toMatchObject({ met: false, current: '9/10 mẫu' });
    h.clock.advance(1000);
    await h.bundle.health.recordSessionCheck(b.id, { state: 'failed', error: 'timeout' });
    r = await h.bundle.health.evaluateReadiness(b.id, { fresh: true });
    expect(r.conditions[0]).toMatchObject({ met: false, current: 0.9 });
    for (let i = 0; i < 10; i++) {
      h.clock.advance(1000);
      await h.bundle.health.recordSessionCheck(b.id, { state: 'logged_in' });
    }
    r = await h.bundle.health.evaluateReadiness(b.id, { fresh: true });
    expect(r.conditions[0]).toMatchObject({ met: true, current: 0.95 });
  });

  it('điều kiện L2→L3 từ run outcome; no_open_site_changed', async () => {
    const b = await addBinding(h, 1, { level: 2 });
    h.bundle.health.setThresholds(
      {
        L0_to_L1: [],
        L1_to_L2: [],
        L2_to_L3: [
          { kind: 'event_count_by_mode', flowId: 'youtube/upload', mode: 'L2', min: 20 },
          { kind: 'l2_correct_rate', flowId: 'youtube/upload', min: 0.95, minSamples: 20 },
          { kind: 'flow_success_rate', flowId: 'youtube/upload', min: 0.9, minSamples: 5 },
          { kind: 'no_open_site_changed', flowId: 'youtube/upload' },
        ],
      },
      'user',
    );
    let n = 0;
    const run = (status: 'done' | 'failed', l2Review?: 'correct' | 'fixed', errorCode?: 'SITE_CHANGED') =>
      h.bundle.health.recordRunOutcome({ bindingId: b.id, runId: `rn_${String(++n).padStart(26, '0')}`, flowId: 'youtube/upload', mode: 'L2', status, ...(l2Review ? { l2Review } : {}), ...(errorCode ? { errorCode } : {}), occurredAt: new Date(h.clock.nowMs() + n * 1000).toISOString() });
    for (let i = 0; i < 19; i++) await run('done', 'correct');
    await run('done', 'fixed');
    let r = await h.bundle.health.evaluateReadiness(b.id, { fresh: true });
    const byKind = Object.fromEntries(r.conditions.map((c) => [c.condition.kind, c]));
    expect(byKind.event_count_by_mode).toMatchObject({ met: true, current: 20 });
    expect(byKind.l2_correct_rate).toMatchObject({ met: true, current: 0.95 });
    expect(byKind.flow_success_rate).toMatchObject({ met: true, current: 1 });
    expect(byKind.no_open_site_changed?.met).toBe(true);
    await run('failed', undefined, 'SITE_CHANGED');
    r = await h.bundle.health.evaluateReadiness(b.id, { fresh: true });
    expect(r.conditions.find((c) => c.condition.kind === 'no_open_site_changed')?.met).toBe(false);
    await run('done', 'correct');
    r = await h.bundle.health.evaluateReadiness(b.id, { fresh: true });
    expect(r.conditions.find((c) => c.condition.kind === 'no_open_site_changed')?.met).toBe(true);
  });

  it('cache 5 phút: không tính lại nếu không có sự kiện mới; sự kiện mới → tính lại', async () => {
    const b = await addBinding(h, 1);
    const r1 = await h.bundle.health.evaluateReadiness(b.id);
    h.clock.advance(60_000);
    const r2 = await h.bundle.health.evaluateReadiness(b.id);
    expect(r2.evaluatedAt).toBe(r1.evaluatedAt);
    await h.bundle.health.recordManualEvent(b.id, 'manual.upload');
    const r3 = await h.bundle.health.evaluateReadiness(b.id);
    expect(r3.evaluatedAt).not.toBe(r1.evaluatedAt);
    h.clock.advance(6 * 60_000);
    const r4 = await h.bundle.health.evaluateReadiness(b.id);
    expect(r4.evaluatedAt).not.toBe(r3.evaluatedAt);
  });

  it('L3: không có mức kế; promote từ chối', async () => {
    const b = await addBinding(h, 1, { level: 3 });
    const r = await h.bundle.health.evaluateReadiness(b.id);
    expect(r).toMatchObject({ nextLevel: null, progress: null, canPromote: false });
    await expect(h.bundle.health.promote(b.id, 'user')).rejects.toMatchObject({ code: 'INPUT_INVALID' });
  });
});
