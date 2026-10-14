import {
  CreateBindingInputSchema,
  DEFAULT_THRESHOLDS,
  DetectSuiteInputSchema,
  MANUAL_EVENT_MAX_BACKDATE_MS,
  ManualEventTypeSchema,
  newId,
  PvError,
  RunOutcomeInputSchema,
  SessionCheckOutcomeSchema,
  ThresholdsSchema,
  UpdateBindingInputSchema,
  type AutomationLevel,
  type Binding,
  type Clock,
  type Config,
  type CreateBindingInput,
  type DetectSuiteInput,
  type HealthEventRecord,
  type HealthEventType,
  type LevelChange,
  type ManualEventType,
  type Pause,
  type ProxyCheck,
  type Readiness,
  type RunOutcomeInput,
  type SessionCheckOutcome,
  type Thresholds,
  type UpdateBindingInput,
} from '@sctech/profilevault-contract';
import type { EventBus, Logger, Seeder } from '@sctech/profilevault-core';
import {
  BindingsRepo,
  DetectSuiteRepo,
  HealthEventsRepo,
  LevelChangesRepo,
  PausesRepo,
  ProxyChecksRepo,
  type AuditRepo,
  type Database,
  type HealthEventFilter,
  type SettingsRepo,
} from '@sctech/profilevault-db';
import type { FuryClient, Timers } from '@sctech/profilevault-fury-client';
import { LevelPolicy, type PendingBusEvent } from './level-policy.js';
import { ProxyCheckService } from './proxy-check.js';
import { ReadinessEvaluator, type ConditionEvaluator } from './readiness.js';
import { HealthScheduler } from './scheduler.js';
import { THRESHOLDS_SETTING, thresholdsSeeder } from './seed.js';

export interface HealthService {
  createBinding(input: CreateBindingInput, actor?: 'user' | 'client'): Promise<Binding>;
  updateBinding(id: string, patch: UpdateBindingInput, actor?: 'user' | 'client'): Promise<Binding>;
  archiveBinding(id: string, actor?: 'user'): Promise<void>;
  getBinding(id: string): Binding | undefined;
  getBindingByProfile(furyProfileId: string): Binding | undefined;
  listBindings(opts?: { includeArchived?: boolean }): Binding[];

  recordManualEvent(bindingId: string, type: ManualEventType, occurredAt?: string, note?: string, actor?: string): Promise<HealthEventRecord>;
  recordDetectSuite(input: DetectSuiteInput, actor?: 'user'): Promise<void>;
  recordSessionCheck(bindingId: string, outcome: SessionCheckOutcome): Promise<void>;
  recordRunOutcome(input: RunOutcomeInput): Promise<void>;
  recordFuryProfileStatus(profileId: string, open: boolean, at: string): Promise<void>;
  recordFuryVersionChanged(from: string | undefined, to: string | undefined): Promise<void>;
  listEvents(bindingId: string | null | undefined, filter?: Omit<HealthEventFilter, 'bindingId'>): HealthEventRecord[];

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

  runProxyCheckNow(bindingId: string): Promise<ProxyCheck>;
  listProxyChecks(bindingId: string, limit?: number): ProxyCheck[];
  currentFuryVersion(): string | undefined;

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
  schedulerSeed?: number;
  /** Fury có đang reachable không (từ poller); mặc định hỏi `fury.health()` mỗi tick. */
  isFuryReachable?: () => boolean;
}

export interface HealthBundle {
  health: HealthService;
  policy: LevelPolicy;
  proxy: ProxyCheckService;
  scheduler: HealthScheduler;
  readiness: ReadinessEvaluator;
  thresholdsSeeder: Seeder;
  repos: {
    bindings: BindingsRepo;
    events: HealthEventsRepo;
    pauses: PausesRepo;
    levelChanges: LevelChangesRepo;
    proxyChecks: ProxyChecksRepo;
    detectSuite: DetectSuiteRepo;
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

export function createHealth(d: HealthDeps): HealthBundle {
  const db = d.database.db;
  const repos = {
    bindings: new BindingsRepo(db),
    events: new HealthEventsRepo(db),
    pauses: new PausesRepo(db),
    levelChanges: new LevelChangesRepo(db),
    proxyChecks: new ProxyChecksRepo(db),
    detectSuite: new DetectSuiteRepo(db),
  };
  const policy = new LevelPolicy({ database: d.database, clock: d.clock, ...repos, settings: d.settings, audit: d.audit, logger: d.logger });
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
  d.bus.on('fury.status_changed', (p) => {
    furyReachable = p.reachable;
  });

  const health: HealthService = {
    async createBinding(input, actor = 'user') {
      const parsed = CreateBindingInputSchema.safeParse(input);
      if (!parsed.success) throw new PvError('INPUT_INVALID', 'Dữ liệu binding sai', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
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
      return binding;
    },

    async updateBinding(id, patch, actor = 'user') {
      const parsed = UpdateBindingInputSchema.safeParse(patch);
      if (!parsed.success) throw new PvError('INPUT_INVALID', 'Dữ liệu binding sai', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
      const b = mustGet(id);
      if (b.archivedAt) throw new PvError('INPUT_INVALID', 'Binding đã lưu trữ', { bindingId: id });
      const p = parsed.data;
      const packConfig = p.packConfig !== undefined ? { ...p.packConfig, ...(b.packConfig._personaAtBind !== undefined ? { _personaAtBind: b.packConfig._personaAtBind } : {}) } : undefined;
      policy.transact(() => {
        repos.bindings.update(id, { ...p, ...(packConfig ? { packConfig } : {}) }, d.clock.nowIso());
        d.audit.append({ actorType: actor, action: 'binding.update', targetType: 'binding', targetId: id, detail: { fields: Object.keys(p) } });
      });
      readiness.invalidate(id);
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
      if (!parsed.success) throw new PvError('INPUT_INVALID', 'Dữ liệu detect-suite sai', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
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
      if (!parsed.success) throw new PvError('INPUT_INVALID', 'Kết quả session-check sai', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
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
      if (!parsed.success) throw new PvError('INPUT_INVALID', 'Kết quả run sai', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
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
    },

    listEvents: (bindingId, filter = {}) => repos.events.list({ ...filter, ...(bindingId === undefined ? {} : { bindingId }) }),

    evaluateReadiness: (bindingId, opts) => readiness.evaluate(mustGet(bindingId), opts),

    async promote(bindingId, actor) {
      if (actor !== 'user') throw new PvError('FORBIDDEN_ACTION', 'Chỉ người vận hành lên mức trên dashboard');
      const b = mustGet(bindingId);
      if (b.archivedAt) throw new PvError('INPUT_INVALID', 'Binding đã lưu trữ', { bindingId });
      if (b.level >= 3) throw new PvError('INPUT_INVALID', 'Binding đã ở L3', { bindingId });
      const r = await readiness.evaluate(b, { fresh: true });
      if (r.openPauses.length > 0) throw new PvError('BINDING_PAUSED', 'Binding đang bị dừng', { bindingId, pauses: r.openPauses.map((p) => p.reason) });
      if (!r.canPromote) {
        const missing = r.conditions.filter((c) => !c.met).map((c) => c.condition.kind);
        throw new PvError('INPUT_INVALID', 'Chưa đạt ngưỡng lên mức', { bindingId, missing });
      }
      const { result, bus } = policy.transact(() => policy.promote(b, 'threshold_met', { conditions: r.conditions.map((c) => c.condition.kind) }));
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
      if (!parsed.success) throw new PvError('INPUT_INVALID', 'Ngưỡng sai', { issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
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

    async runProxyCheckNow(bindingId) {
      const { check, bus } = await proxy.check(bindingId);
      flush(bus);
      return check;
    },
    listProxyChecks: (bindingId, limit) => repos.proxyChecks.list(bindingId, limit),
    currentFuryVersion: () => policy.currentFuryVersion(),

    start: () => scheduler.start(),
    stop: () => scheduler.stop(),
  };

  return { health, policy, proxy, scheduler, readiness, thresholdsSeeder, repos };
}
