import type { Clock } from '@sctech/profilevault-contract';
import type { Logger } from '@sctech/profilevault-core';
import { realTimers, type Timers } from '@sctech/profilevault-fury-client';
import { fromLocal, localDateKey } from './local-time.js';

/** 4 khung giờ địa phương (SPEC-02 §7): 06–10, 10–14, 14–18, 18–22. */
export const PROXY_CHECK_WINDOWS: readonly [number, number][] = [
  [6, 10],
  [10, 14],
  [14, 18],
  [18, 22],
];

export interface SchedulerDeps {
  clock: Clock;
  timers?: Timers;
  timezone: string;
  listBindingIds: () => string[];
  runCheck: (bindingId: string) => Promise<void>;
  isFuryReachable: () => boolean;
  /** 3 lượt lỡ liên tiếp (SPEC-02 §7). */
  onMissedStreak: (bindingId: string, streak: number) => void | Promise<void>;
  logger: Logger;
  seed?: number;
  tickMs?: number;
  missedThreshold?: number;
}

export interface Slot {
  bindingId: string;
  at: number;
  window: number;
  done: boolean;
}

/** RNG tất định (research R2). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Lịch kiểm proxy: 4 lượt/ngày/binding, giờ ngẫu nhiên trong khung (SPEC-02 §7). */
export class HealthScheduler {
  private slots: Slot[] = [];
  private dateKey = '';
  private stopFn: (() => void) | null = null;
  private readonly missed = new Map<string, number>();
  private ticking = false;
  private readonly timers: Timers;

  constructor(private readonly d: SchedulerDeps) {
    this.timers = d.timers ?? realTimers;
  }

  /** Thời điểm 4 lượt của một binding trong ngày địa phương `dateKey` (tái lập được theo seed). */
  planFor(bindingId: string, dateKey: string): Slot[] {
    const rng = mulberry32(((this.d.seed ?? 0) ^ hashString(`${bindingId}|${dateKey}`)) >>> 0);
    const [y, m, dd] = dateKey.split('-').map(Number) as [number, number, number];
    return PROXY_CHECK_WINDOWS.map(([start, end], window) => {
      const minutes = Math.floor(rng() * (end - start) * 60);
      const at = fromLocal(this.d.timezone, y, m, dd, start + Math.floor(minutes / 60), minutes % 60).getTime();
      return { bindingId, at, window, done: false };
    });
  }

  private ensurePlanned(now: Date): void {
    const key = localDateKey(now, this.d.timezone);
    const ids = this.d.listBindingIds();
    if (key !== this.dateKey) {
      this.dateKey = key;
      this.slots = ids.flatMap((id) => this.planFor(id, key));
      // lượt đã qua khi mới khởi động/đổi ngày: bỏ, không chạy bù (giả định G18)
      for (const s of this.slots) if (s.at <= now.getTime()) s.done = true;
      this.d.logger.debug('lập lịch kiểm proxy', { date: key, slots: this.slots.length });
      return;
    }
    // binding mới thêm trong ngày
    const known = new Set(this.slots.map((s) => s.bindingId));
    for (const id of ids) {
      if (known.has(id)) continue;
      const extra = this.planFor(id, key);
      for (const s of extra) if (s.at <= now.getTime()) s.done = true;
      this.slots.push(...extra);
    }
    const alive = new Set(ids);
    this.slots = this.slots.filter((s) => alive.has(s.bindingId));
  }

  /** Lượt còn lại trong ngày (cho dashboard/test). */
  pending(): Slot[] {
    return this.slots.filter((s) => !s.done).sort((a, b) => a.at - b.at);
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = this.d.clock.now();
      this.ensurePlanned(now);
      const due = this.slots.filter((s) => !s.done && s.at <= now.getTime());
      for (const slot of due) {
        slot.done = true;
        if (!this.d.isFuryReachable()) {
          const streak = (this.missed.get(slot.bindingId) ?? 0) + 1;
          this.missed.set(slot.bindingId, streak);
          if (streak >= (this.d.missedThreshold ?? 3)) await this.d.onMissedStreak(slot.bindingId, streak);
          continue;
        }
        this.missed.set(slot.bindingId, 0);
        try {
          await this.d.runCheck(slot.bindingId);
        } catch (err) {
          this.d.logger.warn('kiểm proxy lỗi', { bindingId: slot.bindingId, err: err instanceof Error ? err.message : String(err) });
        }
      }
    } finally {
      this.ticking = false;
    }
  }

  missedStreak(bindingId: string): number {
    return this.missed.get(bindingId) ?? 0;
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
