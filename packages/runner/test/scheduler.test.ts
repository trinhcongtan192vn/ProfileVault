import { afterEach, describe, expect, it } from 'vitest';
import { pickTimes } from '../src/scheduler.js';
import { runnerHarness } from './helpers.js';
let h: Awaited<ReturnType<typeof runnerHarness>> | undefined;
afterEach(async () => { await h?.cleanup(); h = undefined; });
describe('Lịch flow SPEC-03 §8', () => {
  it('giờ đều, khác nhau kể cả RNG cùng giá trị', () => {
    const values = pickTimes(100, 10000, 3, () => 0.5);
    expect(new Set(values).size).toBe(3); expect(values.every((n) => n >= 100 && n < 10000)).toBe(true);
  });
  it('3 binding có slots bền vững, chạy bù sau 3 giờ và không tạo trùng', async () => {
    h = await runnerHarness(); const bindings = await Promise.all([h.binding(1), h.binding(2), h.binding(3)]);
    const schedule = h.runner.schedules.create({ flowId: 'test/check', target: { bindingIds: bindings.map((b) => b.id) }, daysOfWeek: '1234567', windowStart: '07:00', windowEnd: '22:00' }, 'user');
    await h.runner.schedules.tick();
    const slots = h.runner.schedules.list().find((s) => s.id === schedule.id)!.nextRuns!;
    expect(slots).toHaveLength(3); expect(new Set(slots.map((s) => s.at)).size).toBe(3);
    h.clock.set(Date.parse(slots[2]!.at) + 3 * 3_600_000);
    await h.runner.schedules.recover();
    const catchup = h.runner.schedules.list().find((s) => s.id === schedule.id)!.nextRuns!;
    expect(catchup.every((s) => Date.parse(s.at) - h!.clock.nowMs() >= 60_000 && Date.parse(s.at) - h!.clock.nowMs() <= 15 * 60_000)).toBe(true);
    h.clock.advance(16 * 60_000); await h.runner.schedules.tick(); await h.runner.schedules.tick();
    expect(h.runner.listJobs({})).toHaveLength(3);
    expect(h.runner.listJobs({}).every((j) => j.clientId === 'scheduler')).toBe(true);
  });
  it('bỏ lượt L0/dừng, target all/tag và kiểm khung giờ', async () => {
    h = await runnerHarness(); const a = await h.binding(1); const b = await h.binding(2, 0);
    h.fake.upsertProfile({ id: 'p1', name: 'A', tags: ['daily'] });
    const schedule = h.runner.schedules.create({ flowId: 'test/check', target: { furyTag: 'daily' }, daysOfWeek: '1234567', windowStart: '10:00', windowEnd: '11:00' }, 'user');
    await h.runner.schedules.tick();
    const planned = h.runner.schedules.list().find((s) => s.id === schedule.id)!;
    expect(planned.nextRuns!.map((s) => s.bindingId)).toEqual([a.id]);
    h.runner.schedules.update(schedule.id, { target: { all: true, platform: 'youtube' } }, 'user'); await h.runner.schedules.tick();
    expect(h.runner.schedules.list().find((s) => s.id === schedule.id)!.nextRuns).toHaveLength(2);
    h.clock.advance(2 * 3_600_000); await h.runner.schedules.tick();
    expect(h.runner.listJobs({}).map((j) => j.bindingId)).toEqual([a.id]);
    expect(h.runner.listJobs({}).some((j) => j.bindingId === b.id)).toBe(false);
    expect(() => h!.runner.schedules.create({ flowId: 'test/check', target: { all: true }, daysOfWeek: '1', windowStart: '25:00', windowEnd: '26:00' }, 'user')).toThrow();
    h.runner.schedules.remove(schedule.id, 'user'); expect(h.runner.schedules.list()).toEqual([]);
  });
  it('bỏ lịch lỡ quá 12 giờ, mặc định session-check chỉ tạo một lần khi lên L1', async () => {
    h = await runnerHarness(); const b = await h.binding();
    const pack = h.loader.packs.get('test')!;
    pack.flows[0]!.manifest.id = 'youtube/session-check'; pack.manifest.id = 'youtube'; pack.manifest.platform = 'youtube'; pack.manifest.flows = ['session-check'];
    h.loader.packs.delete('test'); h.loader.packs.set('youtube', pack);
    h.runner.schedules.start();
    expect(h.runner.schedules.list()).toHaveLength(1);
    h.runner.schedules.stop(); h.runner.schedules.start(); expect(h.runner.schedules.list()).toHaveLength(1);
    await h.runner.schedules.tick();
    h.clock.advance(2 * 86_400_000); await h.runner.schedules.recover(); await h.runner.schedules.tick();
    expect(h.runner.listJobs({})).toEqual([]);
    expect(h.runner.schedules.list()[0]!.target).toEqual({ bindingIds: [b.id] });
  });
});
