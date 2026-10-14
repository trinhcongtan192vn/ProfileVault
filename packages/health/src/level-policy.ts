import {
  defaultSeverity,
  newId,
  PvError,
  USER_CLEARABLE_PAUSE_REASONS,
  type AutomationLevel,
  type Binding,
  type BusEventMap,
  type BusEventName,
  type Clock,
  type EventSeverity,
  type HealthEventRecord,
  type HealthEventType,
  type LevelChange,
  type Pause,
  type PauseReason,
} from '@sctech/profilevault-contract';
import { eventMeta } from '@sctech/profilevault-contract';
import type { Logger } from '@sctech/profilevault-core';
import type {
  AuditRepo,
  BindingsRepo,
  Database,
  DetectSuiteRepo,
  HealthEventsRepo,
  LevelChangesRepo,
  PausesRepo,
  SettingsRepo,
} from '@sctech/profilevault-db';

export type PendingBusEvent = { [K in BusEventName]: { name: K; payload: BusEventMap[K] } }[BusEventName];

export interface LevelPolicyDeps {
  database: Database;
  clock: Clock;
  bindings: BindingsRepo;
  events: HealthEventsRepo;
  pauses: PausesRepo;
  levelChanges: LevelChangesRepo;
  detectSuite: DetectSuiteRepo;
  settings: SettingsRepo;
  audit: AuditRepo;
  logger: Logger;
}

export const FURY_VERSION_SETTING = 'fury.currentVersion';

/**
 * Quy tắc hạ mức và dừng R1–R7 (SPEC-02 §4). Mọi phương thức `apply*` phải chạy trong `transact()`;
 * sự kiện bus được gom và phát sau khi commit (research R1).
 */
export class LevelPolicy {
  private pending: PendingBusEvent[] = [];
  private depth = 0;
  /** Hàm gọi khi dữ liệu của binding đổi (vô hiệu cache readiness). */
  onChanged: ((bindingId: string) => void) | null = null;

  constructor(private readonly d: LevelPolicyDeps) {}

  /** Chạy `fn` trong giao dịch SQLite; trả kết quả và sự kiện bus chờ phát. Lồng nhau được. */
  transact<T>(fn: () => T): { result: T; bus: PendingBusEvent[] } {
    if (this.depth > 0) {
      this.depth++;
      try {
        return { result: fn(), bus: [] };
      } finally {
        this.depth--;
      }
    }
    this.depth = 1;
    this.pending = [];
    try {
      const result = this.d.database.sqlite.transaction(fn)();
      const bus = this.pending;
      this.pending = [];
      return { result, bus };
    } catch (err) {
      this.pending = [];
      throw err;
    } finally {
      this.depth = 0;
    }
  }

  emit<K extends BusEventName>(name: K, payload: BusEventMap[K]): void {
    this.pending.push({ name, payload } as PendingBusEvent);
  }

  // ---- ghi sự kiện ----

  recordEvent(
    bindingId: string | null,
    type: HealthEventType,
    payload: Record<string, unknown> = {},
    opts: { occurredAt?: string; severity?: EventSeverity } = {},
  ): HealthEventRecord {
    const now = this.d.clock.nowIso();
    const record: HealthEventRecord = {
      id: newId('healthEvent', this.d.clock.nowMs()),
      bindingId,
      type,
      severity: opts.severity ?? defaultSeverity(type),
      source: eventMeta(type).source,
      payload,
      occurredAt: opts.occurredAt ?? now,
      recordedAt: now,
    };
    this.d.events.append(record);
    this.emit('health.event_recorded', { event: record });
    if (bindingId) this.onChanged?.(bindingId);
    return record;
  }

  // ---- mức ----

  private changeLevel(b: Binding, to: AutomationLevel, kind: 'promote' | 'demote', reason: string, detail: Record<string, unknown>, actor: string): LevelChange {
    const now = this.d.clock.nowIso();
    const change: LevelChange = {
      id: newId('levelChange', this.d.clock.nowMs()),
      bindingId: b.id,
      fromLevel: b.level,
      toLevel: to,
      kind,
      reason,
      detail,
      actor,
      createdAt: now,
    };
    this.d.levelChanges.append(change);
    this.d.bindings.setLevel(b.id, to, now);
    this.recordEvent(b.id, kind === 'promote' ? 'level.promoted' : 'level.demoted', { from: b.level, to, reason, changeId: change.id });
    this.d.audit.append({ actorType: actor === 'user' ? 'user' : 'system', action: `binding.level.${kind}`, targetType: 'binding', targetId: b.id, detail: { from: b.level, to, reason } });
    this.emit('binding.level_changed', { bindingId: b.id, changeId: change.id, fromLevel: b.level, toLevel: to, kind, reason });
    b.level = to;
    b.levelSince = now;
    this.onChanged?.(b.id);
    return change;
  }

  promote(b: Binding, reason: string, detail: Record<string, unknown>): LevelChange {
    if (b.level >= 3) throw new PvError('INPUT_INVALID', 'Binding đã ở L3, không có mức kế', { bindingId: b.id });
    return this.changeLevel(b, (b.level + 1) as AutomationLevel, 'promote', reason, detail, 'user');
  }

  demoteTo(b: Binding, to: AutomationLevel, reason: string, detail: Record<string, unknown> = {}): LevelChange | null {
    if (b.archivedAt) return null;
    if (b.level <= to) return null;
    return this.changeLevel(b, to, 'demote', reason, detail, 'system');
  }

  demoteOne(b: Binding, reason: string, detail: Record<string, unknown> = {}): LevelChange | null {
    if (b.level === 0) return null;
    return this.demoteTo(b, (b.level - 1) as AutomationLevel, reason, detail);
  }

  // ---- dừng ----

  openPause(b: Binding, reason: PauseReason, detail: Record<string, unknown> = {}): Pause {
    const existing = this.d.pauses.findOpen(b.id, reason);
    if (existing) return existing;
    const pause = this.d.pauses.open({ id: newId('pause', this.d.clock.nowMs()), bindingId: b.id, reason, detail, createdAt: this.d.clock.nowIso() });
    this.recordEvent(b.id, 'binding.paused', { pauseId: pause.id, reason, detail });
    this.d.audit.append({ actorType: reason === 'manual' ? 'user' : 'system', action: 'binding.pause', targetType: 'binding', targetId: b.id, detail: { pauseId: pause.id, reason } });
    this.emit('binding.pause_changed', { bindingId: b.id, pauseId: pause.id, reason, open: true });
    return pause;
  }

  clearPause(pause: Pause, by: 'user' | 'system'): void {
    if (pause.clearedAt) return;
    const now = this.d.clock.nowIso();
    this.d.pauses.clear(pause.id, now, by);
    this.recordEvent(pause.bindingId, 'binding.resumed', { pauseId: pause.id, reason: pause.reason, clearedBy: by });
    this.d.audit.append({ actorType: by, action: 'binding.pause.clear', targetType: 'binding', targetId: pause.bindingId, detail: { pauseId: pause.id, reason: pause.reason } });
    this.emit('binding.pause_changed', { bindingId: pause.bindingId, pauseId: pause.id, reason: pause.reason, open: false });
  }

  clearOpenPauses(bindingId: string, reason: PauseReason): number {
    let n = 0;
    for (const p of this.d.pauses.list(bindingId, { open: true })) {
      if (p.reason !== reason) continue;
      this.clearPause(p, 'system');
      n++;
    }
    return n;
  }

  // ---- R1–R7 ----

  /** R1: sự kiện đỏ về tài khoản → L0 + `red_event`. */
  applyRedEvent(b: Binding, eventId: string): void {
    if (b.archivedAt) return;
    this.demoteTo(b, 0, 'red_event', { eventId, rule: 'R1' });
    this.openPause(b, 'red_event', { eventId });
  }

  /** R2: đổi quốc gia/ASN → hạ một mức + `proxy_changed`. */
  applyProxyChanged(b: Binding, detail: { eventId: string; proxyCheckId: string; field: 'country' | 'asn'; from: unknown; to: unknown }): void {
    if (b.archivedAt) return;
    this.demoteOne(b, 'proxy_changed', { ...detail, rule: 'R2' });
    this.openPause(b, 'proxy_changed', detail);
  }

  /** R3: nhóm binding trùng exit IP → cả nhóm L0 + `duplicate_exit_ip`; binding không còn trùng → tự gỡ. */
  applyDuplicateExitIp(groups: Map<string, string[]>): void {
    const inGroup = new Set<string>();
    for (const [ip, ids] of groups) {
      if (ids.length < 2) continue;
      for (const id of ids) {
        inGroup.add(id);
        const b = this.d.bindings.get(id);
        if (!b || b.archivedAt) continue;
        const peers = ids.filter((x) => x !== id);
        this.demoteTo(b, 0, 'duplicate_exit_ip', { ip, peers, rule: 'R3' });
        this.openPause(b, 'duplicate_exit_ip', { ip, peers });
      }
    }
    for (const p of this.d.pauses.listOpen()) {
      if (p.reason === 'duplicate_exit_ip' && !inGroup.has(p.bindingId)) this.clearPause(p, 'system');
    }
  }

  /** R4: luật `block` khác trượt → giữ mức, `consistency_block`; hết trượt → tự gỡ. */
  applyConsistencyBlock(b: Binding, failingRuleIds: string[]): void {
    if (b.archivedAt) return;
    if (failingRuleIds.length > 0) this.openPause(b, 'consistency_block', { ruleIds: failingRuleIds });
    else this.clearOpenPauses(b.id, 'consistency_block');
  }

  currentFuryVersion(): string | undefined {
    const v = this.d.settings.get<{ version: string | null }>(FURY_VERSION_SETTING);
    return v?.version ?? undefined;
  }

  setCurrentFuryVersion(version: string | undefined): void {
    this.d.settings.set(FURY_VERSION_SETTING, { version: version ?? null, at: this.d.clock.nowIso() }, 'system');
  }

  /** R5 (kết quả detect-suite): trượt → `detect_suite_failed`; đạt → tự gỡ. Chỉ áp cho phiên bản Fury hiện tại. */
  applyDetectSuite(furyVersion: string, passed: boolean, bindingId?: string): void {
    const current = this.currentFuryVersion();
    if (current !== undefined && current !== furyVersion) return;
    const targets = bindingId ? [this.d.bindings.get(bindingId)].filter((x): x is Binding => !!x) : this.d.bindings.list();
    for (const b of targets) {
      if (b.archivedAt) continue;
      if (passed) this.clearOpenPauses(b.id, 'detect_suite_failed');
      else this.openPause(b, 'detect_suite_failed', { furyVersion });
    }
  }

  /** R5 (Fury đổi phiên bản): chưa có kết quả passed cho phiên bản mới → `detect_suite_failed`. */
  applyFuryVersionChanged(to: string | undefined): void {
    this.setCurrentFuryVersion(to);
    for (const b of this.d.bindings.list()) {
      if (to !== undefined && this.d.detectSuite.hasPassed(to, b.id)) this.clearOpenPauses(b.id, 'detect_suite_failed');
      else this.openPause(b, 'detect_suite_failed', { furyVersion: to ?? null, reason: to === undefined ? 'unknown_version' : 'no_result' });
    }
  }

  /** R6: `flow.site_changed` 2 lần liên tiếp cùng flow ở L3 → L2. Gọi SAU khi đã ghi sự kiện site_changed. */
  applySiteChanged(b: Binding, flowId: string): void {
    if (b.archivedAt || b.level !== 3) return;
    const recent = this.d.events.list({ bindingId: b.id, types: ['flow.site_changed', 'run.done'], limit: 50 }).filter((e) => e.payload.flowId === flowId);
    if (recent.length >= 2 && recent[0]?.type === 'flow.site_changed' && recent[1]?.type === 'flow.site_changed') {
      this.demoteTo(b, 2, 'site_changed', { flowId, rule: 'R6' });
    }
  }

  /** R7: người bấm "Tạm dừng". */
  manualPause(b: Binding, note?: string): Pause {
    return this.openPause(b, 'manual', note ? { note } : {});
  }

  /** Người gỡ dừng — chỉ R1, R2, R7 (SPEC-02 §8 `clearPause`). */
  userClearPause(pauseId: string): void {
    const p = this.d.pauses.get(pauseId);
    if (!p) throw new PvError('INPUT_INVALID', 'Không có pause này', { pauseId });
    if (p.clearedAt) return;
    if (!USER_CLEARABLE_PAUSE_REASONS.includes(p.reason)) {
      throw new PvError('FORBIDDEN_ACTION', `Lý do dừng "${p.reason}" chỉ hệ thống tự gỡ khi lần kiểm kế tiếp đạt`, { pauseId, reason: p.reason });
    }
    this.clearPause(p, 'user');
  }
}
