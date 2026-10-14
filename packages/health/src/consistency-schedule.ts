import type { Clock } from '@sctech/profilevault-contract';
import type { Logger } from '@sctech/profilevault-core';
import type { SettingsRepo } from '@sctech/profilevault-db';
import { realTimers, type Timers } from '@sctech/profilevault-fury-client';
import { fromLocal, localDateKey, localParts } from './local-time.js';
import { mulberry32 } from './scheduler.js';

export interface ConsistencyScheduleDeps {
  clock: Clock;
  timers?: Timers;
  timezone: string;
  settings: SettingsRepo;
  logger: Logger;
  runPeriodic: () => Promise<void>;
  runChecklistExpiry: () => Promise<void>;
  captureHost: () => Promise<void>;
  seed?: number;
  tickMs?: number;
  hostIntervalHours?: number;
}

export const CONSISTENCY_SETTING = 'consistency';
export const NEXT_PERIODIC_SETTING = 'consistency.nextPeriodicAt';
export const HOST_LAST_SETTING = 'host.lastCapturedAt';

/**
 * Lịch SPEC-02 §7: kiểm nhất quán định kỳ `periodicDays` ngày (giờ ngẫu nhiên 09–18), hết hạn checklist 08:00,
 * chụp host_snapshots mỗi 24 giờ. Thời điểm kế tiếp lưu trong settings để sống qua khởi động lại.
 */
export class ConsistencySchedule {
  private stopFn: (() => void) | null = null;
  private ticking = false;
  private lastChecklistDay = '';
  private readonly timers: Timers;

  constructor(private readonly d: ConsistencyScheduleDeps) {
    this.timers = d.timers ?? realTimers;
  }

  periodicDays(): number {
    const v = this.d.settings.get<{ periodicDays?: number }>(CONSISTENCY_SETTING);
    return typeof v?.periodicDays === 'number' && v.periodicDays > 0 ? v.periodicDays : 7;
  }

  /** Thời điểm định kỳ kế tiếp: `days` ngày sau `from`, giờ ngẫu nhiên 09–18 địa phương. */
  planNext(from: Date, days: number): Date {
    const key = localDateKey(from, this.d.timezone);
    const rng = mulberry32(((this.d.seed ?? 0) ^ hash(`${key}|${days}`)) >>> 0);
    const minutes = Math.floor(rng() * 9 * 60);
    const p = localParts(from, this.d.timezone);
    const base = fromLocal(this.d.timezone, p.year, p.month, p.day, 9 + Math.floor(minutes / 60), minutes % 60);
    return new Date(base.getTime() + days * 86_400_000);
  }

  nextPeriodicAt(): string | undefined {
    return this.d.settings.get<{ at: string }>(NEXT_PERIODIC_SETTING)?.at;
  }

  private ensureNext(now: Date): string {
    const existing = this.nextPeriodicAt();
    if (existing) return existing;
    const next = this.planNext(now, this.periodicDays()).toISOString();
    this.d.settings.set(NEXT_PERIODIC_SETTING, { at: next }, 'system');
    return next;
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.d.clock.now();
      // định kỳ
      const next = this.ensureNext(now);
      if (Date.parse(next) <= now.getTime()) {
        const after = this.planNext(now, this.periodicDays()).toISOString();
        this.d.settings.set(NEXT_PERIODIC_SETTING, { at: after }, 'system');
        try {
          await this.d.runPeriodic();
        } catch (err) {
          this.d.logger.warn('kiểm nhất quán định kỳ lỗi', { err: err instanceof Error ? err.message : String(err) });
        }
      }
      // checklist 08:00 địa phương
      const parts = localParts(now, this.d.timezone);
      const day = localDateKey(now, this.d.timezone);
      if (parts.hour >= 8 && this.lastChecklistDay !== day) {
        this.lastChecklistDay = day;
        try {
          await this.d.runChecklistExpiry();
        } catch (err) {
          this.d.logger.warn('kiểm hết hạn checklist lỗi', { err: err instanceof Error ? err.message : String(err) });
        }
      }
      // host 24h
      const last = this.d.settings.get<{ at: string }>(HOST_LAST_SETTING)?.at;
      const hours = this.d.hostIntervalHours ?? 24;
      if (!last || now.getTime() - Date.parse(last) >= hours * 3_600_000) {
        this.d.settings.set(HOST_LAST_SETTING, { at: now.toISOString() }, 'system');
        try {
          await this.d.captureHost();
        } catch (err) {
          this.d.logger.warn('chụp host lỗi', { err: err instanceof Error ? err.message : String(err) });
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  start(): void {
    if (this.stopFn) return;
    this.stopFn = this.timers.setInterval(() => void this.tick().catch(() => undefined), this.d.tickMs ?? 60_000);
  }

  stop(): void {
    this.stopFn?.();
    this.stopFn = null;
  }
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
