import { describe, expect, it } from 'vitest';
import { FakeClock } from '@sctech/profilevault-contract';
import { silentLogger } from '@sctech/profilevault-core';
import { FakeTimers } from '@sctech/profilevault-fury-client';
import { fromLocal, HealthScheduler, localDateKey, localParts, PROXY_CHECK_WINDOWS } from '../src/index.js';

const TZ = 'Asia/Bangkok';

describe('local-time', () => {
  it('localParts/fromLocal khớp nhau ở Asia/Bangkok (UTC+7) và Europe/Berlin (DST)', () => {
    const d = fromLocal(TZ, 2026, 10, 14, 9, 30);
    expect(d.toISOString()).toBe('2026-10-14T02:30:00.000Z');
    expect(localParts(d, TZ)).toMatchObject({ year: 2026, month: 10, day: 14, hour: 9, minute: 30 });
    expect(localDateKey(new Date('2026-10-13T20:00:00.000Z'), TZ)).toBe('2026-10-14');
    const summer = fromLocal('Europe/Berlin', 2026, 7, 1, 12, 0);
    expect(summer.toISOString()).toBe('2026-07-01T10:00:00.000Z');
    const winter = fromLocal('Europe/Berlin', 2026, 1, 1, 12, 0);
    expect(winter.toISOString()).toBe('2026-01-01T11:00:00.000Z');
  });
});

function make(opts: { reachable?: () => boolean; start?: string } = {}) {
  const clock = new FakeClock(opts.start ?? '2026-10-13T20:00:00.000Z'); // 03:00 địa phương ngày 14
  const timers = new FakeTimers();
  const checks: string[] = [];
  const missed: [string, number][] = [];
  const scheduler = new HealthScheduler({
    clock,
    timers,
    timezone: TZ,
    listBindingIds: () => ['ab_1', 'ab_2', 'ab_3'],
    runCheck: async (id) => void checks.push(id),
    isFuryReachable: opts.reachable ?? (() => true),
    onMissedStreak: (id, streak) => void missed.push([id, streak]),
    logger: silentLogger,
    seed: 7,
  });
  return { clock, timers, checks, missed, scheduler };
}

describe('HealthScheduler (SPEC-02 §7)', () => {
  it('4 lượt/binding trong 4 khung, khác nhau giữa binding, tái lập theo seed', () => {
    const { scheduler } = make();
    const a = scheduler.planFor('ab_1', '2026-10-14');
    const b = scheduler.planFor('ab_2', '2026-10-14');
    expect(a).toHaveLength(4);
    a.forEach((slot, i) => {
      const hour = localParts(new Date(slot.at), TZ).hour;
      const [start, end] = PROXY_CHECK_WINDOWS[i]!;
      expect(hour).toBeGreaterThanOrEqual(start);
      expect(hour).toBeLessThan(end);
    });
    expect(a.map((s) => s.at)).not.toEqual(b.map((s) => s.at));
    expect(scheduler.planFor('ab_1', '2026-10-14').map((s) => s.at)).toEqual(a.map((s) => s.at));
  });

  it('tick chạy lượt tới giờ; mỗi binding đúng 4 lượt/ngày; lượt qua trước khi khởi động bị bỏ', async () => {
    const { clock, checks, scheduler } = make();
    await scheduler.tick();
    expect(checks).toEqual([]);
    for (let i = 0; i < 24 * 60; i += 5) {
      clock.advance(5 * 60_000);
      await scheduler.tick();
    }
    const perBinding = checks.reduce<Record<string, number>>((m, id) => ({ ...m, [id]: (m[id] ?? 0) + 1 }), {});
    expect(perBinding).toEqual({ ab_1: 4, ab_2: 4, ab_3: 4 });

    const late = make({ start: '2026-10-14T05:00:00.000Z' }); // 12:00 địa phương: khung 06–10 đã qua
    await late.scheduler.tick();
    expect(late.checks).toEqual([]); // không chạy bù lượt đã qua
    const pendingA = late.scheduler.pending().filter((s) => s.bindingId === 'ab_1');
    expect(pendingA.length).toBeGreaterThanOrEqual(2); // còn khung 14–18, 18–22 (10–14 tùy giờ ngẫu nhiên)
    expect(pendingA.length).toBeLessThanOrEqual(3);
    expect(pendingA.every((s) => s.at > late.clock.nowMs())).toBe(true);
  });

  it('Fury offline → bỏ lượt, 3 lượt lỡ liên tiếp → onMissedStreak; online lại → reset', async () => {
    let reachable = false;
    const { clock, checks, missed, scheduler } = make({ reachable: () => reachable });
    for (let i = 0; i < 24 * 60; i += 5) {
      clock.advance(5 * 60_000);
      await scheduler.tick();
      if (scheduler.missedStreak('ab_1') >= 3 && !reachable) {
        reachable = true;
      }
    }
    expect(checks.length).toBeGreaterThan(0);
    expect(missed.some(([id, n]) => id === 'ab_1' && n === 3)).toBe(true);
    expect(scheduler.missedStreak('ab_1')).toBe(0);
  });

  it('start đăng ký interval 60 s; stop hủy', () => {
    const { timers, scheduler } = make();
    scheduler.start();
    expect(timers.intervals.map((i) => i.ms)).toEqual([60_000]);
    scheduler.stop();
    expect(timers.intervals[0]?.active).toBe(false);
  });
});
