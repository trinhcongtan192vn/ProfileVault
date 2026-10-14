import { describe, expect, it } from 'vitest';
import { BUS_EVENTS, BusEventNameSchema, FakeClock, IsoDateTimeSchema, newId, systemClock } from '../src/index.js';

describe('Clock', () => {
  it('FakeClock tiến thời gian', () => {
    const c = new FakeClock('2026-10-14T00:00:00.000Z');
    c.advanceDays(14);
    expect(c.nowIso()).toBe('2026-10-28T00:00:00.000Z');
    c.set('2026-01-01T00:00:00.000Z');
    expect(c.nowMs()).toBe(Date.parse('2026-01-01T00:00:00.000Z'));
  });
  it('systemClock trả ISO UTC', () => {
    expect(IsoDateTimeSchema.safeParse(systemClock.nowIso()).success).toBe(true);
  });
});

describe('sự kiện bus (SPEC-00 §10)', () => {
  it('có đủ 6 sự kiện', () => {
    expect(BusEventNameSchema.options.sort()).toEqual(
      [
        'health.event_recorded',
        'binding.level_changed',
        'binding.pause_changed',
        'run.status_changed',
        'run.needs_user',
        'fury.status_changed',
      ].sort(),
    );
  });
  it('payload kiểm bằng Zod', () => {
    const ok = BUS_EVENTS['binding.level_changed'].safeParse({
      bindingId: newId('binding'),
      changeId: newId('levelChange'),
      fromLevel: 1,
      toLevel: 0,
      kind: 'demote',
      reason: 'red_event',
    });
    expect(ok.success).toBe(true);
    expect(BUS_EVENTS['binding.level_changed'].safeParse({ bindingId: 'x' }).success).toBe(false);
  });
});
