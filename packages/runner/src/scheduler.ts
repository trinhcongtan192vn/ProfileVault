import { ScheduleInputSchema, ScheduleSchema, ScheduleSlotsSchema, PvError, newId, type Clock, type Config, type EnqueueInput, type FlowInfo, type RunRecord, type Schedule, type ScheduleInput, type ScheduleSlot } from '@sctech/profilevault-contract';
import type { AuditRepo, Database, SettingsRepo } from '@sctech/profilevault-db';
import { schedules } from '@sctech/profilevault-db';
import type { EventBus, Logger } from '@sctech/profilevault-core';
import { realTimers, type FuryClient, type Timers } from '@sctech/profilevault-fury-client';
import { fromLocal, localDateKey, nextDateKey, type HealthService } from '@sctech/profilevault-health';
import { eq } from 'drizzle-orm';

interface SchedulerDeps { database: Database; clock: Clock; config: Config; settings: SettingsRepo; audit: AuditRepo; bus: EventBus; health: HealthService; fury: FuryClient; logger: Logger; timers?: Timers; random?: () => number; enqueue(input: EnqueueInput): Promise<RunRecord>; listFlows(): FlowInfo[] }
/** Chọn giờ đều trong khung, khác nhau giữa các binding; seed tiêm qua random. */
export function pickTimes(start: number, end: number, count: number, random: () => number): number[] {
  if (end <= start || end - start < count) throw new PvError('INPUT_INVALID', 'Khung giờ không hợp lệ');
  const used = new Set<number>(); const out: number[] = [];
  for (let i = 0; i < count; i++) { let at = start + Math.floor(Math.min(0.999999999, Math.max(0, random())) * (end - start)); while (used.has(at)) at = start + (at - start + 1) % (end - start); used.add(at); out.push(at); }
  return out;
}
export class Scheduler {
  private stopTimer?: () => void;
  private unsubscribe?: () => void;
  private ticking = false;
  constructor(private readonly d: SchedulerDeps) {}
  private key(id: string) { return `schedule.slots:${id}`; }
  private slots(id: string): ScheduleSlot[] { return this.d.settings.get(this.key(id), ScheduleSlotsSchema) ?? []; }
  list(): Schedule[] {
    return this.d.database.db.select().from(schedules).all().map((row) => ScheduleSchema.parse({ ...row, target: JSON.parse(row.targetJson) as unknown, params: JSON.parse(row.paramsJson) as unknown, nextRuns: this.slots(row.id).map((s) => ({ bindingId: s.bindingId, at: s.at })) }));
  }
  create(input: ScheduleInput, actor: 'user' | 'system'): Schedule {
    const value = ScheduleInputSchema.parse(input); this.validate(value);
    const id = newId('schedule', this.d.clock.nowMs());
    this.d.database.db.insert(schedules).values({ id, flowId: value.flowId, targetJson: JSON.stringify(value.target), paramsJson: JSON.stringify(value.params), daysOfWeek: value.daysOfWeek, windowStart: value.windowStart, windowEnd: value.windowEnd, enabled: value.enabled, createdAt: this.d.clock.nowIso() }).run();
    this.d.audit.append({ actorType: actor, action: 'schedule.create', targetType: 'schedule', targetId: id });
    return this.list().find((s) => s.id === id)!;
  }
  update(id: string, patch: Partial<ScheduleInput>, actor: 'user'): Schedule {
    const current = this.list().find((s) => s.id === id); if (!current) throw new PvError('INPUT_INVALID', 'Không có lịch');
    const value = ScheduleInputSchema.parse({ ...current, ...patch }); this.validate(value);
    this.d.database.sqlite.transaction(() => {
      this.d.database.db.update(schedules).set({ flowId: value.flowId, targetJson: JSON.stringify(value.target), paramsJson: JSON.stringify(value.params), daysOfWeek: value.daysOfWeek, windowStart: value.windowStart, windowEnd: value.windowEnd, enabled: value.enabled, nextRunAt: null }).where(eq(schedules.id, id)).run();
      this.d.settings.set(this.key(id), [], actor);
      this.d.audit.append({ actorType: actor, action: 'schedule.update', targetType: 'schedule', targetId: id });
    })();
    return this.list().find((s) => s.id === id)!;
  }
  remove(id: string, actor: 'user'): void {
    this.d.database.sqlite.transaction(() => {
      this.d.database.db.delete(schedules).where(eq(schedules.id, id)).run(); this.d.settings.set(this.key(id), [], actor);
      this.d.audit.append({ actorType: actor, action: 'schedule.delete', targetType: 'schedule', targetId: id });
    })();
  }
  private validate(s: ScheduleInput): void {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.windowStart) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.windowEnd) || s.windowStart >= s.windowEnd) throw new PvError('INPUT_INVALID', 'Khung giờ phải cùng ngày, bắt đầu trước kết thúc');
    if (!this.d.listFlows().some((f) => f.id === s.flowId && f.status === 'enabled')) throw new PvError('FLOW_DISABLED', 'Flow chưa sẵn sàng');
  }
  start(): void {
    if (this.stopTimer) return;
    this.stopTimer = (this.d.timers ?? realTimers).setInterval(() => { void this.tick().catch((err: unknown) => this.d.logger.warn('Lịch chạy lỗi', { error: String(err) })); }, 2000);
    this.unsubscribe = this.d.bus.on('binding.level_changed', (e) => {
      if (e.kind === 'promote' && e.toLevel >= 1) this.ensureDefault(e.bindingId);
    });
    for (const b of this.d.health.listBindings().filter((b) => b.level >= 1)) this.ensureDefault(b.id);
  }
  stop(): void { this.stopTimer?.(); this.stopTimer = undefined; this.unsubscribe?.(); this.unsubscribe = undefined; }
  isTicking(): boolean { return this.ticking; }
  private ensureDefault(bindingId: string): void {
    const b = this.d.health.getBinding(bindingId); if (!b) return;
    for (const flowId of [`${b.platform}/session-check`, 'generic/probe']) {
      if (!this.d.listFlows().some((f) => f.id === flowId && f.status === 'enabled')) continue;
      if (this.list().some((s) => s.flowId === flowId && 'bindingIds' in s.target && s.target.bindingIds.includes(bindingId))) continue;
      this.create({ flowId, target: { bindingIds: [bindingId] }, daysOfWeek: flowId === 'generic/probe' ? '1' : '1234567', windowStart: flowId === 'generic/probe' ? '09:00' : '07:00', windowEnd: flowId === 'generic/probe' ? '18:00' : '22:00', params: {}, enabled: true }, 'system');
    }
  }
  private async targets(schedule: Schedule): Promise<string[]> {
    const bindings = this.d.health.listBindings(); const target = schedule.target;
    if ('bindingIds' in target) return bindings.filter((b) => target.bindingIds.includes(b.id)).map((b) => b.id);
    if ('all' in target) return bindings.filter((b) => !target.platform || b.platform === target.platform).map((b) => b.id);
    const profiles = await this.d.fury.listProfiles(); const ids = new Set(profiles.filter((p) => p.tags.includes(target.furyTag)).map((p) => p.id));
    return bindings.filter((b) => ids.has(b.furyProfileId)).map((b) => b.id);
  }
  private async plan(schedule: Schedule): Promise<void> {
    const now = this.d.clock.nowMs(); const timezone = this.d.config.ui.timezone;
    const targets = await this.targets(schedule); if (!targets.length) return;
    let day = localDateKey(this.d.clock.now(), timezone);
    const completed = this.d.settings.get<Record<string, string>>(`schedule.completed:${schedule.id}`) ?? {};
    const slots = this.slots(schedule.id).filter((s) => targets.includes(s.bindingId));
    const missing = targets.filter((id) => !slots.some((s) => s.bindingId === id));
    for (let i = 0; i < 8 && missing.length; i++, day = nextDateKey(day)) {
      const [year, month, date] = day.split('-').map(Number) as [number, number, number];
      const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay() || 7;
      if (!schedule.daysOfWeek.includes(String(weekday))) continue;
      const [sh, sm] = schedule.windowStart.split(':').map(Number) as [number, number]; const [eh, em] = schedule.windowEnd.split(':').map(Number) as [number, number];
      const start = fromLocal(timezone, year, month, date, sh, sm).getTime(); const end = fromLocal(timezone, year, month, date, eh, em).getTime();
      if (end <= now) continue;
      const eligible = missing.filter((id) => completed[id] !== day);
      const windowStart = Math.max(start, now + 1);
      const reserved = new Set(slots.map((s) => Date.parse(s.at)));
      const times = pickTimes(windowStart, end, eligible.length, this.d.random ?? Math.random).map((candidate) => { let at = candidate; while (reserved.has(at)) at = windowStart + (at - windowStart + 1) % (end - windowStart); reserved.add(at); return at; });
      for (let j = 0; j < eligible.length; j++) { slots.push({ bindingId: eligible[j]!, day, at: new Date(times[j]!).toISOString() }); missing.splice(missing.indexOf(eligible[j]!), 1); }
    }
    this.saveSlots(schedule.id, slots);
  }
  private saveSlots(id: string, slots: ScheduleSlot[]): void {
    slots.sort((a, b) => a.at.localeCompare(b.at));
    this.d.settings.set(this.key(id), slots, 'system');
    this.d.database.db.update(schedules).set({ nextRunAt: slots[0]?.at ?? null }).where(eq(schedules.id, id)).run();
  }
  async recover(): Promise<void> {
    for (const schedule of this.list().filter((s) => s.enabled)) {
      const slots = this.slots(schedule.id); const kept: ScheduleSlot[] = [];
      for (const slot of slots) {
        const late = this.d.clock.nowMs() - Date.parse(slot.at);
        if (late > 12 * 3_600_000) {
          const completed = this.d.settings.get<Record<string, string>>(`schedule.completed:${schedule.id}`) ?? {};
          completed[slot.bindingId] = slot.day; this.d.settings.set(`schedule.completed:${schedule.id}`, completed, 'system');
          continue;
        }
        kept.push(late > 0 ? { ...slot, at: new Date(this.d.clock.nowMs() + 60_000 + Math.floor((this.d.random ?? Math.random)() * 14 * 60_000)).toISOString() } : slot);
      }
      this.saveSlots(schedule.id, kept); await this.plan(schedule);
    }
  }
  async tick(): Promise<void> {
    if (this.ticking) return; this.ticking = true;
    try {
      for (const schedule of this.list().filter((s) => s.enabled)) {
        await this.plan(schedule); const slots = this.slots(schedule.id); const kept: ScheduleSlot[] = [];
        for (const slot of slots) {
          if (Date.parse(slot.at) > this.d.clock.nowMs()) { kept.push(slot); continue; }
          const b = this.d.health.getBinding(slot.bindingId); const flow = this.d.listFlows().find((f) => f.id === schedule.flowId);
          if (b && !b.archivedAt && flow?.status === 'enabled' && b.level >= flow.minLevel && b.level > 0 && !this.d.health.listPauses(b.id, { open: true }).length) {
            try { await this.d.enqueue({ flowId: schedule.flowId, bindingId: b.id, input: schedule.params, clientId: 'scheduler', idempotencyKey: `${schedule.id}:${b.id}:${slot.day}` }); }
            catch (err) { this.d.logger.warn('Không tạo được lượt lịch', { scheduleId: schedule.id, error: String(err) }); kept.push(slot); continue; }
          }
          const completed = this.d.settings.get<Record<string, string>>(`schedule.completed:${schedule.id}`) ?? {};
          completed[slot.bindingId] = slot.day; this.d.settings.set(`schedule.completed:${schedule.id}`, completed, 'system');
          this.d.database.db.update(schedules).set({ lastRunAt: this.d.clock.nowIso() }).where(eq(schedules.id, schedule.id)).run();
        }
        this.saveSlots(schedule.id, kept); await this.plan(schedule);
      }
    } finally { this.ticking = false; }
  }
}
