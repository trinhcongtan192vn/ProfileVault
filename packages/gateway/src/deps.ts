import { PvError, type Clock, type Config, type FuryInstallStatus, type FlowInfo, type JobRecord, type RunRecord, type Schedule, type ScheduleInput } from '@sctech/profilevault-contract';
import type { EventBus, Logger, SecretStore } from '@sctech/profilevault-core';
import type { AuditRepo, Database, SettingsRepo } from '@sctech/profilevault-db';
import type { FuryClient, FuryStatusPoller, Timers } from '@sctech/profilevault-fury-client';
import type { HealthService } from '@sctech/profilevault-health';
import type { JobService } from '@sctech/profilevault-jobs';

/** Phần Runner mà Gateway cần (SPEC-03 §9, SPEC-05 §7). Feature 007 cài; tới lúc đó dùng `NoRunner`. */
export interface RunnerFacade {
  listJobs(filter: { status?: string; clientId?: string; bindingId?: string; limit?: number }): JobRecord[];
  getRun(runId: string): RunRecord | undefined;
  /** Run đang `needs_user` (trang Chờ bạn). */
  listNeedsUser(): RunRecord[];
  cancelRun(runId: string, actor: string): Promise<void>;
  resolveGate(runId: string, result: { choice: string; note?: string }, actor: 'user'): Promise<void>;
  artifactPath(runId: string, name: string): string | undefined;
  listFlows(): FlowInfo[];
  systemInfo(): { queue: { queued: number; running: number; needsUser: number }; runningProfiles: number; busyMode: boolean; globalPause: boolean; packs: { id: string; version: string; status: 'enabled' | 'disabled'; reason?: string; flows: string[] }[] };
  setGlobalPause(paused: boolean): void;
  setBusyMode(busy: boolean): void;
  schedules: {
    list(): Schedule[];
    create(input: ScheduleInput, actor: 'user'): Schedule;
    update(id: string, patch: Partial<ScheduleInput>, actor: 'user'): Schedule;
    remove(id: string, actor: 'user'): void;
  };
}

const notReady = (): never => {
  throw new PvError('FLOW_DISABLED', 'Runner chưa sẵn sàng (feature 007)', { reason: 'runner_missing' });
};

/** Mặc định khi chưa có Runner: danh sách rỗng, thao tác → FLOW_DISABLED (giả định G27). */
export class NoRunner implements RunnerFacade {
  private globalPause = false;
  private busyMode = false;
  listJobs(): JobRecord[] {
    return [];
  }
  getRun(): RunRecord | undefined {
    return undefined;
  }
  listNeedsUser(): RunRecord[] {
    return [];
  }
  async cancelRun(): Promise<void> {
    notReady();
  }
  async resolveGate(): Promise<void> {
    notReady();
  }
  artifactPath(): string | undefined {
    return undefined;
  }
  listFlows(): FlowInfo[] {
    return [];
  }
  systemInfo() {
    return { queue: { queued: 0, running: 0, needsUser: 0 }, runningProfiles: 0, busyMode: this.busyMode, globalPause: this.globalPause, packs: [] };
  }
  setGlobalPause(paused: boolean): void {
    this.globalPause = paused;
  }
  setBusyMode(busy: boolean): void {
    this.busyMode = busy;
  }
  schedules = {
    list: (): Schedule[] => [],
    create: (): Schedule => notReady(),
    update: (): Schedule => notReady(),
    remove: (): void => notReady(),
  };
}

export interface GatewayDeps {
  config: Config;
  clock: Clock;
  timers?: Timers;
  bus: EventBus;
  logger: Logger;
  health: HealthService;
  fury: FuryClient;
  poller: Pick<FuryStatusPoller, 'lastHealth' | 'tickHealth'>;
  secrets: SecretStore;
  audit: AuditRepo;
  settings: SettingsRepo;
  database: Database;
  paths: { probesDir: string };
  runner?: RunnerFacade;
  /** Job service (SPEC-06): `/api/v1`, MCP, gửi job từ dashboard. */
  jobs?: JobService;
  /** Bộ tự cài Fury (SPEC-00 §11.1); không có → `/internal/fury/install` báo `disabled`. */
  furyInstall?: { status(): FuryInstallStatus; ensure(): Promise<FuryInstallStatus> };
  /** File `api-token` của Fury (đọc khi chưa lưu token ở Cài đặt). */
  furyTokenFile?: string;
  /** Thư mục SPA đã build (apps/dashboard/dist); không có → trang HTML tối thiểu. */
  staticDir?: string;
  serviceVersion?: string;
  startedAt?: string;
  /** Sinh byte ngẫu nhiên (test). */
  random?: (bytes: number) => Buffer;
}
