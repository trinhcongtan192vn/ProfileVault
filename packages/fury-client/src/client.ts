import type {
  ExitInfo,
  FuryCapabilities,
  FuryHealth,
  FuryLaunchResult,
  FuryProfileDetail,
  FuryProfileStatus,
  FuryProfileSummary,
} from '@sctech/profilevault-contract';

/** Lớp duy nhất nói chuyện với Fury (SPEC-01 §3). Mọi package khác chỉ dùng giao diện này. */
export interface FuryClient {
  health(opts?: { retry?: boolean }): Promise<FuryHealth>;
  listProfiles(): Promise<FuryProfileSummary[]>;
  getProfile(profileId: string): Promise<FuryProfileDetail>;
  getStatus(profileId: string): Promise<FuryProfileStatus>;
  launch(profileId: string, opts: { cdp: true }): Promise<FuryLaunchResult>;
  stop(profileId: string): Promise<void>;
  checkExit(profileId: string): Promise<ExitInfo>;
  capabilities(): Promise<FuryCapabilities>;
}

/** Timeout từng phương thức (SPEC-01 §5). */
export const FURY_TIMEOUTS_MS = {
  health: 3_000,
  listProfiles: 5_000,
  getProfile: 5_000,
  getStatus: 5_000,
  checkExit: 30_000,
  launch: 60_000,
  stop: 15_000,
  personas: 5_000,
  proxies: 5_000,
} as const;
export type FuryTimeouts = { [K in keyof typeof FURY_TIMEOUTS_MS]: number };

/** Backoff thử lại (SPEC-01 §5): 1 s → 3 s, tối đa 2 lần. */
export const FURY_RETRY_BACKOFF_MS = [1_000, 3_000] as const;

/** Timer tiêm được để test không chờ thật (SPEC-09 §3.2). */
export interface Timers {
  sleep(ms: number): Promise<void>;
  setInterval(fn: () => void, ms: number): () => void;
}

export const realTimers: Timers = {
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  setInterval: (fn, ms) => {
    const h = setInterval(fn, ms);
    return () => clearInterval(h);
  },
};

/** Timer giả: `sleep` ghi lại và trả ngay; `setInterval` lưu để test gọi tay. */
export class FakeTimers implements Timers {
  readonly sleeps: number[] = [];
  readonly intervals: { fn: () => void; ms: number; active: boolean }[] = [];

  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
  }

  setInterval(fn: () => void, ms: number): () => void {
    const entry = { fn, ms, active: true };
    this.intervals.push(entry);
    return () => {
      entry.active = false;
    };
  }

  /** Kích hoạt mọi interval còn hoạt động có chu kỳ `ms` (hoặc tất cả). */
  fire(ms?: number): void {
    for (const i of this.intervals) if (i.active && (ms === undefined || i.ms === ms)) i.fn();
  }
}
