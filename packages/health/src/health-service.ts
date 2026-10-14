import {
  AsnAttestationInputSchema,
  CreateBindingInputSchema,
  DEFAULT_THRESHOLDS,
  DetectSuiteInputSchema,
  MANUAL_EVENT_MAX_BACKDATE_MS,
  ManualEventTypeSchema,
  newId,
  PvError,
  RulePatchSchema,
  RunOutcomeInputSchema,
  SessionCheckOutcomeSchema,
  ThresholdsSchema,
  UpdateBindingInputSchema,
  type AsnAttestationInput,
  type AutomationLevel,
  type Binding,
  type BindingConsistency,
  type ChecklistInput,
  type ChecklistStatus,
  type Clock,
  type Config,
  type ConsistencyRunSummary,
  type ConsistencyTrigger,
  type CreateBindingInput,
  type CrossMatrix,
  type DetectSuiteInput,
  type HealthEventRecord,
  type HealthEventType,
  type HostSnapshot,
  type LevelChange,
  type ManualEventType,
  type Pause,
  type ProbeResult,
  type ProxyCheck,
  type Readiness,
  type RuleConfig,
  type RulePatch,
  type RunOutcomeInput,
  type SessionCheckOutcome,
  type Thresholds,
  type UpdateBindingInput,
} from '@sctech/profilevault-contract';
import type { EventBus, Logger, SecretStore, Seeder } from '@sctech/profilevault-core';
import {
  AsnAttestationsRepo,
  BindingsRepo,
  ChecklistsRepo,
  ConsistencyRulesRepo,
  ConsistencyRunsRepo,
  DetectSuiteRepo,
  HealthEventsRepo,
  HostSnapshotsRepo,
  LevelChangesRepo,
  PausesRepo,
  ProbeResultsRepo,
  ProxyChecksRepo,
  type AsnAttestationRow,
  type AuditRepo,
  type Database,
  type HealthEventFilter,
  type SettingsRepo,
} from '@sctech/profilevault-db';
import type { FuryClient, Timers } from '@sctech/profilevault-fury-client';
import { ChecklistService } from './checklist.js';
import { ConsistencyEngine } from './consistency-engine.js';
import { CONSISTENCY_SETTING, ConsistencySchedule } from './consistency-schedule.js';
import { HostService, type HostCapture } from './host.js';
import { LevelPolicy, type PendingBusEvent } from './level-policy.js';
import { probeDiff, type ProbeChange } from './probe/diff.js';
import { importProbeFile, type ProbeSource } from './probe/import.js';
import type { ProbeConverter } from './probe/converters.js';
import { ProxyCheckService } from './proxy-check.js';
import { ReadinessEvaluator, type ConditionEvaluator } from './readiness.js';
import { defaultRuleConfigs } from './rules/index.js';
import { HealthScheduler } from './scheduler.js';
import { THRESHOLDS_SETTING, thresholdsSeeder } from './seed.js';

export interface HealthService {
  // ---- binding ----
  createBinding(input: CreateBindingInput, actor?: 'user' | 'client'): Promise<Binding>;
  updateBinding(id: string, patch: UpdateBindingInput, actor?: 'user' | 'client'): Promise<Binding>;
  archiveBinding(id: string, actor?: 'user'): Promise<void>;
  getBinding(id: string): Binding | undefined;
  getBindingByProfile(furyProfileId: string): Binding | undefined;
  listBindings(opts?: { includeArchived?: boolean }): Binding[];

  // ---- sự kiện ----
  recordManualEvent(bindingId: string, type: ManualEventType, occurredAt?: string, note?: string, actor?: string): Promise<HealthEventRecord>;
  recordDetectSuite(input: DetectSuiteInput, actor?: 'user'): Promise<void>;
  recordSessionCheck(bindingId: string, outcome: SessionCheckOutcome): Promise<void>;
  recordRunOutcome(input: RunOutcomeInput): Promise<void>;
  recordFuryProfileStatus(profileId: string, open: boolean, at: string): Promise<void>;
  recordFuryVersionChanged(from: string | undefined, to: string | undefined): Promise<void>;
  listEvents(bindingId: string | null | undefined, filter?: Omit<HealthEventFilter, 'bindingId'>): HealthEventRecord[];

  // ---- mức ----
  evaluateReadiness(bindingId: string, opts?: { fresh?: boolean }): Promise<Readiness>;
  promote(bindingId: string, actor: 'user'): Promise<LevelChange>;
  pause(bindingId: string, actor: 'user', note?: string): Promise<Pause>;
  clearPause(pauseId: string, actor: 'user'): Promise<void>;
  listPauses(bindingId: string, opts?: { open?: boolean }): Pause[];
  listLevelChanges(bindingId: string): LevelChange[];
  getThresholds(): Thresholds;
  setThresholds(t: Thresholds, actor: 'user'): void;
  registerConditionEvaluator(kind: 'consistency_clear' | 'checklist_valid', fn: ConditionEvaluator): void;
  onReadinessReached(listener: (bindingId: string, toLevel: AutomationLevel) => void): () => void;

  // ---- proxy ----
  runProxyCheckNow(bindingId: string): Promise<ProxyCheck>;
  listProxyChecks(bindingId: string, limit?: number): ProxyCheck[];
  currentFuryVersion(): string | undefined;

  // ---- nhất quán (SPEC-02 §6) ----
  importProbe(bindingId: string, from: ProbeSource, source: 'manual_import' | 'flow', actor?: 'user' | 'client'): Promise<ProbeResult>;
  listProbes(bindingId: string, limit?: number): ProbeResult[];
  compareLatestProbes(bindingId: string): { latest: ProbeResult; previous: ProbeResult; changes: ProbeChange[] } | undefined;
  upsertChecklist(bindingId: string, input: ChecklistInput, actor?: 'user' | 'client'): Promise<ChecklistStatus>;
  confirmChecklist(bindingId: string, actor: 'user'): Promise<ChecklistStatus>;
  getChecklist(bindingId: string): ChecklistStatus;
  listChecklistExpiring(days?: number): ChecklistStatus[];
  attestAsn(input: AsnAttestationInput, actor: 'user'): Promise<void>;
  listAsnAttestations(): AsnAttestationRow[];
  runConsistency(scope: { bindingId?: string }, trigger?: ConsistencyTrigger, actor?: 'user' | 'client' | 'system'): Promise<ConsistencyRunSummary>;
  getConsistency(bindingId: string): (BindingConsistency & { runId: string; trigger: string; finishedAt: string | null }) | undefined;
  getCrossMatrix(): Promise<CrossMatrix>;
  getRules(): RuleConfig[];
  setRule(id: string, patch: RulePatch, actor: 'user'): RuleConfig;
  latestHost(): HostSnapshot | undefined;
  captureHost(): Promise<HostSnapshot>;

  // ---- vòng đời ----
  start(): void;
  stop(): void;
}

export interface HealthDeps {
  database: Database;
  bus: EventBus;
  clock: Clock;
  timers?: Timers;
  fury: FuryClient;
  logger: Logger;
  config: Config;
  audit: AuditRepo;
  settings: SettingsRepo;
  secrets: SecretStore;
  /** Thư mục lưu file probe gốc (`paths.probesDir`). */
  probesDir: string;
  /** Hàm chụp host (host-info); mặc định trả snapshot tối thiểu từ `os`. */
  captureHost?: HostCapture;
  probeConverters?: ProbeConverter[];
  schedulerSeed?: number;
  /** Fury có đang reachable không (từ poller); mặc định theo `fury.status_changed`. */
  isFuryReachable?: () => boolean;
}

export interface HealthBundle {
  health: HealthService;
  policy: LevelPolicy;
  proxy: ProxyCheckService;
  scheduler: HealthScheduler;
  consistencySchedule: ConsistencySchedule;
  readiness: ReadinessEvaluator;
  engine: ConsistencyEngine;
  checklist: ChecklistService;
  hostService: HostService;
  thresholdsSeeder: Seeder;
  rulesSeeder: Seeder;
  repos: {
    bindings: BindingsRepo;
    events: HealthEventsRepo;
    pauses: PausesRepo;
    levelChanges: LevelChangesRepo;
    proxyChecks: ProxyChecksRepo;
    detectSuite: DetectSuiteRepo;
    probes: ProbeResultsRepo;
    checklists: ChecklistsRepo;
    hosts: HostSnapshotsRepo;
    rules: ConsistencyRulesRepo;
    runs: ConsistencyRunsRepo;
    attestations: AsnAttestationsRepo;
  };
}

const SESSION_STATE_TO_TYPE: Record<SessionCheckOutcome['state'], HealthEventType> = {
  logged_in: 'session_check.ok',
  logged_out: 'session_check.logged_out',
  wrong_account: 'session_check.wrong_account',
  challenge: 'run.challenge',
  failed: 'session_check.failed',
  unknown: 'session_check.failed',
};

function issues(err: { issues: { path: PropertyKey[]; message: string }[] }): { path: string; message: string }[] {
  return err.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
}

async function defaultCaptureHost(): Promise<HostSnapshot> {
  const os = await import('node:os');
  return { os: process.platform === 'win32' ? 'windows' : process.platform, osVersion: os.release(), gpus: [], displays: [], ramMb: Math.round(os.totalmem() / 1048576), capturedAt: new Date().toISOString() };
}

export function createHealth(d: HealthDeps): HealthBundle {
  const db = d.database.db;
  const repos = {
    bindings: new BindingsRepo(db),
    events: new HealthEventsRepo(db),
    pauses: new PausesRepo(db),
    levelChanges: new LevelChangesRepo(db),
    proxyChecks: new ProxyChecksRepo(db),
    detectSuite: new DetectSuiteRepo(db),
    probes: new ProbeResultsRepo(db),
    checklists: new ChecklistsRepo(db),
    hosts: new HostSnapshotsRepo(db),
    rules: new ConsistencyRulesRepo(db),
    runs: new ConsistencyRunsRepo(db),
    attestations: new AsnAttestationsRepo(db),
  };
  const policy = new LevelPolicy({ database: d.database, clock: d.clock, bindings: repos.bindings, events: repos.events, pauses: repos.pauses, levelChanges: repos.levelChanges, detectSuite: repos.detectSuite, settings: d.settings, audit: d.audit, logger: d.logger });
  const getThresholds = (): Thresholds => d.settings.get(THRESHOLDS_SETTING, ThresholdsSchema) ?? DEFAULT_THRESHOLDS;
  const readiness = new ReadinessEvaluator({
    clock: d.clock,
    bindings: repos.bindings,
    events: repos.events,
    pauses: repos.pauses,
    detectSuite: repos.detectSuite,
    getThresholds,
    currentFuryVersion: () => policy.currentFuryVersion(),
  });
  policy.onChanged = (id) => readiness.invalidate(id);
  const proxy = new ProxyCheckService({ fury: d.fury, clock: d.clock, bindings: repos.bindings, proxyChecks: repos.proxyChecks, policy, logger: d.logger });
  const checklist = new ChecklistService({ repo: repos.checklists, secrets: d.secrets, clock: d.clock, audit: d.audit });
  const hostService = new HostService(repos.hosts, d.captureHost ?? defaultCaptureHost, d.clock);
  const engine = new ConsistencyEngine({
    clock: d.clock,
    fury: d.fury,
    logger: d.logger,
    bindings: repos.bindings,
    proxyChecks: repos.proxyChecks,
    probes: repos.probes,
    checklists: repos.checklists,
    hosts: repos.hosts,
    rules: repos.rules,
    runs: repos.runs,
    attestations: repos.attestations,
    policy,
  });

  // evaluator §6 cho ngưỡng (SPEC-02 §3.2)
  readiness.register('consistency_clear', ({ binding, condition }) => {
    const maxAge = condition.kind === 'consistency_clear' ? condition.maxAgeHours : 24;
    const r = engine.isClear(binding.id, maxAge);
    return { condition, met: r.clear, current: r.current, required: `mọi luật chặn đạt trong ${maxAge} giờ` };
  });
  readiness.register('checklist_valid', ({ binding, condition }) => {
    const s = checklist.status(binding.id);
    const current = !s.complete ? `thiếu ${s.missing.join(', ')}` : s.expired ? 'hết hạn/chưa xác nhận' : `còn hạn tới ${s.expiresAt}`;
    return { condition, met: s.complete && !s.expired, current, required: 'đủ trường, còn hạn' };
  });

  const flush = (bus: PendingBusEvent[]): void => {
    for (const e of bus) {
      try {
        d.bus.emit(e.name, e.payload);
      } catch (err) {
        d.logger.error('phát sự kiện bus lỗi', { event: e.name, err: err instanceof Error ? err.message : String(err) });
      }
    }
  };

  const mustGet = (bindingId: string): Binding => {
    const b = repos.bindings.get(bindingId);
    if (!b) throw new PvError('ACCOUNT_NOT_BOUND', 'Không có binding', { bindingId });
    return b;
  };

  const runCheck = async (scope: { bindingId?: string }, trigger: ConsistencyTrigger): Promise<ConsistencyRunSummary> => {
    const { summary, bus } = await engine.run(scope, trigger);
    flush(bus);
    return summary;
  };
  const safeCheck = async (scope: { bindingId?: string }, trigger: ConsistencyTrigger): Promise<void> => {
    try {
      await runCheck(scope, trigger);
    } catch (err) {
      d.logger.warn('kiểm nhất quán lỗi', { trigger, err: err instanceof Error ? err.message : String(err) });
    }
  };

  let furyReachable = false;
  const scheduler = new HealthScheduler({
    clock: d.clock,
    timers: d.timers,
    timezone: d.config.ui.timezone,
    listBindingIds: () => repos.bindings.list().map((b) => b.id),
    runCheck: async (id) => {
      await health.runProxyCheckNow(id);
    },
    isFuryReachable: d.isFuryReachable ?? (() => furyReachable),
    onMissedStreak: (id, streak) => {
      const { bus } = policy.transact(() => policy.recordEvent(id, 'proxy.check_failed', { error: 'FURY_OFFLINE', missedStreak: streak }));
      flush(bus);
    },
    logger: d.logger,
    seed: d.schedulerSeed,
  });
  const consistencySchedule = new ConsistencySchedule({
    clock: d.clock,
    timers: d.timers,
    timezone: d.config.ui.timezone,
    settings: d.settings,
    logger: d.logger,
    seed: d.schedulerSeed,
    runPeriodic: () => safeCheck({}, 'periodic'),
    runChecklistExpiry: async () => {
      for (const s of checklist.expiredToday()) await safeCheck({ bindingId: s.bindingId }, 'checklist_expired');
    },
    captureHost: async () => {
      await hostService.captureAndStore();
    },
  });
  d.bus.on('fury.status_changed', (p) => {
    furyReachable = p.reachable;
  });

  const rulesSeeder: Seeder = (ctx) => {
    const now = ctx.clock.nowIso();
    if (repos.rules.count() === 0) for (const r of defaultRuleConfigs(now)) repos.rules.upsert(r);
    if (!ctx.settings.has(CONSISTENCY_SETTING)) ctx.settings.set(CONSISTENCY_SETTING, { periodicDays: 7 }, 'system');
  };

  const health: HealthService = {
    // ---------------- binding ----------------
    async createBinding(input, actor = 'user') {
      const parsed = CreateBindingInputSchema.safeParse(input);
      if (!parsed.success) throw new PvError('INPUT_INVALID', 'Dữ liệu binding sai', { issues: issues(parsed.error) });
      const v = parsed.data;
      if (repos.bindings.getByProfile(v.furyProfileId)) throw new PvError('INPUT_INVALID', 'Profile Fury đã được gắn với kênh khác', { field: 'furyProfileId' });
      if (repos.bindings.getByAccount(v.platform, v.accountId)) throw new PvError('INPUT_INVALID', 'Tài khoản đã được gắn', { field: 'accountId' });
      const packConfig: Record<string, unknown> = { ...v.packConfig };
      try {
        const profile = await d.fury.getProfile(v.furyProfileId);
        if (profile.personaId !== undefined) packConfig._personaAtBind = profile.personaId;
      } catch (err) {
        if (err instanceof PvError && err.code === 'INPUT_INVALID') throw new PvError('INPUT_INVALID', `Profile Fury "${v.furyProfileId}" không tồn tại`, { field: 'furyProfileId' });
        d.logger.warn('không đọc được profile Fury khi tạo binding (Fury offline?)', { furyProfileId: v.furyProfileId });
      }
      const now = d.clock.nowIso();
      const binding: Binding = {
        id: newId('binding', d.clock.nowMs()),
        platform: v.platform,
        accountId: v.accountId,
        displayName: v.displayName,
        furyProfileId: v.furyProfileId,
        marketCountry: v.marketCountry,
        packConfig,
        allowedRoots: v.allowedRoots,
        level: 0,
        levelSince: now,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
      };
      policy.transact(() => {
        repos.bindings.insert(binding);
        d.audit.append({ actorType: actor, action: 'binding.create', targetType: 'binding', targetId: binding.id, detail: { platform: v.platform, accountId: v.accountId, furyProfileId: v.furyProfileId } });
      });
      await safeCheck({ bindingId: binding.id }, 'binding_created');
      return binding;
    },

    async updateBinding(id, patch, actor = 'user') {
      const parsed = UpdateBindingInputSchema.safeParse(patch);
      if (!parsed.success) throw new PvError('INPUT_INVALID', 'Dữ liệu binding sai', { issues: issues(parsed.error) });
      const b = mustGet(id);
      if (b.archivedAt) throw new PvError('INPUT_INVALID', 'Binding đã lưu trữ', { bindingId: id });
      const p = parsed.data;
      let personaAtBind = b.packConfig._personaAtBind;
      if (personaAtBind === undefined) {
        try {
          personaAtBind = (await d.fury.getProfile(b.furyProfileId)).personaId;
        } catch {
          /* Fury offline: giữ undefined */
        }
      }
      let packConfig: Record<string, unknown> | undefined;
      if (p.packConfig !== undefined) packConfig = { ...p.packConfig, ...(personaAtBind !== undefined ? { _personaAtBind: personaAtBind } : {}) };
      else if (personaAtBind !== undefined && b.packConfig._personaAtBind === undefined) packConfig = { ...b.packConfig, _personaAtBind: personaAtBind };
      policy.transact(() => {
        repos.bindings.update(id, { ...p, ...(packConfig ? { packConfig } : {}) }, d.clock.nowIso());
        d.audit.append({ actorType: actor, action: 'binding.update', targetType: 'binding', targetId: id, detail: { fields: Object.keys(p) } });
      });
      readiness.invalidate(id);
      await safeCheck({ bindingId: id }, 'binding_updated');
      return mustGet(id);
    },

    async archiveBinding(id, actor = 'user') {
      const b = mustGet(id);
      if (b.archivedAt) return;
      policy.transact(() => {
        repos.bindings.archive(id, d.clock.nowIso());
        d.audit.append({ actorType: actor, action: 'binding.archive', targetType: 'binding', targetId: id });
      });
      readiness.invalidate(id);
    },

    getBinding: (id) => repos.bindings.get(id),
    getBindingByProfile: (pid) => repos.bindings.getByProfile(pid),
    listBindings: (opts) => repos.bindings.list(opts),

    // ---------------- sự kiện ----------------
    async recordManualEvent(bindingId, type, occurredAt, note, actor = 'user') {
      if (!ManualEventTypeSchema.safeParse(type).success) throw new PvError('INPUT_INVALID', 'Loại sự kiện tay không hợp lệ', { type });
      const b = mustGet(bindingId);
      const nowMs = d.clock.nowMs();
      let at = d.clock.nowIso();
      if (occurredAt !== undefined) {
        const t = Date.parse(occurredAt);
        if (Number.isNaN(t)) throw new PvError('INPUT_INVALID', 'occurredAt không phải ISO 8601', { occurredAt });
        if (nowMs - t > MANUAL_EVENT_MAX_BACKDATE_MS) throw new PvError('INPUT_INVALID', 'Chỉ được khai lùi tối đa 7 ngày', { occurredAt });
        if (t - nowMs > 5 * 60_000) throw new PvError('INPUT_INVALID', 'occurredAt ở tương lai', { occurredAt });
        at = new Date(t).toISOString();
      }
      const { result, bus } = policy.transact(() => {
        const ev = policy.recordEvent(b.id, type, note ? { note } : {}, { occurredAt: at });
        if (ev.severity === 'red') policy.applyRedEvent(b, ev.id);
        d.audit.append({ actorType: actor === 'user' ? 'user' : 'client', action: 'event.manual', targetType: 'binding', targetId: b.id, detail: { type, eventId: ev.id } });
        return ev;
      });
      flush(bus);
      return result;
    },

    async recordDetectSuite(input, actor = 'user') {
      const parsed = DetectSuiteInputSchema.safeParse(input);
      if (!parsed.success) throw new PvError('INPUT_INVALID', 'Dữ liệu detect-suite sai', { issues: issues(parsed.error) });
      const v = parsed.data;
      if (v.bindingId) mustGet(v.bindingId);
      const { bus } = policy.transact(() => {
        repos.detectSuite.insert({ furyVersion: v.furyVersion, bindingId: v.bindingId ?? null, passed: v.passed, summary: v.summary ?? null, recordedAt: d.clock.nowIso() });
        policy.recordEvent(v.bindingId ?? null, 'detect_suite.recorded', { furyVersion: v.furyVersion, passed: v.passed, summary: v.summary ?? null }, { severity: v.passed ? 'info' : 'red' });
        policy.applyDetectSuite(v.furyVersion, v.passed, v.bindingId);
        d.audit.append({ actorType: actor, action: 'detect_suite.record', targetType: v.bindingId ? 'binding' : null, targetId: v.bindingId ?? null, detail: { furyVersion: v.furyVersion, passed: v.passed } });
        if (!v.bindingId) readiness.invalidate();
      });
      flush(bus);
    },

    async recordSessionCheck(bindingId, outcome) {
      const parsed = SessionCheckOutcomeSchema.safeParse(outcome);
      if (!parsed.success) throw new PvError('INPUT_INVALID', 'Kết quả session-check sai', { issues: issues(parsed.error) });
      const o = parsed.data;
      const b = mustGet(bindingId);
      const type = SESSION_STATE_TO_TYPE[o.state];
      const payload: Record<string, unknown> = { state: o.state };
      if (o.runId) payload.runId = o.runId;
      if (o.channelId) payload.channelId = o.channelId;
      if (o.studioLanguage) payload.studioLanguage = o.studioLanguage;
      if (o.studioLanguageOk !== undefined) payload.studioLanguageOk = o.studioLanguageOk;
      if (o.error) payload.error = o.error;
      const { bus } = policy.transact(() => {
        const severity = type === 'session_check.ok' && o.studioLanguageOk === false ? 'warn' : undefined;
        const ev = policy.recordEvent(b.id, type, payload, { occurredAt: o.occurredAt, ...(severity ? { severity } : {}) });
        if (ev.severity === 'red') policy.applyRedEvent(b, ev.id);
      });
      flush(bus);
    },

    async recordRunOutcome(input) {
      const parsed = RunOutcomeInputSchema.safeParse(input);
      if (!parsed.success) throw new PvError('INPUT_INVALID', 'Kết quả run sai', { issues: issues(parsed.error) });
      const r = parsed.data;
      const b = mustGet(r.bindingId);
      const payload: Record<string, unknown> = { runId: r.runId, flowId: r.flowId, mode: r.mode ?? null };
      if (r.errorCode) payload.errorCode = r.errorCode;
      if (r.l2Review) payload.l2Review = r.l2Review;
      if (r.step) payload.step = r.step;
      const type: HealthEventType = r.status === 'done' ? 'run.done' : r.status === 'failed' ? 'run.failed' : 'run.needs_user';
      const { bus } = policy.transact(() => {
        policy.recordEvent(b.id, type, payload, { occurredAt: r.occurredAt });
        if (r.errorCode === 'CHALLENGE') {
          const ev = policy.recordEvent(b.id, 'run.challenge', { runId: r.runId, flowId: r.flowId, step: r.step ?? null }, { occurredAt: r.occurredAt });
          policy.applyRedEvent(b, ev.id);
        }
        if (r.errorCode === 'SITE_CHANGED') {
          policy.recordEvent(b.id, 'flow.site_changed', { runId: r.runId, flowId: r.flowId, step: r.step ?? null }, { occurredAt: r.occurredAt });
          policy.applySiteChanged(b, r.flowId);
        }
      });
      flush(bus);
    },

    async recordFuryProfileStatus(profileId, open, at) {
      const b = repos.bindings.getByProfile(profileId);
      if (!b || b.archivedAt) return;
      const { bus } = policy.transact(() => policy.recordEvent(b.id, open ? 'fury.profile_opened' : 'fury.profile_closed', { profileId }, { occurredAt: at }));
      flush(bus);
    },

    async recordFuryVersionChanged(from, to) {
      const { bus } = policy.transact(() => {
        policy.recordEvent(null, 'fury.version_changed', { from: from ?? null, to: to ?? null });
        policy.applyFuryVersionChanged(to);
        readiness.invalidate();
      });
      flush(bus);
      await safeCheck({}, 'fury_version_changed');
    },

    listEvents: (bindingId, filter = {}) => repos.events.list({ ...filter, ...(bindingId === undefined ? {} : { bindingId }) }),

    // ---------------- mức ----------------
    evaluateReadiness: (bindingId, opts) => readiness.evaluate(mustGet(bindingId), opts),

    async promote(bindingId, actor) {
      if (actor !== 'user') throw new PvError('FORBIDDEN_ACTION', 'Chỉ người vận hành lên mức trên dashboard');
      const b = mustGet(bindingId);
      if (b.archivedAt) throw new PvError('INPUT_INVALID', 'Binding đã lưu trữ', { bindingId });
      if (b.level >= 3) throw new PvError('INPUT_INVALID', 'Binding đã ở L3', { bindingId });
      await safeCheck({ bindingId }, 'before_promote');
      const fresh = mustGet(bindingId);
      const r = await readiness.evaluate(fresh, { fresh: true });
      if (r.openPauses.length > 0) throw new PvError('BINDING_PAUSED', 'Binding đang bị dừng', { bindingId, pauses: r.openPauses.map((p) => p.reason) });
      if (!r.canPromote) {
        const missing = r.conditions.filter((c) => !c.met).map((c) => c.condition.kind);
        throw new PvError('INPUT_INVALID', 'Chưa đạt ngưỡng lên mức', { bindingId, missing });
      }
      const { result, bus } = policy.transact(() => policy.promote(fresh, 'threshold_met', { conditions: r.conditions.map((c) => c.condition.kind) }));
      flush(bus);
      return result;
    },

    async pause(bindingId, actor, note) {
      if (actor !== 'user') throw new PvError('FORBIDDEN_ACTION', 'Chỉ người vận hành tạm dừng');
      const b = mustGet(bindingId);
      const { result, bus } = policy.transact(() => policy.manualPause(b, note));
      flush(bus);
      return result;
    },

    async clearPause(pauseId, actor) {
      if (actor !== 'user') throw new PvError('FORBIDDEN_ACTION', 'Chỉ người vận hành gỡ dừng');
      const { bus } = policy.transact(() => policy.userClearPause(pauseId));
      flush(bus);
    },

    listPauses: (bindingId, opts) => repos.pauses.list(bindingId, opts),
    listLevelChanges: (bindingId) => repos.levelChanges.list(bindingId),

    getThresholds,
    setThresholds(t, actor) {
      if (actor !== 'user') throw new PvError('FORBIDDEN_ACTION', 'Chỉ người vận hành sửa ngưỡng');
      const parsed = ThresholdsSchema.safeParse(t);
      if (!parsed.success) throw new PvError('INPUT_INVALID', 'Ngưỡng sai', { issues: issues(parsed.error) });
      policy.transact(() => {
        d.settings.set(THRESHOLDS_SETTING, parsed.data, 'user');
        d.audit.append({ actorType: 'user', action: 'settings.thresholds', detail: { keys: Object.keys(parsed.data) } });
      });
      readiness.invalidate();
    },
    registerConditionEvaluator: (kind, fn) => {
      readiness.register(kind, fn);
      readiness.invalidate();
    },
    onReadinessReached: (l) => readiness.onReached(l),

    // ---------------- proxy ----------------
    async runProxyCheckNow(bindingId) {
      const { check, bus } = await proxy.check(bindingId);
      flush(bus);
      await safeCheck({ bindingId }, 'proxy_checked');
      return check;
    },
    listProxyChecks: (bindingId, limit) => repos.proxyChecks.list(bindingId, limit),
    currentFuryVersion: () => policy.currentFuryVersion(),

    // ---------------- nhất quán ----------------
    async importProbe(bindingId, from, source, actor = 'user') {
      const b = mustGet(bindingId);
      if (b.archivedAt) throw new PvError('INPUT_INVALID', 'Binding đã lưu trữ', { bindingId });
      const { result, bus } = policy.transact(() => {
        const pr = importProbeFile({ repo: repos.probes, clock: d.clock, probesDir: d.probesDir, converters: d.probeConverters }, b.id, from, source);
        policy.recordEvent(b.id, 'probe.imported', { probeId: pr.id, furyVersion: pr.furyVersion, source });
        d.audit.append({ actorType: actor === 'user' ? 'user' : 'client', action: 'probe.import', targetType: 'binding', targetId: b.id, detail: { probeId: pr.id, furyVersion: pr.furyVersion, source } });
        return pr;
      });
      flush(bus);
      await safeCheck({ bindingId: b.id }, 'probe_imported');
      return result;
    },
    listProbes: (bindingId, limit) => repos.probes.list(bindingId, limit),
    compareLatestProbes(bindingId) {
      const [latest, previous] = repos.probes.latestTwo(bindingId);
      if (!latest || !previous) return undefined;
      return { latest, previous, changes: probeDiff(previous.data, latest.data) };
    },

    async upsertChecklist(bindingId, input, actor = 'user') {
      mustGet(bindingId);
      const status = await checklist.upsert(bindingId, input, actor);
      readiness.invalidate(bindingId);
      await safeCheck({ bindingId }, 'checklist_changed');
      return status;
    },
    async confirmChecklist(bindingId, actor) {
      if (actor !== 'user') throw new PvError('FORBIDDEN_ACTION', 'Chỉ người vận hành xác nhận checklist');
      mustGet(bindingId);
      const status = checklist.confirm(bindingId, 'user');
      readiness.invalidate(bindingId);
      await safeCheck({ bindingId }, 'checklist_changed');
      return status;
    },
    getChecklist: (bindingId) => checklist.status(bindingId),
    listChecklistExpiring: (days = 7) => checklist.expiring(days),

    async attestAsn(input, actor) {
      if (actor !== 'user') throw new PvError('FORBIDDEN_ACTION', 'Chỉ người vận hành xác nhận ASN');
      const parsed = AsnAttestationInputSchema.safeParse(input);
      if (!parsed.success) throw new PvError('INPUT_INVALID', 'Dữ liệu ASN sai', { issues: issues(parsed.error) });
      const v = parsed.data;
      policy.transact(() => {
        repos.attestations.upsert({ asn: v.asn, asnType: v.asnType, note: v.note ?? null, createdAt: d.clock.nowIso() });
        d.audit.append({ actorType: 'user', action: 'asn.attest', detail: { asn: v.asn, asnType: v.asnType } });
      });
      const affected = repos.proxyChecks.latestOkPerBinding().filter((c) => c.asn === v.asn).map((c) => c.bindingId);
      for (const id of affected) await safeCheck({ bindingId: id }, 'asn_attested');
    },
    listAsnAttestations: () => repos.attestations.list(),

    async runConsistency(scope, trigger = 'manual', actor = 'user') {
      if (scope.bindingId) mustGet(scope.bindingId);
      const summary = await runCheck(scope, trigger);
      if (trigger === 'manual') d.audit.append({ actorType: actor, action: 'consistency.run', targetType: scope.bindingId ? 'binding' : null, targetId: scope.bindingId ?? null, detail: { runId: summary.runId } });
      return summary;
    },
    getConsistency: (bindingId) => engine.latest(bindingId),
    getCrossMatrix: () => engine.crossMatrix(),
    getRules: () => [...engine.ruleConfigs().values()],
    setRule(id, patch, actor) {
      if (actor !== 'user') throw new PvError('FORBIDDEN_ACTION', 'Chỉ người vận hành sửa luật');
      const parsed = RulePatchSchema.safeParse(patch);
      if (!parsed.success) throw new PvError('INPUT_INVALID', 'Dữ liệu luật sai', { issues: issues(parsed.error) });
      const current = engine.ruleConfigs().get(id);
      if (!current) throw new PvError('INPUT_INVALID', `Không có luật ${id}`, { ruleId: id });
      const next: RuleConfig = { ...current, ...parsed.data, params: parsed.data.params ?? current.params, updatedAt: d.clock.nowIso() };
      policy.transact(() => {
        repos.rules.upsert(next);
        d.settings.set(`consistency_rule:${id}`, { severity: next.severity, enabled: next.enabled, params: next.params }, 'user');
        d.audit.append({ actorType: 'user', action: 'consistency.rule.update', targetType: 'rule', targetId: id, detail: parsed.data });
      });
      readiness.invalidate();
      return next;
    },
    latestHost: () => hostService.latest(),
    captureHost: () => hostService.captureAndStore(),

    start: () => {
      scheduler.start();
      consistencySchedule.start();
      void consistencySchedule.tick().catch(() => undefined);
    },
    stop: () => {
      scheduler.stop();
      consistencySchedule.stop();
    },
  };

  return { health, policy, proxy, scheduler, consistencySchedule, readiness, engine, checklist, hostService, thresholdsSeeder, rulesSeeder, repos };
}
