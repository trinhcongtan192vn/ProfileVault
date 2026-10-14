import {
  transitionFor,
  type AutomationLevel,
  type Binding,
  type Clock,
  type Condition,
  type ConditionResult,
  type HealthEventRecord,
  type Readiness,
  type Thresholds,
} from '@sctech/profilevault-contract';
import type { BindingsRepo, DetectSuiteRepo, HealthEventsRepo, PausesRepo } from '@sctech/profilevault-db';

export type ConditionEvaluator = (ctx: { binding: Binding; condition: Condition; now: Date }) => ConditionResult | Promise<ConditionResult>;

export interface ReadinessDeps {
  clock: Clock;
  bindings: BindingsRepo;
  events: HealthEventsRepo;
  pauses: PausesRepo;
  detectSuite: DetectSuiteRepo;
  getThresholds: () => Thresholds;
  currentFuryVersion: () => string | undefined;
  cacheMs?: number;
}

const RED_TYPES_IGNORE_NONE: string[] = [];

/** Đánh giá ngưỡng lên mức (SPEC-02 §3.5) với cache 5 phút (§7). */
export class ReadinessEvaluator {
  private readonly extra = new Map<string, ConditionEvaluator>();
  private readonly cache = new Map<string, { at: number; value: Readiness }>();
  private readonly reached = new Map<string, boolean>();
  private readonly listeners = new Set<(bindingId: string, toLevel: AutomationLevel) => void>();
  private readonly cacheMs: number;

  constructor(private readonly d: ReadinessDeps) {
    this.cacheMs = d.cacheMs ?? 5 * 60_000;
  }

  register(kind: 'consistency_clear' | 'checklist_valid', fn: ConditionEvaluator): void {
    this.extra.set(kind, fn);
  }

  invalidate(bindingId?: string): void {
    if (bindingId) this.cache.delete(bindingId);
    else this.cache.clear();
  }

  onReached(listener: (bindingId: string, toLevel: AutomationLevel) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async evaluate(binding: Binding, opts: { fresh?: boolean } = {}): Promise<Readiness> {
    const nowMs = this.d.clock.nowMs();
    const cached = this.cache.get(binding.id);
    if (!opts.fresh && cached && nowMs - cached.at < this.cacheMs) return cached.value;

    const transition = transitionFor(binding.level);
    const openPauses = this.d.pauses.list(binding.id, { open: true });
    let result: Readiness;
    if (!transition || binding.archivedAt) {
      result = { bindingId: binding.id, level: binding.level, nextLevel: null, conditions: [], progress: null, canPromote: false, openPauses, evaluatedAt: this.d.clock.nowIso() };
    } else {
      const conditions = this.d.getThresholds()[transition];
      const results: ConditionResult[] = [];
      for (const c of conditions) results.push(await this.evaluateCondition(binding, c));
      const met = results.filter((r) => r.met).length;
      const allMet = results.length > 0 && met === results.length;
      result = {
        bindingId: binding.id,
        level: binding.level,
        nextLevel: (binding.level + 1) as AutomationLevel,
        conditions: results,
        progress: results.length === 0 ? 1 : met / results.length,
        canPromote: allMet && openPauses.length === 0,
        openPauses,
        evaluatedAt: this.d.clock.nowIso(),
      };
    }
    this.cache.set(binding.id, { at: nowMs, value: result });
    const was = this.reached.get(binding.id) ?? false;
    if (result.canPromote && !was && result.nextLevel !== null) {
      for (const l of this.listeners) l(binding.id, result.nextLevel);
    }
    this.reached.set(binding.id, result.canPromote);
    return result;
  }

  private eventsSince(binding: Binding, types: string[]): HealthEventRecord[] {
    return this.d.events.list({ bindingId: binding.id, types, since: binding.levelSince, limit: 10_000, order: 'asc' });
  }

  private async evaluateCondition(binding: Binding, c: Condition): Promise<ConditionResult> {
    const now = this.d.clock.now();
    switch (c.kind) {
      case 'days_at_level': {
        const days = Math.floor((now.getTime() - Date.parse(binding.levelSince)) / 86_400_000);
        return { condition: c, met: days >= c.min, current: days, required: c.min };
      }
      case 'event_count': {
        // bỏ sự kiện đã bị hoàn tác (manual.note payload.undoOf — giả định G31)
        const undone = new Set(this.d.events.list({ bindingId: binding.id, types: ['manual.note'], limit: 10_000 }).map((e) => e.payload.undoOf).filter((x): x is string => typeof x === 'string'));
        const n = this.eventsSince(binding, [c.type]).filter((e) => !undone.has(e.id)).length;
        return { condition: c, met: n >= c.min, current: n, required: c.min };
      }
      case 'no_red_events': {
        const reds = this.d.events.list({ bindingId: binding.id, since: binding.levelSince, limit: 10_000 }).filter((e) => e.severity === 'red' && !RED_TYPES_IGNORE_NONE.includes(e.type));
        return { condition: c, met: reds.length === 0, current: reds.length, required: 0, ...(reds[0] ? { note: `gần nhất: ${reds[0].type}` } : {}) };
      }
      case 'session_check_rate': {
        const evs = this.eventsSince(binding, ['session_check.ok', 'session_check.logged_out', 'session_check.wrong_account', 'session_check.failed']);
        const ok = evs.filter((e) => e.type === 'session_check.ok').length;
        const total = evs.length;
        const rate = total > 0 ? ok / total : 0;
        if (total < c.minSamples) return { condition: c, met: false, current: `${total}/${c.minSamples} mẫu`, required: c.min, note: 'chưa đủ mẫu' };
        return { condition: c, met: rate >= c.min, current: Number(rate.toFixed(3)), required: c.min };
      }
      case 'proxy_stable': {
        const n = this.eventsSince(binding, ['proxy.country_changed', 'proxy.asn_changed']).length;
        return { condition: c, met: n === 0, current: n === 0 ? 'ổn định' : `${n} lần đổi`, required: 'ổn định' };
      }
      case 'detect_suite_pass': {
        const v = this.d.currentFuryVersion();
        if (!v) return { condition: c, met: false, current: 'chưa biết phiên bản Fury', required: 'đạt' };
        const passed = this.d.detectSuite.hasPassed(v, binding.id);
        return { condition: c, met: passed, current: passed ? `đạt (${v})` : `chưa có kết quả đạt cho ${v}`, required: 'đạt' };
      }
      case 'flow_success_rate': {
        const evs = this.eventsSince(binding, ['run.done', 'run.failed']).filter((e) => e.payload.flowId === c.flowId && (c.mode === undefined || e.payload.mode === c.mode));
        const done = evs.filter((e) => e.type === 'run.done').length;
        const total = evs.length;
        if (total < c.minSamples) return { condition: c, met: false, current: `${total}/${c.minSamples} mẫu`, required: c.min, note: 'chưa đủ mẫu' };
        const rate = done / total;
        return { condition: c, met: rate >= c.min, current: Number(rate.toFixed(3)), required: c.min };
      }
      case 'l2_correct_rate': {
        const evs = this.eventsSince(binding, ['run.done']).filter((e) => e.payload.flowId === c.flowId && e.payload.mode === 'L2' && typeof e.payload.l2Review === 'string');
        const correct = evs.filter((e) => e.payload.l2Review === 'correct').length;
        const total = evs.length;
        if (total < c.minSamples) return { condition: c, met: false, current: `${total}/${c.minSamples} mẫu`, required: c.min, note: 'chưa đủ mẫu' };
        const rate = correct / total;
        return { condition: c, met: rate >= c.min, current: Number(rate.toFixed(3)), required: c.min };
      }
      case 'event_count_by_mode': {
        const n = this.eventsSince(binding, ['run.done']).filter((e) => e.payload.flowId === c.flowId && e.payload.mode === c.mode).length;
        return { condition: c, met: n >= c.min, current: n, required: c.min };
      }
      case 'no_open_site_changed': {
        const evs = this.d.events
          .list({ bindingId: binding.id, types: ['flow.site_changed', 'run.done'], limit: 200 })
          .filter((e) => c.flowId === undefined || e.payload.flowId === c.flowId);
        const last = evs[0];
        const open = last?.type === 'flow.site_changed';
        return { condition: c, met: !open, current: open ? 'còn SITE_CHANGED chưa xử lý' : 'không', required: 'không' };
      }
      case 'consistency_clear':
      case 'checklist_valid': {
        const fn = this.extra.get(c.kind);
        if (!fn) return { condition: c, met: false, current: 'chưa có dữ liệu', required: 'đạt', note: 'kiểm tra nhất quán chưa chạy' };
        return fn({ binding, condition: c, now });
      }
    }
  }
}
