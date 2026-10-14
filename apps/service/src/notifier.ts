import nodeNotifier from 'node-notifier';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AutomationLevel, Clock, Config } from '@sctech/profilevault-contract';
import type { EventBus } from '@sctech/profilevault-core';
import { fromLocal, localDateKey, localParts, type HealthService } from '@sctech/profilevault-health';

export interface Notification { title: string; message: string; path: string }
export type Notify = (notification: Notification) => void;
/** Logo cho toast: assets/profilevault.png ở gốc repo (cả khi chạy từ src/ lẫn dist/). */
const TOAST_ICON = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'assets', 'profilevault.png');

export function windowsNotify(openUrl: (path: string) => string, open: (url: string) => void): Notify {
  return (n) => {
    nodeNotifier.notify({ title: n.title, message: n.message, icon: TOAST_ICON, wait: true }, (err, response, metadata) => {
      if (!err && (response === 'activate' || metadata?.activationType === 'contentsClicked')) open(openUrl(n.path));
    });
  };
}

/** Toast SPEC-07 §7; lên mức do người quyết định, notifier chỉ thông báo. */
export class Notifier {
  private readonly seen = new Map<string, number>();
  private readonly readinessDay = new Map<string, string>();
  private readonly checklistDay = new Map<string, string>();
  private reminderDay: string | null = null;
  private offlineSince: number | null = null;
  private offlineSent = false;
  private readonly unsubscribe: (() => void)[] = [];
  constructor(private readonly d: { clock: Clock; config: Config; bus: EventBus; health: HealthService; notify: Notify }) {
    const name = (id: string) => d.health.getBinding(id)?.displayName ?? id;
    this.unsubscribe.push(
      d.bus.on('run.needs_user', ({ bindingId, gate }) => {
        const message = gate.reason === 'review_before_final' ? `${name(bindingId)}: đã điền xong, mời bạn kiểm tra và bấm Save` : `${name(bindingId)}: ${gate.message}`;
        this.send({ title: 'Chờ bạn', message, path: '/inbox' });
      }),
      d.bus.on('binding.level_changed', (e) => {
        if (e.kind === 'demote') this.send({ title: 'Kênh bị hạ mức', message: `${name(e.bindingId)} về L${e.toLevel}: ${e.reason}`, path: `/bindings/${e.bindingId}` });
      }),
      d.bus.on('binding.pause_changed', (e) => {
        if (e.open && e.reason !== 'manual') this.send({ title: 'Kênh bị dừng', message: `${name(e.bindingId)}: ${e.reason}`, path: `/bindings/${e.bindingId}` });
      }),
      d.bus.on('fury.status_changed', (e) => {
        if (e.reachable) { this.offlineSince = null; this.offlineSent = false; }
        else if (this.offlineSince === null) this.offlineSince = d.clock.nowMs();
        if (e.reachable && !e.supported) this.send({ title: 'Kết nối Fury', message: `Phiên bản Fury ${e.version ?? ''} ngoài khoảng hỗ trợ`, path: '/settings?section=fury' });
      }),
      d.health.onReadinessReached((id, level) => this.readiness(id, level)),
    );
  }
  send(n: Notification): void {
    const now = this.d.clock.nowMs();
    for (const [key, at] of this.seen) if (now - at >= 30 * 60_000) this.seen.delete(key);
    const key = `${n.title}|${n.message}`;
    if (this.seen.has(key)) return;
    this.seen.set(key, now);
    this.d.notify(n);
  }
  readiness(id: string, level: AutomationLevel): void {
    const day = localDateKey(this.d.clock.now(), this.d.config.ui.timezone);
    if (this.readinessDay.get(id) === day) return;
    this.readinessDay.set(id, day);
    this.send({ title: 'Đạt ngưỡng', message: `${this.d.health.getBinding(id)?.displayName ?? id} đủ điều kiện lên L${level}`, path: `/bindings/${id}?tab=thresholds` });
  }
  async tick(): Promise<void> {
    const { clock, config, health } = this.d;
    const now = clock.nowMs();
    if (this.offlineSince !== null && now - this.offlineSince > 10 * 60_000 && !this.offlineSent) {
      this.offlineSent = true;
      this.send({ title: 'Kết nối Fury', message: 'Fury offline hơn 10 phút', path: '/settings?section=fury' });
    }
    const day = localDateKey(clock.now(), config.ui.timezone);
    for (const binding of health.listBindings()) await health.evaluateReadiness(binding.id);
    for (const status of health.listChecklistExpiring(7)) {
      if (this.checklistDay.get(status.bindingId) === day) continue;
      this.checklistDay.set(status.bindingId, day);
      this.send({ title: 'Checklist sắp hết hạn', message: `${health.getBinding(status.bindingId)?.displayName ?? status.bindingId}: xác nhận lại checklist`, path: `/bindings/${status.bindingId}?tab=checklist` });
    }
    const p = localParts(clock.now(), config.ui.timezone);
    const time = `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
    if (time < config.ui.dailyReminderLocalTime || this.reminderDay === day) return;
    this.reminderDay = day;
    const since = fromLocal(config.ui.timezone, p.year, p.month, p.day, 0, 0).toISOString();
    const missing: string[] = [];
    for (const b of health.listBindings()) {
      const events = health.listEvents(b.id, { since, limit: 10_000 });
      if (events.some((e) => e.type === 'fury.profile_opened') && !events.some((e) => e.type.startsWith('manual.'))) missing.push(b.displayName);
    }
    if (missing.length) this.send({ title: 'Nhắc khai báo', message: `Chưa khai báo hôm nay: ${missing.join(', ')}`, path: '/' });
  }
  stop(): void { for (const unsubscribe of this.unsubscribe.splice(0)) unsubscribe(); }
}
