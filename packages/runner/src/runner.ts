import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { chromium, type Browser, type Page } from 'playwright';
import { collectFileRefs, EnqueueInputSchema, HumanGateSchema, PvError, SessionCheckOutputSchema, StepOptionsSchema, isRetryable, type Clock, type Config, type EnqueueInput, type GateResult, type HumanGate, type RunRecord, type RunStatus, type StepOptions } from '@sctech/profilevault-contract';
import type { EventBus, Logger } from '@sctech/profilevault-core';
import type { AuditRepo, Database, SettingsRepo } from '@sctech/profilevault-db';
import { realTimers, type FuryClient, type Timers } from '@sctech/profilevault-fury-client';
import type { HealthService } from '@sctech/profilevault-health';
import type { FlowContext } from './flow.js';
import type { PackLoader } from './pack-loader.js';
import { SafeUi } from './safe-ui.js';
import { RunStore } from './store.js';
import { Scheduler } from './scheduler.js';
import { CpuLoad } from './cpu-load.js';

const TERMINAL = new Set<RunStatus>(['done', 'failed', 'cancelled']);
/** Flow generic: domain của nền tảng binding + domain loopback của chính flow (vd trang probe). Flow nền tảng: manifest. */
function sitesFor(flowId: string, manifest: string[], platformSites: string[] | undefined): string[] {
  if (!flowId.startsWith('generic/')) return manifest;
  return [...new Set([...(platformSites ?? manifest), ...manifest.filter((h) => h === '127.0.0.1' || h === 'localhost')])];
}
/** Setting chỉ người đặt (dashboard): spike P4 đạt → mở khóa flow có chế độ L2/L3. */
export const P4_SETTING = 'spike.p4Passed';
interface ActiveRun { probeUrl?: string; promise: Promise<void>; page?: Page; browser?: Browser; owned: boolean; cancel?: PvError; gate?: { resolve(value: GateResult): void; reject(error: Error): void }; gateSince?: number; gateTime: number; started: number; pauseStep?: () => void; resumeStep?: () => void }
export interface RunnerDeps {
  database: Database; clock: Clock; config: Config; settings: SettingsRepo; audit: AuditRepo; bus: EventBus; health: HealthService; fury: FuryClient; logger: Logger; runsDir: string; loader: PackLoader;
  timers?: Timers; connect?: (endpoint: string) => Promise<Browser>; freeRamMb?: () => number; cpuBusy?: () => boolean; random?: () => number;
}
export class Runner {
  readonly store: RunStore;
  readonly schedules: Scheduler;
  private readonly active = new Map<string, ActiveRun>();
  private readonly retryAt = new Map<string, number>();
  private readonly waitingSince = new Map<string, number>();
  private readonly cpu = new CpuLoad();
  private ticking = false;
  private stopping = false;
  private stopTimer?: () => void;
  private stopRetentionTimer?: () => void;
  private readonly unsubscribe: (() => void)[] = [];
  private globalPause: boolean;
  private busyMode: boolean;
  constructor(readonly d: RunnerDeps) {
    this.store = new RunStore(d.database, d.clock);
    this.globalPause = d.settings.get<boolean>('runner.globalPause') ?? false;
    this.busyMode = d.settings.get<boolean>('runner.busyMode') ?? false;
    this.schedules = new Scheduler({ ...d, enqueue: (input) => this.enqueue(input), listFlows: () => this.listFlows() });
    this.unsubscribe.push(d.bus.on('binding.pause_changed', (e) => { if (e.open) void this.cancelBinding(e.bindingId).catch((err: unknown) => d.logger.error('Hủy binding lỗi', { error: String(err) })); }), d.bus.on('binding.level_changed', (e) => { if (e.kind === 'demote') void this.cancelBinding(e.bindingId).catch((err: unknown) => d.logger.error('Hủy binding lỗi', { error: String(err) })); }));
  }
  listJobs(filter: Parameters<RunStore['listJobs']>[0]) { return this.store.listJobs(filter); }
  getRun(id: string): RunRecord | undefined {
    const run = this.store.run(id); if (!run) return;
    const log = this.artifactPath(id, 'log.ndjson');
    return { ...run, logTail: log && existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').slice(-100) : [] };
  }
  listNeedsUser(): RunRecord[] { return this.store.listRuns().filter((r) => r.status === 'needs_user'); }
  listFlows() { return this.d.loader.listFlows(); }
  /** Định nghĩa flow đã nạp (Job service kiểm input/manifest). */
  getFlow(id: string) { return this.d.loader.get(id)?.flow; }
  getJob(id: string) { return this.store.job(id); }
  runForJob(jobId: string) { return this.store.runByJob(jobId); }
  jobByKey(clientId: string, key: string) { return this.store.jobByKey(clientId, key); }
  async reloadPacks() { for (const p of [...this.d.loader.packs.values()]) await this.d.loader.load(p.directory); return this.systemInfo().packs; }
  systemInfo() {
    const runs = this.store.listRuns();
    return { queue: { queued: runs.filter((r) => ['queued', 'waiting_profile'].includes(r.status)).length, running: runs.filter((r) => ['launching', 'running', 'finalizing'].includes(r.status)).length, needsUser: runs.filter((r) => r.status === 'needs_user').length }, runningProfiles: [...this.active.values()].filter((r) => r.owned).length, busyMode: this.busyMode, globalPause: this.globalPause, packs: [...this.d.loader.packs.values()].map((p) => ({ id: p.manifest.id, version: p.manifest.version, status: p.status, reason: p.reason, flows: p.manifest.flows.map((f) => `${p.manifest.id}/${f}`) })) };
  }
  setGlobalPause(value: boolean): void { this.globalPause = value; this.d.settings.set('runner.globalPause', value, 'user'); }
  setBusyMode(value: boolean): void { this.busyMode = value; this.d.settings.set('runner.busyMode', value, 'user'); }
  artifactPath(runId: string, name: string): string | undefined {
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name === '.' || name === '..') return;
    const run = this.store.raw(runId); if (!run?.artifactsDir) return;
    const file = path.resolve(run.artifactsDir, name);
    if (!file.startsWith(path.resolve(this.d.runsDir) + path.sep) || !file.startsWith(path.resolve(run.artifactsDir) + path.sep)) return;
    return file;
  }
  /** Flow ghi lên nền tảng (có chế độ L2/L3) chỉ chạy sau khi người xác nhận SPIKE-P4 đạt trên dashboard. */
  private assertP4(flowId: string, modes: readonly string[]): void {
    if (modes.length > 0 && this.d.settings.get<boolean>(P4_SETTING) !== true) throw new PvError('FLOW_DISABLED', 'Flow upload bị khóa tới khi spike P4 được xác nhận đạt (Cài đặt → Runner)', { flowId, reason: 'p4_not_passed' });
  }
  async enqueue(input: EnqueueInput): Promise<RunRecord> {
    const parsed = EnqueueInputSchema.parse(input);
    const { flow } = this.d.loader.assertEnabled(parsed.flowId);
    this.assertP4(parsed.flowId, flow.manifest.modes);
    const b = this.d.health.getBinding(parsed.bindingId); if (!b || b.archivedAt) throw new PvError('ACCOUNT_NOT_BOUND', 'Không có binding đang hoạt động');
    if (parsed.mode && !flow.manifest.modes.includes(parsed.mode)) throw new PvError('INPUT_INVALID', 'Flow không hỗ trợ chế độ này');
    if (flow.manifest.modes.length && !parsed.mode) throw new PvError('INPUT_INVALID', 'Cần chọn chế độ flow');
    const normalized = { ...parsed, input: flow.input.parse(parsed.input) };
    const run = this.store.enqueue(normalized, flow.manifest.version);
    const artifactsDir = path.join(this.d.runsDir, run.id); mkdirSync(artifactsDir, { recursive: true });
    const logPath = path.join(artifactsDir, 'log.ndjson');
    if (!existsSync(logPath)) appendFileSync(logPath, JSON.stringify({ at: this.d.clock.nowIso(), message: 'Run được đưa vào hàng đợi' }) + '\n');
    this.store.patchRun(run.id, { artifactsDir });
    return this.store.run(run.id)!;
  }
  start(): void {
    if (this.stopTimer) return; this.stopping = false;
    this.stopTimer = (this.d.timers ?? realTimers).setInterval(() => { void this.tick().catch((err: unknown) => this.d.logger.error('Runner tick lỗi', { error: String(err) })); }, 2000);
    this.schedules.start(); this.pruneArtifacts();
    this.stopRetentionTimer = (this.d.timers ?? realTimers).setInterval(() => this.pruneArtifacts(), 86_400_000);
  }
  async stop(): Promise<void> {
    this.stopping = true; this.stopTimer?.(); this.stopTimer = undefined; this.schedules.stop();
    this.stopRetentionTimer?.(); this.stopRetentionTimer = undefined;
    while (this.ticking || this.schedules.isTicking()) await new Promise<void>((resolve) => setTimeout(resolve, 10));
    for (const fn of this.unsubscribe.splice(0)) fn();
    for (const id of this.active.keys()) await this.cancelRun(id, 'system');
    await Promise.allSettled([...this.active.values()].map((r) => r.promise));
  }
  async tick(): Promise<void> {
    if (this.ticking || this.stopping) return; this.ticking = true;
    try {
      for (const r of this.listNeedsUser()) if (Date.parse(r.needsUser?.expiresAt ?? '') <= this.d.clock.nowMs()) {
        const active = this.active.get(r.id);
        if (active?.gate) active.gate.reject(new PvError('TIMEOUT', 'Hết thời gian chờ người'));
        else await this.finish(r.id, 'failed', new PvError('TIMEOUT', 'Hết thời gian chờ người'));
      }
      for (const [id, a] of this.active) {
        const flow = this.d.loader.get(this.store.run(id)!.flowId)?.flow;
        if (!a.gate && flow && this.d.clock.nowMs() - a.started - a.gateTime > flow.manifest.timeoutMinutes * 60_000) {
          a.cancel = new PvError('TIMEOUT', 'Flow quá thời gian'); await a.page?.close().catch(() => undefined);
        }
      }
      if (this.globalPause) return;
      const settings = this.settings(); const ram = (this.d.freeRamMb ?? (() => os.freemem() / 1048576))();
      const cpuBusy = this.d.cpuBusy?.() ?? this.cpu.busy(this.d.clock.nowMs());
      const busy = this.busyMode || ram < 8192 || cpuBusy;
      const limit = Math.max(0, Math.min(busy ? settings.maxConcurrentBusy : settings.maxConcurrentIdle, Math.floor(ram / settings.ramPerProfileMb)));
      for (const run of this.store.listRuns().filter((r) => ['queued', 'waiting_profile'].includes(r.status))) {
        if (this.stopping || [...this.active.entries()].filter(([id, r]) => r.owned || this.store.run(id)?.status !== 'needs_user').length >= limit) break;
        if (this.active.has(run.id) || [...this.active.keys()].some((id) => this.store.run(id)?.bindingId === run.bindingId)) continue;
        if ((this.retryAt.get(run.id) ?? 0) > this.d.clock.nowMs()) continue;
        if (!await this.preflight(run) || this.stopping || TERMINAL.has(this.store.run(run.id)!.status)) continue;
        const a: ActiveRun = { promise: Promise.resolve(), owned: false, gateTime: 0, started: this.d.clock.nowMs() };
        this.active.set(run.id, a);
        a.promise = this.execute(run.id, a).catch((err: unknown) => this.d.logger.error('Runner execute lỗi', { runId: run.id, error: String(err) })).finally(() => this.active.delete(run.id));
        // Reserve capacity kể cả launch đang chờ Fury.
      }
    } finally { this.ticking = false; }
  }
  private settings() {
    const s = this.d.settings.get<Partial<Config['runner']>>('runner') ?? {};
    return { ...this.d.config.runner, ...s };
  }
  private async preflight(run: RunRecord): Promise<boolean> {
    let health;
    try { health = await this.d.fury.health(); } catch { health = { reachable: false, supported: false }; }
    if (!health.reachable || !health.supported) {
      if (this.d.clock.nowMs() - Date.parse(run.queuedAt) >= 30 * 60_000) await this.finish(run.id, 'failed', new PvError(!health.reachable ? 'FURY_OFFLINE' : 'FURY_VERSION_UNSUPPORTED'));
      else this.retryAt.set(run.id, this.d.clock.nowMs() + 60_000);
      return false;
    }
    const b = this.d.health.getBinding(run.bindingId);
    if (!b || b.archivedAt || this.d.health.listPauses(run.bindingId, { open: true }).length) { await this.finish(run.id, 'cancelled', new PvError('BINDING_PAUSED')); return false; }
    const found = this.d.loader.get(run.flowId);
    const requiredLevel = this.store.job(run.jobId)?.mode === 'L3' ? 3 : found?.flow.manifest.minLevel ?? 1;
    if (b.level === 0 || b.level < requiredLevel) { await this.finish(run.id, 'cancelled', new PvError('LEVEL_TOO_LOW')); return false; }
    try {
      const { flow: preflightFlow } = this.d.loader.assertEnabled(run.flowId, 'version' in health ? health.version : undefined);
      this.assertP4(run.flowId, preflightFlow.manifest.modes);
      if (found?.flow.manifest.version !== run.flowVersion) throw new PvError('FLOW_DISABLED', 'Flow đã đổi phiên bản, cần tạo lượt mới');
      this.d.loader.validateBinding(b.platform, b.packConfig);
    } catch (err) { await this.finish(run.id, 'failed', new PvError('FLOW_DISABLED', String(err))); return false; }
    const status = await this.d.fury.getStatus(b.furyProfileId);
    if (status.open) {
      const since = this.waitingSince.get(run.id) ?? Date.parse(run.queuedAt); this.waitingSince.set(run.id, since);
      if (this.d.clock.nowMs() - since >= this.settings().profileBusyTimeoutMinutes * 60_000) await this.finish(run.id, 'failed', new PvError('PROFILE_BUSY'));
      else { this.status(run.id, 'waiting_profile'); this.retryAt.set(run.id, this.d.clock.nowMs() + 60_000); }
      return false;
    }
    this.retryAt.delete(run.id); return true;
  }
  private status(id: string, status: RunStatus): void {
    const run = this.store.run(id)!;
    this.store.database.sqlite.transaction(() => {
      this.store.patchRun(id, { status });
      this.store.patchJob(run.jobId, { status: status === 'waiting_profile' || status === 'queued' ? 'queued' : status === 'needs_user' ? 'needs_user' : status === 'done' || status === 'failed' || status === 'cancelled' ? status : 'running' });
    })();
    this.d.bus.emit('run.status_changed', { runId: id, jobId: run.jobId, bindingId: run.bindingId, flowId: run.flowId, status, ...(run.currentStep ? { step: run.currentStep } : {}) });
  }
  private async connect(id: string, active: ActiveRun): Promise<void> {
    const run = this.store.run(id)!; const b = this.d.health.getBinding(run.bindingId)!;
    if (TERMINAL.has(run.status)) throw new PvError('CANCELLED');
    if (active.cancel) throw active.cancel;
    const health = await this.d.fury.health();
    if (!health.reachable || !health.supported) throw new PvError(!health.reachable ? 'FURY_OFFLINE' : 'FURY_VERSION_UNSUPPORTED');
    const { flow: beforeLaunch } = this.d.loader.assertEnabled(run.flowId, health.version);
    if (b.level === 0 || b.level < beforeLaunch.manifest.minLevel || this.store.job(run.jobId)?.mode === 'L3' && b.level < 3) throw new PvError('LEVEL_TOO_LOW');
    if (this.d.health.listPauses(b.id, { open: true }).length) throw new PvError('BINDING_PAUSED');
    if ((await this.d.fury.getStatus(b.furyProfileId)).open) throw new PvError('PROFILE_BUSY');
    this.status(id, 'launching');
    // TODO(SPIKE-P4): xác minh vòng đời Fury CDP; connector tiêm cho fixture.
    const launched = await this.d.fury.launch(b.furyProfileId, { cdp: true });
    active.owned = true; active.probeUrl = launched.probeUrl; this.store.patchRun(id, { launchedByRun: true });
    active.browser = await (this.d.connect ?? ((endpoint) => chromium.connectOverCDP(endpoint)))(launched.cdpEndpoint);
    const context = active.browser.contexts()[0]; if (!context) throw new PvError('INTERNAL', 'CDP không có context');
    active.page = await context.newPage(); active.page.setDefaultTimeout(120_000);
    const { flow } = this.d.loader.assertEnabled(run.flowId);
    const sites = sitesFor(run.flowId, flow.manifest.site, this.platformPack(b.platform)?.manifest.generic?.sites);
    await active.page.route('**/*', async (route) => {
      const request = route.request();
      if (request.isNavigationRequest()) {
        try { new SafeUi({ page: active.page!, sites }).assertUrl(request.url()); } catch {
          active.cancel = new PvError('FORBIDDEN_ACTION', 'Điều hướng ra ngoài domain được phép');
          this.d.audit.append({ actorType: 'system', action: 'run.forbidden', targetType: 'run', targetId: id, detail: { reason: 'navigation_domain' } });
          await route.abort('blockedbyclient'); return;
        }
      }
      await route.continue();
    });
    this.status(id, 'running');
  }
  private platformPack(platform: string) { return [...this.d.loader.packs.values()].find((p) => p.manifest.platform === platform); }
  private checkCancelled(active: ActiveRun): void { if (active.cancel) throw active.cancel; }
  private async disconnect(id: string, a: ActiveRun): Promise<void> {
    const b = this.d.health.getBinding(this.store.run(id)!.bindingId);
    await a.page?.close().catch(() => undefined); a.page = undefined;
    // CDP Browser.close ngắt kết nối Playwright; Fury.stop là nơi đóng profile sở hữu.
    await a.browser?.close().catch(() => undefined); a.browser = undefined;
    if (a.owned && b) {
      try {
        await this.d.fury.stop(b.furyProfileId);
        for (let i = 0; i < 15; i++) { if (!(await this.d.fury.getStatus(b.furyProfileId)).open) { a.owned = false; this.store.patchRun(id, { launchedByRun: false }); break; } await (this.d.timers ?? realTimers).sleep(1000); }
        if (a.owned) this.d.logger.warn('Profile chưa đóng sau 15 giây', { runId: id });
      } catch (err) { this.d.logger.warn('Đóng profile lỗi', { runId: id, error: String(err) }); }
    }
  }
  private async execute(id: string, a: ActiveRun): Promise<void> {
    const run = this.store.run(id)!; const job = this.store.job(run.jobId)!;
    const cp = this.store.checkpoint(id); let index = -1; let gateIndex = -1; let finalCount = 0;
    const b = this.d.health.getBinding(run.bindingId)!;
    const { flow, pack } = this.d.loader.assertEnabled(run.flowId);
    const artifactsDir = path.join(this.d.runsDir, id); mkdirSync(artifactsDir, { recursive: true });
    this.store.patchRun(id, { artifactsDir, startedAt: run.startedAt ?? this.d.clock.nowIso() });
    const log = (message: string) => appendFileSync(path.join(artifactsDir, 'log.ndjson'), JSON.stringify({ at: this.d.clock.nowIso(), message }) + '\n');
    const save = () => this.store.saveCheckpoint(id, cp);
    const gate = async (input: HumanGate): Promise<GateResult> => {
      gateIndex++;
      const previous = cp.gateResults[gateIndex];
      if (previous) return previous;
      if (a.cancel) throw new PvError(a.cancel.code, a.cancel.message);
      const g = HumanGateSchema.parse(input); const since = this.d.clock.nowIso();
      const needsUser = { ...g, since, expiresAt: new Date(this.d.clock.nowMs() + this.settings().humanGateTimeoutHours * 3_600_000).toISOString() };
      cp.gateIndex = gateIndex; save();
      this.store.patchRun(id, { needsUserJson: JSON.stringify(needsUser) });
      a.gateSince = this.d.clock.nowMs();
      a.pauseStep?.();
      const answer = new Promise<GateResult>((resolve, reject) => { a.gate = { resolve, reject }; });
      void answer.catch(() => undefined);
      this.status(id, 'needs_user');
      this.d.bus.emit('run.needs_user', { runId: id, bindingId: b.id, gate: g });
      await this.d.health.recordRunOutcome({ bindingId: b.id, runId: id, flowId: run.flowId, mode: job.mode, status: 'needs_user' });
      if (!g.keepProfileOpen) await this.disconnect(id, a);
      const result = await answer;
      a.gate = undefined; a.gateTime += this.d.clock.nowMs() - (a.gateSince ?? this.d.clock.nowMs());
      cp.gateResults[gateIndex] = result; cp.gateIndex = null; save();
      this.store.patchRun(id, { needsUserJson: null });
      if (result.choice === 'cancel') throw new PvError('CANCELLED');
      if (!a.page) await this.connect(id, a); else this.status(id, 'running');
      a.resumeStep?.();
      return result;
    };
    const step = async <T>(name: string, fn: () => Promise<T>, input?: StepOptions): Promise<T> => {
      index++; const seq = index;
      if (cp.stepNames[seq] && cp.stepNames[seq] !== name || cp.stepNames.includes(name) && cp.stepNames[seq] !== name) throw new PvError('INPUT_INVALID', 'Tên bước không duy nhất hoặc flow đã đổi');
      cp.stepNames[seq] = name;
      const opts = StepOptionsSchema.parse(input ?? {});
      if (opts.final && ++finalCount > 1) throw new PvError('INPUT_INVALID', 'Flow có nhiều bước final');
      if (seq <= cp.stepIndex) { gateIndex = cp.stepGateEnds[name] ?? gateIndex; return cp.stepResults[name] as T; }
      if (a.cancel) throw a.cancel;
      if (opts.final && job.mode === 'L2') {
        cp.state.l2Result = await gate({ reason: 'review_before_final', message: 'Kiểm tra và bấm Save trong profile, rồi xác nhận kết quả', choices: [{ id: 'done_correct', label: 'Đúng hết, tôi đã bấm' }, { id: 'done_fixed', label: 'Phải sửa tay rồi mới bấm' }, { id: 'cancel', label: 'Hủy' }], keepProfileOpen: true });
        cp.stepIndex = seq; cp.activeStep = null; cp.stepGateEnds[name] = gateIndex; save();
        this.store.step(id, seq, { name, status: 'skipped', attempts: 0, startedAt: this.d.clock.nowIso(), finishedAt: this.d.clock.nowIso() });
        return undefined as T;
      }
      const retries = opts.idempotent ? opts.retry ?? 1 : 0;
      const startedAt = this.d.clock.nowIso();
      for (let attempt = 0; attempt <= retries; attempt++) {
        cp.activeStep = { index: seq, name, idempotent: opts.idempotent }; save();
        this.store.patchRun(id, { currentStep: name });
        this.store.step(id, seq, { name, status: 'running', attempts: attempt + 1, startedAt }); log(`Bắt đầu bước ${name}, lần ${attempt + 1}`);
        await a.page!.context().tracing.start({ screenshots: true, snapshots: true }).catch(() => undefined);
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          let remaining = opts.timeoutSeconds * 1000;
          let began = Date.now();
          const expiration = new Promise<never>((_, reject) => {
            a.pauseStep = () => { if (timeout) { clearTimeout(timeout); timeout = undefined; remaining -= Date.now() - began; } };
            a.resumeStep = () => {
              began = Date.now();
              timeout = setTimeout(() => { void Promise.resolve(a.page?.screenshot({ path: path.join(artifactsDir, `screenshot-${seq}.png`) }).catch(() => undefined)).then(() => a.page?.close()).finally(() => reject(new PvError('TIMEOUT', 'Bước quá thời gian'))); }, Math.max(1, remaining));
            };
            a.resumeStep();
          });
          const result = await Promise.race([fn(), expiration]);
          this.checkCancelled(a);
          cp.stepResults[name] = result === undefined ? null : result; cp.stepIndex = seq; cp.activeStep = null; cp.stepGateEnds[name] = gateIndex; save();
          this.store.step(id, seq, { name, status: 'done', attempts: attempt + 1, startedAt, finishedAt: this.d.clock.nowIso() });
          const traceAlways = this.d.settings.get<{ traceAlways?: boolean }>('runner')?.traceAlways;
          await a.page!.context().tracing.stop(traceAlways ? { path: path.join(artifactsDir, `trace-${seq}.zip`) } : {}).catch(() => undefined);
          return result;
        } catch (err) {
          const error = a.cancel ?? (err instanceof PvError ? err : new PvError(/locator|selector|timeout/i.test(String(err)) ? 'SITE_CHANGED' : 'INTERNAL', 'Bước không hoàn thành'));
          await a.page?.screenshot({ path: path.join(artifactsDir, `screenshot-${seq}.png`) }).catch(() => undefined);
          await a.page?.context().tracing.stop({ path: path.join(artifactsDir, `trace-${seq}.zip`) }).catch(() => undefined);
          this.store.step(id, seq, { name, status: 'failed', attempts: attempt + 1, startedAt, finishedAt: this.d.clock.nowIso(), errorCode: error.code });
          if (attempt === retries || err instanceof PvError && !isRetryable(error.code) || !a.page || a.page.isClosed()) throw error;
        } finally { if (timeout) clearTimeout(timeout); a.pauseStep = undefined; a.resumeStep = undefined; }
      }
      throw new PvError('INTERNAL');
    };
    try {
      await this.connect(id, a);
      const platform = this.platformPack(b.platform);
      const binding = { ...b, packConfig: { ...b.packConfig, _generic: platform?.manifest.generic } };
      const humanize = this.d.settings.get<{ humanize?: { actionDelayMs: [number, number]; typingDelayMs: [number, number] } }>('runner')?.humanize;
      const context: FlowContext = {
        input: flow.input.parse(this.store.input(run.jobId)), binding, mode: job.mode, state: cp.state,
        get page() { return a.page!; },
        get ui() { return new SafeUi({ page: a.page!, verifiedFiles, sites: sitesFor(run.flowId, flow.manifest.site, platform?.manifest.generic?.sites), forbidden: pack.forbidden, timers: thisTimers, actionDelayMs: humanize?.actionDelayMs, typingDelayMs: humanize?.typingDelayMs, denied: (detail) => audit.append({ actorType: 'system', action: 'run.forbidden', targetType: 'run', targetId: id, detail }) }); },
        step, humanGate: gate,
        get fury() { return { ...(a.probeUrl ? { probeUrl: a.probeUrl } : {}) }; },
        fail: (code, message, detail) => { throw new PvError(code, message, detail); },
        log: (message) => log(message),
        artifact: async (name, data) => { const file = this.artifactPath(id, name); if (!file) throw new PvError('FILE_NOT_ALLOWED'); writeFileSync(file, data); return file; },
      };
      const thisTimers = this.d.timers; const audit = this.d.audit;
      // File được upload: chỉ các file Job service đã kiểm trong input (SPEC-03 §4.2, SPEC-06 §3)
      const verifiedFiles = Object.fromEntries(collectFileRefs(this.store.input(run.jobId)).map((r) => [r.path, r.sha256]));
      let output = flow.output.parse(await flow.run(context));
      if (a.cancel) throw a.cancel;
      if (job.mode === 'L2' && finalCount !== 1) throw new PvError('INPUT_INVALID', 'Flow L2 thiếu bước final');
      if (cp.state.l2Result && typeof cp.state.l2Result === 'object') output = { ...(output as object), l2Review: (cp.state.l2Result as GateResult).choice === 'done_fixed' ? 'fixed' : 'correct' };
      this.status(id, 'finalizing');
      await this.disconnect(id, a);
      await this.finish(id, 'done', undefined, output);
    } catch (err) {
      await this.disconnect(id, a);
      const error = a.cancel ?? (err instanceof PvError ? err : new PvError('INTERNAL', 'Run không hoàn thành'));
      log(`Kết thúc: ${error.code}`);
      await this.finish(id, error.code === 'CANCELLED' || error.code === 'BINDING_PAUSED' ? 'cancelled' : 'failed', error);
    }
  }
  private async finish(id: string, status: 'done' | 'failed' | 'cancelled', error?: PvError, output?: unknown): Promise<void> {
    const run = this.store.run(id)!; if (TERMINAL.has(run.status)) return;
    const job = this.store.job(run.jobId)!;
    this.store.patchRun(id, { finishedAt: this.d.clock.nowIso(), needsUserJson: null, errorCode: error?.code ?? null, errorDetailJson: error?.detail ? JSON.stringify(error.detail) : null });
    this.store.patchJob(job.id, { resultJson: output === undefined ? null : JSON.stringify(output), errorCode: error?.code ?? null, errorDetailJson: error?.detail ? JSON.stringify(error.detail) : null });
    this.status(id, status);
    if (status === 'done' && run.flowId.endsWith('/session-check')) await this.d.health.recordSessionCheck(run.bindingId, { ...SessionCheckOutputSchema.parse(output), runId: id });
    if (status === 'done' && run.flowId === 'generic/probe' && output && typeof output === 'object' && 'raw' in output) {
      // Probe tự động (SPEC-04 §2.3): Health chuẩn hóa + chạy kiểm nhất quán; lỗi định dạng không làm hỏng run
      try { await this.d.health.importProbe(run.bindingId, { raw: (output as { raw: object }).raw }, 'flow'); } catch (err) { this.d.logger.warn('Nhập probe từ flow lỗi', { runId: id, error: String(err) }); }
    }
    if (status !== 'cancelled') await this.d.health.recordRunOutcome({ bindingId: run.bindingId, runId: id, flowId: run.flowId, mode: job.mode, status, errorCode: error?.code, l2Review: output && typeof output === 'object' ? (output as { l2Review?: 'correct' | 'fixed' }).l2Review : undefined, step: run.currentStep ?? undefined });
  }
  async cancelRun(id: string, actor: string): Promise<void> {
    const run = this.store.run(id); if (!run || TERMINAL.has(run.status)) return;
    this.d.audit.append({ actorType: actor === 'user' ? 'user' : 'system', action: 'run.cancel', targetType: 'run', targetId: id });
    const active = this.active.get(id);
    if (active) { active.cancel = new PvError('CANCELLED'); active.gate?.reject(active.cancel); }
    else await this.finish(id, 'cancelled', new PvError('CANCELLED'));
  }
  private async cancelBinding(bindingId: string): Promise<void> { for (const run of this.store.listRuns().filter((r) => r.bindingId === bindingId && !TERMINAL.has(r.status))) await this.cancelRun(run.id, 'system'); }
  async resolveGate(id: string, result: { choice: string; note?: string }, actor: 'user'): Promise<void> {
    if (actor !== 'user') throw new PvError('FORBIDDEN_ACTION');
    const run = this.store.run(id); if (run?.status !== 'needs_user' || !run.needsUser) throw new PvError('INPUT_INVALID', 'Run không chờ người');
    if (!run.needsUser.choices.some((c) => c.id === result.choice)) throw new PvError('INPUT_INVALID', 'Lựa chọn không hợp lệ');
    if (Date.parse(run.needsUser.expiresAt ?? '') <= this.d.clock.nowMs()) throw new PvError('TIMEOUT');
    const answer: GateResult = { ...result, resolvedAt: this.d.clock.nowIso() };
    this.d.audit.append({ actorType: 'user', action: 'run.resolve', targetType: 'run', targetId: id, detail: { choice: result.choice } });
    const active = this.active.get(id); if (active?.gate) { active.gate.resolve(answer); return; }
    if (result.choice === 'cancel') { await this.finish(id, 'cancelled', new PvError('CANCELLED')); return; }
    const cp = this.store.checkpoint(id);
    if (cp.gateIndex !== null) cp.gateResults[cp.gateIndex] = answer;
    else if (cp.activeStep && !cp.activeStep.idempotent) { cp.stepIndex = cp.activeStep.index; cp.stepResults[cp.activeStep.name] = null; cp.activeStep = null; }
    cp.gateIndex = null; this.store.saveCheckpoint(id, cp); this.store.patchRun(id, { needsUserJson: null }); this.status(id, 'queued');
  }
  async recover(): Promise<void> {
    for (const run of this.store.listRuns().filter((r) => !TERMINAL.has(r.status))) {
      const raw = this.store.raw(run.id)!; const b = this.d.health.getBinding(run.bindingId);
      if (raw.launchedByRun && b) { await this.d.fury.stop(b.furyProfileId); this.store.patchRun(run.id, { launchedByRun: false }); }
      if (run.status === 'needs_user' || run.status === 'queued' || run.status === 'waiting_profile') continue;
      const cp = this.store.checkpoint(run.id);
      this.store.patchRun(run.id, { attempt: run.attempt + 1 });
      if (cp.activeStep && !cp.activeStep.idempotent) {
        const gate = { reason: 'custom', message: `Bước ${cp.activeStep.name} bị ngắt. Kiểm tra trên nền tảng trước khi tiếp tục từ bước sau.`, choices: [{ id: 'resume', label: 'Đã kiểm, chạy tiếp từ bước sau' }, { id: 'cancel', label: 'Hủy' }], keepProfileOpen: false, since: this.d.clock.nowIso(), expiresAt: new Date(this.d.clock.nowMs() + this.settings().humanGateTimeoutHours * 3_600_000).toISOString() };
        this.store.patchRun(run.id, { needsUserJson: JSON.stringify(gate), errorCode: 'INTERRUPTED' }); this.status(run.id, 'needs_user');
      } else this.status(run.id, 'queued');
    }
    await this.schedules.recover();
  }
  private pruneArtifacts(): void {
    if (!existsSync(this.d.runsDir)) return;
    for (const entry of readdirSync(this.d.runsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^rn_[0-9A-HJKMNP-TV-Z]{26}$/.test(entry.name)) continue;
      const file = path.resolve(this.d.runsDir, entry.name); const run = this.store.run(entry.name);
      if (file.startsWith(path.resolve(this.d.runsDir) + path.sep) && run && TERMINAL.has(run.status) && this.d.clock.nowMs() - statSync(file).mtimeMs > this.d.config.retention.runArtifactsDays * 86_400_000) rmSync(file, { recursive: true, force: true });
    }
  }
}
