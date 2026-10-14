import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, FakeClock, type AutomationLevel, type Binding, type ChecklistStatus, type HealthEventRecord } from '@sctech/profilevault-contract';
import { EventBus } from '@sctech/profilevault-core';
import type { HealthService } from '@sctech/profilevault-health';
import { Notifier, type Notification } from '../src/notifier.js';

function harness() {
  const clock = new FakeClock('2026-10-14T14:00:00.000Z');
  const bus = new EventBus(); const sent: Notification[] = [];
  const id = 'ab_01K7E4R0000000000000000001';
  let reached: ((id: string, level: AutomationLevel) => void) | undefined;
  let expiring: ChecklistStatus[] = []; let events: HealthEventRecord[] = [];
  const health = {
    getBinding: () => ({ id, displayName: 'Kênh A' }) as Binding,
    listBindings: () => [{ id, displayName: 'Kênh A' }] as Binding[],
    onReadinessReached: (fn: typeof reached) => { reached = fn; return () => { reached = undefined; }; },
    listChecklistExpiring: () => expiring,
    listEvents: () => events,
    evaluateReadiness: async () => ({}),
  } as unknown as HealthService;
  const notifier = new Notifier({ clock, bus, health, config: DEFAULT_CONFIG, notify: (n) => sent.push(n) });
  return { clock, bus, sent, id, notifier, reached: (level: AutomationLevel) => reached?.(id, level), expiring: () => { expiring = [{ bindingId: id }] as ChecklistStatus[]; }, opened: () => { events = [{ type: 'fury.profile_opened' }] as HealthEventRecord[]; } };
}

describe('Toast SPEC-07 §7', () => {
  it('chống trùng trong 30 phút; đạt ngưỡng tối đa một/ngày/kênh', () => {
    const h = harness();
    h.reached(1); h.reached(1); expect(h.sent).toHaveLength(1);
    h.clock.advance(31 * 60_000); h.reached(1); expect(h.sent).toHaveLength(1);
    h.clock.advanceDays(1); h.reached(1); expect(h.sent).toHaveLength(2);
    const n = { title: 'test', message: 'same', path: '/' };
    h.notifier.send(n); h.notifier.send(n); expect(h.sent).toHaveLength(3);
    h.clock.advance(30 * 60_000); h.notifier.send(n); expect(h.sent).toHaveLength(4);
    h.notifier.stop(); expect(h.bus.listenerCount('run.needs_user')).toBe(0);
  });
  it('run chờ người và L2 dùng deep link Chờ bạn', () => {
    const h = harness();
    for (const reason of ['challenge', 'review_before_final']) h.bus.emit('run.needs_user', { runId: 'rn_01K7E4R0000000000000000001', bindingId: h.id, gate: { reason, message: 'Cần xử lý' } });
    expect(h.sent).toHaveLength(2); expect(h.sent[1]!.message).toContain('Save');
    expect(h.sent.every((n) => n.path === '/inbox')).toBe(true);
  });
  it('hạ mức/dừng tự động gửi thông báo, dừng tay không gửi', () => {
    const h = harness();
    h.bus.emit('binding.level_changed', { bindingId: h.id, changeId: 'lc_01K7E4R0000000000000000001', fromLevel: 1, toLevel: 0, kind: 'demote', reason: 'red_event' });
    for (const reason of ['red_event', 'proxy_changed', 'duplicate_exit_ip', 'consistency_block', 'detect_suite_failed', 'manual'] as const) h.bus.emit('binding.pause_changed', { bindingId: h.id, pauseId: 'bp_01K7E4R0000000000000000001', reason, open: true });
    expect(h.sent).toHaveLength(6); expect(h.sent[0]!.message).toContain('L0');
  });
  it('offline chỉ báo sau 10 phút; phục hồi rồi offline sẽ báo lại; phiên bản ngoài khoảng', async () => {
    const h = harness();
    h.bus.emit('fury.status_changed', { reachable: false, supported: false });
    h.clock.advance(10 * 60_000); await h.notifier.tick(); expect(h.sent).toHaveLength(0);
    h.clock.advance(1); await h.notifier.tick(); await h.notifier.tick(); expect(h.sent).toHaveLength(1);
    h.bus.emit('fury.status_changed', { reachable: true, version: '9.0.0', supported: false });
    expect(h.sent[1]!.message).toContain('9.0.0');
    h.clock.advance(31 * 60_000);
    h.bus.emit('fury.status_changed', { reachable: false, supported: false });
    h.clock.advance(11 * 60_000); await h.notifier.tick(); expect(h.sent).toHaveLength(3);
  });
  it('nhắc khai báo theo giờ cấu hình và checklist sắp hết hạn mỗi ngày', async () => {
    const h = harness(); h.expiring(); h.opened();
    await h.notifier.tick(); await h.notifier.tick();
    expect(h.sent.map((n) => n.title)).toEqual(['Checklist sắp hết hạn', 'Nhắc khai báo']);
    expect(h.sent[0]!.path).toContain('tab=checklist');
  });
});
