import { systemClock, type Clock, type FuryHealth } from '@sctech/profilevault-contract';
import type { EventBus, Logger } from '@sctech/profilevault-core';
import { realTimers, type FuryClient, type Timers } from './client.js';

export interface PollerOptions {
  client: FuryClient;
  bus: EventBus;
  clock?: Clock;
  timers?: Timers;
  logger?: Logger;
  /** Profile Fury đang có binding (SPEC-01 §7). */
  listBoundProfileIds: () => string[] | Promise<string[]>;
  /** Health service (003) nối để ghi `fury.profile_opened/closed`. */
  onProfileStatusChanged?: (profileId: string, open: boolean, at: string) => void | Promise<void>;
  /** Health service (003) nối để ghi `fury.version_changed` và áp R5. */
  onVersionChanged?: (from: string | undefined, to: string | undefined) => void | Promise<void>;
  healthIntervalMs?: number;
  statusIntervalMs?: number;
}

/** Bộ theo dõi trạng thái Fury (SPEC-01 §7): health 60 s, trạng thái profile 5 phút. */
export class FuryStatusPoller {
  lastHealth: FuryHealth | null = null;
  readonly lastOpen = new Map<string, boolean>();
  private stops: (() => void)[] = [];
  private readonly clock: Clock;
  private readonly timers: Timers;
  private running = { health: false, status: false };

  constructor(private readonly opts: PollerOptions) {
    this.clock = opts.clock ?? systemClock;
    this.timers = opts.timers ?? realTimers;
  }

  start(): void {
    if (this.stops.length > 0) return;
    this.stops.push(this.timers.setInterval(() => void this.tickHealth().catch(() => undefined), this.opts.healthIntervalMs ?? 60_000));
    this.stops.push(this.timers.setInterval(() => void this.tickStatus().catch(() => undefined), this.opts.statusIntervalMs ?? 300_000));
  }

  stop(): void {
    for (const s of this.stops) s();
    this.stops = [];
  }

  async tickHealth(): Promise<FuryHealth> {
    if (this.running.health) return this.lastHealth ?? { reachable: false, supported: false, checkedAt: this.clock.nowIso() };
    this.running.health = true;
    try {
      const h = await this.opts.client.health();
      const prev = this.lastHealth;
      this.lastHealth = h;
      const changed = !prev || prev.reachable !== h.reachable || prev.version !== h.version || prev.supported !== h.supported;
      if (changed) {
        const payload: { reachable: boolean; supported: boolean; version?: string } = { reachable: h.reachable, supported: h.supported };
        if (h.version !== undefined) payload.version = h.version;
        this.opts.bus.emit('fury.status_changed', payload);
        this.opts.logger?.info('trạng thái Fury đổi', { ...payload, error: h.error });
        if (prev && h.reachable && prev.version !== h.version && h.version !== undefined) {
          await this.opts.onVersionChanged?.(prev.version, h.version);
        }
      }
      return h;
    } finally {
      this.running.health = false;
    }
  }

  async tickStatus(): Promise<void> {
    if (this.running.status) return;
    this.running.status = true;
    try {
      if (!this.lastHealth) await this.tickHealth();
      if (!this.lastHealth?.reachable) return; // offline: giữ trạng thái cuối, không sinh sự kiện giả
      const ids = await this.opts.listBoundProfileIds();
      for (const id of ids) {
        let open: boolean;
        try {
          open = (await this.opts.client.getStatus(id)).open;
        } catch (err) {
          this.opts.logger?.warn('không lấy được trạng thái profile', { profileId: id, err: err instanceof Error ? err.message : String(err) });
          continue;
        }
        const prev = this.lastOpen.get(id);
        this.lastOpen.set(id, open);
        if (prev !== undefined && prev !== open) {
          await this.opts.onProfileStatusChanged?.(id, open, this.clock.nowIso());
        } else if (prev === undefined && open) {
          // lần đầu thấy profile đang mở: báo để nhắc khai báo (SPEC-07 §7)
          await this.opts.onProfileStatusChanged?.(id, true, this.clock.nowIso());
        }
      }
      for (const id of [...this.lastOpen.keys()]) if (!ids.includes(id)) this.lastOpen.delete(id);
    } finally {
      this.running.status = false;
    }
  }
}
