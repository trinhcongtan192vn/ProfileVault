import {
  newId,
  type AsnType,
  type Binding,
  type BindingConsistency,
  type Clock,
  type ConsistencyResultRow,
  type ConsistencyRunSummary,
  type ConsistencyScore,
  type ConsistencyTrigger,
  type CrossMatrix,
  type FuryProfileDetail,
  type ProxyCheck,
  type RuleConfig,
  type RuleOutcome,
  type Severity,
} from '@sctech/profilevault-contract';
import type { Logger } from '@sctech/profilevault-core';
import type {
  AsnAttestationsRepo,
  BindingsRepo,
  ChecklistsRepo,
  ConsistencyRulesRepo,
  ConsistencyRunsRepo,
  HostSnapshotsRepo,
  ProbeResultsRepo,
  ProxyChecksRepo,
} from '@sctech/profilevault-db';
import type { FuryClient } from '@sctech/profilevault-fury-client';
import type { LevelPolicy, PendingBusEvent } from './level-policy.js';
import { ALL_RULES, RULES_WITH_OWN_PAUSE, defaultRuleConfigs, loadRuleData, subnetOf, type BindingSnapshot, type ConsistencyRule, type RuleContext } from './rules/index.js';

export interface EngineDeps {
  clock: Clock;
  fury: FuryClient;
  logger: Logger;
  bindings: BindingsRepo;
  proxyChecks: ProxyChecksRepo;
  probes: ProbeResultsRepo;
  checklists: ChecklistsRepo;
  hosts: HostSnapshotsRepo;
  rules: ConsistencyRulesRepo;
  runs: ConsistencyRunsRepo;
  attestations: AsnAttestationsRepo;
  policy: LevelPolicy;
  /** Exit chỉ dùng khi ≤ maxAgeHours (mặc định 24). */
  exitMaxAgeHours?: number;
  /** Dữ liệu cũ hơn → `stale` (mặc định 14 ngày). */
  staleDays?: number;
}

const BLOCKING = new Set<Severity>(['block']);

/** Động cơ kiểm tra độ nhất quán (SPEC-02 §6). Chỉ báo và chặn, không ghi tới Fury. */
export class ConsistencyEngine {
  constructor(private readonly d: EngineDeps) {}

  ruleConfigs(): Map<string, RuleConfig> {
    const now = this.d.clock.nowIso();
    const map = new Map(defaultRuleConfigs(now).map((r) => [r.id, r]));
    for (const r of this.d.rules.list()) map.set(r.id, r);
    return map;
  }

  private async snapshotOf(binding: Binding, now: Date): Promise<{ snap: BindingSnapshot; previousExit?: ProxyCheck; previousProbe?: BindingSnapshot['probe']; furyProfileError?: string }> {
    const maxAgeMs = (this.d.exitMaxAgeHours ?? 24) * 3_600_000;
    const latestOk = this.d.proxyChecks.latestOk(binding.id);
    const exit = latestOk && now.getTime() - Date.parse(latestOk.checkedAt) <= maxAgeMs ? latestOk : undefined;
    const previousExit = latestOk ? this.d.proxyChecks.latestOk(binding.id, latestOk.id) : undefined;
    const [probe, previousProbe] = this.d.probes.latestTwo(binding.id);
    let furyProfile: FuryProfileDetail | undefined;
    let furyProfileError: string | undefined;
    try {
      furyProfile = await this.d.fury.getProfile(binding.furyProfileId);
    } catch (err) {
      furyProfileError = err instanceof Error && 'code' in err ? String((err as { code: unknown }).code) : 'lỗi';
    }
    const snap: BindingSnapshot = { binding, exit, furyProfile, checklist: this.d.checklists.get(binding.id), probe };
    return { snap, previousExit, previousProbe, furyProfileError };
  }

  /** Chạy kiểm cho phạm vi (SPEC-02 §6.6). Ghi runs/results, áp R4, trả tóm tắt + sự kiện bus chờ phát. */
  async run(scope: { bindingId?: string }, trigger: ConsistencyTrigger): Promise<{ summary: ConsistencyRunSummary; bus: PendingBusEvent[] }> {
    const now = this.d.clock.now();
    const startedAt = now.toISOString();
    const all = this.d.bindings.list();
    const targets = scope.bindingId ? all.filter((b) => b.id === scope.bindingId) : all;
    const configs = this.ruleConfigs();
    const data = loadRuleData();
    const host = this.d.hosts.latest();
    const attestations = new Map<number, AsnType>(this.d.attestations.list().map((a) => [a.asn, a.asnType]));
    const staleMs = (this.d.staleDays ?? 14) * 86_400_000;

    const snaps = await Promise.all(all.map((b) => this.snapshotOf(b, now)));
    const allSnaps = snaps.map((s) => s.snap);
    const byId = new Map(snaps.map((s) => [s.snap.binding.id, s]));

    const runId = newId('consistencyRun', this.d.clock.nowMs());
    const rows: ConsistencyResultRow[] = [];
    const perBinding = new Map<string, ConsistencyResultRow[]>();
    const push = (r: ConsistencyResultRow) => {
      rows.push(r);
      const list = perBinding.get(r.bindingId) ?? [];
      list.push(r);
      perBinding.set(r.bindingId, list);
    };
    const toRow = (rule: ConsistencyRule, cfg: RuleConfig, o: RuleOutcome, ctx: RuleContext): ConsistencyResultRow => {
      const severity = cfg.severity === 'info' || rule.defaultSeverity === 'info' ? 'info' : (o.severityOverride ?? cfg.severity);
      let hint = o.hint ?? null;
      if (o.status !== 'skipped' && o.status !== 'info') {
        const ts = rule.needs.includes('probe') ? ctx.probe?.capturedAt : rule.needs.includes('exit') ? ctx.exit?.checkedAt : undefined;
        if (ts && now.getTime() - Date.parse(ts) > staleMs) hint = `${hint ? hint + ' ' : ''}(Thiếu dữ liệu: dữ liệu cũ hơn 14 ngày.)`;
      }
      return { runId, bindingId: o.bindingId, ruleId: rule.id, status: o.status, severity, actual: o.actual, expected: o.expected, hint };
    };

    const targetIds = new Set(targets.map((b) => b.id));
    for (const rule of ALL_RULES) {
      const cfg = configs.get(rule.id)!;
      if (rule.scope === 'cross') {
        if (allSnaps.length === 0) continue;
        const ctx: RuleContext = { binding: allSnaps[0]!.binding, allBindings: allSnaps, attestations, now, data, host };
        const outcomes = cfg.enabled ? (rule.evaluate(ctx, cfg.params) as RuleOutcome[]) : allSnaps.map((s) => ({ bindingId: s.binding.id, status: 'skipped' as const, hint: 'Luật đã tắt' }));
        for (const o of outcomes) if (targetIds.has(o.bindingId)) push(toRow(rule, cfg, o, ctx));
        continue;
      }
      for (const b of targets) {
        const s = byId.get(b.id)!;
        const ctx: RuleContext = {
          binding: b,
          furyProfile: s.snap.furyProfile,
          furyProfileError: s.furyProfileError,
          exit: s.snap.exit,
          previousExit: s.previousExit,
          probe: s.snap.probe,
          previousProbe: s.previousProbe,
          host,
          checklist: s.snap.checklist,
          allBindings: allSnaps,
          attestations,
          now,
          data,
        };
        let outcome: RuleOutcome;
        if (!cfg.enabled) outcome = { bindingId: b.id, status: 'skipped', hint: 'Luật đã tắt' };
        else {
          try {
            outcome = rule.evaluate(ctx, cfg.params) as RuleOutcome;
          } catch (err) {
            this.d.logger.error('luật lỗi', { rule: rule.id, err: err instanceof Error ? err.message : String(err) });
            outcome = { bindingId: b.id, status: 'unknown', hint: 'Luật gặp lỗi nội bộ khi đánh giá.' };
          }
        }
        push(toRow(rule, cfg, outcome, ctx));
      }
    }

    const { bus } = this.d.policy.transact(() => {
      this.d.runs.start(runId, trigger, startedAt);
      this.d.runs.addResults(rows);
      for (const b of targets) {
        const results = perBinding.get(b.id) ?? [];
        const failing = results.filter((r) => BLOCKING.has(r.severity) && r.status === 'fail' && !RULES_WITH_OWN_PAUSE.has(r.ruleId)).map((r) => r.ruleId);
        const fresh = this.d.bindings.get(b.id);
        if (fresh) this.d.policy.applyConsistencyBlock(fresh, failing);
        this.d.policy.onChanged?.(b.id);
      }
      this.d.runs.finish(runId, this.d.clock.nowIso());
    });

    const summary: ConsistencyRunSummary = {
      runId,
      trigger,
      startedAt,
      finishedAt: this.d.clock.nowIso(),
      bindings: targets.map((b) => ({ bindingId: b.id, score: score(perBinding.get(b.id) ?? []), results: perBinding.get(b.id) ?? [] })),
    };
    this.d.logger.info('kiểm tra nhất quán xong', { runId, trigger, bindings: targets.length, ms: Date.now() - Date.parse(startedAt) });
    return { summary, bus };
  }

  /** Lần kiểm gần nhất của binding (SPEC-02 §6.5). */
  latest(bindingId: string): (BindingConsistency & { runId: string; trigger: string; finishedAt: string | null }) | undefined {
    const l = this.d.runs.latestForBinding(bindingId);
    if (!l) return undefined;
    return { bindingId, runId: l.run.id, trigger: l.run.trigger, finishedAt: l.run.finishedAt, score: score(l.results), results: l.results };
  }

  /** `consistency_clear` (SPEC-02 §3.2, §6.5): lần kiểm gần nhất ≤ maxAgeHours, mọi luật block (không skipped) đều pass. */
  isClear(bindingId: string, maxAgeHours: number): { clear: boolean; current: string } {
    const l = this.d.runs.latestForBinding(bindingId);
    if (!l) return { clear: false, current: 'chưa kiểm tra nhất quán' };
    const at = l.run.finishedAt ?? l.run.startedAt;
    const ageH = (this.d.clock.nowMs() - Date.parse(at)) / 3_600_000;
    if (ageH > maxAgeHours) return { clear: false, current: `lần kiểm cuối cách ${Math.round(ageH)} giờ (> ${maxAgeHours})` };
    const bad = l.results.filter((r) => BLOCKING.has(r.severity) && (r.status === 'fail' || r.status === 'unknown'));
    if (bad.length > 0) return { clear: false, current: `${bad.length} luật chặn trượt/chưa rõ: ${bad.map((r) => r.ruleId.split('.')[0]).join(', ')}` };
    return { clear: true, current: 'mọi luật chặn đạt' };
  }

  /** Ma trận chéo cho trang Hệ thống (SPEC-07 §4.6). */
  async crossMatrix(): Promise<CrossMatrix> {
    const now = this.d.clock.now();
    const all = this.d.bindings.list();
    const snaps = (await Promise.all(all.map((b) => this.snapshotOf(b, now)))).map((s) => s.snap);
    const cells: CrossMatrix['cells'] = [];
    for (let i = 0; i < snaps.length; i++) {
      for (let j = i + 1; j < snaps.length; j++) {
        const a = snaps[i]!;
        const b = snaps[j]!;
        if (a.exit?.exitIp && a.exit.exitIp === b.exit?.exitIp) cells.push({ a: a.binding.id, b: b.binding.id, kind: 'exit_ip', level: 'red', detail: a.exit.exitIp });
        else if (a.exit?.exitIp && b.exit?.exitIp && subnetOf(a.exit.exitIp) === subnetOf(b.exit.exitIp)) cells.push({ a: a.binding.id, b: b.binding.id, kind: 'subnet', level: 'yellow', detail: subnetOf(a.exit.exitIp) ?? '' });
        if (a.furyProfile?.personaId && a.furyProfile.personaId === b.furyProfile?.personaId && a.exit?.asn !== null && a.exit?.asn !== undefined && a.exit.asn === b.exit?.asn) {
          cells.push({ a: a.binding.id, b: b.binding.id, kind: 'asn_persona', level: 'yellow', detail: `${a.furyProfile.personaId} @ AS${a.exit.asn}` });
        }
        const ca = a.checklist;
        const cb = b.checklist;
        if (ca && cb && ((ca.recoveryEmailHmac && ca.recoveryEmailHmac === cb.recoveryEmailHmac) || (ca.recoveryPhoneHmac && ca.recoveryPhoneHmac === cb.recoveryPhoneHmac))) {
          cells.push({ a: a.binding.id, b: b.binding.id, kind: 'recovery', level: 'red', detail: 'email/số khôi phục trùng' });
        }
      }
    }
    return { bindingIds: all.map((b) => b.id), cells, computedAt: this.d.clock.nowIso() };
  }
}

export function score(results: ConsistencyResultRow[]): ConsistencyScore {
  const counted = results.filter((r) => r.status !== 'skipped' && r.status !== 'info');
  const passed = counted.filter((r) => r.status === 'pass').length;
  return {
    passed,
    total: counted.length,
    blockFailing: counted.filter((r) => r.severity === 'block' && r.status === 'fail').length,
    blockUnknown: counted.filter((r) => r.severity === 'block' && r.status === 'unknown').length,
    ratio: counted.length === 0 ? null : passed / counted.length,
  };
}
